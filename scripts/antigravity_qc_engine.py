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

    set_ai_status("running", "Antigravity AI Audit", "Initializing catalog verification...", 5)
    print("==================================================", flush=True)
    print("      ANTIGRAVITY AUTONOMOUS QC ENGINE (ULTRA)     ", flush=True)
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

    retained_active = []
    stats = {
        "verified": 0,
        "archived": 0,
        "quarantined": 0,
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

        cost = (ev.get("pricing_all_in_cad") or {}).get("regular")
        if cost is None:
            cost = ev.get("price", 0.0)
        try:
            cost = float(cost or 0.0)
        except ValueError:
            cost = 0.0

        # Check A: $50 Budget Ceiling Enforcement
        if cost > 50.0 and not is_free_public:
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

        # Check B: Date Expiration (Safeguards Perennial Free Public Access)
        s3 = (ev.get("show_3") or {}).get("date")
        s2 = (ev.get("show_2") or {}).get("date")
        s1 = (ev.get("show_1") or {}).get("date")
        last_date = s3 or s2 or s1

        if not is_free_public and last_date and last_date < today_str:
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

        # Check C: URL Sanitization
        orig_ticket = ev.get("ticket_url") or ""
        clean_ticket = sanitize_url(orig_ticket)
        if clean_ticket != orig_ticket:
            ev["ticket_url"] = clean_ticket
            stats["sanitized_urls"] += 1

        orig_details = ev.get("details_url") or ""
        clean_details = sanitize_url(orig_details)
        if clean_details != orig_details:
            ev["details_url"] = clean_details

        # Check D: Tag Normalization & Enrichment
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
            d_str = last_date or "Upcoming"
            t_str = (ev.get("show_1") or {}).get("start_time") or ""
            sched = f"{d_str} at {t_str}" if t_str else d_str
            log_confirmed(title, f"Date: {sched} (${cost:.2f} CAD)", step=f"Item {idx}/{total_events}", progress=pct)

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
    set_ai_status("running", "Antigravity AI Audit", "Synchronizing js/data.js frontend feed...", 95)
    sync_js_data_file()

    print("\n==================================================", flush=True)
    print("      ANTIGRAVITY AUDIT FULLY COMPLETED           ", flush=True)
    print(f" • Verified Active: {stats['verified']}", flush=True)
    print(f" • Archived Concluded: {stats['archived']}", flush=True)
    print(f" • Quarantined: {stats['quarantined']}", flush=True)
    print(f" • Cleaned URLs: {stats['sanitized_urls']}", flush=True)
    print("==================================================", flush=True)

    set_ai_status(
        "idle",
        "Antigravity AI Engine (Ultra)",
        f"Audit Complete: {stats['verified']} verified active, {stats['quarantined']} quarantined, {stats['archived']} archived.",
        100
    )

    return stats


if __name__ == "__main__":
    run_antigravity_qc_pass()
