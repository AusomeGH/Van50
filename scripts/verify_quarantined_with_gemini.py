#!/usr/bin/env python3
"""
Van50 Quarantined Events Re-Verification Engine (Gemini AI Powered)
Runs Google Search Grounding via gemini-3.8-flash on each quarantined item to:
- Verify current real-world status (active, seasonal conclusion, or schedule changes)
- Find verified upcoming dates and true all-in checkout pricing (<= $50 CAD)
- Promote verified events to events.json or archive seasonal/expired events to events_archive.json.
"""

import os
import sys
import json
import time
import urllib.request
import urllib.error
import re
from datetime import datetime

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
ARCHIVE_PATH = os.path.join(DATA_DIR, "events_archive.json")

sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from gemini_event_scout import get_gemini_api_key, call_gemini_with_search
from curator_server import sync_js_data_file


def call_gemini_direct_json(prompt: str, api_key: str, model: str = "gemini-3.8-flash") -> Optional[Dict[str, Any]]:
    """Calls Gemini REST API directly with responseMimeType: application/json."""
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


def verify_quarantined_items():
    api_key = get_gemini_api_key()
    if not api_key:
        print("[ERROR] GEMINI_API_KEY is not set.")
        sys.exit(1)

    if not os.path.exists(QUEUE_PATH):
        print("[INFO] No manual_review_queue.json found.")
        return

    with open(QUEUE_PATH, "r", encoding="utf-8") as f:
        queue_data = json.load(f)

    quarantined = queue_data.get("quarantinedEvents", [])
    if not quarantined:
        print("[INFO] No quarantined events found in queue.")
        return

    print(f"=== VERIFYING {len(quarantined)} QUARANTINED ITEMS WITH GEMINI AI ===")

    events_active = []
    if os.path.exists(EVENTS_PATH):
        with open(EVENTS_PATH, "r", encoding="utf-8") as f:
            events_active = json.load(f)

    events_archive = []
    if os.path.exists(ARCHIVE_PATH):
        with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
            events_archive = json.load(f)

    remaining_quarantine = []
    decisions = []

    today_str = datetime.now().strftime("%Y-%m-%d")

    for idx, item in enumerate(quarantined, 1):
        item_id = item.get("id")
        title = item.get("title")
        venue = item.get("venue")
        url = item.get("websiteUrl") or item.get("venueUrl") or ""

        print(f"\n[{idx}/{len(quarantined)}] Verifying: '{title}' at {venue}...")

        search_prompt = (
            f"Search Google for current live event details in Vancouver BC for: "
            f"'{title}' at venue '{venue}' (URL: {url}). "
            f"Determine:\n"
            f"1. Is this event currently running/upcoming, or is it a seasonal summer event that has concluded?\n"
            f"2. What are the specific verified upcoming dates and start times?\n"
            f"3. What is the exact ticket price or door cover in CAD, including any fees?\n"
            f"4. What is the official live link?\n"
            f"Give a factual summary."
        )

        search_result = call_gemini_with_search(search_prompt, api_key)
        if not search_result:
            print(f"  [WARN] No search response for {item_id}; keeping in quarantine.")
            remaining_quarantine.append(item)
            continue

        analysis_prompt = f"""
You are the Van50 Curation Judge. Today's date is {today_str}.
Analyze this live research about Vancouver event '{title}' at '{venue}':

RESEARCH:
{search_result}

DECISION RULES:
- If the event has ended for the season (e.g. Kitsilano Showboat is a summer-only series that ended in August/September), decide "ARCHIVE".
- If the event is actively running with verified pricing <= $50.00 CAD all-in and upcoming dates, decide "RESTORE".
- If the event is permanently discontinued or exceeds $50.00 CAD, decide "ARCHIVE".
- Otherwise decide "KEEP_IN_REVIEW".

Return a strict JSON object with:
{{
  "decision": "RESTORE | ARCHIVE | KEEP_IN_REVIEW",
  "reason": "Detailed 2-3 sentence explanation of the real-world finding and why this decision was made.",
  "verified_price": 0.0,
  "verified_price_label": "$0.00 CAD",
  "verified_date": "YYYY-MM-DD or null",
  "verified_start_time": "HH:MM or null",
  "verified_url": "URL"
}}
"""
        decision_data = call_gemini_direct_json(analysis_prompt, api_key)
        if not decision_data:
            print(f"  [WARN] Structuring failed for {item_id}; keeping in quarantine.")
            remaining_quarantine.append(item)
            continue

        dec = decision_data.get("decision", "KEEP_IN_REVIEW")
        reason = decision_data.get("reason", "No reason provided")
        price = float(decision_data.get("verified_price", 0.0) or 0.0)

        print(f"  [DECISION] -> {dec}: {reason}")

        decisions.append({
            "id": item_id,
            "title": title,
            "venue": venue,
            "decision": dec,
            "reason": reason,
            "price": price,
            "verified_date": decision_data.get("verified_date")
        })

        if dec == "RESTORE":
            # Reconstruct clean active event entry
            show1_date = decision_data.get("verified_date") or item.get("startIso", "")[:10]
            show1_time = decision_data.get("verified_start_time") or "19:00"
            restored_entry = {
                "event_id": item_id,
                "event_name": title,
                "category": item.get("category", "General"),
                "venue_name": venue,
                "full_address": item.get("address", "Vancouver, BC"),
                "neighborhood": item.get("neighborhood", "Vancouver"),
                "description": item.get("description", ""),
                "pricing_all_in_cad": {
                    "regular": price,
                    "senior": None,
                    "student": None,
                    "member": None
                },
                "show_1": {
                    "date": show1_date,
                    "start_time": show1_time,
                    "end_time": None,
                    "cost": price
                },
                "show_2": None,
                "show_3": None,
                "discovery_url": decision_data.get("verified_url") or item.get("websiteUrl") or "",
                "details_url": decision_data.get("verified_url") or item.get("websiteUrl") or "",
                "ticket_url": decision_data.get("verified_url") or item.get("websiteUrl") or "",
                "ticket_provider": item.get("ticketProvider", "Direct"),
                "tags": item.get("subTags", []),
                "festival_affiliation": "None",
                "approval_status": "Auto-Approved",
                "curator_notes": f"AI-Verified: {reason}"
            }
            # Remove if already exists to avoid dupes
            events_active = [e for e in events_active if (e.get("event_id") or e.get("id")) != item_id]
            events_active.append(restored_entry)
            print(f"  ✓ Restored to events.json")

        elif dec == "ARCHIVE":
            archived_entry = {
                "event_id": item_id,
                "event_name": title,
                "category": item.get("category", "General"),
                "venue_name": venue,
                "full_address": item.get("address", "Vancouver, BC"),
                "neighborhood": item.get("neighborhood", "Vancouver"),
                "description": item.get("description", ""),
                "attempted_price_cad": price or item.get("price", 0.0),
                "discovery_url": item.get("websiteUrl", ""),
                "archive_reason": f"AI Verified: {reason}",
                "archived_at": today_str
            }
            events_archive = [e for e in events_archive if (e.get("event_id") or e.get("id")) != item_id]
            events_archive.append(archived_entry)
            print(f"  ✓ Moved to events_archive.json")

        else:
            remaining_quarantine.append(item)

        time.sleep(2)

    # Save mutated catalogs
    with open(EVENTS_PATH, "w", encoding="utf-8") as f:
        json.dump(events_active, f, indent=2, ensure_ascii=False)

    with open(ARCHIVE_PATH, "w", encoding="utf-8") as f:
        json.dump(events_archive, f, indent=2, ensure_ascii=False)

    queue_data["quarantinedEvents"] = remaining_quarantine
    queue_data["pendingCount"] = len(remaining_quarantine)
    queue_data["metadata"]["pendingCount"] = len(remaining_quarantine)
    queue_data["metadata"]["updatedAt"] = today_str
    queue_data["lastTriagedAt"] = datetime.now().isoformat()

    with open(QUEUE_PATH, "w", encoding="utf-8") as f:
        json.dump(queue_data, f, indent=2, ensure_ascii=False)

    sync_js_data_file()

    print("\n=== AI VERIFICATION COMPLETE ===")
    print(f"• Active Events in events.json: {len(events_active)}")
    print(f"• Archived Events in events_archive.json: {len(events_archive)}")
    print(f"• Remaining in Quarantine: {len(remaining_quarantine)}")

    # Write audit log artifact
    summary_path = os.path.join(DATA_DIR, "ai_quarantine_resolutions.json")
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(decisions, f, indent=2, ensure_ascii=False)
    print(f"• Detailed decisions logged to {summary_path}")


if __name__ == "__main__":
    verify_quarantined_items()
