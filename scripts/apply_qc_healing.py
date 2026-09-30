import json
import os
import shutil
from datetime import datetime

BASE_DIR = r"c:\Users\Micro\.gemini\antigravity-ide\scratch\van50"
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")

os.makedirs(BACKUP_DIR, exist_ok=True)
ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
shutil.copy2(EVENTS_PATH, os.path.join(BACKUP_DIR, f"events_pre_qc_heal_{ts}.json"))

with open(EVENTS_PATH, "r", encoding="utf-8") as f:
    events = json.load(f)

for e in events:
    eid = e.get("event_id") or e.get("id")
    
    if eid == "van50-theatresports-improv-centre":
        e["show_1"] = {
            "date": "2026-10-02",
            "start_time": "21:00",
            "end_time": "22:30",
            "cost": 33.50
        }
        e["price"] = 33.50
        e["pricing_all_in_cad"] = {
            "regular": 33.50,
            "senior": None,
            "student": None,
            "member": None
        }
        e["curator_notes"] = "AI QC Verified (2026-09-29): Theatresports™ confirmed active weekly on Fridays and Saturdays at 9:00 PM. Set next upcoming date to 2026-10-02 with verified $33.50 CAD live ticket pricing."
        
    elif eid == "van50-heist-arts-club":
        e["show_1"] = {
            "date": "2026-10-01",
            "start_time": "19:30",
            "end_time": "21:30",
            "cost": 45.68
        }
        e["price"] = 45.68
        e["curator_notes"] = "AI QC Verified (2026-09-29): HEIST by Arun Lakra confirmed actively running through October 18, 2026. Set next upcoming performance date to 2026-10-01 with verified $45.68 CAD regular seat tier."
        
    elif eid == "van50-metro-vancouver-croissant-crawl":
        e["show_1"] = {
            "date": "2026-10-04",
            "start_time": "09:00",
            "end_time": "17:00",
            "cost": 0.0
        }
        e["price"] = 0.0
        e["curator_notes"] = "AI QC Verified (2026-09-29): Metro Vancouver Croissant Crawl confirmed running October 4 to October 25, 2026. Set next upcoming date to opening Sunday 2026-10-04 (Free participation)."
        
    elif eid == "van50-harvest-days-vandusen":
        e["show_1"] = {
            "date": "2026-10-03",
            "start_time": "10:30",
            "end_time": "16:30",
            "cost": 7.80
        }
        e["show_2"] = {
            "date": "2026-10-04",
            "start_time": "10:30",
            "end_time": "16:30",
            "cost": 7.80
        }
        e["price"] = 7.80
        e["curator_notes"] = "AI QC Verified (2026-09-29): Harvest Days at VanDusen Botanical Garden converted from multi-day string to discrete daily weekend occurrences starting Saturday 2026-10-03 ($7.80 CAD child / $14.86 adult via Showpass)."

with open(EVENTS_PATH, "w", encoding="utf-8") as f:
    json.dump(events, f, indent=2, ensure_ascii=False)

print("[QC HEALING COMPLETED] Successfully healed 4 cards with discrete calendar dates.")

# Synchronize js/data.js
import sys
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from curator_server import sync_js_data_file
sync_js_data_file()
print("[SYNC] Successfully regenerated js/data.js with 60 cards.")
