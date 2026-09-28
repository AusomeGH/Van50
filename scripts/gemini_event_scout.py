#!/usr/bin/env python3
"""
Van50 Gemini AI Autonomous Event Scout & Curator
=================================================
Automated event discovery, full-fee computation (under $50 CAD),
verified repeating event resolution, and catalog maintenance using Gemini AI.
Outputs both structured JSON and CSV files for easy integration into spreadsheets and web apps.
"""

from __future__ import annotations
import os
import sys
import json
import csv
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

# Relabeled Catalog Paths (JSON & CSV)
EVENTS_ACTIVE_JSON = os.path.join(DATA_DIR, "events_active.json")
EVENTS_ACTIVE_CSV = os.path.join(DATA_DIR, "events_active.csv")
EVENTS_ARCHIVE_JSON = os.path.join(DATA_DIR, "events_archive.json")
EVENTS_ARCHIVE_CSV = os.path.join(DATA_DIR, "events_archive.csv")
VENUES_MASTER_JSON = os.path.join(DATA_DIR, "venues_master.json")
VENUES_MASTER_CSV = os.path.join(DATA_DIR, "venues_master.csv")
FESTIVALS_MASTER_JSON = os.path.join(DATA_DIR, "festivals_master.json")
FESTIVALS_MASTER_CSV = os.path.join(DATA_DIR, "festivals_master.csv")
TICKETING_SOURCES_JSON = os.path.join(DATA_DIR, "ticketing_sources.json")
TICKETING_SOURCES_CSV = os.path.join(DATA_DIR, "ticketing_sources.csv")
DISCOVERY_SOURCES_JSON = os.path.join(DATA_DIR, "discovery_sources.json")
DISCOVERY_SOURCES_CSV = os.path.join(DATA_DIR, "discovery_sources.csv")


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


def call_gemini_with_search(prompt: str, api_key: str, model: str = "gemini-2.5-flash") -> Optional[str]:
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


def call_gemini_json_extractor(raw_content: str, api_key: str, model: str = "gemini-2.5-flash") -> Optional[Dict[str, Any]]:
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
        with urllib.request.urlopen(req, timeout=60) as resp:
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


def run_gemini_scouting_cycle(api_key: str) -> Dict[str, Any]:
    """
    Executes discovery search across top Vancouver sources via Gemini Search Grounding.
    """
    today_str = datetime.now().strftime("%Y-%m-%d")
    queries = [
        f"Vancouver BC events activities things to do {today_str} this week weekend under $50 CAD Daily Hive Vancouver Is Awesome Do604",
        "Vancouver indie concerts live music comedy theater tickets under 50 CAD upcoming dates schedule",
        "Upcoming festivals free community events art exhibits Vancouver Metro Vancouver this month"
    ]

    all_raw_findings = []
    print(f"[SCOUT] Initiating Gemini Search across {len(queries)} search queries...")
    for idx, q in enumerate(queries, 1):
        print(f"[SCOUT] Query {idx}/{len(queries)}: '{q[:60]}...'")
        res = call_gemini_with_search(
            f"Search Google for current, active upcoming events in Vancouver BC Canada: {q}. "
            f"Include exact venues, ticket prices with fees, dates, and direct links.",
            api_key
        )
        if res:
            all_raw_findings.append(res)
        time.sleep(2)  # Respect rate limits

    combined_raw = "\n\n--- NEXT DISCOVERY BLOCK ---\n\n".join(all_raw_findings)
    print(f"[SCOUT] Discovered {len(combined_raw)} characters of live event intelligence. Structuring with Gemini...")
    
    structured_data = call_gemini_json_extractor(combined_raw, api_key)
    if not structured_data:
        print("[WARN] Gemini structuring did not return valid JSON. Skipping merge.")
        return {"events_active": [], "discovered_venues": [], "discovered_festivals": []}

    return structured_data


def save_csv(filepath: str, fieldnames: List[str], rows: List[Dict[str, Any]]):
    """Writes tabular data to CSV with UTF-8 encoding."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        for r in rows:
            # Flatten or format null values as empty string
            row_dict = {}
            for k in fieldnames:
                val = r.get(k, "")
                if val is None:
                    row_dict[k] = ""
                elif isinstance(val, (list, dict)):
                    row_dict[k] = json.dumps(val, ensure_ascii=False)
                else:
                    row_dict[k] = str(val)
            writer.writerow(row_dict)


def export_active_events_to_csv(events: List[Dict[str, Any]], filepath: str):
    """Exports events to a flat CSV matching the user's exact specification."""
    fieldnames = [
        "Event_ID", "Event_Name", "Category", "Venue_Name", "Full_Address", "Neighborhood",
        "Description", "Regular_All_In_CAD", "Senior_All_In_CAD", "Student_All_In_CAD", "Member_All_In_CAD",
        "Show_1_Date", "Show_1_Start_Time", "Show_1_End_Time", "Show_1_All_In_Cost",
        "Show_2_Date", "Show_2_Start_Time", "Show_2_End_Time", "Show_2_All_In_Cost",
        "Show_3_Date", "Show_3_Start_Time", "Show_3_End_Time", "Show_3_All_In_Cost",
        "Discovery_URL", "Details_URL", "Ticket_URL", "Ticket_Provider",
        "Tags", "Festival_Affiliation", "Approval_Status", "Curator_Notes"
    ]

    flat_rows = []
    for ev in events:
        p = ev.get("pricing_all_in_cad", {}) or {}
        s1 = ev.get("show_1", {}) or {}
        s2 = ev.get("show_2", {}) or {}
        s3 = ev.get("show_3", {}) or {}

        flat_rows.append({
            "Event_ID": ev.get("event_id", ""),
            "Event_Name": ev.get("event_name", ""),
            "Category": ev.get("category", ""),
            "Venue_Name": ev.get("venue_name", ""),
            "Full_Address": ev.get("full_address", ""),
            "Neighborhood": ev.get("neighborhood", ""),
            "Description": ev.get("description", ""),
            "Regular_All_In_CAD": p.get("regular", ""),
            "Senior_All_In_CAD": p.get("senior", "") if p.get("senior") is not None else "",
            "Student_All_In_CAD": p.get("student", "") if p.get("student") is not None else "",
            "Member_All_In_CAD": p.get("member", "") if p.get("member") is not None else "",
            "Show_1_Date": s1.get("date", ""),
            "Show_1_Start_Time": s1.get("start_time", ""),
            "Show_1_End_Time": s1.get("end_time", ""),
            "Show_1_All_In_Cost": s1.get("cost", ""),
            "Show_2_Date": s2.get("date", "") if s2 else "",
            "Show_2_Start_Time": s2.get("start_time", "") if s2 else "",
            "Show_2_End_Time": s2.get("end_time", "") if s2 else "",
            "Show_2_All_In_Cost": s2.get("cost", "") if s2 else "",
            "Show_3_Date": s3.get("date", "") if s3 else "",
            "Show_3_Start_Time": s3.get("start_time", "") if s3 else "",
            "Show_3_End_Time": s3.get("end_time", "") if s3 else "",
            "Show_3_All_In_Cost": s3.get("cost", "") if s3 else "",
            "Discovery_URL": ev.get("discovery_url", ""),
            "Details_URL": ev.get("details_url", ""),
            "Ticket_URL": ev.get("ticket_url", ""),
            "Ticket_Provider": ev.get("ticket_provider", ""),
            "Tags": ", ".join(ev.get("tags", [])) if isinstance(ev.get("tags"), list) else ev.get("tags", ""),
            "Festival_Affiliation": ev.get("festival_affiliation", "None"),
            "Approval_Status": ev.get("approval_status", "Auto-Approved"),
            "Curator_Notes": ev.get("curator_notes", "")
        })

    save_csv(filepath, fieldnames, flat_rows)


def sync_master_catalogs(structured_data: Dict[str, Any]):
    """
    Integrates newly discovered data into the master database files:
    Events_Active, Events_Archive, Venues_Master, Festivals_Master, Ticketing_Sources, Discovery_Sources
    """
    today_str = datetime.now().strftime("%Y-%m-%d")

    # 1. Load existing Active & Archived Events
    active_events = []
    if os.path.exists(EVENTS_ACTIVE_JSON):
        try:
            with open(EVENTS_ACTIVE_JSON, "r", encoding="utf-8") as f:
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
        # Check latest show date
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
    new_events = structured_data.get("events_active", [])
    added_count = 0
    quarantined_count = 0

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

        if eid not in existing_ids:
            still_active.append(ne)
            existing_ids.add(eid)
            added_count += 1

    # Save Events Active & Archive (JSON + CSV)
    with open(EVENTS_ACTIVE_JSON, "w", encoding="utf-8") as f:
        json.dump(still_active, f, indent=2, ensure_ascii=False)
    export_active_events_to_csv(still_active, EVENTS_ACTIVE_CSV)

    with open(EVENTS_ARCHIVE_JSON, "w", encoding="utf-8") as f:
        json.dump(archived_events, f, indent=2, ensure_ascii=False)
    export_active_events_to_csv(archived_events, EVENTS_ARCHIVE_CSV)

    # 4. Update Venues Master
    venues = []
    if os.path.exists(VENUES_MASTER_JSON):
        try:
            with open(VENUES_MASTER_JSON, "r", encoding="utf-8") as f:
                venues = json.load(f)
        except Exception:
            pass
    venue_names = {v.get("venue_name", "").lower() for v in venues}
    for nv in structured_data.get("discovered_venues", []):
        vname = nv.get("venue_name", "").strip()
        if vname and vname.lower() not in venue_names:
            venues.append(nv)
            venue_names.add(vname.lower())

    with open(VENUES_MASTER_JSON, "w", encoding="utf-8") as f:
        json.dump(venues, f, indent=2, ensure_ascii=False)
    save_csv(VENUES_MASTER_CSV, ["venue_name", "website_url", "calendar_url", "full_address", "neighborhood", "description"], venues)

    # 5. Update Festivals Master
    festivals = []
    if os.path.exists(FESTIVALS_MASTER_JSON):
        try:
            with open(FESTIVALS_MASTER_JSON, "r", encoding="utf-8") as f:
                festivals = json.load(f)
        except Exception:
            pass
    fest_names = {f.get("festival_name", "").lower() for f in festivals}
    for nf in structured_data.get("discovered_festivals", []):
        fname = nf.get("festival_name", "").strip()
        if fname and fname.lower() not in fest_names:
            festivals.append(nf)
            fest_names.add(fname.lower())

    with open(FESTIVALS_MASTER_JSON, "w", encoding="utf-8") as f:
        json.dump(festivals, f, indent=2, ensure_ascii=False)
    save_csv(FESTIVALS_MASTER_CSV, ["festival_name", "website_url", "schedule_url", "location", "start_date", "end_date", "description"], festivals)

    # 6. Ensure default Ticketing Sources & Discovery Sources exist
    init_default_sources()

    print(f"\n[CATALOG SYNC COMPLETE]")
    print(f" • Active Events: {len(still_active)} (+{added_count} new, {quarantined_count} quarantined)")
    print(f" • Archived Events: {len(archived_events)}")
    print(f" • Venues Master: {len(venues)}")
    print(f" • Festivals Master: {len(festivals)}")
    print(f" • CSVs updated: {EVENTS_ACTIVE_CSV}, {VENUES_MASTER_CSV}, {FESTIVALS_MASTER_CSV}")


def init_default_sources():
    """Initializes standard Ticketing & Discovery sources if not already present."""
    if not os.path.exists(TICKETING_SOURCES_JSON):
        default_providers = [
            {"provider_name": "Eventbrite", "website_url": "https://www.eventbrite.ca", "notes": "Standard ticketing; adds platform service fee + GST at checkout"},
            {"provider_name": "Showpass", "website_url": "https://www.showpass.com", "notes": "Local Canadian ticketing; adds $2-$4 service fee"},
            {"provider_name": "Ticketmaster", "website_url": "https://www.ticketmaster.ca", "notes": "Major venue vendor; significant facility and processing fees"},
            {"provider_name": "ShowClix / PatronTechnology", "website_url": "https://www.showclix.com", "notes": "Common for arts & film festivals"},
            {"provider_name": "Direct Venue Box Office", "website_url": "Direct", "notes": "No third-party fees; cash or debit at door"}
        ]
        with open(TICKETING_SOURCES_JSON, "w", encoding="utf-8") as f:
            json.dump(default_providers, f, indent=2)
        save_csv(TICKETING_SOURCES_CSV, ["provider_name", "website_url", "notes"], default_providers)

    if not os.path.exists(DISCOVERY_SOURCES_JSON):
        default_aggregators = [
            {"source_name": "The Daily Hive Vancouver", "website_url": "https://dailyhive.com/vancouver", "feed_type": "Editorial / Things To Do"},
            {"source_name": "Vancouver Is Awesome", "website_url": "https://www.vancouverisawesome.com", "feed_type": "Hyperlocal News & Culture"},
            {"source_name": "Do604", "website_url": "https://do604.com", "feed_type": "Live Music & Nightlife Aggregator"},
            {"source_name": "The Georgia Straight", "website_url": "https://www.straight.com", "feed_type": "Arts, Fringe, & Culture"},
            {"source_name": "Destination Vancouver", "website_url": "https://www.destinationvancouver.com", "feed_type": "Tourism & Public Festivals"}
        ]
        with open(DISCOVERY_SOURCES_JSON, "w", encoding="utf-8") as f:
            json.dump(default_aggregators, f, indent=2)
        save_csv(DISCOVERY_SOURCES_CSV, ["source_name", "website_url", "feed_type"], default_aggregators)


def bootstrap_from_existing_data():
    """
    Populates master catalogs from existing events.json, venue_directory.json,
    and festival_registry.json if active tables are not yet generated.
    """
    # Bootstrap Venues Master
    if not os.path.exists(VENUES_MASTER_JSON):
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
        with open(VENUES_MASTER_JSON, "w", encoding="utf-8") as f:
            json.dump(venues_list, f, indent=2, ensure_ascii=False)
        save_csv(VENUES_MASTER_CSV, ["venue_name", "website_url", "calendar_url", "full_address", "neighborhood", "description"], venues_list)

    # Bootstrap Festivals Master
    if not os.path.exists(FESTIVALS_MASTER_JSON):
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
        with open(FESTIVALS_MASTER_JSON, "w", encoding="utf-8") as f:
            json.dump(fest_list, f, indent=2, ensure_ascii=False)
        save_csv(FESTIVALS_MASTER_CSV, ["festival_name", "website_url", "schedule_url", "location", "start_date", "end_date", "description"], fest_list)

    # Bootstrap Events Active
    if not os.path.exists(EVENTS_ACTIVE_JSON):
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
        with open(EVENTS_ACTIVE_JSON, "w", encoding="utf-8") as f:
            json.dump(events_list, f, indent=2, ensure_ascii=False)
        export_active_events_to_csv(events_list, EVENTS_ACTIVE_CSV)

    init_default_sources()


def main():
    parser = argparse.ArgumentParser(description="Van50 Gemini AI Autonomous Event Scout")
    parser.add_argument("--dry-run", action="store_true", help="Run without mutating files")
    parser.add_argument("--bootstrap-only", action="store_true", help="Bootstrap catalog CSV/JSON from existing data without running AI queries")
    args = parser.parse_args()

    # Always ensure baseline catalogs are initialized
    bootstrap_from_existing_data()

    if args.bootstrap_only:
        print("[BOOTSTRAP] Successfully initialized master catalogs and CSV files.")
        return

    api_key = get_gemini_api_key()
    if not api_key:
        print("[ERROR] Cannot run Gemini Scout without a valid GEMINI_API_KEY.")
        print("Please set GEMINI_API_KEY in your .env file or GitHub Secrets.")
        sys.exit(1)

    print("=== VAN50 GEMINI AI AUTONOMOUS SCOUT ===")
    structured_data = run_gemini_scouting_cycle(api_key)
    
    if not args.dry_run:
        sync_master_catalogs(structured_data)
    else:
        print("[DRY-RUN] Discovered data:")
        print(json.dumps(structured_data, indent=2))


if __name__ == "__main__":
    main()

