#!/usr/bin/env python3
"""
Van50 Curator Server & API Daemon
Extends standard static HTTP serving with authenticated REST endpoints for:
- Authentication & HMAC session token issuance
- Review queue triage (Approve & Ingest to Master, Dismiss/Archive)
- Automated safety backup creation
- Algorithmic rule persistence to curator_learned_rules.json
- Synchronization of js/data.js
"""

import http.server
import socketserver
import json
import os
import sys
import time
import shutil
import base64
import re
import threading
from datetime import datetime, timezone
from urllib.parse import urlparse, parse_qs

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
MANUAL_QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
RULES_PATH = os.path.join(DATA_DIR, "curator_learned_rules.json")
ARCHIVE_PATH = os.path.join(DATA_DIR, "archived_events.json")
INSTRUCTIONS_PATH = os.path.join(DATA_DIR, "curator_instructions.json")
SCREENSHOTS_DIR = os.path.join(DATA_DIR, "curator_screenshots")
JS_DATA_PATH = os.path.join(BASE_DIR, "js", "data.js")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
LOGS_DIR = os.path.join(DATA_DIR, "automation_logs")
DISCOVERED_VENUES_PATH = os.path.join(DATA_DIR, "discovered_venues.json")
VENUE_DIR_PATH = os.path.join(DATA_DIR, "venue_directory.json")
FESTIVAL_REGISTRY_PATH = os.path.join(DATA_DIR, "festival_registry.json")

sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from curator_auth import verify_curator_password, generate_session_token, verify_session_token, revoke_session_token
from daily_automation import get_automation_status, update_automation_status, run_full_daily_pipeline
from screenshot_verifier import verify_screenshot_against_event

PORT = 8080

# Security Configuration: Protected Directories & Files
BLOCKED_DATA_FILES = {
    "manual_review_queue.json",
    "curator_instructions.json",
    "curator_learned_rules.json",
    "archived_events.json",
    ".curator_secret.json"
}
BLOCKED_DIRS = {"scripts", "tests", "scratch", "backups", ".git", ".agents", ".vscode"}

# Sliding-window rate limiter for mutating API calls: { ip: [timestamp1, timestamp2, ...] }
MUTATING_RATE_LIMITS = {}
MAX_MUTATIONS_PER_MINUTE = 60


def check_mutating_rate_limit(ip: str) -> bool:
    """Sliding-window rate limiter allowing up to MAX_MUTATIONS_PER_MINUTE per IP."""
    now = time.time()
    timestamps = MUTATING_RATE_LIMITS.setdefault(ip, [])
    timestamps[:] = [t for t in timestamps if now - t < 60]
    if len(timestamps) >= MAX_MUTATIONS_PER_MINUTE:
        return False
    timestamps.append(now)
    return True


def sanitize_text(text: str) -> str:
    """Strips HTML and script tags from text inputs to prevent stored XSS injection."""
    if not isinstance(text, str):
        return text
    # Strip <script...>...</script>
    cleaned = re.sub(r'<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>', '', text, flags=re.IGNORECASE)
    # Strip any remaining tags
    cleaned = re.sub(r'<[^>]+>', '', cleaned)
    return cleaned.strip()


def create_backup_snapshot():
    """Creates a timestamped snapshot of data/events.json prior to mutation."""
    if not os.path.exists(EVENTS_PATH):
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    backup_file = os.path.join(BACKUP_DIR, f"events_{ts}.json")
    try:
        shutil.copy2(EVENTS_PATH, backup_file)
        # Keep only latest 20 backups
        backups = sorted([os.path.join(BACKUP_DIR, f) for f in os.listdir(BACKUP_DIR) if f.startswith("events_")])
        if len(backups) > 20:
            for b in backups[:-20]:
                try:
                    os.remove(b)
                except Exception:
                    pass
    except Exception as e:
        print(f"[WARN] Failed to create backup: {e}")


def create_venue_backup_snapshot():
    """Creates a timestamped snapshot of data/venue_directory.json prior to mutation."""
    if not os.path.exists(VENUE_DIR_PATH):
        return None
    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    dest = os.path.join(BACKUP_DIR, f"venues_{ts}.json")
    try:
        shutil.copy2(VENUE_DIR_PATH, dest)
        return f"venues_{ts}.json"
    except Exception as e:
        print(f"[WARN] Failed to create venue backup: {e}")
        return None


def save_screenshots_from_payload(payload: dict, ts_base: int = None) -> list:
    """Decodes base64 screenshots and saves them to data/curator_screenshots."""
    if ts_base is None:
        ts_base = int(time.time() * 1000)
    os.makedirs(SCREENSHOTS_DIR, exist_ok=True)
    screenshot_rel_paths = []

    raw_shots = list(payload.get("screenshotsBase64") or [])
    single_shot = payload.get("screenshotBase64")
    if single_shot and single_shot not in raw_shots:
        raw_shots.insert(0, single_shot)

    for idx, shot_b64 in enumerate(raw_shots):
        if not shot_b64 or not isinstance(shot_b64, str):
            continue
        if "," in shot_b64:
            shot_b64 = shot_b64.split(",", 1)[1]
        try:
            img_data = base64.b64decode(shot_b64)
            file_name = f"screenshot_{ts_base}_{idx}.png"
            full_img_path = os.path.join(SCREENSHOTS_DIR, file_name)
            with open(full_img_path, "wb") as f_img:
                f_img.write(img_data)
            screenshot_rel_paths.append(f"data/curator_screenshots/{file_name}")
        except Exception as e:
            print(f"[WARN] Failed to decode/save screenshot #{idx}: {e}")

    return screenshot_rel_paths


def distill_venue_learned_rules(venue_name: str, calendar_url: str = "", instruction_text: str = "", category: str = "shows", neighborhood: str = None, website_url: str = None) -> dict:
    """
    Analyzes curator plain-English comments/instructions to distill persistent,
    executable rules for venue scraping, door cover policies, schedule patterns,
    genres, and calendar deep links.
    """
    text = (instruction_text or "").strip()
    clean_cal = (calendar_url or website_url or "").strip()

    rules = {
        "venueName": venue_name,
        "category": category or "shows",
        "neighborhood": neighborhood or "Downtown / West End",
        "calendarUrl": clean_cal,
        "doorPrice": None,
        "priceRange": None,
        "pricingType": "standard",
        "isFree": False,
        "minimumSpend": None,
        "priceCeiling": 50.0,
        "scheduleDays": [],
        "genres": [],
        "blacklistPatterns": [],
        "curatorGuidance": text,
        "summary": "",
        "distilledAt": datetime.now(timezone.utc).isoformat()
    }

    if not text:
        rules["summary"] = f"Standard venue record registered for {venue_name}."
        return rules

    # 1. Calendar Deep Link Extraction
    found_urls = re.findall(r"https?://[^\s\"'>)]+", text)
    if found_urls:
        candidate_url = found_urls[0].rstrip(".,;:)")
        if candidate_url.startswith("http"):
            rules["calendarUrl"] = candidate_url

    # 2. Pricing & Door Admission Policies
    # Free / No cover
    if re.search(r"\b(?:free\s+entry|free\s+admission|no\s+cover|free\s+all\s+night|free\s+walk-ins?|\$0\b)\b", text, re.I):
        rules["doorPrice"] = 0.0
        rules["isFree"] = True
        rules["pricingType"] = "free"

    # Minimum spend (e.g. "minimum spend of $20", "minimum $15 purchase")
    min_spend_match = re.search(r"minimum\s+(?:spend|purchase)\s*(?:of\s*)?\$?(\d+(?:\.\d{2})?)", text, re.I)
    if min_spend_match:
        val = float(min_spend_match.group(1))
        if val <= 50.0:
            rules["minimumSpend"] = val
            rules["doorPrice"] = val
            rules["pricingType"] = "minimum-spend"

    # Price range (e.g. "$10-$20", "$12 to $18", "$10 - $25")
    range_match = re.search(r"\$(\d+(?:\.\d{2})?)\s*(?:-|to)\s*\$?(\d+(?:\.\d{2})?)", text, re.I)
    if range_match and rules.get("doorPrice") is None:
        low, high = float(range_match.group(1)), float(range_match.group(2))
        if low <= high and high <= 50.0:
            rules["priceRange"] = [low, high]
            rules["doorPrice"] = high
            rules["pricingType"] = "door-cover"
        elif low <= 50.0:
            rules["priceRange"] = [low, 50.0]
            rules["doorPrice"] = low
            rules["pricingType"] = "door-cover"

    # Single door cover or ticket price
    if rules.get("doorPrice") is None:
        price_match = re.search(r"(?:cover|door|admission|entry|ticket|tickets|entry\s+fee|admission\s+fee)(?:\s+is|\s*[:=-])?\s*\$?(\d+(?:\.\d{2})?)", text, re.I)
        if not price_match:
            price_match = re.search(r"\$(\d+(?:\.\d{2})?)\s*(?:cover|door|admission|entry|tickets?|at\s+the\s+door)", text, re.I)
        if price_match:
            val = float(price_match.group(1))
            if val <= 50.0:
                rules["doorPrice"] = val
                rules["pricingType"] = "door-cover"

    # Price ceiling / budget cap mentions
    cap_match = re.search(r"(?:never\s+over|under|max|cap(?:\s+of)?)\s*\$?(\d+(?:\.\d{2})?)", text, re.I)
    if cap_match:
        cval = float(cap_match.group(1))
        if 0 < cval <= 50.0:
            rules["priceCeiling"] = cval

    # 3. Schedule / Days of Week
    day_map = {
        "monday": "mon", "mon": "mon",
        "tuesday": "tue", "tue": "tue",
        "wednesday": "wed", "wed": "wed",
        "thursday": "thu", "thu": "thu",
        "friday": "fri", "fri": "fri",
        "saturday": "sat", "sat": "sat",
        "sunday": "sun", "sun": "sun"
    }
    all_week = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

    if re.search(r"\bthursdays?\s*(?:through|to|-)\s*sundays?\b", text, re.I):
        rules["scheduleDays"] = ["thu", "fri", "sat", "sun"]
    elif re.search(r"\bfridays?\s*(?:and|&|-)\s*saturdays?\b", text, re.I):
        rules["scheduleDays"] = ["fri", "sat"]
    elif re.search(r"\bweekends?\b", text, re.I):
        rules["scheduleDays"] = ["fri", "sat", "sun"]
    elif re.search(r"\bweekdays?\b", text, re.I):
        rules["scheduleDays"] = ["mon", "tue", "wed", "thu", "fri"]
    elif re.search(r"\bdaily\b", text, re.I):
        rules["scheduleDays"] = ["daily"]
    else:
        found_days = []
        for word, code in day_map.items():
            if re.search(rf"\b{word}s?\b", text, re.I) and code not in found_days:
                found_days.append(code)
        if found_days:
            rules["scheduleDays"] = sorted(found_days, key=lambda d: all_week.index(d))

    # 4. Music Genres & Tags
    genre_keywords = [
        "punk", "metal", "hardcore", "indie rock", "indie", "rock", "electronic", "techno",
        "house", "djs", "dj", "dance", "drag", "cabaret", "tiki", "comedy", "improv",
        "jazz", "blues", "folk", "hip hop", "open mic", "trivia", "board games", "arcade",
        "live music"
    ]
    detected_genres = []
    for g in genre_keywords:
        if re.search(rf"\b{re.escape(g)}\b", text, re.I):
            detected_genres.append(g)
    rules["genres"] = detected_genres

    # 5. Blacklist / Filter Patterns & Demographic Filtering
    blacklists = []
    if re.search(r"\b(?:exclude|ignore|skip)\s+private\b", text, re.I):
        blacklists.append(f"{venue_name.lower()} private rental")
    if re.search(r"\b(?:exclude|ignore|skip)\s+(?:multi-week|workshops?|courses?)\b", text, re.I):
        blacklists.append(f"{venue_name.lower()} multi-week")
    if re.search(r"\b(?:children|kids?|toddlers?|family)\b", text, re.I) and re.search(r"\b(?:don'?t include|exclude|skip|not\s+(?:the\s+)?intended demographic|only special adult)\b", text, re.I):
        blacklists.extend(["kids", "children", "toddler", "family show"])
        rules["demographicFilter"] = "adults_only"
    rules["blacklistPatterns"] = blacklists

    # 6. Executive Summary Generation
    parts = []
    if rules["isFree"]:
        parts.append("Free Admission ($0)")
    elif rules["minimumSpend"]:
        parts.append(f"Min Spend ${rules['minimumSpend']:.2f}")
    elif rules["priceRange"]:
        parts.append(f"Cover ${rules['priceRange'][0]:.0f}-${rules['priceRange'][1]:.0f}")
    elif rules["doorPrice"] is not None:
        parts.append(f"Door Cover ${rules['doorPrice']:.2f}")

    if rules.get("demographicFilter") == "adults_only":
        parts.append("Filter: Adults only (Exclude regular kids events)")
    if rules["scheduleDays"]:
        parts.append(f"Days: {', '.join(rules['scheduleDays']).upper()}")
    if rules["genres"]:
        parts.append(f"Tags: {', '.join(rules['genres'][:3])}")
    if rules["calendarUrl"]:
        parts.append(f"Calendar: {rules['calendarUrl']}")

    rules["summary"] = " | ".join(parts) if parts else f"AI distilled policy rules from curator comments for {venue_name}."
    return rules


def apply_distilled_venue_rules(distilled: dict, instruction_id: str = None) -> dict:
    """
    Persists distilled venue rules across curator_learned_rules.json,
    venue_directory.json, and updates curator_instructions.json status.
    """
    venue_name = distilled.get("venueName")
    if not venue_name:
        return {}

    # 1. Update data/curator_learned_rules.json
    rules_data = {"metadata": {}, "venue_policy_rules": {}, "venue_calendar_deep_links": {}}
    if os.path.exists(RULES_PATH):
        try:
            with open(RULES_PATH, "r", encoding="utf-8") as rf:
                rules_data = json.load(rf)
        except Exception as e:
            print(f"[WARN] Failed loading curator_learned_rules.json: {e}")

    rules_data.setdefault("venue_policy_rules", {})[venue_name] = {
        "doorPrice": distilled.get("doorPrice"),
        "priceRange": distilled.get("priceRange"),
        "pricingType": distilled.get("pricingType"),
        "minimumSpend": distilled.get("minimumSpend"),
        "priceCeiling": distilled.get("priceCeiling", 50.0),
        "scheduleDays": distilled.get("scheduleDays", []),
        "genres": distilled.get("genres", []),
        "calendarUrl": distilled.get("calendarUrl", ""),
        "summary": distilled.get("summary", ""),
        "curatorGuidance": distilled.get("curatorGuidance", ""),
        "learnedAt": datetime.now(timezone.utc).isoformat(),
        "source": f"Curator Studio Instruction {instruction_id or ''}".strip()
    }

    if distilled.get("calendarUrl"):
        rules_data.setdefault("venue_calendar_deep_links", {})[venue_name] = distilled["calendarUrl"]

    for pattern in distilled.get("blacklistPatterns", []):
        if pattern not in rules_data.setdefault("course_blacklist_patterns", []):
            rules_data["course_blacklist_patterns"].append(pattern)

    rules_data.setdefault("metadata", {})["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
    try:
        with open(RULES_PATH, "w", encoding="utf-8") as rf:
            json.dump(rules_data, rf, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"[WARN] Failed writing curator_learned_rules.json: {e}")

    # 2. Update data/venue_directory.json
    if os.path.exists(VENUE_DIR_PATH):
        try:
            with open(VENUE_DIR_PATH, "r", encoding="utf-8") as vf:
                v_dir_data = json.load(vf)
            venues_map = v_dir_data.setdefault("venues", {})
            if venue_name in venues_map:
                v_obj = venues_map[venue_name]
                v_obj["curatorInstructions"] = distilled.get("curatorGuidance", "")
                v_obj["curatorNote"] = distilled.get("curatorGuidance", "")
                v_obj["curatorLearnedRules"] = distilled
                v_obj["policySummary"] = distilled.get("summary", "")
                if distilled.get("doorPrice") is not None:
                    v_obj["doorCover"] = distilled.get("doorPrice")
                if distilled.get("priceRange"):
                    v_obj["priceRange"] = distilled.get("priceRange")
                if distilled.get("scheduleDays"):
                    v_obj["operatingDays"] = distilled.get("scheduleDays")
                if distilled.get("genres"):
                    existing_tags = list(v_obj.get("subTags") or [])
                    v_obj["subTags"] = sorted(list(set(existing_tags + distilled.get("genres", []))))
                if distilled.get("calendarUrl"):
                    v_obj["calendarUrl"] = distilled["calendarUrl"]
                    v_obj["boxOfficeUrl"] = distilled["calendarUrl"]
                v_dir_data["metadata"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
                with open(VENUE_DIR_PATH, "w", encoding="utf-8") as vf:
                    json.dump(v_dir_data, vf, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[WARN] Failed updating venue_directory.json with learned rules: {e}")

    # 3. Update data/curator_instructions.json
    if instruction_id and os.path.exists(INSTRUCTIONS_PATH):
        try:
            with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as inf:
                inst_db = json.load(inf)
            for item in inst_db.get("instructions", []):
                if item.get("id") == instruction_id:
                    if item.get("actionTaken") != "queue_only":
                        item["status"] = "active_learned"
                    else:
                        item["status"] = "pending"
                    item["aiLearned"] = True
                    item["distilledRules"] = distilled
                    item["aiLearnedSummary"] = distilled.get("summary", "")
                    item["learnedAt"] = datetime.now(timezone.utc).isoformat()
            inst_db["metadata"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
            with open(INSTRUCTIONS_PATH, "w", encoding="utf-8") as inf:
                json.dump(inst_db, inf, indent=2, ensure_ascii=False)
        except Exception as e:
            print(f"[WARN] Failed updating curator_instructions.json: {e}")

    return distilled


def map_super_cluster(ev_or_venue):
    old_n = ev_or_venue.get('neighborhood', '')
    title_l = ev_or_venue.get('title', '').lower() if 'title' in ev_or_venue else ''
    venue_l = ev_or_venue.get('venue', ev_or_venue.get('name', '')).lower()
    ev_id = ev_or_venue.get('id', ev_or_venue.get('venueId', '')).lower()

    if ('granville island' in old_n.lower() or 'granville island' in venue_l or 
        'false creek' in title_l or 'false creek' in venue_l or 'science world' in venue_l):
        return 'Granville Island & False Creek'

    if ('kitsilano' in old_n.lower() or 'ubc' in old_n.lower() or 'ubc' in venue_l or 
        'ubc' in title_l or 'point grey' in old_n.lower() or 'hollywood' in venue_l or 
        'showboat' in title_l or 'wreck beach' in title_l):
        return 'Kitsilano, Point Grey & UBC'

    if ('mount pleasant' in old_n.lower() or 'south vancouver' in old_n.lower() or 
        'cambie' in old_n.lower() or 'queen elizabeth' in venue_l or 'bloedel' in venue_l or 
        'riley park' in title_l or 'nat bailey' in venue_l or 'main street' in old_n.lower() or
        'marpole' in old_n.lower() or 'oakridge' in old_n.lower() or 'fraser' in old_n.lower() or
        'qe-park' in ev_id):
        return 'Mount Pleasant & South Vancouver'

    if ('commercial drive' in old_n.lower() or 'east van' in old_n.lower() or 
        'hastings' in old_n.lower() or 'rupert' in venue_l or 'slice of life' in venue_l or 
        'hand eye' in venue_l or 'cafe au clay' in venue_l or 'trout lake' in title_l or 
        'dude chilling' in venue_l or 'rio theatre' in venue_l or 'rio' in old_n.lower() or
        'arts factory' in venue_l or 'cultch' in venue_l):
        return 'Commercial Drive & East Vancouver'

    if ('north shore' in old_n.lower() or 'burnaby' in old_n.lower() or 'lynn canyon' in venue_l or 
        'shipyards' in venue_l or 'central park' in venue_l or 'lonsdale' in venue_l):
        return 'North Shore, Burnaby & Metro'

    return 'Downtown, Gastown & Yaletown'


def sync_js_data_file():
    """Regenerates js/data.js from data/events.json and data/manual_review_queue.json."""
    try:
        events = []
        if os.path.exists(EVENTS_PATH):
            with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                events = data if isinstance(data, list) else data.get("events", [])

        for ev in events:
            ev["neighborhood"] = map_super_cluster(ev)

        quarantined = []
        if os.path.exists(MANUAL_QUEUE_PATH):
            with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                qdata = json.load(f)
                quarantined = qdata if isinstance(qdata, list) else qdata.get("quarantinedEvents", [])

        for q in quarantined:
            q["neighborhood"] = map_super_cluster(q)

        discovery_sources = []
        disc_path = os.path.join(DATA_DIR, "discovery_sources.json")
        if os.path.exists(disc_path):
            try:
                with open(disc_path, "r", encoding="utf-8") as f:
                    discovery_sources = json.load(f).get("sources", [])
            except Exception as e:
                print(f"[WARN] Failed to load discovery sources: {e}")

        from sync_events import VENUE_URLS

        timestamp = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
        js_content = f"""// Van50 — Vancouver Events & Outings (Strictly <= $50 CAD)
// AUTO-GENERATED from central data/events.json on {timestamp}
// Single Reference Source Architecture • 0 Client-Side Scraping

const VANCOUVER_EVENTS = {json.dumps(events, indent=2, ensure_ascii=False)};
const MANUAL_REVIEW_QUEUE = {json.dumps(quarantined, indent=2, ensure_ascii=False)};

// Regional Super-Clusters (Option B)
const NEIGHBORHOODS = [
  "Downtown, Gastown & Yaletown",
  "Mount Pleasant & South Vancouver",
  "Commercial Drive & East Vancouver",
  "Kitsilano, Point Grey & UBC",
  "Granville Island & False Creek",
  "North Shore, Burnaby & Metro"
];

// Days of the Week
const DAYS_OF_WEEK = [
  {{ id: "all", label: "All Days", icon: "🗓️" }},
  {{ id: "mon", label: "Mon", full: "Monday" }},
  {{ id: "tue", label: "Tue", full: "Tuesday" }},
  {{ id: "wed", label: "Wed", full: "Wednesday" }},
  {{ id: "thu", label: "Thu", full: "Thursday" }},
  {{ id: "fri", label: "Fri", full: "Friday" }},
  {{ id: "sat", label: "Sat", full: "Saturday" }},
  {{ id: "sun", label: "Sun", full: "Sunday" }},
  {{ id: "daily", label: "Daily Spots", icon: "☀️" }}
];

// Time of Day Starting Slots
const TIME_SLOTS = [
  {{ id: "all", label: "Any Time", icon: "⏰" }},
  {{ id: "early-morning", label: "Early Morning", desc: "Before 12pm", icon: "🌅" }},
  {{ id: "afternoon", label: "Afternoon", desc: "12pm – 5pm", icon: "☀️" }},
  {{ id: "early-evening", label: "Early Evening", desc: "5pm – 8:30pm", icon: "🌆" }},
  {{ id: "late-evening", label: "Late Evening", desc: "8:30pm+", icon: "🌙" }}
];

// Recurrence Frequency Metadata
const FREQUENCIES = [
  {{ id: "all", label: "All Frequencies", icon: "✨" }},
  {{ id: "weekly", label: "Weekly", icon: "🔄", color: "#a855f7" }},
  {{ id: "monthly", label: "Monthly", icon: "📅", color: "#06b6d4" }},
  {{ id: "daily", label: "Daily", icon: "☀️", color: "#f59e0b" }},
  {{ id: "one-off", label: "One-Off", icon: "🎟️", color: "#f43f5e" }},
  {{ id: "seasonal", label: "Seasonal", icon: "🌟", color: "#10b981" }},
  {{ id: "limited-run", label: "Limited Run", icon: "⏳", color: "#10b981" }}
];

// Curated Category Taxonomy (Multi-Category Support)
const CATEGORIES = [
  {{ id: "all", label: "All", icon: "✨" }},
  {{ id: "music", label: "Live Music", icon: "🎵" }},
  {{ id: "shows", label: "Comedy & Stage", icon: "🎭" }},
  {{ id: "festivals", label: "Festivals", icon: "🎪" }},
  {{ id: "markets", label: "Markets", icon: "🧺" }},
  {{ id: "outdoors", label: "Outdoors", icon: "🌲" }},
  {{ id: "cinema", label: "Cinema", icon: "🎬" }},
  {{ id: "social", label: "Social & Arts", icon: "🎨" }}
];

// Curated Venue Homepages Directory
const VENUE_URLS = {json.dumps(VENUE_URLS, indent=2, ensure_ascii=False)};

// Curated Discovery Sources Directory
const DISCOVERY_SOURCES = {json.dumps(discovery_sources, indent=2, ensure_ascii=False)};
"""
        with open(JS_DATA_PATH, "w", encoding="utf-8") as f:
            f.write(js_content)
        print("[OK] Synchronized js/data.js with active catalog.")
    except Exception as e:
        print(f"[ERROR] Failed to regenerate js/data.js: {e}")


def ensure_event_catalog_fields(ev: dict) -> dict:
    """Ensures an event promoted to events.json meets all 7-dimension schema requirements."""
    category = ev.get("category") or "shows"
    ev["category"] = category
    if not ev.get("categories"):
        ev["categories"] = [category]
    if not ev.get("frequency") or ev.get("frequency") not in {'limited-run', 'annual', 'one-off', 'daily', 'weekly', 'monthly', 'seasonal'}:
        ev["frequency"] = "one-off"
    if not ev.get("frequencyLabel"):
        ev["frequencyLabel"] = "One-off Event"
    if not ev.get("confirmedDates") and not ev.get("startIso"):
        ev["confirmedDates"] = ["2026-09-25"]
        ev["startIso"] = "2026-09-25T19:00:00-07:00"
    if not ev.get("coordinates") or not isinstance(ev.get("coordinates"), list) or len(ev.get("coordinates")) != 2:
        ev["coordinates"] = [49.2827, -123.1207]
    if not ev.get("transitInfo") or len(str(ev.get("transitInfo")).strip()) < 5:
        ev["transitInfo"] = "Transit accessible via TransLink SkyTrain / bus service"
    desc = str(ev.get("description") or "").strip()
    if len(desc) < 50:
        venue_str = ev.get("venue") or "Vancouver"
        ev["description"] = f"Live {category} performance and cultural presentation hosted at {venue_str}. Curated and verified under $50 CAD in Vancouver."
    price = float(ev.get("price", 0.0))
    ev["pricingType"] = "free" if price == 0 else "paid"
    ev["isFree"] = (price == 0)
    return ev


class CuratorRequestHandler(http.server.SimpleHTTPRequestHandler):
    """Custom HTTP Request Handler supporting standard file delivery and /api/curator endpoints."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def end_headers(self):
        # Strict Cache-Control
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")

        # Defense-in-Depth Security Headers
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()")
        self.send_header("X-XSS-Protection", "1; mode=block")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
            "font-src 'self' https://fonts.gstatic.com; "
            "img-src 'self' data: https:; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "object-src 'none'; "
            "base-uri 'self';"
        )
        super().end_headers()

    def _get_client_ip(self) -> str:
        client_ip = self.headers.get("X-Forwarded-For")
        if client_ip:
            return client_ip.split(",")[0].strip()
        return self.client_address[0] if self.client_address else "127.0.0.1"

    def _apply_cors_headers(self):
        """Restricts CORS to local loopback and authorized host; prevents wildcard origin exposure."""
        origin = self.headers.get("Origin", "")
        if origin and (
            origin.startswith("http://127.0.0.1:") or
            origin.startswith("http://localhost:") or
            origin in {"http://127.0.0.1:8080", "http://localhost:8080"}
        ):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Vary", "Origin")

    def _send_forbidden(self, message: str = "Access Denied: Protected Resource"):
        """Returns 403 Forbidden with security headers and descriptive error message."""
        response_bytes = message.encode("utf-8")
        self.send_response(403)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def list_directory(self, path):
        """Disables directory browsing across the entire server."""
        self._send_forbidden("Access Denied: Directory browsing is disabled.")
        return None

    def _send_json(self, status: int, data: dict):
        response_bytes = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self._apply_cors_headers()
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Curator-Token, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        if getattr(self, "close_connection", False):
            self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(response_bytes)

    def _check_authenticated(self) -> bool:
        token = self.headers.get("Curator-Token")
        if not token:
            auth_header = self.headers.get("Authorization", "")
            if auth_header.startswith("Bearer "):
                token = auth_header.split(" ", 1)[1].strip()

        if not token:
            return False

        valid, _ = verify_session_token(token)
        return valid

    def do_OPTIONS(self):
        self.send_response(200)
        self._apply_cors_headers()
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Curator-Token, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # 1. API: Check authentication & counts
        if path == "/api/curator/status":
            is_auth = self._check_authenticated()
            q_count = 0
            m_count = 0
            r_count = 0
            if os.path.exists(MANUAL_QUEUE_PATH):
                try:
                    with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                        q_data = json.load(f)
                        raw_q = q_data.get("quarantinedEvents", [])
                        # Strict budget cap: curator only reviews items needing confirmation where price <= 50.0 or unverified
                        q_count = len([
                            x for x in raw_q
                            if float(x.get("attemptedPrice", x.get("price", 0.0))) <= 50.0
                            and not any(k in str(x.get("flagReason", "")).lower() for k in ["strictly exceeds", "exceeds $50", "over-budget"])
                        ])
                except Exception:
                    pass
            if os.path.exists(EVENTS_PATH):
                try:
                    with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                        m_data = json.load(f)
                        m_count = len(m_data.get("events", []))
                except Exception:
                    pass
            if os.path.exists(RULES_PATH):
                try:
                    with open(RULES_PATH, "r", encoding="utf-8") as f:
                        r_data = json.load(f)
                        r_count = (
                            len(r_data.get("vendor_fee_formulas", {})) +
                            len(r_data.get("venue_calendar_deep_links", {})) +
                            len(r_data.get("course_blacklist_patterns", [])) +
                            len(r_data.get("price_override_heuristics", []))
                        )
                except Exception:
                    pass

            a_count = 0
            if os.path.exists(ARCHIVE_PATH):
                try:
                    with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
                        a_data = json.load(f)
                        arch_events = a_data.get("archivedEvents", [])
                        # Non-budget archived items
                        a_count = len([x for x in arch_events if x.get("reviewStatus") != "denied_auto_budget" and float(x.get("attemptedPrice", x.get("price", 0.0))) <= 50.0])
                except Exception:
                    pass

            inst_count = 0
            if os.path.exists(INSTRUCTIONS_PATH):
                try:
                    with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
                        i_data = json.load(f)
                        inst_count = len([i for i in i_data.get("instructions", []) if i.get("status") == "pending"])
                except Exception:
                    pass

            v_count = 0
            if os.path.exists(DISCOVERED_VENUES_PATH):
                try:
                    with open(DISCOVERED_VENUES_PATH, "r", encoding="utf-8") as f:
                        v_data = json.load(f)
                        v_count = len([x for x in v_data.get("discoveredVenues", []) if x.get("status") == "pending"])
                except Exception:
                    pass

            known_venues = []
            if os.path.exists(VENUE_DIR_PATH):
                try:
                    with open(VENUE_DIR_PATH, "r", encoding="utf-8") as f:
                        vd = json.load(f)
                        known_venues = list(vd.get("venues", {}).keys())
                except Exception:
                    pass

            link_audit_data = None
            audit_report_path = os.path.join(LOGS_DIR, "link_audit_latest.json")
            if os.path.exists(audit_report_path):
                try:
                    with open(audit_report_path, "r", encoding="utf-8") as af:
                        link_audit_data = json.load(af)
                except Exception:
                    pass

            return self._send_json(200, {
                "server": "Van50 Curator Daemon",
                "authenticated": is_auth,
                "pendingCount": q_count,
                "masterCount": m_count,
                "rulesCount": r_count,
                "archivedCount": a_count,
                "instructionsPendingCount": inst_count,
                "discoveredVenuesCount": v_count,
                "knownVenues": known_venues,
                "linkAudit": link_audit_data,
                "timestamp": datetime.now().isoformat()
            })

        # API: Automation status
        if path == "/api/automation/status":
            return self._send_json(200, get_automation_status())

        # 2. API: Get quarantined events (requires auth)
        if path == "/api/curator/queue":
            if not self._check_authenticated():
                return self._send_json(401, {"error": "Authentication required", "authenticated": False})
            queue_data = {"metadata": {}, "quarantinedEvents": []}
            if os.path.exists(MANUAL_QUEUE_PATH):
                with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                    queue_data = json.load(f)

            # Cross-reference with curator_instructions.json to annotate dealt-with items
            instructions_map = {}
            if os.path.exists(INSTRUCTIONS_PATH):
                try:
                    with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as inf:
                        inst_data = json.load(inf)
                        for inst in inst_data.get("instructions", []):
                            eid = inst.get("eventId")
                            if eid and inst.get("status") != "dismissed":
                                if eid not in instructions_map or inst.get("status") == "pending":
                                    instructions_map[eid] = inst
                except Exception:
                    pass

            # Strict budget cap: exclude any events > $50.00 from curator triage
            filtered_q = []
            for ev in queue_data.get("quarantinedEvents", []):
                try:
                    p = float(ev.get("attemptedPrice", ev.get("price", 0.0)))
                except (ValueError, TypeError):
                    p = 0.0
                r = str(ev.get("flagReason", "")).lower()
                if p > 50.0 or any(k in r for k in ["strictly exceeds", "exceeds $50", "over-budget"]):
                    continue
                filtered_q.append(ev)

            # Hydrate date fields from events.json if missing from quarantine queue
            catalog_lookup = {}
            if os.path.exists(EVENTS_PATH):
                try:
                    with open(EVENTS_PATH, "r", encoding="utf-8") as ef:
                        c_data = json.load(ef)
                        for cev in c_data.get("events", []):
                            cid = cev.get("id")
                            if cid:
                                catalog_lookup[cid] = cev
                except Exception:
                    pass

            for ev in filtered_q:
                eid = ev.get("id")
                if eid in catalog_lookup:
                    cev = catalog_lookup[eid]
                    for date_field in ["dateSchedule", "startIso", "endIso", "frequency", "frequencyLabel", "daysOfWeek", "isDaily"]:
                        if date_field not in ev or not ev[date_field]:
                            if date_field in cev and cev[date_field]:
                                ev[date_field] = cev[date_field]

                if eid in instructions_map:
                    ev["dealtWith"] = True
                    ev["queuedInstruction"] = instructions_map[eid]
                else:
                    ev["dealtWith"] = False
                    ev["queuedInstruction"] = None

            queue_data["quarantinedEvents"] = filtered_q
            queue_data.setdefault("metadata", {})["pendingCount"] = len(filtered_q)
            return self._send_json(200, queue_data)

        # 3. API: Get learned rules (requires auth)
        if path == "/api/curator/rules":
            if not self._check_authenticated():
                return self._send_json(401, {"error": "Authentication required", "authenticated": False})
            if os.path.exists(RULES_PATH):
                with open(RULES_PATH, "r", encoding="utf-8") as f:
                    return self._send_json(200, json.load(f))
            return self._send_json(200, {})

        # 4. API: Get archived events (requires auth)
        if path == "/api/curator/archived":
            if not self._check_authenticated():
                return self._send_json(401, {"error": "Authentication required", "authenticated": False})
            if os.path.exists(ARCHIVE_PATH):
                with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
                    arch_full = json.load(f)
                    # Filter out > $50 events so curator never sees them
                    arch_filtered = [
                        x for x in arch_full.get("archivedEvents", [])
                        if float(x.get("attemptedPrice", x.get("price", 0.0))) <= 50.0
                        and x.get("reviewStatus") != "denied_auto_budget"
                    ]
                    arch_full["archivedEvents"] = arch_filtered
                    return self._send_json(200, arch_full)
            return self._send_json(200, {"metadata": {}, "archivedEvents": []})

        # 5. API: Get queued AI instructions (requires auth)
        if path == "/api/curator/instructions":
            if not self._check_authenticated():
                return self._send_json(401, {"error": "Authentication required", "authenticated": False})
            if os.path.exists(INSTRUCTIONS_PATH):
                with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
                    return self._send_json(200, json.load(f))
            return self._send_json(200, {"metadata": {}, "instructions": []})

        # 6. API: Get discovered venues candidate list
        if path == "/api/curator/discovered_venues":
            if not self._check_authenticated():
                return self._send_json(401, {"error": "Authentication required", "authenticated": False})
            disc = {"metadata": {}, "discoveredVenues": []}
            if os.path.exists(DISCOVERED_VENUES_PATH):
                try:
                    with open(DISCOVERED_VENUES_PATH, "r", encoding="utf-8") as f:
                        disc = json.load(f)
                except Exception:
                    pass

            # Cross-reference with curator_instructions.json
            if os.path.exists(INSTRUCTIONS_PATH):
                try:
                    with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
                        inst_db = json.load(f)
                    inst_map = {}
                    for inst in inst_db.get("instructions", []):
                        ev_id = inst.get("eventId")
                        v_name = (inst.get("venueName") or "").lower().strip()
                        if ev_id:
                            inst_map[ev_id] = inst
                        if v_name:
                            inst_map[v_name] = inst
                    for v in disc.get("discoveredVenues", []):
                        v_id = v.get("id")
                        v_nm = (v.get("name") or "").lower().strip()
                        if v_id in inst_map:
                            v["queuedInstruction"] = inst_map[v_id]
                            v["dealtWith"] = True
                        elif v_nm in inst_map:
                            v["queuedInstruction"] = inst_map[v_nm]
                            v["dealtWith"] = True
                except Exception:
                    pass

            return self._send_json(200, disc)

        # 7. API: Get festival registry
        if path == "/api/curator/festivals":
            if not self._check_authenticated():
                return self._send_json(401, {"error": "Authentication required", "authenticated": False})
            fests = {"metadata": {}, "festivals": []}
            if os.path.exists(FESTIVAL_REGISTRY_PATH):
                try:
                    with open(FESTIVAL_REGISTRY_PATH, "r", encoding="utf-8") as f:
                        fests = json.load(f)
                except Exception:
                    pass
            return self._send_json(200, fests)

        # Standard file serving for web UI with path filtering & access control
        # 1. Traversal & boundary check
        rel_path = path.lstrip("/\\")
        full_path = os.path.normpath(os.path.join(BASE_DIR, rel_path))

        try:
            common = os.path.commonpath([BASE_DIR, full_path])
            if common != BASE_DIR:
                return self._send_forbidden("Access Denied: Path traversal is prohibited.")
        except Exception:
            return self._send_forbidden("Access Denied: Invalid path.")

        # 2. Block hidden files and dotfiles (e.g. .env, .git, .curator_secret.json)
        parts = rel_path.replace("\\", "/").split("/")
        for part in parts:
            if part.startswith(".") and part not in {".", ".."}:
                return self._send_forbidden("Access Denied: Protected system file.")

        # 3. Block protected internal directories
        if len(parts) > 0 and parts[0] in BLOCKED_DIRS:
            return self._send_forbidden(f"Access Denied: Directory '{parts[0]}' is protected.")

        # 4. Block direct access to administrative data files (must use authenticated API)
        file_name = os.path.basename(full_path)
        if file_name in BLOCKED_DATA_FILES:
            if not self._check_authenticated():
                return self._send_forbidden("Access Denied: Administrative data requires curator authentication.")

        # 5. Block directory browsing
        if os.path.isdir(full_path):
            index_file = os.path.join(full_path, "index.html")
            if not os.path.exists(index_file):
                return self._send_forbidden("Access Denied: Directory browsing is disabled.")

        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path
        client_ip = self._get_client_ip()

        # Enforce Content-Length checks to prevent memory exhaustion DoS
        content_len_header = self.headers.get("Content-Length")
        if not content_len_header and path.startswith("/api/curator/"):
            return self._send_json(411, {"error": "Length Required"})

        try:
            content_len = int(content_len_header or 0)
        except ValueError:
            return self._send_json(400, {"error": "Invalid Content-Length header"})

        # Limits: 25MB for screenshot uploads (supporting multiple screenshots), 256KB for all other JSON endpoints
        max_bytes = 25 * 1024 * 1024 if path in {"/api/curator/instruction", "/api/curator/venues/add", "/api/curator/verify-screenshot"} else 256 * 1024
        if content_len > max_bytes:
            try:
                # Drain small excess if feasible to prevent abrupt connection reset
                if content_len <= 1024 * 1024:
                    self.rfile.read(content_len)
            except Exception:
                pass
            self.close_connection = True
            unit = "MB" if max_bytes >= 1024 * 1024 else "KB"
            div = (1024 * 1024) if max_bytes >= 1024 * 1024 else 1024
            return self._send_json(413, {"error": f"Payload Too Large. Max permitted size is {max_bytes // div} {unit}."})

        try:
            body_raw = self.rfile.read(content_len).decode("utf-8") if content_len > 0 else "{}"
            payload = json.loads(body_raw)
        except Exception as e:
            return self._send_json(400, {"error": f"Invalid JSON payload: {e}"})

        # 1. API: Authenticate
        if path == "/api/curator/auth":
            password = payload.get("password", "")
            ok, msg, cooldown = verify_curator_password(password, client_ip)
            if ok:
                token = generate_session_token()
                return self._send_json(200, {
                    "success": True,
                    "message": "Authentication successful",
                    "token": token
                })
            else:
                status_code = 429 if cooldown > 0 and "locked" in msg.lower() else 401
                return self._send_json(status_code, {
                    "success": False,
                    "message": msg,
                    "cooldown": cooldown
                })

        # 2. API: Logout & Revoke Session Token
        if path == "/api/curator/logout":
            token = self.headers.get("Curator-Token")
            if not token:
                auth_header = self.headers.get("Authorization", "")
                if auth_header.startswith("Bearer "):
                    token = auth_header.split(" ", 1)[1].strip()
            if token:
                revoke_session_token(token)
            return self._send_json(200, {"success": True, "message": "Session revoked and logged out."})

        # All mutating endpoints strictly require authentication
        if not self._check_authenticated():
            return self._send_json(403, {"error": "Forbidden: Valid Curator-Token required for database mutations"})

        # Sliding window rate limit on mutating endpoints
        if path in {
            "/api/curator/approve", "/api/curator/reject", "/api/curator/rules", 
            "/api/curator/rules/update", "/api/curator/rules/delete",
            "/api/curator/instruction", "/api/curator/instructions/update", "/api/curator/instructions/delete",
            "/api/curator/dismiss_instruction", "/api/curator/venues/add", "/api/curator/discovered_venues/dismiss"
        }:
            if not check_mutating_rate_limit(client_ip):
                return self._send_json(429, {"error": "Rate limit exceeded: Too many mutating actions. Please wait a minute."})

        # 2. API: Approve event & promote to master list
        if path == "/api/curator/approve":
            event_data = payload.get("event")
            if not event_data or not event_data.get("id"):
                return self._send_json(400, {"error": "Missing event data or event id"})

            ev_id = event_data["id"]
            price = float(event_data.get("price", 0.0))
            if price > 50.0:
                return self._send_json(400, {"error": f"Price ${price:.2f} strictly exceeds <= $50.00 CAD budget limit."})

            # Create backup snapshot before writing
            create_backup_snapshot()

            # Sanitize all string fields against stored XSS
            event_data["title"] = sanitize_text(str(event_data.get("title", "")))
            event_data["venue"] = sanitize_text(str(event_data.get("venue", "")))
            event_data["description"] = sanitize_text(str(event_data.get("description", "")))
            event_data["neighborhood"] = sanitize_text(str(event_data.get("neighborhood", "")))
            if "dateSchedule" in event_data and event_data["dateSchedule"]:
                event_data["dateSchedule"] = sanitize_text(str(event_data["dateSchedule"]))
            category = sanitize_text(str(event_data.get("category") or "shows"))
            source_url = sanitize_text(str(event_data.get("websiteUrl") or event_data.get("url") or ""))

            curator_note = sanitize_text(payload.get("curatorNote") or event_data.get("curatorNote") or "Approved by curator in Van50 Curator Studio.")
            raw_price_label = sanitize_text(event_data.get("priceLabel") or "")
            if not raw_price_label or raw_price_label == "$0.00 door" or (price == 0 and "$0.00" in raw_price_label):
                price_label = "Free ($0)" if price == 0 else f"${price:.2f} CAD"
            else:
                price_label = raw_price_label

            # Ensure checkout verification metadata is set
            event_data["checkoutVerification"] = {
                "status": "verified_live",
                "method": "manual_curator_review",
                "verifiedTotal": price,
                "feeBreakdown": event_data.get("feeBreakdown") or f"${price:.2f} CAD verified via Curator Studio review",
                "verifiedAt": datetime.now(timezone.utc).isoformat(),
                "details": f"Approved by curator in Van50 Curator Studio. Note: {curator_note}",
                "curatorSnapshot": {
                    "approvedTitle": event_data.get("title"),
                    "approvedPrice": price,
                    "approvedPriceLabel": price_label,
                    "approvedCategory": category,
                    "curatorNote": curator_note,
                    "approvedAt": datetime.now(timezone.utc).isoformat(),
                    "sourceUrl": source_url
                }
            }
            event_data["curatorNote"] = curator_note
            event_data["category"] = category
            event_data["isSoldOut"] = bool(event_data.get("isSoldOut", False))
            event_data = ensure_event_catalog_fields(event_data)

            # 1. Add/update in data/events.json
            with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                db = json.load(f)
            events_list = db.get("events", [])
            # Deduplicate by ID
            events_list = [e for e in events_list if e["id"] != ev_id]
            events_list.append(event_data)
            db["events"] = events_list
            db["metadata"]["totalEvents"] = len(events_list)
            db["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
            with open(EVENTS_PATH, "w", encoding="utf-8") as f:
                json.dump(db, f, indent=2, ensure_ascii=False)

            # 2. Remove from data/manual_review_queue.json
            with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                q_data = json.load(f)
            q_list = q_data.get("quarantinedEvents", [])
            q_list = [q for q in q_list if q["id"] != ev_id]
            q_data["quarantinedEvents"] = q_list
            q_data["metadata"]["pendingCount"] = len(q_list)
            q_data["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
            with open(MANUAL_QUEUE_PATH, "w", encoding="utf-8") as f:
                json.dump(q_data, f, indent=2, ensure_ascii=False)

            # 3. Record positive reinforcement learning signal in data/curator_instructions.json
            try:
                if os.path.exists(INSTRUCTIONS_PATH):
                    with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as inf:
                        inst_db = json.load(inf)
                else:
                    inst_db = {"metadata": {}, "instructions": []}
                instructions_list = inst_db.setdefault("instructions", [])
                
                # Check if this exact event already has a pending reinforcement entry
                existing_learn = next((i for i in instructions_list if i.get("eventId") == ev_id and i.get("status") == "pending" and i.get("type") == "reinforcement_learning"), None)
                if not existing_learn:
                    learning_entry = {
                        "id": f"learn_{int(time.time() * 1000)}",
                        "createdAt": datetime.now(timezone.utc).isoformat(),
                        "status": "pending",
                        "type": "reinforcement_learning",
                        "actionTaken": "approved_as_is",
                        "eventId": ev_id,
                        "eventTitle": event_data.get("title", ""),
                        "venueName": event_data.get("venue", ""),
                        "sourceUrl": event_data.get("websiteUrl") or event_data.get("url") or "",
                        "approvedPrice": price,
                        "instructionText": f"Approved As-Is by curator. Verified price (${price:.2f} CAD) and category '{category}'. Reinforce crawler accuracy for {event_data.get('venue', 'this venue')}.",
                        "screenshotPath": None,
                        "curatorNote": curator_note,
                        "targetScraperOrEngine": event_data.get("venue", "UniversalCrawler")
                    }
                    instructions_list.append(learning_entry)
                    inst_db.setdefault("metadata", {})["pendingCount"] = len([i for i in instructions_list if i.get("status") == "pending"])
                    inst_db["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
                    with open(INSTRUCTIONS_PATH, "w", encoding="utf-8") as inf:
                        json.dump(inst_db, inf, indent=2, ensure_ascii=False)
            except Exception as e:
                print(f"[WARN] Failed to record learning signal on approve: {e}")

            # 4. Synchronize js/data.js
            sync_js_data_file()

            return self._send_json(200, {
                "success": True,
                "message": f"Successfully approved '{event_data.get('title')}' and queued for AI learning.",
                "remainingQuarantine": len(q_list),
                "totalMasterEvents": len(events_list)
            })

        # 3. API: Reject event & archive
        if path == "/api/curator/reject":
            ev_id = payload.get("id")
            reason = payload.get("reason", "Dismissed by curator")
            if not ev_id:
                return self._send_json(400, {"error": "Missing event id"})

            # Remove from manual review queue
            with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                q_data = json.load(f)
            q_list = q_data.get("quarantinedEvents", [])
            rejected_item = next((q for q in q_list if q["id"] == ev_id), None)
            q_list = [q for q in q_list if q["id"] != ev_id]
            q_data["quarantinedEvents"] = q_list
            q_data["metadata"]["pendingCount"] = len(q_list)
            with open(MANUAL_QUEUE_PATH, "w", encoding="utf-8") as f:
                json.dump(q_data, f, indent=2, ensure_ascii=False)

            # Save to archived_events.json
            os.makedirs(os.path.dirname(ARCHIVE_PATH), exist_ok=True)
            arch_data = {"metadata": {"updatedAt": datetime.now().isoformat()}, "archivedEvents": []}
            if os.path.exists(ARCHIVE_PATH):
                try:
                    with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
                        arch_data = json.load(f)
                except Exception:
                    pass
            if rejected_item:
                rejected_item["archivedReason"] = reason
                rejected_item["archivedAt"] = datetime.now().isoformat()
                arch_data["archivedEvents"].append(rejected_item)
                with open(ARCHIVE_PATH, "w", encoding="utf-8") as f:
                    json.dump(arch_data, f, indent=2, ensure_ascii=False)

            # Record in learned rules archived IDs
            try:
                with open(RULES_PATH, "r", encoding="utf-8") as f:
                    r_data = json.load(f)
                if ev_id not in r_data.setdefault("archived_event_ids", []):
                    r_data["archived_event_ids"].append(ev_id)
                    with open(RULES_PATH, "w", encoding="utf-8") as f:
                        json.dump(r_data, f, indent=2, ensure_ascii=False)
            except Exception:
                pass

            sync_js_data_file()

            return self._send_json(200, {
                "success": True,
                "message": f"Quarantined event '{ev_id}' dismissed and moved to archive.",
                "remainingQuarantine": len(q_list)
            })

        # 4. API: Learn rule
        if path == "/api/curator/learn-rule":
            rule_type = payload.get("ruleType")
            rule_key = payload.get("key")
            rule_value = payload.get("value")

            if not rule_type or not rule_value:
                return self._send_json(400, {"error": "Missing ruleType or ruleValue"})

            with open(RULES_PATH, "r", encoding="utf-8") as f:
                rules = json.load(f)

            if rule_type in ["vendor_fee_formulas", "venue_calendar_deep_links"]:
                if not rule_key:
                    return self._send_json(400, {"error": f"ruleKey required for {rule_type}"})
                rules.setdefault(rule_type, {})[rule_key] = rule_value
            elif rule_type in ["course_blacklist_patterns", "archived_event_ids"]:
                val = str(rule_value).lower().strip()
                if val not in rules.setdefault(rule_type, []):
                    rules[rule_type].append(val)
            elif rule_type == "price_override_heuristics":
                rules.setdefault("price_override_heuristics", []).append(rule_value)

            rules["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
            with open(RULES_PATH, "w", encoding="utf-8") as f:
                json.dump(rules, f, indent=2, ensure_ascii=False)

            return self._send_json(200, {
                "success": True,
                "message": f"Successfully registered learned rule in '{rule_type}'.",
                "rules": rules
            })

        # 4b. API: Update existing learned rule
        if path == "/api/curator/rules/update":
            rule_type = payload.get("ruleType")
            key = sanitize_text(str(payload.get("key") or "").strip())
            old_key = sanitize_text(str(payload.get("oldKey") or "").strip()) or key
            value = payload.get("value") if "value" in payload else payload.get("data")

            if not rule_type or value is None:
                return self._send_json(400, {"error": "Missing ruleType or value."})

            with open(RULES_PATH, "r", encoding="utf-8") as f:
                rules = json.load(f)

            if rule_type in ["venue_policy_rules", "vendor_fee_formulas", "venue_calendar_deep_links"]:
                if not key:
                    return self._send_json(400, {"error": "Key is required."})
                target_dict = rules.setdefault(rule_type, {})
                if old_key and old_key in target_dict and old_key != key:
                    del target_dict[old_key]
                target_dict[key] = value
            elif rule_type in ["course_blacklist_patterns", "archived_event_ids"]:
                patterns = rules.setdefault(rule_type, [])
                new_val = str(value).lower().strip()
                if old_key and old_key in patterns:
                    idx = patterns.index(old_key)
                    patterns[idx] = new_val
                elif new_val not in patterns:
                    patterns.append(new_val)
            elif rule_type == "price_override_heuristics":
                rules.setdefault("price_override_heuristics", []).append(value)
            else:
                return self._send_json(400, {"error": f"Unknown ruleType: {rule_type}"})

            rules["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
            with open(RULES_PATH, "w", encoding="utf-8") as f:
                json.dump(rules, f, indent=2, ensure_ascii=False)

            r_count = (
                len(rules.get("vendor_fee_formulas", {})) +
                len(rules.get("venue_calendar_deep_links", {})) +
                len(rules.get("course_blacklist_patterns", [])) +
                len(rules.get("price_override_heuristics", []))
            )

            return self._send_json(200, {
                "success": True,
                "message": f"Successfully updated rule in '{rule_type}'.",
                "rulesCount": r_count,
                "rules": rules
            })

        # 4c. API: Delete learned rule
        if path == "/api/curator/rules/delete":
            rule_type = payload.get("ruleType")
            key = payload.get("key")

            if not rule_type or key is None:
                return self._send_json(400, {"error": "Missing ruleType or key."})

            with open(RULES_PATH, "r", encoding="utf-8") as f:
                rules = json.load(f)

            if rule_type in ["venue_policy_rules", "vendor_fee_formulas", "venue_calendar_deep_links"]:
                rules.setdefault(rule_type, {}).pop(str(key), None)
            elif rule_type in ["course_blacklist_patterns", "archived_event_ids"]:
                patterns = rules.setdefault(rule_type, [])
                val_to_remove = str(key).lower().strip()
                if val_to_remove in patterns:
                    patterns.remove(val_to_remove)
            elif rule_type == "price_override_heuristics":
                heuristics = rules.setdefault("price_override_heuristics", [])
                try:
                    idx = int(key)
                    if 0 <= idx < len(heuristics):
                        heuristics.pop(idx)
                except (ValueError, TypeError):
                    pass
            else:
                return self._send_json(400, {"error": f"Unknown ruleType: {rule_type}"})

            rules["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
            with open(RULES_PATH, "w", encoding="utf-8") as f:
                json.dump(rules, f, indent=2, ensure_ascii=False)

            r_count = (
                len(rules.get("vendor_fee_formulas", {})) +
                len(rules.get("venue_calendar_deep_links", {})) +
                len(rules.get("course_blacklist_patterns", [])) +
                len(rules.get("price_override_heuristics", []))
            )

            return self._send_json(200, {
                "success": True,
                "message": f"Successfully deleted rule from '{rule_type}'.",
                "rulesCount": r_count,
                "rules": rules
            })

        # 4d. API: Update AI instruction
        if path == "/api/curator/instructions/update":
            inst_id = payload.get("id")
            text = payload.get("instructionText")
            note = payload.get("curatorNote")
            status = payload.get("status")

            if not inst_id:
                return self._send_json(400, {"error": "Missing instruction id."})

            if not os.path.exists(INSTRUCTIONS_PATH):
                return self._send_json(404, {"error": "Instructions file not found."})

            with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as inf:
                inst_db = json.load(inf)

            instructions = inst_db.get("instructions", [])
            target = next((i for i in instructions if i.get("id") == inst_id), None)
            if not target:
                return self._send_json(404, {"error": f"Instruction '{inst_id}' not found."})

            if text is not None:
                target["instructionText"] = sanitize_text(str(text).strip())
            if note is not None:
                target["curatorNote"] = sanitize_text(str(note).strip())
            if status is not None and status in {"pending", "resolved", "dismissed"}:
                target["status"] = status

            pending_count = len([i for i in instructions if i.get("status") == "pending"])
            inst_db.setdefault("metadata", {})["pendingCount"] = pending_count
            inst_db["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")

            with open(INSTRUCTIONS_PATH, "w", encoding="utf-8") as inf:
                json.dump(inst_db, inf, indent=2, ensure_ascii=False)

            return self._send_json(200, {
                "success": True,
                "message": "Instruction updated successfully.",
                "instruction": target,
                "instructionsPendingCount": pending_count
            })

        # 4e. API: Delete AI instruction
        if path == "/api/curator/instructions/delete":
            inst_id = payload.get("id")
            if not inst_id:
                return self._send_json(400, {"error": "Missing instruction id."})

            if not os.path.exists(INSTRUCTIONS_PATH):
                return self._send_json(404, {"error": "Instructions file not found."})

            with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as inf:
                inst_db = json.load(inf)

            instructions = inst_db.get("instructions", [])
            inst_db["instructions"] = [i for i in instructions if i.get("id") != inst_id]
            pending_count = len([i for i in inst_db["instructions"] if i.get("status") == "pending"])
            inst_db.setdefault("metadata", {})["pendingCount"] = pending_count
            inst_db["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")

            with open(INSTRUCTIONS_PATH, "w", encoding="utf-8") as inf:
                json.dump(inst_db, inf, indent=2, ensure_ascii=False)

            return self._send_json(200, {
                "success": True,
                "message": f"Instruction '{inst_id}' deleted successfully.",
                "instructionsPendingCount": pending_count
            })

        # 4f. API: Verify Screenshot & Align with Card Metadata (Native Windows OCR)
        if path == "/api/curator/verify-screenshot":
            if not self._check_authenticated():
                return self._send_json(401, {"error": "Authentication required", "authenticated": False})

            event_id = payload.get("eventId", "")
            screenshot_base64 = payload.get("screenshotBase64") or payload.get("screenshot")
            screenshot_path = payload.get("screenshotPath")
            card_data = payload.get("event") or {}

            if not card_data and event_id:
                if os.path.exists(MANUAL_QUEUE_PATH):
                    try:
                        with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                            q_data = json.load(f)
                        card_data = next((q for q in q_data.get("quarantinedEvents", []) if q.get("id") == event_id), None)
                    except Exception:
                        pass
                if not card_data and os.path.exists(EVENTS_PATH):
                    try:
                        with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                            ev_data = json.load(f)
                        card_data = next((e for e in ev_data.get("events", []) if e.get("id") == event_id), None)
                    except Exception:
                        pass

            if not card_data:
                card_data = {
                    "id": event_id or "candidate",
                    "title": payload.get("eventTitle", ""),
                    "venue": payload.get("venueName", ""),
                    "price": float(payload.get("price", 0.0)),
                    "dateSchedule": payload.get("dateSchedule", "")
                }

            source_img = screenshot_path if (screenshot_path and os.path.exists(screenshot_path)) else screenshot_base64
            if not source_img:
                return self._send_json(400, {"error": "No screenshot provided. Please provide screenshotBase64 or screenshotPath."})

            try:
                result = verify_screenshot_against_event(source_img, card_data)
                return self._send_json(200, result)
            except Exception as e:
                return self._send_json(500, {"error": f"Screenshot verification failed: {e}"})

        # 5. API: Instruct AI Assistant (Plain English & Screenshot Queue)
        if path == "/api/curator/instruction":
            instruction_text = (payload.get("instructionText") or "").strip()
            if not instruction_text:
                return self._send_json(400, {"error": "Missing instructionText. Please provide plain-English instructions."})

            event_id = payload.get("eventId", "")
            action = payload.get("action", "queue_only")

            ts_base = int(time.time() * 1000)
            screenshot_rel_paths = save_screenshots_from_payload(payload, ts_base)
            primary_shot = screenshot_rel_paths[0] if screenshot_rel_paths else None

            inst_id = f"inst_{ts_base}"
            instruction_record = {
                "id": inst_id,
                "createdAt": datetime.now(timezone.utc).isoformat(),
                "status": "pending",
                "eventId": event_id,
                "eventTitle": payload.get("eventTitle", ""),
                "venueName": payload.get("venueName", ""),
                "sourceUrl": payload.get("sourceUrl", ""),
                "instructionText": instruction_text,
                "screenshotPath": primary_shot,
                "screenshotPaths": screenshot_rel_paths,
                "hasScreenshot": len(screenshot_rel_paths) > 0,
                "screenshotCount": len(screenshot_rel_paths),
                "actionTaken": action,
                "curatorNote": payload.get("curatorNote", ""),
                "targetScraperOrEngine": payload.get("venueName") or "UniversalVenueCrawler"
            }

            # Save to curator_instructions.json
            os.makedirs(DATA_DIR, exist_ok=True)
            instructions_db = {
                "metadata": {
                    "version": "1.0.0",
                    "updatedAt": datetime.now(timezone.utc).isoformat(),
                    "pendingCount": 0,
                    "description": "Queued plain-English instructions and screenshots for AI scraper enhancements."
                },
                "instructions": []
            }
            if os.path.exists(INSTRUCTIONS_PATH):
                try:
                    with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
                        instructions_db = json.load(f)
                except Exception:
                    pass

            instructions_db.setdefault("instructions", []).append(instruction_record)
            pending_count = len([i for i in instructions_db["instructions"] if i.get("status") == "pending"])
            instructions_db["metadata"]["pendingCount"] = pending_count
            instructions_db["metadata"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
            with open(INSTRUCTIONS_PATH, "w", encoding="utf-8") as f:
                json.dump(instructions_db, f, indent=2, ensure_ascii=False)

            approval_msg = ""
            distilled_rules = None
            is_venue_item = str(event_id).startswith("discovered-") or payload.get("itemType") == "venue" or bool(payload.get("venueName"))
            if is_venue_item and instruction_text:
                v_target_name = sanitize_text(str(payload.get("venueName") or payload.get("eventTitle") or "").replace("Venue: ", "").strip())
                if v_target_name:
                    distilled_rules = distill_venue_learned_rules(
                        venue_name=v_target_name,
                        calendar_url=payload.get("sourceUrl", ""),
                        instruction_text=instruction_text,
                        category=payload.get("approvedCategory") or payload.get("category") or "shows",
                        neighborhood=payload.get("neighborhood"),
                        website_url=payload.get("sourceUrl", "")
                    )
                    apply_distilled_venue_rules(distilled_rules, inst_id)

            if action == "queue_and_approve":
                # Check if this is a discovered candidate venue
                if str(event_id).startswith("discovered-") or payload.get("itemType") == "venue":
                    venue_name = sanitize_text(str(payload.get("venueName", "")).strip())
                    if venue_name:
                        if not distilled_rules:
                            distilled_rules = distill_venue_learned_rules(
                                venue_name=venue_name,
                                calendar_url=payload.get("sourceUrl", ""),
                                instruction_text=instruction_text,
                                category=payload.get("approvedCategory") or payload.get("category") or "shows",
                                neighborhood=payload.get("neighborhood"),
                                website_url=payload.get("sourceUrl", "")
                            )
                            apply_distilled_venue_rules(distilled_rules, inst_id)

                        create_venue_backup_snapshot()
                        clean_slug = re.sub(r"[^\w\s-]", "", venue_name.lower())
                        vid = re.sub(r"[-\s]+", "-", clean_slug).strip("-")
                        v_addr = sanitize_text(str(payload.get("address") or f"{venue_name}, Vancouver, BC").strip())
                        v_neigh = sanitize_text(str(payload.get("neighborhood") or "Downtown / West End").strip())
                        v_cat = sanitize_text(str(payload.get("approvedCategory") or payload.get("category") or "shows").strip())
                        v_url = sanitize_text(str((distilled_rules.get("calendarUrl") if distilled_rules else None) or payload.get("sourceUrl") or "").strip())
                        v_dir_data = {"metadata": {}, "venues": {}}
                        if os.path.exists(VENUE_DIR_PATH):
                            try:
                                with open(VENUE_DIR_PATH, "r", encoding="utf-8") as vf:
                                    v_dir_data = json.load(vf)
                            except Exception:
                                pass
                        v_map = v_dir_data.setdefault("venues", {})
                        new_v = {
                            "venueId": vid,
                            "name": venue_name,
                            "aliases": [venue_name],
                            "address": v_addr,
                            "neighborhood": v_neigh,
                            "coordinates": payload.get("coordinates") or [49.2827, -123.1207],
                            "transitInfo": sanitize_text(str(payload.get("transitInfo") or "Check TransLink for nearest transit route")),
                            "category": v_cat,
                            "venueUrl": v_url,
                            "calendarUrl": v_url,
                            "boxOfficeUrl": v_url,
                            "ticketingProvider": "Universal Ticketing",
                            "adapter": "UniversalVenueCrawler",
                            "doorCover": distilled_rules.get("doorPrice") if distilled_rules else None,
                            "priceRange": distilled_rules.get("priceRange") if distilled_rules else None,
                            "operatingDays": distilled_rules.get("scheduleDays") if distilled_rules else [],
                            "subTags": sorted(list(set(payload.get("subTags", []) + (distilled_rules.get("genres", []) if distilled_rules else [])))),
                            "curatorInstructions": instruction_text,
                            "curatorNote": instruction_text,
                            "curatorLearnedRules": distilled_rules,
                            "policySummary": distilled_rules.get("summary", "") if distilled_rules else "",
                            "managedEvents": []
                        }
                        v_map[venue_name] = new_v
                        v_dir_data.setdefault("metadata", {})["totalVenues"] = len(v_map)
                        v_dir_data["metadata"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
                        with open(VENUE_DIR_PATH, "w", encoding="utf-8") as vf:
                            json.dump(v_dir_data, vf, indent=2, ensure_ascii=False)

                        if os.path.exists(DISCOVERED_VENUES_PATH):
                            try:
                                with open(DISCOVERED_VENUES_PATH, "r", encoding="utf-8") as df:
                                    disc_data = json.load(df)
                                for item in disc_data.get("discoveredVenues", []):
                                    if item.get("id") == event_id or item.get("name", "").lower() == venue_name.lower():
                                        item["status"] = "approved"
                                        item["approvedAt"] = datetime.now(timezone.utc).isoformat()
                                        item["curatorLearnedRules"] = distilled_rules
                                with open(DISCOVERED_VENUES_PATH, "w", encoding="utf-8") as df:
                                    json.dump(disc_data, df, indent=2, ensure_ascii=False)
                            except Exception:
                                pass
                        sync_js_data_file()
                        approval_msg = f" Venue '{venue_name}' approved and enrolled into Universal Venue Crawler."
                else:
                    event_to_approve = None
                    if os.path.exists(MANUAL_QUEUE_PATH):
                        with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                            q_data = json.load(f)
                        q_list = q_data.get("quarantinedEvents", [])
                        event_to_approve = next((q for q in q_list if q.get("id") == event_id), None)
                    if not event_to_approve and payload.get("event"):
                        event_to_approve = payload.get("event")

                    if event_to_approve:
                        # Auto-extract from screenshot if user did not type price explicitly
                        user_supplied_price = payload.get("approvedPrice")
                        fee_breakdown_override = None
                        if user_supplied_price is None and primary_shot and os.path.exists(primary_shot):
                            try:
                                ocr_res = verify_screenshot_against_event(primary_shot, event_to_approve)
                                extracted_ocr = ocr_res.get("extracted", {})
                                if extracted_ocr.get("total_price") is not None:
                                    price = float(extracted_ocr["total_price"])
                                    fee_breakdown_override = extracted_ocr.get("fee_breakdown")
                                    print(f"[CURATOR AUTO-OCR] Auto-applied verified screenshot price ${price:.2f} to '{event_id}'")
                                else:
                                    price = float(event_to_approve.get("price", 0.0))
                            except Exception as e:
                                print(f"[CURATOR AUTO-OCR WARN] {e}")
                                price = float(event_to_approve.get("price", 0.0))
                        else:
                            price = float(user_supplied_price if user_supplied_price is not None else event_to_approve.get("price", 0.0))

                        if price > 50.0:
                            return self._send_json(400, {"error": f"Approved price ${price:.2f} CAD exceeds $50.00 CAD budget limit."})

                        category = payload.get("approvedCategory") or event_to_approve.get("category", "shows")
                        raw_price_label = payload.get("priceLabel") or ""
                        if not raw_price_label or raw_price_label == "$0.00 door" or (price == 0 and "$0.00" in raw_price_label):
                            price_label = "Free ($0)" if price == 0 else f"${price:.2f} CAD"
                        else:
                            price_label = raw_price_label

                        create_backup_snapshot()

                        note = payload.get("curatorNote", "") or event_to_approve.get("curatorNote", "")
                        source_url = payload.get("sourceUrl", "") or event_to_approve.get("sourceUrl", "") or event_to_approve.get("ticketUrl", "")

                        event_to_approve["price"] = price
                        event_to_approve["category"] = category
                        event_to_approve["curatorNote"] = note

                        if payload.get("approvedDate"):
                            event_to_approve["dateSchedule"] = sanitize_text(str(payload.get("approvedDate")))
                        if payload.get("approvedVenue"):
                            event_to_approve["venue"] = sanitize_text(str(payload.get("approvedVenue")))
                        if payload.get("approvedTitle"):
                            event_to_approve["title"] = sanitize_text(str(payload.get("approvedTitle")))

                        event_to_approve["checkoutVerification"] = {
                            "status": "verified_live",
                            "method": "curator_screenshot_verification" if fee_breakdown_override else "manual_curator_review",
                            "verifiedTotal": price,
                            "feeBreakdown": fee_breakdown_override or f"${price:.2f} CAD verified via Curator Studio review with AI instruction",
                            "verifiedAt": datetime.now(timezone.utc).isoformat(),
                            "details": f"Approved by curator with AI instruction. Note: {note}",
                            "curatorSnapshot": {
                                "approvedTitle": event_to_approve.get("title"),
                                "approvedPrice": price,
                                "approvedPriceLabel": price_label,
                                "approvedCategory": category,
                                "approvedDate": event_to_approve.get("dateSchedule"),
                                "approvedVenue": event_to_approve.get("venue"),
                                "curatorNote": note,
                                "approvedAt": datetime.now(timezone.utc).isoformat(),
                                "sourceUrl": source_url
                            }
                        }
                        event_to_approve["isSoldOut"] = bool(event_to_approve.get("isSoldOut", False))
                        event_to_approve = ensure_event_catalog_fields(event_to_approve)

                        # 1. Add/update in events.json
                        with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                            db = json.load(f)
                        events_list = [e for e in db.get("events", []) if e.get("id") != event_id]
                        events_list.append(event_to_approve)
                        db["events"] = events_list
                        db.setdefault("metadata", {})["totalEvents"] = len(events_list)
                        db.setdefault("metadata", {})["updatedAt"] = datetime.now(timezone.utc).isoformat()
                        with open(EVENTS_PATH, "w", encoding="utf-8") as f:
                            json.dump(db, f, indent=2, ensure_ascii=False)

                        # 2. Remove from manual_review_queue.json
                        if os.path.exists(MANUAL_QUEUE_PATH):
                            with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                                q_data = json.load(f)
                            q_list = [q for q in q_data.get("quarantinedEvents", []) if q.get("id") != event_id]
                            q_data["quarantinedEvents"] = q_list
                            q_data.setdefault("metadata", {})["pendingCount"] = len(q_list)
                            with open(MANUAL_QUEUE_PATH, "w", encoding="utf-8") as f:
                                json.dump(q_data, f, indent=2, ensure_ascii=False)

                        sync_js_data_file()
                        approval_msg = f" Event '{event_to_approve.get('title')}' approved and promoted to catalog."

            elif action in ("queue_and_dismiss", "queue_and_reject"):
                if str(event_id).startswith("discovered-") or payload.get("itemType") == "venue":
                    venue_name = sanitize_text(str(payload.get("venueName", "")).strip())
                    if os.path.exists(DISCOVERED_VENUES_PATH):
                        try:
                            with open(DISCOVERED_VENUES_PATH, "r", encoding="utf-8") as df:
                                disc_data = json.load(df)
                            for item in disc_data.get("discoveredVenues", []):
                                if item.get("id") == event_id or (venue_name and item.get("name", "").lower() == venue_name.lower()):
                                    item["status"] = "dismissed"
                                    item["dismissedAt"] = datetime.now(timezone.utc).isoformat()
                            with open(DISCOVERED_VENUES_PATH, "w", encoding="utf-8") as df:
                                json.dump(disc_data, df, indent=2, ensure_ascii=False)
                        except Exception:
                            pass
                    approval_msg = f" Candidate venue '{venue_name or event_id}' dismissed."
                else:
                    event_to_dismiss = None
                    if os.path.exists(MANUAL_QUEUE_PATH):
                        with open(MANUAL_QUEUE_PATH, "r", encoding="utf-8") as f:
                            q_data = json.load(f)
                        q_list = q_data.get("quarantinedEvents", [])
                        event_to_dismiss = next((q for q in q_list if q.get("id") == event_id), None)
                        new_q = [q for q in q_list if q.get("id") != event_id]
                        q_data["quarantinedEvents"] = new_q
                        q_data["metadata"]["pendingCount"] = len(new_q)
                        with open(MANUAL_QUEUE_PATH, "w", encoding="utf-8") as f:
                            json.dump(q_data, f, indent=2, ensure_ascii=False)

                    if event_to_dismiss:
                        create_backup_snapshot()
                        archive_db = {"metadata": {}, "archivedEvents": []}
                        if os.path.exists(ARCHIVE_PATH):
                            try:
                                with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
                                    archive_db = json.load(f)
                            except Exception:
                                pass
                        archived_item = {
                            **event_to_dismiss,
                            "archivedAt": datetime.now(timezone.utc).isoformat(),
                            "reviewStatus": "dismissed_by_curator",
                            "archivedReason": f"Dismissed with AI instruction: {instruction_text[:120]}",
                            "curatorInstructionId": inst_id
                        }
                        archive_db.setdefault("archivedEvents", []).append(archived_item)
                        archive_db["metadata"]["totalArchived"] = len(archive_db["archivedEvents"])
                        archive_db["metadata"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
                        with open(ARCHIVE_PATH, "w", encoding="utf-8") as f:
                            json.dump(archive_db, f, indent=2, ensure_ascii=False)

                    if os.path.exists(EVENTS_PATH):
                        with open(EVENTS_PATH, "r", encoding="utf-8") as f:
                            db = json.load(f)
                        db_events = [e for e in db.get("events", []) if e.get("id") != event_id]
                        if len(db_events) != len(db.get("events", [])):
                            db["events"] = db_events
                            db["metadata"]["totalEvents"] = len(db_events)
                            with open(EVENTS_PATH, "w", encoding="utf-8") as f:
                                json.dump(db, f, indent=2, ensure_ascii=False)

                    sync_js_data_file()
                    approval_msg = f" Event '{event_to_dismiss.get('title')}' dismissed and moved to archive."

            return self._send_json(200, {
                "success": True,
                "message": f"Instruction queued successfully for AI Assistant.{approval_msg}",
                "instructionId": inst_id,
                "action": action,
                "screenshotPath": primary_shot,
                "screenshotPaths": screenshot_rel_paths,
                "pendingInstructions": pending_count,
                "distilledRules": distilled_rules,
                "aiLearnedSummary": distilled_rules.get("summary", "") if distilled_rules else None
            })

        # 6. API: Safe rollback
        if path == "/api/curator/rollback":
            backups = sorted([os.path.join(BACKUP_DIR, f) for f in os.listdir(BACKUP_DIR) if f.startswith("events_")])
            if not backups:
                return self._send_json(404, {"error": "No backup snapshots available for rollback."})
            latest = backups[-1]
            shutil.copy2(latest, EVENTS_PATH)
            sync_js_data_file()
            return self._send_json(200, {
                "success": True,
                "message": f"Successfully rolled back catalog to snapshot: {os.path.basename(latest)}"
            })

        # 6b. API: Fetch & Ingest Newsletters from Gmail or dropped files
        if path == "/api/curator/sync_newsletters":
            if not self._check_authenticated():
                return self._send_json(403, {"error": "Forbidden: Valid Curator-Token required to fetch newsletters"})
            try:
                try:
                    from newsletter_ingestor import run_newsletter_ingestion, process_inbound_folder
                except ImportError:
                    from scripts.newsletter_ingestor import run_newsletter_ingestion, process_inbound_folder
                folder_res = process_inbound_folder()
                gmail_res = run_newsletter_ingestion(unread_only=True, limit=20, dry_run=False)

                total_queued = folder_res.get("queued", 0) + gmail_res.get("queued", 0)
                msg_parts = []
                if folder_res.get("files_processed", 0) > 0:
                    msg_parts.append(f"Processed {folder_res['files_processed']} local files ({folder_res.get('queued', 0)} queued)")
                if gmail_res.get("success"):
                    msg_parts.append(f"Checked Gmail ({gmail_res.get('queued', 0)} queued from {gmail_res.get('emailsChecked', 0)} emails)")
                elif gmail_res.get("requiresSetup"):
                    msg_parts.append("Gmail credentials not yet configured in .env")
                elif gmail_res.get("error"):
                    msg_parts.append(f"Gmail sync warning: {gmail_res['error']}")

                sync_js_data_file()
                return self._send_json(200, {
                    "success": True,
                    "totalQueued": total_queued,
                    "folderResult": folder_res,
                    "gmailResult": gmail_res,
                    "message": " • ".join(msg_parts) if msg_parts else "Newsletter ingestion complete."
                })
            except Exception as e:
                return self._send_json(500, {"success": False, "error": str(e), "message": f"Newsletter sync failed: {e}"})

        # 7. API: Trigger full automation pipeline
        if path == "/api/automation/trigger":
            if not self._check_authenticated():
                return self._send_json(403, {"error": "Forbidden: Valid Curator-Token required to trigger daily automation"})

            cur_status = get_automation_status()
            if cur_status.get("status") == "running":
                return self._send_json(409, {
                    "error": "Daily discovery pipeline is already actively running.",
                    "status": cur_status
                })

            def _async_pipeline_worker():
                try:
                    run_full_daily_pipeline()
                    sync_js_data_file()
                except Exception as ex:
                    print(f"[AUTOMATION TRIGGER ERROR] {ex}")

            t = threading.Thread(target=_async_pipeline_worker, daemon=True)
            t.start()

            return self._send_json(200, {
                "success": True,
                "message": "Autonomous daily discovery pipeline triggered in background.",
                "timestamp": datetime.now().isoformat()
            })

        # 8. API: Toggle automation active state
        if path == "/api/automation/toggle":
            if not self._check_authenticated():
                return self._send_json(403, {"error": "Forbidden: Valid Curator-Token required to toggle automation"})

            cur_status = get_automation_status()
            new_state = not cur_status.get("automationEnabled", True)
            update_automation_status({"automationEnabled": new_state})
            return self._send_json(200, {
                "success": True,
                "automationEnabled": new_state,
                "message": f"Daily automation scheduler {'enabled' if new_state else 'paused'}."
            })

        # 8b. API: Restart system & clear server caches, reset automation locks, and resync catalog
        if path == "/api/curator/system/restart-and-clear":
            if not self._check_authenticated():
                return self._send_json(403, {"error": "Forbidden: Valid Curator-Token required to restart system and clear caches"})

            # 1. Reset automation status
            try:
                update_automation_status({
                    "status": "idle",
                    "currentStep": None,
                    "error": None
                })
            except Exception as e:
                print(f"[RESTART WARN] Could not reset automation status: {e}")

            # 2. Resync js/data.js and re-verify catalog
            try:
                sync_js_data_file()
            except Exception as e:
                print(f"[RESTART WARN] Could not resync js/data.js: {e}")

            # 3. Clean temporary scrapers/locks in scratch or logs if needed
            cleaned_items = 0
            if os.path.exists(LOGS_DIR):
                for f in os.listdir(LOGS_DIR):
                    if f.endswith(".lock") or f.endswith(".tmp"):
                        try:
                            os.remove(os.path.join(LOGS_DIR, f))
                            cleaned_items += 1
                        except Exception:
                            pass

            return self._send_json(200, {
                "success": True,
                "message": "Server state reset: automation unlocked, catalog re-synchronized, and temporary locks cleared.",
                "cleanedItems": cleaned_items,
                "timestamp": datetime.now().isoformat()
            })

        # 9. API: Add discovered venue to permanent directory & regular crawler (or instruct AI / dismiss)
        if path == "/api/curator/venues/add":
            name = sanitize_text(str(payload.get("name", "")).strip())
            if not name:
                return self._send_json(400, {"error": "Venue name is required."})

            action = payload.get("action", "queue_and_approve")
            address = sanitize_text(str(payload.get("address") or f"{name}, Vancouver, BC").strip())
            neighborhood = sanitize_text(str(payload.get("neighborhood") or "Downtown / West End").strip())
            calendar_url = sanitize_text(str(payload.get("calendarUrl") or payload.get("websiteUrl") or "").strip())
            venue_url = sanitize_text(str(payload.get("venueUrl") or calendar_url).strip())
            category = sanitize_text(str(payload.get("category") or "shows").strip())
            ticketing_provider = sanitize_text(str(payload.get("ticketingProvider") or "Universal Ticketing").strip())
            adapter = sanitize_text(str(payload.get("adapter") or "UniversalVenueCrawler").strip())
            discovered_id = payload.get("discoveredId")
            instruction_text = (payload.get("instructionText") or "").strip()

            distilled_rules = distill_venue_learned_rules(
                venue_name=name,
                calendar_url=calendar_url,
                instruction_text=instruction_text,
                category=category,
                neighborhood=neighborhood,
                website_url=venue_url
            )
            if distilled_rules.get("calendarUrl") and not calendar_url:
                calendar_url = distilled_rules["calendarUrl"]
                venue_url = calendar_url

            clean_slug = re.sub(r"[^\w\s-]", "", name.lower())
            venue_id = re.sub(r"[-\s]+", "-", clean_slug).strip("-")

            ts_base = int(time.time() * 1000)
            screenshot_rel_paths = save_screenshots_from_payload(payload, ts_base)
            primary_shot = screenshot_rel_paths[0] if screenshot_rel_paths else None

            inst_id = None
            if instruction_text or screenshot_rel_paths:
                inst_id = f"inst_{ts_base}"
                instruction_record = {
                    "id": inst_id,
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                    "status": "pending",
                    "eventId": discovered_id or venue_id,
                    "eventTitle": f"Venue: {name}",
                    "venueName": name,
                    "sourceUrl": calendar_url,
                    "instructionText": instruction_text or f"Curator triaged venue '{name}' with {adapter}.",
                    "screenshotPath": primary_shot,
                    "screenshotPaths": screenshot_rel_paths,
                    "hasScreenshot": len(screenshot_rel_paths) > 0,
                    "screenshotCount": len(screenshot_rel_paths),
                    "actionTaken": action,
                    "curatorNote": payload.get("curatorNote", ""),
                    "targetScraperOrEngine": adapter or "UniversalVenueCrawler",
                    "aiLearned": True,
                    "distilledRules": distilled_rules,
                    "aiLearnedSummary": distilled_rules.get("summary", "")
                }
                # Save to curator_instructions.json
                os.makedirs(DATA_DIR, exist_ok=True)
                instructions_db = {
                    "metadata": {
                        "version": "1.0.0",
                        "updatedAt": datetime.now(timezone.utc).isoformat(),
                        "pendingCount": 0,
                        "description": "Queued plain-English instructions and screenshots for AI scraper enhancements."
                    },
                    "instructions": []
                }
                if os.path.exists(INSTRUCTIONS_PATH):
                    try:
                        with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
                            instructions_db = json.load(f)
                    except Exception:
                        pass
                instructions_db.setdefault("instructions", []).append(instruction_record)
                pending_count = len([i for i in instructions_db["instructions"] if i.get("status") == "pending"])
                instructions_db["metadata"]["pendingCount"] = pending_count
                instructions_db["metadata"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
                with open(INSTRUCTIONS_PATH, "w", encoding="utf-8") as f:
                    json.dump(instructions_db, f, indent=2, ensure_ascii=False)

            # Handle action branches:
            if action in ("queue_and_dismiss", "dismiss"):
                if os.path.exists(DISCOVERED_VENUES_PATH):
                    try:
                        with open(DISCOVERED_VENUES_PATH, "r", encoding="utf-8") as df:
                            disc_data = json.load(df)
                        for item in disc_data.get("discoveredVenues", []):
                            if (discovered_id and item.get("id") == discovered_id) or item.get("name", "").lower() == name.lower():
                                item["status"] = "dismissed"
                                item["dismissedAt"] = datetime.now(timezone.utc).isoformat()
                                if instruction_text:
                                    item["curatorNote"] = instruction_text
                        with open(DISCOVERED_VENUES_PATH, "w", encoding="utf-8") as df:
                            json.dump(disc_data, df, indent=2, ensure_ascii=False)
                    except Exception as e:
                        print(f"[WARN] Failed updating discovered venues status: {e}")

                return self._send_json(200, {
                    "success": True,
                    "action": action,
                    "message": f"Candidate venue '{name}' dismissed and feedback recorded for AI.",
                    "instructionId": inst_id,
                    "screenshotPaths": screenshot_rel_paths,
                    "distilledRules": distilled_rules,
                    "aiLearnedSummary": distilled_rules.get("summary", "")
                })

            if action == "queue_only":
                if instruction_text:
                    apply_distilled_venue_rules(distilled_rules, inst_id)

                if os.path.exists(DISCOVERED_VENUES_PATH):
                    try:
                        with open(DISCOVERED_VENUES_PATH, "r", encoding="utf-8") as df:
                            disc_data = json.load(df)
                        for item in disc_data.get("discoveredVenues", []):
                            if (discovered_id and item.get("id") == discovered_id) or item.get("name", "").lower() == name.lower():
                                if instruction_text:
                                    item["curatorNote"] = instruction_text
                                item["hasInstruction"] = True
                                item["curatorLearnedRules"] = distilled_rules
                        with open(DISCOVERED_VENUES_PATH, "w", encoding="utf-8") as df:
                            json.dump(disc_data, df, indent=2, ensure_ascii=False)
                    except Exception as e:
                        print(f"[WARN] Failed updating discovered venues status: {e}")

                return self._send_json(200, {
                    "success": True,
                    "action": action,
                    "message": f"AI scraper instructions, proof, and learned rules saved for venue '{name}'.",
                    "instructionId": inst_id,
                    "screenshotPaths": screenshot_rel_paths,
                    "distilledRules": distilled_rules,
                    "aiLearnedSummary": distilled_rules.get("summary", "")
                })

            # Default: action == "queue_and_approve"
            create_venue_backup_snapshot()
            apply_distilled_venue_rules(distilled_rules, inst_id)

            venue_dir_data = {"metadata": {}, "venues": {}}
            if os.path.exists(VENUE_DIR_PATH):
                try:
                    with open(VENUE_DIR_PATH, "r", encoding="utf-8") as f:
                        venue_dir_data = json.load(f)
                except Exception as e:
                    return self._send_json(500, {"error": f"Failed reading venue directory: {e}"})

            venues_map = venue_dir_data.setdefault("venues", {})

            new_venue = {
                "venueId": venue_id,
                "name": name,
                "aliases": [name],
                "address": address,
                "neighborhood": neighborhood,
                "coordinates": payload.get("coordinates") or [49.2827, -123.1207],
                "transitInfo": sanitize_text(str(payload.get("transitInfo") or "Check TransLink for nearest transit route")),
                "category": category,
                "venueUrl": venue_url,
                "calendarUrl": calendar_url,
                "boxOfficeUrl": calendar_url,
                "ticketingProvider": ticketing_provider,
                "adapter": adapter,
                "doorCover": distilled_rules.get("doorPrice"),
                "priceRange": distilled_rules.get("priceRange"),
                "operatingDays": distilled_rules.get("scheduleDays"),
                "subTags": sorted(list(set(payload.get("subTags", []) + distilled_rules.get("genres", [])))),
                "curatorInstructions": instruction_text,
                "curatorNote": instruction_text,
                "curatorLearnedRules": distilled_rules,
                "policySummary": distilled_rules.get("summary", ""),
                "managedEvents": []
            }

            venues_map[name] = new_venue
            venue_dir_data.setdefault("metadata", {})["totalVenues"] = len(venues_map)
            venue_dir_data["metadata"]["updatedAt"] = datetime.now(timezone.utc).isoformat()

            try:
                with open(VENUE_DIR_PATH, "w", encoding="utf-8") as f:
                    json.dump(venue_dir_data, f, indent=2, ensure_ascii=False)
            except Exception as e:
                return self._send_json(500, {"error": f"Failed saving venue directory: {e}"})

            # Mark in discovered_venues.json as approved if exists
            if os.path.exists(DISCOVERED_VENUES_PATH):
                try:
                    with open(DISCOVERED_VENUES_PATH, "r", encoding="utf-8") as df:
                        disc_data = json.load(df)
                    for item in disc_data.get("discoveredVenues", []):
                        if (discovered_id and item.get("id") == discovered_id) or item.get("name", "").lower() == name.lower():
                            item["status"] = "approved"
                            item["approvedAt"] = datetime.now(timezone.utc).isoformat()
                            if instruction_text:
                                item["curatorNote"] = instruction_text
                            item["curatorLearnedRules"] = distilled_rules
                    with open(DISCOVERED_VENUES_PATH, "w", encoding="utf-8") as df:
                        json.dump(disc_data, df, indent=2, ensure_ascii=False)
                except Exception as e:
                    print(f"[WARN] Failed updating discovered venues status: {e}")

            sync_js_data_file()

            return self._send_json(200, {
                "success": True,
                "action": action,
                "message": f"Venue '{name}' successfully added to permanent directory and registered with {adapter}.",
                "venue": new_venue,
                "totalVenues": len(venues_map),
                "instructionId": inst_id,
                "screenshotPaths": screenshot_rel_paths,
                "distilledRules": distilled_rules,
                "aiLearnedSummary": distilled_rules.get("summary", "")
            })

        # 10. API: Dismiss discovered venue
        if path == "/api/curator/discovered_venues/dismiss":
            disc_id = payload.get("id")
            if not disc_id:
                return self._send_json(400, {"error": "Missing discovered venue id"})

            if os.path.exists(DISCOVERED_VENUES_PATH):
                try:
                    with open(DISCOVERED_VENUES_PATH, "r", encoding="utf-8") as df:
                        disc_data = json.load(df)
                    found = False
                    for item in disc_data.get("discoveredVenues", []):
                        if item.get("id") == disc_id:
                            item["status"] = "dismissed"
                            item["dismissedAt"] = datetime.now(timezone.utc).isoformat()
                            found = True
                    if found:
                        with open(DISCOVERED_VENUES_PATH, "w", encoding="utf-8") as df:
                            json.dump(disc_data, df, indent=2, ensure_ascii=False)
                        return self._send_json(200, {"success": True, "message": "Discovered venue candidate dismissed."})
                    else:
                        return self._send_json(404, {"error": "Candidate not found."})
                except Exception as e:
                    return self._send_json(500, {"error": f"Failed dismissing discovered venue: {e}"})
            return self._send_json(404, {"error": "Discovered venues registry not found"})

        return self._send_json(404, {"error": "Endpoint not found"})


def _curator_daemon_scheduler_loop(target_time_str: str = "04:00"):
    """Background scheduler thread running inside curator_server."""
    while True:
        try:
            status = get_automation_status()
            if status.get("automationEnabled", True):
                now = datetime.now()
                current_time_hm = now.strftime("%H:%M")
                last_run_iso = status.get("lastRunAt")
                already_ran_today = False
                if last_run_iso:
                    try:
                        last_dt = datetime.fromisoformat(last_run_iso)
                        if last_dt.date() == now.date() and (now - last_dt).total_seconds() < 3600:
                            already_ran_today = True
                    except Exception:
                        pass

                if current_time_hm == target_time_str and not already_ran_today and status.get("status") != "running":
                    print(f"[CURATOR SCHEDULER] Triggering scheduled daily discovery at {current_time_hm}...")
                    run_full_daily_pipeline(run_at_time=target_time_str)
                    sync_js_data_file()
        except Exception as e:
            print(f"[CURATOR SCHEDULER ERROR] {e}")
        time.sleep(30)


def run_server(port=PORT):
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    scheduler_thread = threading.Thread(target=_curator_daemon_scheduler_loop, daemon=True)
    scheduler_thread.start()
    with socketserver.ThreadingTCPServer(("127.0.0.1", port), CuratorRequestHandler) as httpd:
        print(f"[CURATOR SERVER] Listening on http://127.0.0.1:{port}/")
        print(f"[CURATOR SERVER] Curator Studio: http://127.0.0.1:{port}/curator.html")
        print(f"[CURATOR SERVER] Daily Automation Scheduler active (Target: 04:00 AM)")
        httpd.serve_forever()


if __name__ == "__main__":
    p = int(sys.argv[1]) if len(sys.argv) > 1 else PORT
    run_server(p)
