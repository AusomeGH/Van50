#!/usr/bin/env python3
"""
apply_qc_pass_20261004_run3.py

Antigravity AI QC Audit Pass 3 - October 4, 2026
Normalizes D7 Category Taxonomy across all 78 active cards in data/events.json:
- Maps 15 concert/gig cards from shorthand 'Music' to canonical 'Live Music'
- Maps '00s vs 10s Dance Party' from 'Music' to canonical 'Nightlife & Social'
- Maps 'Small File Media Festival' from 'Social & Arts' to canonical 'Arts & Culture'
- Populates categoryLabel on all cards where it is None to match category
- Synchronizes js/data.js
"""

import os
import json
import sys

WORKSPACE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENTS_PATH = os.path.join(WORKSPACE, "data", "events.json")

def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write("\n")

def run_pass():
    events = load_json(EVENTS_PATH)
    print(f"Total cards before pass: {len(events)}")

    calibrated_count = 0
    for e in events:
        eid = e.get("event_id")
        cat = e.get("category")

        # Specific dance party
        if eid == "van50-90s-00s-dance-party-fox-20261009":
            e["category"] = "Nightlife & Social"
            e["categoryLabel"] = "Nightlife & Social"
            calibrated_count += 1
            print(f"Calibrated {eid} to Nightlife & Social")
        # Film festival
        elif eid == "van50-scout-cinematheque-small-file-20261017":
            e["category"] = "Arts & Culture"
            e["categoryLabel"] = "Arts & Culture"
            calibrated_count += 1
            print(f"Calibrated {eid} to Arts & Culture")
        # General Music -> Live Music
        elif cat == "Music":
            e["category"] = "Live Music"
            e["categoryLabel"] = "Live Music"
            calibrated_count += 1
            print(f"Calibrated {eid} to Live Music")

        # Ensure categoryLabel is always set
        if not e.get("categoryLabel"):
            e["categoryLabel"] = e.get("category")

    save_json(EVENTS_PATH, events)
    print(f"Calibrated {calibrated_count} cards to canonical D7 taxonomy.")

    # Synchronize js/data.js
    sys.path.insert(0, os.path.join(WORKSPACE, "scripts"))
    try:
        from curator_server import sync_js_data_file
        sync_js_data_file()
        print("Synchronized js/data.js via curator_server.")
    except Exception as e:
        print(f"Sync fallback: {e}")
        from sync_events import sync_all
        sync_all()

    print("Pass 3 complete!")

if __name__ == "__main__":
    run_pass()
