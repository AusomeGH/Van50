#!/usr/bin/env python3
"""
Van50 Gemini AI Autonomous Event Scout & Curator
=================================================
Automated event discovery, full-fee computation (under $50 CAD),
verified repeating event resolution, and master catalog maintenance using Gemini AI.
Maintains pure JSON master catalogs across active events, archives, venues, festivals, and ticketing sources.
"""

from __future__ import annotations
import os
import sys
import json
import re
import time
import argparse
import traceback
from datetime import datetime, date, timedelta, timezone
from typing import Dict, Any, List, Optional

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")

# Clean JSON Catalogs (Option 2)
EVENTS_JSON = os.path.join(DATA_DIR, "events.json")
EVENTS_ARCHIVE_JSON = os.path.join(DATA_DIR, "events_archive.json")
VENUES_JSON = os.path.join(DATA_DIR, "venues.json")
FESTIVALS_JSON = os.path.join(DATA_DIR, "festivals.json")
TICKETING_SOURCES_JSON = os.path.join(DATA_DIR, "ticketing_sources.json")
DISCOVERY_SOURCES_JSON = os.path.join(DATA_DIR, "discovery_sources.json")
ORGANIZERS_JSON = os.path.join(DATA_DIR, "organizers_directory.json")



def load_env():
    """Loads environment variables from .env if present."""
    env_file = os.path.join(BASE_DIR, ".env")
    if os.path.exists(env_file):
        try:
            with open(env_file, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and k not in os.environ:
                        os.environ[k] = v
        except Exception:
            pass


load_env()


def get_gemini_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        print("[WARN] GEMINI_API_KEY environment variable is not set.")
    return key


def call_gemini_with_search(prompt: str, api_key: str, model: str = "gemini-3.8-flash") -> Optional[str]:
    """
    Calls the Gemini REST API with Google Search Grounding enabled.
    Falls back gracefully if search tool is not supported in a given region.
    """
    import urllib.request
    import urllib.error

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    
    payload = {
        "contents": [
            {
                "parts": [{"text": prompt}]
            }
        ],
        "tools": [
            {"googleSearch": {}}
        ],
        "generationConfig": {
            "temperature": 0.2
        }
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            candidates = data.get("candidates", [])
            if candidates:
                parts = candidates[0].get("content", {}).get("parts", [])
                text_parts = [p.get("text", "") for p in parts if "text" in p]
                return "\n".join(text_parts)
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="ignore")
        print(f"[ERROR] Gemini API HTTP Error {e.code}: {error_body}")
        # If googleSearch fails or is disabled, retry without tools
        if "tools" in error_body.lower() or "search" in error_body.lower():
            print("[INFO] Retrying Gemini call without search grounding...")
            payload.pop("tools", None)
            req_fallback = urllib.request.Request(
                url,
                data=json.dumps(payload).encode("utf-8"),
                headers={"Content-Type": "application/json"}
            )
            with urllib.request.urlopen(req_fallback, timeout=60) as resp2:
                data2 = json.loads(resp2.read().decode("utf-8"))
                candidates = data2.get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    return "\n".join([p.get("text", "") for p in parts if "text" in p])
    except Exception as e:
        print(f"[ERROR] Failed to query Gemini API: {e}")
    return None


def call_gemini_json_extractor(raw_content: str, api_key: str, model: str = "gemini-3.8-flash") -> Optional[Dict[str, Any]]:
    """
    Takes discovered web event text and parses it into strict structured JSON.
    """
    import urllib.request

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    
    today_str = datetime.now().strftime("%Y-%m-%d")
    
    structuring_prompt = f"""
You are the Van50 Data Extraction Engine. Today's date is {today_str}.
Analyze the following event information discovered for Vancouver, BC, and extract all events that strictly cost $50.00 CAD or less per ticket ALL-IN (including taxes and estimated ticketing fees).

CRITICAL CONSTRAINTS:
1. ONLY return events occurring in Vancouver, BC (or immediate Metro Vancouver transit hubs).
2. HARD PRICE CAP: All-in cost must be <= $50.00 CAD.
   - True All-In Cost = Base Ticket + Platform Service Fee (estimate $2-$5 if on Eventbrite/Showpass/Ticketmaster) + 5% GST.
   - If base ticket is >= $43.00 CAD and fees are unverified, set approval_status to "Quarantined".
3. VERIFIED REPEAT SHOWINGS (DO NOT GUESS):
   - Only fill show_2 and show_3 if explicit calendar dates/times are verified.
   - If an event claims to 'repeat weekly' or 'runs daily' but specific future dates are not confirmed, leave show_2 and show_3 completely EMPTY (null).
   - NEVER invent or extrapolate dates. Empty fields are preferred over inaccurate guesses.
4. Also extract any new Venues, Festivals, Ticketing Platforms, and Aggregator websites identified.

RAW DISCOVERED CONTENT:
{raw_content}

Output MUST be a single, valid JSON object with the following schema:
{{
  "events_active": [
    {{
      "event_id": "van50-slug-id",
      "event_name": "Concise Descriptive Title",
      "category": "Live Music | Comedy | Theatre | Art & Culture | Food & Drink | Community | Film | Outdoor | Sports",
      "venue_name": "Venue Name",
      "full_address": "Street address, Vancouver, BC",
      "neighborhood": "Downtown | Mount Pleasant | Commercial Drive | Kitsilano | etc",
      "description": "2-3 sentence punchy summary",
      "pricing_all_in_cad": {{
        "regular": 15.00,
        "senior": null,
        "student": null,
        "member": null
      }},
      "show_1": {{
        "date": "YYYY-MM-DD",
        "start_time": "HH:MM",
        "end_time": "HH:MM",
        "cost": 15.00
      }},
      "show_2": null,
      "show_3": null,
      "discovery_url": "URL where found",
      "details_url": "Official event info URL",
      "ticket_url": "Direct ticket purchase URL",
      "ticket_provider": "Eventbrite | Showpass | Direct | Free",
      "tags": ["indie", "live-music", "date-night"],
      "festival_affiliation": "None or Festival Name",
      "approval_status": "Auto-Approved | Quarantined",
      "curator_notes": "Note about age limit (19+), door fee, or fee verification"
    }}
  ],
  "discovered_venues": [
    {{
      "venue_name": "Name",
      "website_url": "URL",
      "calendar_url": "URL",
      "full_address": "Address",
      "neighborhood": "Neighborhood",
      "description": "Brief description"
    }}
  ],
  "discovered_festivals": [
    {{
      "festival_name": "Name",
      "website_url": "URL",
      "schedule_url": "URL",
      "location": "Address or Multiple Venues",
      "start_date": "YYYY-MM-DD",
      "end_date": "YYYY-MM-DD",
      "description": "Brief description"
    }}
  ]
}}
"""

    payload = {
        "contents": [
            {"parts": [{"text": structuring_prompt}]}
        ],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            candidates = data.get("candidates", [])
            if candidates:
                part_text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                # Clean up if markdown fences present
                clean_json = re.sub(r"^```json\s*", "", part_text.strip())
                clean_json = re.sub(r"\s*```$", "", clean_json)
                return json.loads(clean_json)
    except Exception as e:
        print(f"[ERROR] Structuring JSON call failed: {e}")
    return None


def call_gemini_direct_json(prompt: str, api_key: str, model: str = "gemini-3.8-flash") -> Optional[Dict[str, Any]]:
    """Calls Gemini REST API directly with responseMimeType: application/json."""
    import urllib.request
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload = {
        "contents": [
            {"parts": [{"text": prompt}]}
        ],
        "generationConfig": {
            "temperature": 0.1,
            "responseMimeType": "application/json"
        }
    }
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"}
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            candidates = data.get("candidates", [])
            if candidates:
                part_text = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                clean_json = re.sub(r"^```json\s*", "", part_text.strip())
                clean_json = re.sub(r"\s*```$", "", clean_json)
                return json.loads(clean_json)
    except Exception as e:
        print(f"[ERROR] Direct JSON call failed: {e}")
    return None


def audit_and_verify_active_events(api_key: str, max_check: int = 15) -> Dict[str, Any]:
    """
    1. events.json:
    - Double checks all details and links and ensures they are correct, or corrects them.
    - If the AI can't figure it out, flags it for the curator and adds it to the Quarantine.
    - If the event has ended/concluded, moves it to events_archive.json.
    """
    today_str = datetime.now().strftime("%Y-%m-%d")
    results = {"verified": 0, "updated": 0, "archived": 0, "quarantined": 0}

    if not os.path.exists(EVENTS_JSON):
        return results

    with open(EVENTS_JSON, "r", encoding="utf-8") as f:
        events = json.load(f)

    archived_events = []
    if os.path.exists(EVENTS_ARCHIVE_JSON):
        try:
            with open(EVENTS_ARCHIVE_JSON, "r", encoding="utf-8") as f:
                archived_events = json.load(f)
        except Exception:
            pass

    queue_data = {
        "metadata": {
            "version": "1.0.0",
            "updatedAt": today_str,
            "pendingCount": 0,
            "description": "Events quarantined for manual curator review due to ambiguous status, unverified checkout pricing, or unresolvable links."
        },
        "quarantinedEvents": []
    }
    if os.path.exists(QUEUE_PATH):
        try:
            with open(QUEUE_PATH, "r", encoding="utf-8") as f:
                queue_data = json.load(f)
        except Exception:
            pass
    quarantined = queue_data.get("quarantinedEvents", [])
    quarantine_ids = {q.get("id") or q.get("event_id") for q in quarantined}

    updated_events = []
    checked_count = 0

    # Prioritize unverified events or events not verified today
    unverified = [e for e in events if f"({today_str})" not in (e.get("curator_notes") or "")]
    already_verified = [e for e in events if f"({today_str})" in (e.get("curator_notes") or "")]
    sorted_events = unverified + already_verified

    for ev in sorted_events:
        eid = ev.get("event_id")
        title = ev.get("event_name", "")
        venue = ev.get("venue_name", "")
        url = ev.get("ticket_url") or ev.get("details_url") or ev.get("discovery_url") or ""

        # Check showing dates
        s3 = (ev.get("show_3") or {}).get("date")
        s2 = (ev.get("show_2") or {}).get("date")
        s1 = (ev.get("show_1") or {}).get("date")
        last_date = s3 or s2 or s1

        # Automatic expiration check: date is strictly in the past
        if last_date and last_date < today_str:
            print(f"[AUDIT: ARCHIVE] Event '{title}' concluded on {last_date}. Moving to archive.")
            archived_events.append({
                "event_id": eid,
                "event_name": title,
                "category": ev.get("category", "General"),
                "venue_name": venue,
                "full_address": ev.get("full_address", "Vancouver, BC"),
                "neighborhood": ev.get("neighborhood", "Vancouver"),
                "description": ev.get("description", ""),
                "attempted_price_cad": (ev.get("pricing_all_in_cad") or {}).get("regular", 0.0),
                "discovery_url": url,
                "archive_reason": f"AI Audit: Event date {last_date} has concluded",
                "archived_at": today_str
            })
            results["archived"] += 1
            continue

        # AI live verification for unverified active events
        is_already_verified = f"({today_str})" in (ev.get("curator_notes") or "")
        if not is_already_verified and (max_check is None or checked_count < max_check):
            checked_count += 1
            cost = (ev.get("pricing_all_in_cad") or {}).get("regular", 0.0)
            print(f"[AUDIT {checked_count}/{max_check or len(events)}] Checking '{title}' at {venue}...")

            search_prompt = (
                f"Search Google for current live event details for Vancouver event: "
                f"'{title}' at '{venue}' (URL: '{url}', Date: '{last_date}', Stated Price: ${cost} CAD). "
                f"Determine:\n"
                f"1. Is this event still valid, active, and upcoming?\n"
                f"2. Are the date, start time, and pricing <= $50 CAD accurate, or should they be updated?\n"
                f"3. Is the official URL active, or is there an updated direct link?\n"
                f"4. Can this event be verified, or is it unresolvable / dead link with no replacement?"
            )
            search_res = call_gemini_with_search(search_prompt, api_key)
            if search_res:
                dec_prompt = f"""
You are the Van50 Event Auditor. Today is {today_str}.
Analyze the live web research for event '{title}' at '{venue}':

RESEARCH:
{search_res}

RULES:
- "VALID": Event is confirmed active with accurate details under $50 CAD.
- "UPDATE": Event is active, but dates, start times, price, or official URL should be updated.
- "CONCLUDED": Event or season has ended, move to archive.
- "CANNOT_FIGURE_OUT": Official page is dead/missing, event status is ambiguous/unresolvable, or pricing exceeds $50. Flag for curator review in quarantine.

Return strict JSON:
{{
  "decision": "VALID | UPDATE | CONCLUDED | CANNOT_FIGURE_OUT",
  "reason": "Clear explanation of finding",
  "updated_date": "YYYY-MM-DD or null",
  "updated_start_time": "HH:MM or null",
  "updated_cost": 0.0,
  "updated_url": "URL or null"
}}
"""
                dec_data = call_gemini_direct_json(dec_prompt, api_key)
                if dec_data:
                    dec = dec_data.get("decision", "VALID")
                    reason = dec_data.get("reason", "No reason provided")

                    if dec == "CONCLUDED":
                        print(f"  ✓ Concluded: {reason}")
                        archived_events.append({
                            "event_id": eid,
                            "event_name": title,
                            "category": ev.get("category", "General"),
                            "venue_name": venue,
                            "full_address": ev.get("full_address", "Vancouver, BC"),
                            "neighborhood": ev.get("neighborhood", "Vancouver"),
                            "description": ev.get("description", ""),
                            "attempted_price_cad": cost,
                            "discovery_url": url,
                            "archive_reason": f"AI Audit: {reason}",
                            "archived_at": today_str
                        })
                        results["archived"] += 1
                        continue

                    elif dec == "CANNOT_FIGURE_OUT":
                        print(f"  ⚠️ Cannot figure out: {reason}. Flagging for curator in quarantine.")
                        if eid not in quarantine_ids:
                            quarantined.append({
                                "id": eid,
                                "title": title,
                                "artist": ev.get("artist") or title,
                                "venue": venue,
                                "address": ev.get("full_address", "Vancouver, BC"),
                                "neighborhood": ev.get("neighborhood", "Vancouver"),
                                "price": cost,
                                "priceLabel": f"${cost:.2f} CAD" if cost > 0 else "Free ($0)",
                                "category": ev.get("category", "general").lower(),
                                "categoryLabel": ev.get("category", "General"),
                                "startIso": f"{last_date}T{(ev.get('show_1') or {}).get('start_time', '19:00')}:00",
                                "websiteUrl": url,
                                "quarantineReason": f"AI Audit: Cannot figure out details: {reason}",
                                "flaggedAt": today_str
                            })
                            quarantine_ids.add(eid)
                        results["quarantined"] += 1
                        continue

                    elif dec == "UPDATE":
                        print(f"  ✓ Updating event details: {reason}")
                        if dec_data.get("updated_date") and "show_1" in ev and ev["show_1"]:
                            ev["show_1"]["date"] = dec_data["updated_date"]
                        if dec_data.get("updated_start_time") and "show_1" in ev and ev["show_1"]:
                            ev["show_1"]["start_time"] = dec_data["updated_start_time"]
                        if dec_data.get("updated_cost") is not None and float(dec_data["updated_cost"]) <= 50.0:
                            new_cost = float(dec_data["updated_cost"])
                            if "pricing_all_in_cad" in ev:
                                ev["pricing_all_in_cad"]["regular"] = new_cost
                            if "show_1" in ev and ev["show_1"]:
                                ev["show_1"]["cost"] = new_cost
                        if dec_data.get("updated_url"):
                            ev["ticket_url"] = dec_data["updated_url"]
                            ev["details_url"] = dec_data["updated_url"]
                        ev["curator_notes"] = f"AI Updated ({today_str}): {reason}"
                        results["updated"] += 1

                    else:
                        ev["curator_notes"] = f"AI-Verified ({today_str}): Confirmed active under $50 CAD."
                        results["verified"] += 1

            time.sleep(1.5)

        updated_events.append(ev)

    # Save mutated catalogs
    with open(EVENTS_JSON, "w", encoding="utf-8") as f:
        json.dump(updated_events, f, indent=2, ensure_ascii=False)

    with open(EVENTS_ARCHIVE_JSON, "w", encoding="utf-8") as f:
        json.dump(archived_events, f, indent=2, ensure_ascii=False)

    queue_data["quarantinedEvents"] = quarantined
    queue_data["pendingCount"] = len(quarantined)
    with open(QUEUE_PATH, "w", encoding="utf-8") as f:
        json.dump(queue_data, f, indent=2, ensure_ascii=False)

    return results


def scout_organizers_directory(api_key: str) -> List[str]:
    """
    2. organizers_directory.json:
    Looks through organizers' websites and feeds to find additional events or changes.
    """
    if not os.path.exists(ORGANIZERS_JSON):
        return []
    with open(ORGANIZERS_JSON, "r", encoding="utf-8") as f:
        org_data = json.load(f)
    organizers = org_data.get("organizers", {})
    all_findings = []
    print(f"[SCOUT: organizers_directory.json] Reviewing {len(organizers)} organizers...")
    for org_id, org in organizers.items():
        name = org.get("name", org_id)
        web_url = org.get("websiteUrl", "")
        events_url = org.get("eventsUrl") or org.get("ticketingPortal") or ""
        print(f"  • Searching organizer: '{name}'...")
        prompt = (
            f"Search Google for upcoming events, parties, performances, and shows organized by '{name}' in Vancouver BC "
            f"(Website: {web_url}, Events URL: {events_url}). "
            f"Look for upcoming dates, exact venues, direct links, and ticket prices under $50 CAD all-in."
        )
        res = call_gemini_with_search(prompt, api_key)
        if res:
            all_findings.append(res)
        time.sleep(1.5)
    return all_findings


def scout_festivals(api_key: str) -> List[str]:
    """
    3. festivals.json:
    Looks through festival websites to find additional events or changes.
    """
    if not os.path.exists(FESTIVALS_JSON):
        return []
    with open(FESTIVALS_JSON, "r", encoding="utf-8") as f:
        festivals = json.load(f)
    all_findings = []
    print(f"[SCOUT: festivals.json] Reviewing {len(festivals)} festivals...")
    for fest in festivals:
        name = fest.get("festival_name", "")
        web_url = fest.get("website_url", "")
        sched_url = fest.get("schedule_url", "")
        print(f"  • Searching festival: '{name}'...")
        prompt = (
            f"Search Google for current/upcoming shows, screenings, concerts, and schedule programming for '{name}' in Vancouver BC "
            f"(Website: {web_url}, Schedule: {sched_url}). "
            f"Find specific individual events or screenings strictly costing $50 CAD or less all-in with dates, times, and direct ticket links."
        )
        res = call_gemini_with_search(prompt, api_key)
        if res:
            all_findings.append(res)
        time.sleep(1.5)
    return all_findings


def scout_venues_directory(api_key: str, max_venues: int = 6) -> List[str]:
    """
    4. venues.json:
    Looks through the venue websites to find additional events or changes
    (such as recurring weekly programming like karaoke, trivia, comedy, resident DJ sets, concerts).
    """
    if not os.path.exists(VENUES_JSON):
        return []
    with open(VENUES_JSON, "r", encoding="utf-8") as f:
        venues = json.load(f)

    target_keywords = ["pub", "cabaret", "theatre", "hall", "studio", "lounge", "improv", "gallery", "market", "club"]
    priority_venues = [
        v for v in venues
        if any(k in v.get("venue_name", "").lower() or k in v.get("description", "").lower() for k in target_keywords)
    ]
    selected_venues = priority_venues[:max_venues]
    all_findings = []
    print(f"[SCOUT: venues.json] Reviewing {len(selected_venues)} priority performance/music venues...")
    for venue in selected_venues:
        name = venue.get("venue_name", "")
        web_url = venue.get("website_url", "")
        cal_url = venue.get("calendar_url", "")
        print(f"  • Searching venue: '{name}'...")
        prompt = (
            f"Search Google for current events, concerts, weekly resident nights (trivia, karaoke, comedy, retro DJ nights), and shows at "
            f"'{name}' in Vancouver BC (Website: {web_url}, Calendar: {cal_url}). "
            f"Extract verified dates, times, door prices / ticket costs under $50 CAD all-in, and direct links."
        )
        res = call_gemini_with_search(prompt, api_key)
        if res:
            all_findings.append(res)
        time.sleep(1.5)
    return all_findings


def scout_discovery_sources(api_key: str, max_sources: int = 4) -> List[str]:
    """
    5. discovery_sources.json:
    Looks through the source websites to find additional events or changes.
    """
    if not os.path.exists(DISCOVERY_SOURCES_JSON):
        return []
    with open(DISCOVERY_SOURCES_JSON, "r", encoding="utf-8") as f:
        data = json.load(f)
    sources = data.get("sources", [])
    active_sources = [s for s in sources if s.get("status") == "active"][:max_sources]
    all_findings = []
    print(f"[SCOUT: discovery_sources.json] Reviewing {len(active_sources)} editorial discovery hubs...")
    for src in active_sources:
        name = src.get("name", "")
        events_url = src.get("eventsUrl", "")
        print(f"  • Searching discovery source: '{name}'...")
        prompt = (
            f"Search Google for top upcoming events, concerts, and things to do in Vancouver BC listed on '{name}' "
            f"({events_url}) strictly costing $50 CAD or less all-in. "
            f"Include exact dates, venue names, addresses, and canonical ticket links."
        )
        res = call_gemini_with_search(prompt, api_key)
        if res:
            all_findings.append(res)
        time.sleep(1.5)
    return all_findings


def scout_ticketing_sources(api_key: str) -> List[str]:
    """
    6. ticketing_sources.json:
    Looks through ticketing websites to find additional events or changes.
    """
    if not os.path.exists(TICKETING_SOURCES_JSON):
        return []
    with open(TICKETING_SOURCES_JSON, "r", encoding="utf-8") as f:
        platforms = json.load(f)
    all_findings = []
    print(f"[SCOUT: ticketing_sources.json] Reviewing {len(platforms)} ticketing platforms...")
    for plat in platforms:
        name = plat.get("provider_name", "")
        url = plat.get("website_url", "")
        if url == "Direct":
            continue
        print(f"  • Searching ticketing platform: '{name}'...")
        prompt = (
            f"Search Google for upcoming ticketed events in Vancouver BC on '{name}' ({url}) "
            f"with total all-in ticket price <= $50 CAD (including estimated platform fees and 5% GST). "
            f"Include specific dates, artists/performers, venue locations, and direct ticket checkout URLs."
        )
        res = call_gemini_with_search(prompt, api_key)
        if res:
            all_findings.append(res)
        time.sleep(1.5)
    return all_findings


def run_full_gemini_scouting_pipeline(api_key: str, audit_events: bool = True) -> Dict[str, Any]:
    """
    Executes the complete 6-file AI pipeline requested:
    1. events.json - Audit, correct, or quarantine
    2. organizers_directory.json - Discover organizer events & changes
    3. festivals.json - Discover festival events & changes
    4. venues.json - Discover venue weekly/upcoming events & changes
    5. discovery_sources.json - Discover editorial events & changes
    6. ticketing_sources.json - Discover platform events & changes
    Consolidates findings and synchronizes master catalogs.
    """
    print("=== STARTING 6-FILE AUTONOMOUS GEMINI PIPELINE ===")

    # Stage 1: events.json
    audit_results = {}
    if audit_events:
        print("\n--- STAGE 1/6: AUDITING & VERIFYING events.json ---")
        audit_results = audit_and_verify_active_events(api_key, max_check=None)
        print(f"[AUDIT SUMMARY] Verified: {audit_results.get('verified', 0)} | "
              f"Updated: {audit_results.get('updated', 0)} | "
              f"Archived: {audit_results.get('archived', 0)} | "
              f"Quarantined: {audit_results.get('quarantined', 0)}")

    all_raw_findings = []

    # Stage 2: organizers_directory.json
    print("\n--- STAGE 2/6: SCOUTING organizers_directory.json ---")
    all_raw_findings.extend(scout_organizers_directory(api_key))

    # Stage 3: festivals.json
    print("\n--- STAGE 3/6: SCOUTING festivals.json ---")
    all_raw_findings.extend(scout_festivals(api_key))

    # Stage 4: venues.json
    print("\n--- STAGE 4/6: SCOUTING venues.json ---")
    all_raw_findings.extend(scout_venues_directory(api_key, max_venues=6))

    # Stage 5: discovery_sources.json
    print("\n--- STAGE 5/6: SCOUTING discovery_sources.json ---")
    all_raw_findings.extend(scout_discovery_sources(api_key, max_sources=4))

    # Stage 6: ticketing_sources.json
    print("\n--- STAGE 6/6: SCOUTING ticketing_sources.json ---")
    all_raw_findings.extend(scout_ticketing_sources(api_key))

    # Chunk findings into manageable batches of ~25,000 characters to prevent timeouts
    chunks = []
    current_chunk = []
    current_len = 0
    for finding in all_raw_findings:
        if current_len + len(finding) > 25000 and current_chunk:
            chunks.append("\n\n--- NEXT DISCOVERY BLOCK ---\n\n".join(current_chunk))
            current_chunk = [finding]
            current_len = len(finding)
        else:
            current_chunk.append(finding)
            current_len += len(finding)
    if current_chunk:
        chunks.append("\n\n--- NEXT DISCOVERY BLOCK ---\n\n".join(current_chunk))

    total_chars = sum(len(f) for f in all_raw_findings)
    print(f"\n[SCOUT] Discovered {len(all_raw_findings)} intelligence blocks ({total_chars} chars). Structuring across {len(chunks)} batches...")

    all_discovered_events = []
    all_discovered_venues = []
    all_discovered_festivals = []

    for idx, chunk_text in enumerate(chunks, 1):
        print(f"  • Structuring batch {idx}/{len(chunks)} ({len(chunk_text)} chars)...")
        chunk_data = call_gemini_json_extractor(chunk_text, api_key)
        if chunk_data:
            all_discovered_events.extend(chunk_data.get("events_active", []))
            all_discovered_venues.extend(chunk_data.get("discovered_venues", []))
            all_discovered_festivals.extend(chunk_data.get("discovered_festivals", []))
        time.sleep(1.5)

    structured_data = {
        "events_active": all_discovered_events,
        "discovered_venues": all_discovered_venues,
        "discovered_festivals": all_discovered_festivals
    }

    # Integrate into master catalogs
    sync_master_catalogs(structured_data)

    return {
        "audit_results": audit_results,
        "structured_data": structured_data
    }


def run_gemini_scouting_cycle(api_key: str) -> Dict[str, Any]:
    """Backward-compatible entry point calling the complete 6-file pipeline."""
    res = run_full_gemini_scouting_pipeline(api_key, audit_events=True)
    return res.get("structured_data", {"events_active": [], "discovered_venues": [], "discovered_festivals": []})


def sync_master_catalogs(structured_data: Dict[str, Any]):
    """
    Integrates newly discovered data into the clean JSON database files:
    events.json, events_archive.json, venues.json, festivals.json,
    ticketing_sources.json, discovery_sources.json
    """
    today_str = datetime.now().strftime("%Y-%m-%d")

    # 1. Load existing Active & Archived Events
    active_events = []
    if os.path.exists(EVENTS_JSON):
        try:
            with open(EVENTS_JSON, "r", encoding="utf-8") as f:
                active_events = json.load(f)
        except Exception:
            active_events = []

    archived_events = []
    if os.path.exists(EVENTS_ARCHIVE_JSON):
        try:
            with open(EVENTS_ARCHIVE_JSON, "r", encoding="utf-8") as f:
                archived_events = json.load(f)
        except Exception:
            archived_events = []

    # 2. Archive concluded events
    still_active = []
    for ev in active_events:
        s3_date = (ev.get("show_3") or {}).get("date")
        s2_date = (ev.get("show_2") or {}).get("date")
        s1_date = (ev.get("show_1") or {}).get("date")
        last_date = s3_date or s2_date or s1_date
        
        if last_date and last_date < today_str:
            ev["archived_at"] = today_str
            archived_events.append(ev)
        else:
            still_active.append(ev)

    # 3. Add new discovered events (deduplicating by title/slug)
    existing_ids = {e.get("event_id") for e in still_active}
    existing_archive_ids = {e.get("event_id") for e in archived_events}
    new_events = structured_data.get("events_active", [])
    added_count = 0
    quarantined_count = 0

    # Load manual review queue for quarantined events
    queue_data = {"metadata": {"version": "1.0.0", "updatedAt": today_str, "pendingCount": 0, "description": "Events quarantined for manual user review due to unverified live checkout pricing."}, "quarantinedEvents": []}
    if os.path.exists(QUEUE_PATH):
        try:
            with open(QUEUE_PATH, "r", encoding="utf-8") as qf:
                queue_data = json.load(qf)
        except Exception:
            pass
    queue_events = queue_data.get("quarantinedEvents", [])
    queue_ids = {q.get("id") or q.get("event_id") for q in queue_events}

    for ne in new_events:
        eid = ne.get("event_id") or re.sub(r"[^a-z0-9]+", "-", ne.get("event_name", "event").lower()).strip("-")
        ne["event_id"] = eid
        
        # Enforce $50 CAD hard ceiling
        reg_price = (ne.get("pricing_all_in_cad") or {}).get("regular", 0.0) or 0.0
        if reg_price > 50.0:
            print(f"[FILTER] Excluded {ne.get('event_name')} - All-in price ${reg_price} exceeds $50.00 CAD")
            continue

        if ne.get("approval_status") == "Quarantined":
            quarantined_count += 1
            if eid not in queue_ids:
                queue_events.append({
                    "id": eid,
                    "title": ne.get("event_name", "Event"),
                    "artist": ne.get("event_name", "Artist"),
                    "venue": ne.get("venue_name", "Vancouver Venue"),
                    "address": ne.get("full_address", "Vancouver, BC"),
                    "neighborhood": ne.get("neighborhood", "Vancouver"),
                    "price": reg_price,
                    "priceLabel": f"${reg_price:.2f}" if reg_price > 0 else "Free ($0)",
                    "category": (ne.get("category") or "General").lower(),
                    "categoryLabel": ne.get("category", "General"),
                    "startIso": f"{ne.get('show_1', {}).get('date', '')}T{ne.get('show_1', {}).get('start_time', '19:00')}:00",
                    "websiteUrl": ne.get("ticket_url") or ne.get("details_url") or "",
                    "quarantineReason": ne.get("curator_notes") or "Ticket price >= $43 CAD or unverified checkout service fees",
                    "flaggedAt": today_str
                })
                queue_ids.add(eid)
                print(f"[QUARANTINE] Routed {ne.get('event_name')} (${reg_price} CAD) to manual_review_queue.json")
            continue

        if eid not in existing_ids and eid not in existing_archive_ids:
            still_active.append(ne)
            existing_ids.add(eid)
            added_count += 1
            print(f"[ADD] Added active verified event: {ne.get('event_name')} (${reg_price:.2f} CAD)")

    # Save Events Active & Archive (Pure JSON)
    with open(EVENTS_JSON, "w", encoding="utf-8") as f:
        json.dump(still_active, f, indent=2, ensure_ascii=False)

    with open(EVENTS_ARCHIVE_JSON, "w", encoding="utf-8") as f:
        json.dump(archived_events, f, indent=2, ensure_ascii=False)

    # Save Manual Review Queue if updated
    queue_data["quarantinedEvents"] = queue_events
    queue_data["metadata"]["pendingCount"] = len(queue_events)
    queue_data["metadata"]["updatedAt"] = today_str
    with open(QUEUE_PATH, "w", encoding="utf-8") as qf:
        json.dump(queue_data, qf, indent=2, ensure_ascii=False)

    # 4. Update Venues (JSON)
    venues = []
    if os.path.exists(VENUES_JSON):
        try:
            with open(VENUES_JSON, "r", encoding="utf-8") as f:
                venues = json.load(f)
        except Exception:
            pass
    venue_names = {v.get("venue_name", "").lower() for v in venues}
    for nv in structured_data.get("discovered_venues", []):
        vname = nv.get("venue_name", "").strip()
        if vname and vname.lower() not in venue_names:
            venues.append(nv)
            venue_names.add(vname.lower())

    with open(VENUES_JSON, "w", encoding="utf-8") as f:
        json.dump(venues, f, indent=2, ensure_ascii=False)

    # 5. Update Festivals (JSON)
    festivals = []
    if os.path.exists(FESTIVALS_JSON):
        try:
            with open(FESTIVALS_JSON, "r", encoding="utf-8") as f:
                festivals = json.load(f)
        except Exception:
            pass
    fest_names = {f.get("festival_name", "").lower() for f in festivals}
    for nf in structured_data.get("discovered_festivals", []):
        fname = nf.get("festival_name", "").strip()
        if fname and fname.lower() not in fest_names:
            festivals.append(nf)
            fest_names.add(fname.lower())

    with open(FESTIVALS_JSON, "w", encoding="utf-8") as f:
        json.dump(festivals, f, indent=2, ensure_ascii=False)

    # 6. Ensure default Ticketing Sources & Discovery Sources exist
    init_default_sources()

    # 7. Synchronize js/data.js
    try:
        from curator_server import sync_js_data_file
        sync_js_data_file()
        print("[OK] Synchronized js/data.js with active catalog.")
    except Exception as e:
        print(f"[WARN] Could not sync js/data.js: {e}")

    print(f"\n[CATALOG SYNC COMPLETE]")
    print(f" • Active Events: {len(still_active)} (+{added_count} new)")
    print(f" • Quarantined Queue: {len(queue_events)} (+{quarantined_count} queued for review)")
    print(f" • Archived Events: {len(archived_events)}")
    print(f" • Venues: {len(venues)}")
    print(f" • Festivals: {len(festivals)}")
    print(f" • JSON Catalogs updated: {EVENTS_JSON}, {QUEUE_PATH}, {VENUES_JSON}, {FESTIVALS_JSON}")


def init_default_sources():
    """Initializes standard Ticketing & Discovery sources in pure JSON."""
    if not os.path.exists(TICKETING_SOURCES_JSON):
        default_providers = [
            {"provider_name": "Eventbrite", "website_url": "https://www.eventbrite.ca", "notes": "Standard ticketing; adds platform service fee + GST at checkout"},
            {"provider_name": "Showpass", "website_url": "https://www.showpass.com", "notes": "Local Canadian ticketing; adds $2-$4 service fee"},
            {"provider_name": "Ticketmaster", "website_url": "https://www.ticketmaster.ca", "notes": "Major venue vendor; significant facility and processing fees"},
            {"provider_name": "ShowClix / PatronTechnology", "website_url": "https://www.showclix.com", "notes": "Common for arts & film festivals"},
            {"provider_name": "Direct Venue Box Office", "website_url": "Direct", "notes": "No third-party fees; cash or debit at door"}
        ]
        with open(TICKETING_SOURCES_JSON, "w", encoding="utf-8") as f:
            json.dump(default_providers, f, indent=2, ensure_ascii=False)

    if not os.path.exists(DISCOVERY_SOURCES_JSON):
        default_aggregators = [
            {"source_name": "The Daily Hive Vancouver", "website_url": "https://dailyhive.com/vancouver", "feed_type": "Editorial / Things To Do"},
            {"source_name": "Vancouver Is Awesome", "website_url": "https://www.vancouverisawesome.com", "feed_type": "Hyperlocal News & Culture"},
            {"source_name": "Do604", "website_url": "https://do604.com", "feed_type": "Live Music & Nightlife Aggregator"},
            {"source_name": "The Georgia Straight", "website_url": "https://www.straight.com", "feed_type": "Arts, Fringe, & Culture"},
            {"source_name": "Destination Vancouver", "website_url": "https://www.destinationvancouver.com", "feed_type": "Tourism & Public Festivals"}
        ]
        with open(DISCOVERY_SOURCES_JSON, "w", encoding="utf-8") as f:
            json.dump(default_aggregators, f, indent=2, ensure_ascii=False)


def bootstrap_from_existing_data():
    """
    Populates master catalogs from existing events.json, venue_directory.json,
    and festival_registry.json if active tables are not yet generated.
    """
    # Bootstrap Venues
    if not os.path.exists(VENUES_JSON):
        vdir_path = os.path.join(DATA_DIR, "venue_directory.json")
        venues_list = []
        if os.path.exists(vdir_path):
            try:
                with open(vdir_path, "r", encoding="utf-8") as f:
                    raw_vd = json.load(f)
                    items = raw_vd.get("venues", raw_vd) if isinstance(raw_vd, dict) else raw_vd
                    for k, v in (items.items() if isinstance(items, dict) else enumerate(items)):
                        vdata = v if isinstance(v, dict) else {}
                        vname = vdata.get("name") or vdata.get("venue_name") or str(k)
                        venues_list.append({
                            "venue_name": vname,
                            "website_url": vdata.get("websiteUrl") or vdata.get("website_url") or "",
                            "calendar_url": vdata.get("calendarUrl") or vdata.get("calendar_url") or "",
                            "full_address": vdata.get("address") or vdata.get("full_address") or "",
                            "neighborhood": vdata.get("neighborhood") or "",
                            "description": vdata.get("description") or ""
                        })
            except Exception:
                pass
        with open(VENUES_JSON, "w", encoding="utf-8") as f:
            json.dump(venues_list, f, indent=2, ensure_ascii=False)

    # Bootstrap Festivals
    if not os.path.exists(FESTIVALS_JSON):
        freg_path = os.path.join(DATA_DIR, "festival_registry.json")
        fest_list = []
        if os.path.exists(freg_path):
            try:
                with open(freg_path, "r", encoding="utf-8") as f:
                    freg = json.load(f)
                    for fest in freg.get("festivals", []):
                        fest_list.append({
                            "festival_name": fest.get("name", ""),
                            "website_url": fest.get("websiteUrl", ""),
                            "schedule_url": fest.get("scheduleUrl", ""),
                            "location": ", ".join(fest.get("hostVenues", [])) if fest.get("hostVenues") else "Multiple Venues",
                            "start_date": fest.get("startDate", ""),
                            "end_date": fest.get("endDate", ""),
                            "description": fest.get("category", "")
                        })
            except Exception:
                pass
        with open(FESTIVALS_JSON, "w", encoding="utf-8") as f:
            json.dump(fest_list, f, indent=2, ensure_ascii=False)

    # Bootstrap Events
    if not os.path.exists(EVENTS_JSON):
        events_list = []
        if os.path.exists(EVENTS_PATH):
            try:
                with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                    ev_data = json.load(f)
                    for ev in ev_data.get("events", []):
                        price = float(ev.get("price", 0.0) or 0.0)
                        if price > 50.0:
                            continue
                        
                        start_iso = ev.get("startIso", "")
                        date_str = start_iso[:10] if start_iso and len(start_iso) >= 10 else ""
                        time_str = start_iso[11:16] if start_iso and len(start_iso) >= 16 else ""

                        events_list.append({
                            "event_id": ev.get("id", ""),
                            "event_name": ev.get("title", ""),
                            "category": ev.get("category", "General"),
                            "venue_name": ev.get("venue", ""),
                            "full_address": ev.get("address", ""),
                            "neighborhood": ev.get("neighborhood", ""),
                            "description": ev.get("description", ""),
                            "pricing_all_in_cad": {
                                "regular": price,
                                "senior": None,
                                "student": None,
                                "member": None
                            },
                            "show_1": {
                                "date": date_str,
                                "start_time": time_str,
                                "end_time": "",
                                "cost": price
                            },
                            "show_2": None,
                            "show_3": None,
                            "discovery_url": ev.get("websiteUrl", ""),
                            "details_url": ev.get("websiteUrl", ""),
                            "ticket_url": ev.get("websiteUrl", ""),
                            "ticket_provider": ev.get("ticketProvider", "Direct"),
                            "tags": ev.get("subTags", []),
                            "festival_affiliation": "None",
                            "approval_status": "Auto-Approved",
                            "curator_notes": ""
                        })
            except Exception:
                pass
        with open(EVENTS_JSON, "w", encoding="utf-8") as f:
            json.dump(events_list, f, indent=2, ensure_ascii=False)

    init_default_sources()


    init_default_sources()


def main():
    parser = argparse.ArgumentParser(description="Van50 Gemini AI Autonomous Event Scout")
    parser.add_argument("--dry-run", action="store_true", help="Run without mutating files")
    parser.add_argument("--bootstrap-only", action="store_true", help="Bootstrap catalog JSON from existing data without running AI queries")
    args = parser.parse_args()

    # Always ensure baseline catalogs are initialized
    bootstrap_from_existing_data()

    if args.bootstrap_only:
        print("[BOOTSTRAP] Successfully initialized master catalogs in pure JSON.")
        return

    api_key = get_gemini_api_key()
    if not api_key:
        print("[ERROR] Cannot run Gemini Scout without a valid GEMINI_API_KEY.")
        print("Please set GEMINI_API_KEY in your .env file or GitHub Secrets.")
        sys.exit(1)

    print("=== VAN50 GEMINI AI AUTONOMOUS SCOUT ===")
    pipeline_res = run_full_gemini_scouting_pipeline(api_key, audit_events=True)
    if args.dry_run:
        print("[DRY-RUN] Discovered data:")
        print(json.dumps(pipeline_res.get("structured_data", {}), indent=2))


if __name__ == "__main__":
    main()

