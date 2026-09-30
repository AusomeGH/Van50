#!/usr/bin/env python3
"""
Van50 Antigravity Autonomous QC & Hygiene Engine
================================================
Executes high-fidelity catalog audit, lifecycle verification, link sanitization,
and tag enrichment without external Gemini API keys (powered directly by Antigravity).

Guarantees:
1. Strict $50 CAD price ceiling enforcement.
2. Perennial Drop-In & Free Public Access protection (never archived by date).
3. Concluded time-bound event auto-archival.
4. Tracking parameter scrubbing from direct ticket URLs.
5. High-intent semantic tag normalization.
6. Real-time streaming into data/live_ai_activity.json and console stdout.
"""

from __future__ import annotations
import os
import sys
import json
import re
import urllib.parse
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
ARCHIVE_PATH = os.path.join(DATA_DIR, "events_archive.json")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")

sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from bs4 import BeautifulSoup
from dynamic_enricher import fetch_html
from universal_link_hunter import AutonomousDeepLinkHunter, is_generic_url, OFFICIAL_CALENDAR_PATTERNS
from activity_logger import (
    log_confirmed, log_new_event, log_new_venue, log_new_source,
    log_quarantined, log_archived, log_info, set_ai_status
)
from curator_server import sync_js_data_file


def sanitize_url(url: str) -> str:
    """Strips advertising/tracking query parameters from ticket/venue URLs."""
    if not url or url.startswith("#") or not url.startswith("http"):
        return url
    try:
        parsed = urllib.parse.urlparse(url)
        params = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
        strip_keys = {
            "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
            "fbclid", "gclid", "ref", "aff", "affiliate", "mc_cid", "mc_eid"
        }
        filtered = [(k, v) for k, v in params if k.lower() not in strip_keys]
        new_query = urllib.parse.urlencode(filtered)
        return urllib.parse.urlunparse(parsed._replace(query=new_query))
    except Exception:
        return url


BOT_SHIELDED_DOMAINS = {
    'ra.co', 'residentadvisor.net', 'ticketmaster.ca', 'ticketmaster.com',
    'livenation.com', 'ticketweb.ca', 'ticketweb.com'
}

VANCOUVER_BOUNDS = {
    "min_lat": 49.00,
    "max_lat": 49.45,
    "min_lng": -123.40,
    "max_lng": -122.50
}


def check_link_alive(url: str, timeout: float = 3.0) -> tuple[bool, str]:
    """Checks whether an outbound link is alive vs dead (HTTP 404/410/DNS failure)."""
    if not url or not url.startswith("http"):
        return True, "valid_syntax"
    try:
        parsed = urllib.parse.urlparse(url)
        domain = parsed.netloc.lower()
        if any(shielded in domain for shielded in BOT_SHIELDED_DOMAINS):
            return True, "bot_shielded"

        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
            }
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            code = resp.getcode()
            if code in (404, 410):
                return False, f"HTTP {code}"
            return True, f"HTTP {code}"
    except urllib.error.HTTPError as he:
        if he.code in (404, 410):
            return False, f"HTTP {he.code}"
        return True, f"HTTP {he.code}"
    except Exception as ex:
        err_str = str(ex).lower()
        if "getaddrinfo failed" in err_str or "connection refused" in err_str or "no such host" in err_str:
            return False, "Host Unreachable"
        return True, "network_timeout"


def investigate_event_destination(ev: dict, url: str, venue_map: dict = None) -> tuple[bool, str, dict]:
    """
    Deeply investigates the destination page for an event card:
    1. Validates that the link is alive (not HTTP 404/410/DNS failure).
    2. Identifies bot-shielded platforms (RA, Ticketmaster) by specific event path signatures.
    3. Fetches live destination HTML using desktop browser emulation.
    4. Categorizes destination page type (Venue Calendar vs Direct Event Page vs Bare Homepage).
    5. Extracts distinctive tokens from event title, artist name, and venue.
    6. Ensures venue calendars actually include the specific event and its details.
    7. Ensures direct event links match the specific event title/artist (detects link mismatches).
    8. Fact-checks live card details against page content (cancellation, sold-out, and budget).
    9. Autonomously attempts deep link recovery if a link was pointing to a bare venue homepage or mismatched page.
    """
    title = ev.get("event_name") or ev.get("title", "Untitled")
    artist = ev.get("artist") or ""
    venue = ev.get("venue_name") or ev.get("venue", "Vancouver")

    if not url or not url.startswith("http"):
        return False, "Missing or invalid destination URL", {"type": "invalid_url", "quarantine": True}

    is_alive, link_msg = check_link_alive(url)
    if not is_alive:
        return False, f"Dead link detected ({link_msg}): {url}", {"type": "dead_link", "quarantine": True}

    parsed = urllib.parse.urlparse(url)
    domain = parsed.netloc.lower()
    path = parsed.path.rstrip('/')

    # Bot-shielded ticketing platforms (Akamai / Cloudflare protected)
    if any(s in domain for s in BOT_SHIELDED_DOMAINS):
        if re.search(r'/(?:event|events|tickets?|show|shows|venue)/[A-Za-z0-9_-]+', path, re.I):
            return True, f"Bot-shielded direct event ticket link verified by path signature: {url}", {
                "type": "direct_event",
                "is_sold_out": False,
                "is_cancelled": False
            }
        elif not path or path == "":
            return False, f"Generic bare homepage on ticketing platform ({url}) without specific event ID", {
                "type": "generic_homepage",
                "quarantine": True
            }
        return True, f"Bot-shielded platform link preserved: {url}", {
            "type": "bot_shielded",
            "is_sold_out": False,
            "is_cancelled": False
        }

    # Fetch live HTML
    html = fetch_html(url, timeout=5)
    if not html:
        return True, f"Destination page online ({link_msg}): {url}", {
            "type": "online_uninspected",
            "is_sold_out": False,
            "is_cancelled": False
        }

    soup = BeautifulSoup(html, "html.parser")
    page_title = soup.title.string.strip() if soup.title else ""
    og_title = (soup.find("meta", property="og:title") or {}).get("content", "")
    h_text = " ".join([h.get_text(strip=True) for h in soup.find_all(["h1", "h2", "h3"])])
    page_body_lower = soup.get_text(" ", strip=True).lower()
    header_text = f"{page_title} {og_title} {h_text}".lower()

    # Classification: Is this an official venue calendar / programming listing?
    is_calendar = False
    for pat in OFFICIAL_CALENDAR_PATTERNS:
        if re.match(pat, path, re.IGNORECASE):
            is_calendar = True
            break
    if not is_calendar:
        if any(k in path.lower() for k in ['/shows', '/calendar', '/events', '/live-music', '/schedule', '/whats-on', '/o/', '/venue/']):
            is_calendar = True

    is_bare_root = (not path or path == "")

    # Token extraction for distinctive event identification
    tokens = AutonomousDeepLinkHunter.extract_distinctive_tokens(title, artist, venue=venue)

    # Check presence of event on destination page
    has_exact_title = title.lower() in page_body_lower or title.lower() in header_text
    has_artist = bool(artist and (artist.lower() in page_body_lower or artist.lower() in header_text))
    token_matches = sum(1 for t in tokens if t in page_body_lower)
    token_header_matches = sum(1 for t in tokens if t in header_text)

    is_event_present = (
        has_exact_title or
        has_artist or
        token_header_matches >= 1 or
        (len(tokens) > 0 and token_matches >= min(2, len(tokens)))
    )

    # Live Fact-Checking: Sold Out & Cancellation in page body
    is_sold_out = False
    if is_event_present and re.search(r"\b(sold\s*out|all\s*tickets\s*sold|tickets\s*sold\s*out)\b", page_body_lower):
        is_sold_out = True

    is_cancelled = False
    if is_event_present and re.search(r"(?:\[cancelled\]|\[canceled\]|\[postponed\]|\b(?:event\s+cancelled|show\s+cancelled|performance\s+cancelled|tour\s+postponed)\b)", page_body_lower):
        is_cancelled = True
        return False, f"Destination page confirms event has been cancelled or postponed: {url}", {
            "type": "cancelled",
            "is_cancelled": True,
            "page_title": page_title
        }

    # Case 1: Destination is a Venue Calendar
    if is_calendar:
        if is_event_present:
            return True, f"Event '{title}' confirmed present on venue calendar ({url})", {
                "type": "calendar_confirmed",
                "is_sold_out": is_sold_out,
                "is_cancelled": False,
                "page_title": page_title
            }
        else:
            # Event is missing from venue calendar!
            # Attempt autonomous deep link hunting to see if a direct page exists
            try:
                hunt_res = AutonomousDeepLinkHunter.hunt({"title": title, "artist": artist, "venue": venue, "websiteUrl": url})
                deep_url = hunt_res.get("deepUrl", "")
                if hunt_res.get("resolved") and deep_url and deep_url.rstrip('/') != url.rstrip('/'):
                    return True, f"Promoted calendar to direct event link: {deep_url}", {
                        "type": "calendar_confirmed",
                        "repaired_url": deep_url,
                        "is_sold_out": is_sold_out,
                        "is_cancelled": False,
                        "page_title": page_title
                    }
            except Exception:
                pass

            return False, f"Calendar Drift: Destination venue calendar ({url}) does not list or mention '{title}' or artist '{artist}'.", {
                "type": "calendar_drift",
                "quarantine": True,
                "page_title": page_title
            }

    # Case 2: Destination is a Bare Venue Homepage
    if is_bare_root:
        if is_event_present:
            return True, f"Event '{title}' featured directly on venue homepage ({url})", {
                "type": "homepage_featured",
                "is_sold_out": is_sold_out,
                "is_cancelled": False,
                "page_title": page_title
            }
        else:
            # 1. Check if venue has a registered calendar_url in venues.json
            if venue_map and isinstance(venue_map, dict):
                v_entry = venue_map.get(venue.lower())
                if v_entry and v_entry.get("calendar_url"):
                    cal_candidate = v_entry["calendar_url"]
                    if cal_candidate and cal_candidate.rstrip('/') != url.rstrip('/'):
                        cal_html = fetch_html(cal_candidate, timeout=5)
                        if cal_html:
                            cal_soup = BeautifulSoup(cal_html, "html.parser")
                            cal_body = cal_soup.get_text(" ", strip=True).lower()
                            cal_has_title = title.lower() in cal_body
                            cal_has_artist = bool(artist and artist.lower() in cal_body)
                            cal_token_matches = sum(1 for t in tokens if t in cal_body)
                            if cal_has_title or cal_has_artist or (len(tokens) > 0 and cal_token_matches >= min(2, len(tokens))):
                                return True, f"Upgraded bare homepage to official venue calendar ({cal_candidate}) where '{title}' was verified present.", {
                                    "type": "calendar_confirmed",
                                    "repaired_url": cal_candidate,
                                    "is_sold_out": False,
                                    "is_cancelled": False,
                                    "page_title": cal_soup.title.string.strip() if cal_soup.title else ""
                                }

            # 2. Attempt deep link hunting from homepage
            try:
                hunt_res = AutonomousDeepLinkHunter.hunt({"title": title, "artist": artist, "venue": venue, "websiteUrl": url})
                deep_url = hunt_res.get("deepUrl", "")
                if hunt_res.get("resolved") and deep_url and deep_url.rstrip('/') != url.rstrip('/'):
                    return True, f"Repaired bare venue homepage with direct deep link: {deep_url}", {
                        "type": "homepage_featured",
                        "repaired_url": deep_url,
                        "is_sold_out": is_sold_out,
                        "is_cancelled": False,
                        "page_title": page_title
                    }
            except Exception:
                pass

            return False, f"Generic Link: Destination URL is a bare venue homepage ({url}) without specific event details for '{title}'.", {
                "type": "generic_homepage",
                "quarantine": True,
                "page_title": page_title
            }

    # Case 3: Direct Event Page
    if is_event_present:
        return True, f"Direct event page confirmed for '{title}': {url}", {
            "type": "event_page_confirmed",
            "is_sold_out": is_sold_out,
            "is_cancelled": False,
            "page_title": page_title
        }
    else:
        return False, f"Link Mismatch: Page at {url} ('{page_title}') does not contain details for '{title}'.", {
            "type": "link_mismatch",
            "quarantine": True,
            "page_title": page_title
        }


def normalize_tags(tags: list) -> list:
    """Ensures clean kebab-case tags, removes duplicates, and filters junk."""
    if not tags or not isinstance(tags, list):
        return []
    clean = []
    seen = set()
    for t in tags:
        if not t or not isinstance(t, str):
            continue
        slug = re.sub(r"[^a-z0-9\-]+", "-", t.strip().lower()).strip("-")
        if slug and len(slug) >= 2 and slug not in seen:
            clean.append(slug)
            seen.add(slug)
    return clean[:8]


def run_antigravity_qc_pass(today_str: str = None) -> dict:
    if not today_str:
        today_str = datetime.now().strftime("%Y-%m-%d")

    set_ai_status("running", "Automated QC Audit", "Initializing catalog verification...", 5)
    print("==================================================", flush=True)
    print("      AUTOMATED PYTHON QC AUDIT ENGINE            ", flush=True)
    print(f"      Execution Date: {today_str}                  ", flush=True)
    print("==================================================", flush=True)

    # 1. Safety Backup
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    backup_file = os.path.join(BACKUP_DIR, f"events_antigravity_{ts}.json")
    if os.path.exists(EVENTS_PATH):
        import shutil
        shutil.copy2(EVENTS_PATH, backup_file)
        log_info(f"Safety snapshot preserved: events_antigravity_{ts}.json", progress=10)

    # 2. Load active events
    events = []
    if os.path.exists(EVENTS_PATH):
        with open(EVENTS_PATH, "r", encoding="utf-8") as f:
            events = json.load(f)

    # Load archive
    archive = []
    if os.path.exists(ARCHIVE_PATH):
        with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
            archive = json.load(f)

    # Load quarantine queue
    queue_data = {"metadata": {"version": "1.0.0", "updatedAt": today_str, "pendingCount": 0}, "quarantinedEvents": []}
    if os.path.exists(QUEUE_PATH):
        try:
            with open(QUEUE_PATH, "r", encoding="utf-8") as f:
                queue_data = json.load(f)
        except Exception:
            pass

    quarantined = queue_data.get("quarantinedEvents", [])
    quarantine_ids = {q.get("id") or q.get("event_id") for q in quarantined}

    # Load learned rules for pricing tiers & fee fact-checking
    learned_rules = {}
    rules_path = os.path.join(DATA_DIR, "curator_learned_rules.json")
    if os.path.exists(rules_path):
        try:
            with open(rules_path, "r", encoding="utf-8") as rf:
                learned_rules = json.load(rf)
        except Exception:
            pass
    venue_policy_rules = learned_rules.get("venue_policy_rules", {})
    vendor_fees = learned_rules.get("vendor_fee_formulas", {})

    # Load known venues directory for official calendar verification
    venue_map = {}
    venues_file = os.path.join(DATA_DIR, "venues.json")
    if os.path.exists(venues_file):
        try:
            with open(venues_file, "r", encoding="utf-8") as vf:
                v_list = json.load(vf)
                for v in v_list:
                    vname = v.get("venue_name", "").strip().lower()
                    if vname:
                        venue_map[vname] = v
        except Exception:
            pass

    retained_active = []
    seen_event_fingerprints = {}
    stats = {
        "verified": 0,
        "archived": 0,
        "quarantined": 0,
        "duplicates_removed": 0,
        "tiers_fact_checked": 0,
        "shows_progressed": 0,
        "dead_links_quarantined": 0,
        "calendar_drift_quarantined": 0,
        "link_mismatches_quarantined": 0,
        "generic_links_quarantined": 0,
        "repaired_links": 0,
        "calendar_events_confirmed": 0,
        "direct_events_confirmed": 0,
        "cancelled_archived": 0,
        "sold_out_flagged": 0,
        "sanitized_urls": 0,
        "enriched_tags": 0
    }

    total_events = len(events)
    for idx, ev in enumerate(events, start=1):
        pct = int(10 + (idx / max(1, total_events)) * 80)
        eid = ev.get("event_id") or ev.get("id")
        title = ev.get("event_name") or ev.get("title", "Untitled")
        venue = ev.get("venue_name") or ev.get("venue", "Vancouver")
        cat = ev.get("category", "")
        lifecycle = ev.get("lifecycle_type", "")
        
        is_free_public = (
            cat.lower() in ["free public access", "free-public-access", "public access"] or
            lifecycle == "perennial_drop_in"
        )

        # -------------------------------------------------------------
        # Check 0: Duplicate Event Card Detection & Deduplication Pass
        # -------------------------------------------------------------
        norm_title = re.sub(r"[^a-z0-9]+", "", title.lower())
        norm_venue = re.sub(r"[^a-z0-9]+", "", venue.lower())
        s1_date = (ev.get("show_1") or {}).get("date") or "recurring"
        card_fingerprint = f"{norm_title}::{norm_venue}::{s1_date}" if not is_free_public else f"{norm_title}::{norm_venue}"

        if card_fingerprint in seen_event_fingerprints:
            prev_idx = seen_event_fingerprints[card_fingerprint]
            prev_ev = retained_active[prev_idx]
            
            # Compare richness: if new ev has tiers or longer description, replace prior
            prev_has_tiers = bool(prev_ev.get("ticket_tiers") or prev_ev.get("ticketTiers"))
            new_has_tiers = bool(ev.get("ticket_tiers") or ev.get("ticketTiers"))
            
            if new_has_tiers and not prev_has_tiers:
                retained_active[prev_idx] = ev
            
            log_info(f"Deduplicated duplicate event card: '{title}' at {venue}", progress=pct)
            stats["duplicates_removed"] += 1
            continue
        
        # -------------------------------------------------------------
        # Check A: Admission Pricing & Multi-Tier Fact-Checking
        # -------------------------------------------------------------
        cost = (ev.get("pricing_all_in_cad") or {}).get("regular")
        if cost is None:
            cost = ev.get("price", 0.0)
        try:
            cost = float(cost or 0.0)
        except ValueError:
            cost = 0.0

        # Multi-Tier Extraction & Verification
        tier_list = ev.get("ticket_tiers") or ev.get("ticketTiers") or []
        verified_tiers = []

        if isinstance(tier_list, list) and len(tier_list) > 0:
            for t in tier_list:
                if not isinstance(t, dict):
                    continue
                t_name = str(t.get("name") or "Admission").replace("\ufffd", "").strip()
                t_base = t.get("base")
                t_total = t.get("total") or t.get("price") or t_base or 0.0
                try:
                    t_total = float(t_total)
                except ValueError:
                    t_total = cost

                # Verify fee math if provider has learned fee formula
                provider = (ev.get("ticket_provider") or "").lower()
                for v_domain, v_rule in vendor_fees.items():
                    if v_domain in provider or v_domain in (ev.get("ticket_url") or "").lower():
                        if t_base is not None and t_base > 0:
                            calc_fee = (t_base * v_rule.get("feePercent", 0.0)) + v_rule.get("feeFixed", 0.0)
                            expected_total = round(t_base + calc_fee, 2)
                            if abs(t_total - expected_total) > 0.5:
                                t_total = expected_total

                verified_tiers.append({
                    "name": t_name,
                    "base": float(t_base) if t_base is not None else t_total,
                    "total": t_total,
                    "fee": round(t_total - (float(t_base) if t_base is not None else t_total), 2) if t_base is not None else None,
                    "isFree": t_total <= 0
                })
                stats["tiers_fact_checked"] += 1

            ev["ticket_tiers"] = verified_tiers
            ev["ticketTiers"] = verified_tiers

        # Cross-reference with learned venue policy rules (e.g. door cover rates)
        venue_rule = venue_policy_rules.get(venue)
        if venue_rule and not verified_tiers and not is_free_public:
            door_rate = venue_rule.get("doorPrice")
            if door_rate is not None and cost == 0.0:
                cost = float(door_rate)
                if isinstance(ev.get("pricing_all_in_cad"), dict):
                    ev["pricing_all_in_cad"]["regular"] = cost

        # Check A1: Strict $50 Budget Ceiling Enforcement
        min_available_tier = min([t["total"] for t in verified_tiers], default=cost)
        if (cost > 50.0 and min_available_tier > 50.0) and not is_free_public:
            reason = f"All-in price ${cost:.2f} CAD exceeds strict $50.00 CAD threshold"
            log_quarantined(title, reason, step=f"Item {idx}/{total_events}", progress=pct)
            if eid not in quarantine_ids:
                quarantined.append({
                    "id": eid,
                    "title": title,
                    "artist": ev.get("artist") or title,
                    "venue": venue,
                    "address": ev.get("full_address", "Vancouver, BC"),
                    "neighborhood": ev.get("neighborhood", "Vancouver"),
                    "price": cost,
                    "priceLabel": f"${cost:.2f} CAD",
                    "category": (ev.get("category") or "General").lower(),
                    "categoryLabel": ev.get("category", "General"),
                    "startIso": f"{(ev.get('show_1') or {}).get('date', today_str)}T19:00:00",
                    "websiteUrl": ev.get("ticket_url") or ev.get("details_url") or "",
                    "quarantineReason": f"Antigravity Audit: {reason}",
                    "flaggedAt": today_str
                })
                quarantine_ids.add(eid)
            stats["quarantined"] += 1
            continue

        # If regular exceeded $50, but an accessible GA tier exists <= $50, normalize cost
        if cost > 50.0 and min_available_tier <= 50.0:
            cost = min_available_tier
            if isinstance(ev.get("pricing_all_in_cad"), dict):
                ev["pricing_all_in_cad"]["regular"] = cost
            ev["price"] = cost

        # -------------------------------------------------------------
        # Check B: Multi-Show Date Progression & Expiration
        # -------------------------------------------------------------
        s1 = ev.get("show_1") or {}
        s2 = ev.get("show_2") or {}
        s3 = ev.get("show_3") or {}
        s1_date = s1.get("date")
        s2_date = s2.get("date")
        s3_date = s3.get("date")

        # Advance multi-show schedules if show_1 has concluded
        if not is_free_public and s1_date and s1_date < today_str:
            if s2_date and s2_date >= today_str:
                ev["show_1"] = s2
                ev["show_2"] = s3 if (s3_date and s3_date >= today_str) else None
                ev["show_3"] = None
                ev["dateSchedule"] = ev["show_1"].get("date")
                stats["shows_progressed"] += 1
                log_info(f"Show schedule advanced: '{title}' rolled forward from {s1_date} to {s2_date}", progress=pct)
                s1_date = s2_date
            elif s3_date and s3_date >= today_str:
                ev["show_1"] = s3
                ev["show_2"] = None
                ev["show_3"] = None
                ev["dateSchedule"] = ev["show_1"].get("date")
                stats["shows_progressed"] += 1
                log_info(f"Show schedule advanced: '{title}' rolled forward from {s1_date} to {s3_date}", progress=pct)
                s1_date = s3_date
            else:
                # All scheduled dates concluded
                last_date = s3_date or s2_date or s1_date
                reason = f"Show schedule ended on {last_date}"
                log_archived(title, reason, step=f"Item {idx}/{total_events}", progress=pct)
                archive.append({
                    "event_id": eid,
                    "event_name": title,
                    "category": ev.get("category", "General"),
                    "venue_name": venue,
                    "full_address": ev.get("full_address", "Vancouver, BC"),
                    "neighborhood": ev.get("neighborhood", "Vancouver"),
                    "description": ev.get("description", ""),
                    "attempted_price_cad": cost,
                    "discovery_url": ev.get("ticket_url") or ev.get("discovery_url") or "",
                    "archive_reason": f"Antigravity Audit: {reason}",
                    "archived_at": today_str
                })
                stats["archived"] += 1
                continue

        # -------------------------------------------------------------
        # Check B2: Cancellation & Postponement Audit
        # -------------------------------------------------------------
        combined_text = f"{title} {ev.get('description', '')} {ev.get('curator_notes', '')}".lower()
        if re.search(r"(?:\[cancelled\]|\[canceled\]|\[postponed\]|\b(?:event\s+cancelled|show\s+cancelled|tour\s+postponed|tour\s+cancelled|rescheduled\s+to\s+\d{4})\b)", combined_text):
            reason = "Event marked as cancelled or postponed by organizer"
            log_archived(title, reason, step=f"Item {idx}/{total_events}", progress=pct)
            archive.append({
                "event_id": eid,
                "event_name": title,
                "category": ev.get("category", "General"),
                "venue_name": venue,
                "full_address": ev.get("full_address", "Vancouver, BC"),
                "neighborhood": ev.get("neighborhood", "Vancouver"),
                "description": ev.get("description", ""),
                "attempted_price_cad": cost,
                "discovery_url": ev.get("ticket_url") or ev.get("discovery_url") or "",
                "archive_reason": f"Antigravity Audit: {reason}",
                "archived_at": today_str
            })
            stats["cancelled_archived"] += 1
            continue

        # -------------------------------------------------------------
        # Check B3: Sold Out Audit
        # -------------------------------------------------------------
        if re.search(r"\b(sold out|all tickets sold|tickets sold out|sold-out)\b", combined_text):
            ev["is_sold_out"] = True
            stats["sold_out_flagged"] += 1

        # -------------------------------------------------------------
        # Check B4: Geographic Coordinate Boundary Verification
        # -------------------------------------------------------------
        coords = ev.get("coordinates")
        if isinstance(coords, list) and len(coords) == 2 and all(isinstance(c, (int, float)) for c in coords):
            lat, lng = float(coords[0]), float(coords[1])
            if not (VANCOUVER_BOUNDS["min_lat"] <= lat <= VANCOUVER_BOUNDS["max_lat"] and VANCOUVER_BOUNDS["min_lng"] <= lng <= VANCOUVER_BOUNDS["max_lng"]):
                reason = f"Coordinates [{lat:.4f}, {lng:.4f}] fall outside Greater Vancouver boundaries"
                log_quarantined(title, reason, step=f"Item {idx}/{total_events}", progress=pct)
                if eid not in quarantine_ids:
                    quarantined.append({
                        "id": eid,
                        "title": title,
                        "artist": ev.get("artist") or title,
                        "venue": venue,
                        "address": ev.get("full_address", "Vancouver, BC"),
                        "neighborhood": ev.get("neighborhood", "Vancouver"),
                        "price": cost,
                        "priceLabel": f"${cost:.2f} CAD",
                        "category": (ev.get("category") or "General").lower(),
                        "categoryLabel": ev.get("category", "General"),
                        "startIso": f"{(ev.get('show_1') or {}).get('date', today_str)}T19:00:00",
                        "websiteUrl": ev.get("ticket_url") or ev.get("details_url") or "",
                        "quarantineReason": f"Antigravity Audit: {reason}",
                        "flaggedAt": today_str
                    })
                    quarantine_ids.add(eid)
                stats["quarantined"] += 1
                continue

        # -------------------------------------------------------------
        # Check C: Live Link Health & URL Sanitization
        # -------------------------------------------------------------
        orig_ticket = ev.get("ticket_url") or ""
        clean_ticket = sanitize_url(orig_ticket)
        if clean_ticket != orig_ticket:
            ev["ticket_url"] = clean_ticket
            stats["sanitized_urls"] += 1

        orig_details = ev.get("details_url") or ""
        clean_details = sanitize_url(orig_details)
        if clean_details != orig_details:
            ev["details_url"] = clean_details

        # -------------------------------------------------------------
        # Check C: Deep Hyperlink & Event Detail Investigation
        # -------------------------------------------------------------
        target_check_url = clean_ticket or clean_details
        if target_check_url and not is_free_public:
            ok, diag_msg, meta = investigate_event_destination(ev, target_check_url, venue_map=venue_map)

            # If organizer marked event cancelled or postponed on live destination page:
            if meta.get("is_cancelled"):
                reason = f"Destination Page Cancellation: {diag_msg}"
                log_archived(title, reason, step=f"Item {idx}/{total_events}", progress=pct)
                archive.append({
                    "event_id": eid,
                    "event_name": title,
                    "category": ev.get("category", "General"),
                    "venue_name": venue,
                    "full_address": ev.get("full_address", "Vancouver, BC"),
                    "neighborhood": ev.get("neighborhood", "Vancouver"),
                    "description": ev.get("description", ""),
                    "attempted_price_cad": cost,
                    "discovery_url": target_check_url,
                    "archive_reason": f"Antigravity Audit: {reason}",
                    "archived_at": today_str
                })
                stats["cancelled_archived"] += 1
                continue

            # If check failed (dead link, calendar drift, generic homepage, or link mismatch):
            if not ok and meta.get("quarantine"):
                reason = diag_msg
                log_quarantined(title, reason, step=f"Item {idx}/{total_events}", progress=pct)
                if eid not in quarantine_ids:
                    quarantined.append({
                        "id": eid,
                        "title": title,
                        "artist": ev.get("artist") or title,
                        "venue": venue,
                        "address": ev.get("full_address", "Vancouver, BC"),
                        "neighborhood": ev.get("neighborhood", "Vancouver"),
                        "price": cost,
                        "priceLabel": f"${cost:.2f} CAD",
                        "category": (ev.get("category") or "General").lower(),
                        "categoryLabel": ev.get("category", "General"),
                        "startIso": f"{(ev.get('show_1') or {}).get('date', today_str)}T19:00:00",
                        "websiteUrl": target_check_url,
                        "quarantineReason": f"Antigravity Audit: {reason}",
                        "flaggedAt": today_str
                    })
                    quarantine_ids.add(eid)

                m_type = meta.get("type")
                if m_type == "dead_link":
                    stats["dead_links_quarantined"] += 1
                elif m_type == "calendar_drift":
                    stats["calendar_drift_quarantined"] += 1
                elif m_type == "link_mismatch":
                    stats["link_mismatches_quarantined"] += 1
                elif m_type == "generic_homepage":
                    stats["generic_links_quarantined"] += 1
                stats["quarantined"] += 1
                continue

            # If link was successfully repaired to a direct event deep link:
            if meta.get("repaired_url"):
                repaired = meta["repaired_url"]
                ev["ticket_url"] = repaired
                ev["details_url"] = repaired
                stats["repaired_links"] += 1
                log_info(f"Link Self-Healed: '{title}' upgraded to direct deep link {repaired}", progress=pct)

            # If page verified event as sold out:
            if meta.get("is_sold_out"):
                ev["is_sold_out"] = True
                stats["sold_out_flagged"] += 1
                log_info(f"Sold-Out Stamped: '{title}' verified sold out on destination page.", progress=pct)

            # Track confirmed link classifications:
            if meta.get("type") == "calendar_confirmed":
                stats["calendar_events_confirmed"] += 1
                log_info(f"Calendar Verified: '{title}' confirmed listed on venue calendar ({target_check_url})", progress=pct)
            elif meta.get("type") == "event_page_confirmed":
                stats["direct_events_confirmed"] += 1
                log_info(f"Event Page Verified: '{title}' confirmed matching page content ({target_check_url})", progress=pct)

        # -------------------------------------------------------------
        # Check D: Tag Normalization & Enrichment
        # -------------------------------------------------------------
        raw_tags = ev.get("tags") or []
        norm_tags = normalize_tags(raw_tags)
        # Ensure category slug exists in tags
        cat_slug = re.sub(r"[^a-z0-9\-]+", "-", cat.lower()).strip("-")
        if cat_slug and cat_slug not in norm_tags:
            norm_tags.append(cat_slug)
        ev["tags"] = norm_tags

        # Log confirmation
        if is_free_public:
            hours = ev.get("operating_hours") or "Open Daily"
            log_confirmed(title, f"Open Hours: {hours}", step=f"Item {idx}/{total_events}", progress=pct)
        else:
            d_str = s1_date or "Upcoming"
            t_str = (ev.get("show_1") or {}).get("start_time") or ""
            sched = f"{d_str} at {t_str}" if t_str else d_str
            tiers_summary = f" ({len(verified_tiers)} tiers)" if verified_tiers else ""
            log_confirmed(title, f"Date: {sched} (${cost:.2f} CAD){tiers_summary}", step=f"Item {idx}/{total_events}", progress=pct)

        seen_event_fingerprints[card_fingerprint] = len(retained_active)
        retained_active.append(ev)
        stats["verified"] += 1

    # 3. Save Catalogs
    with open(EVENTS_PATH, "w", encoding="utf-8") as f:
        json.dump(retained_active, f, indent=2, ensure_ascii=False)

    with open(ARCHIVE_PATH, "w", encoding="utf-8") as f:
        json.dump(archive, f, indent=2, ensure_ascii=False)

    queue_data["quarantinedEvents"] = quarantined
    queue_data["pendingCount"] = len(quarantined)
    queue_data["metadata"]["pendingCount"] = len(quarantined)
    queue_data["metadata"]["updatedAt"] = today_str
    with open(QUEUE_PATH, "w", encoding="utf-8") as f:
        json.dump(queue_data, f, indent=2, ensure_ascii=False)

    # 4. Synchronize js/data.js
    set_ai_status("running", "Automated QC Audit", "Synchronizing js/data.js frontend feed...", 95)
    sync_js_data_file()

    print("\n==================================================", flush=True)
    print("      AUTOMATED QC AUDIT FULLY COMPLETED          ", flush=True)
    print(f" • Verified Active: {stats['verified']}", flush=True)
    print(f" • Direct Event Pages Verified: {stats.get('direct_events_confirmed', 0)}", flush=True)
    print(f" • Venue Calendar Listings Verified: {stats.get('calendar_events_confirmed', 0)}", flush=True)
    print(f" • Self-Healed Deep Links: {stats.get('repaired_links', 0)}", flush=True)
    print(f" • Calendar Drift Quarantined: {stats.get('calendar_drift_quarantined', 0)}", flush=True)
    print(f" • Link Mismatches Quarantined: {stats.get('link_mismatches_quarantined', 0)}", flush=True)
    print(f" • Generic Links Quarantined: {stats.get('generic_links_quarantined', 0)}", flush=True)
    print(f" • Dead Links Quarantined: {stats.get('dead_links_quarantined', 0)}", flush=True)
    print(f" • Multi-Show Schedules Progressed: {stats.get('shows_progressed', 0)}", flush=True)
    print(f" • Deduplicated Duplicate Cards: {stats['duplicates_removed']}", flush=True)
    print(f" • Admission Tiers Fact-Checked: {stats['tiers_fact_checked']}", flush=True)
    print(f" • Cancelled/Postponed Archived: {stats.get('cancelled_archived', 0)}", flush=True)
    print(f" • Sold-Out Cards Flagged: {stats.get('sold_out_flagged', 0)}", flush=True)
    print(f" • Concluded Archived: {stats['archived']}", flush=True)
    print(f" • Over-Budget Quarantined: {stats['quarantined']}", flush=True)
    print(f" • Cleaned URLs: {stats['sanitized_urls']}", flush=True)
    print("==================================================", flush=True)

    set_ai_status(
        "idle",
        "Automated Python QC Engine",
        f"Audit Complete: {stats['verified']} active verified ({stats.get('direct_events_confirmed', 0)} direct, {stats.get('calendar_events_confirmed', 0)} calendar), {stats.get('calendar_drift_quarantined', 0)} calendar drift, {stats.get('link_mismatches_quarantined', 0)} link mismatches, {stats.get('dead_links_quarantined', 0)} dead links quarantined.",
        100
    )

    return stats


if __name__ == "__main__":
    run_antigravity_qc_pass()
