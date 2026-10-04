#!/usr/bin/env python3
"""
apply_qc_pass_20261004_run2.py

Antigravity AI QC Audit & Healing Pass - October 4, 2026
Applies 100% audit findings across all 81 active cards in data/events.json:
1. Deduplicates 3 duplicate cards:
   - bloedel-conservatory-admission (merged into van50-bloedel-conservatory-dome)
   - van50-pizzeria-ludica-board-games (merged into van50-ludica-boardgame-night)
   - van50-vandusen-harvest-days-20261010 (showings merged into van50-harvest-days-vandusen)
2. Calendar Date Roll-Forward (D2) for 5 active run events:
   - HEIST by Arun Lakra -> rolled to 2026-10-04 (today's matinee)
   - Harvest Days at VanDusen -> rolled to 2026-10-04 (today's session)
   - Deadly Dinner Party -> rolled to 2026-10-09 (next upcoming Friday showing)
   - Vancouver Art Gallery: Free First Friday -> rolled to 2026-11-06 (next First Friday)
   - Burnaby Central Railway Mini Train -> rolled to 2026-10-04 (today's rides)
3. Heals 7 newly scouted October/Halloween shows:
   - Populates discrete date, time, and curtain hours from showings
   - Maps categories to canonical taxonomy (D7)
   - Upgrades bare domain links to deep Tier 1/2 URLs (D14)
4. Recategorizes Vancouver Opera: Tosca from 'Comedy & Shows' to canonical 'Arts & Culture' and removes comedy/improv tags.
5. Synchronizes js/data.js.
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

def run_qc_pass():
    events = load_json(EVENTS_PATH)
    print(f"Total cards before QC audit: {len(events)}")

    # 1. Merge VanDusen Harvest Days showings
    harvest_showings_to_add = [
        {"date": "2026-10-10", "start_time": "10:30", "end_time": "16:30", "cost": 13.27},
        {"date": "2026-10-11", "start_time": "10:30", "end_time": "16:30", "cost": 13.27},
        {"date": "2026-10-12", "start_time": "10:30", "end_time": "16:30", "cost": 13.27},
        {"date": "2026-10-17", "start_time": "10:30", "end_time": "16:30", "cost": 13.27},
        {"date": "2026-10-18", "start_time": "10:30", "end_time": "16:30", "cost": 13.27}
    ]

    for e in events:
        if e.get("event_id") == "van50-harvest-days-vandusen":
            e["date"] = "2026-10-04"
            e["time"] = "10:30"
            e["start_time"] = "10:30"
            e["end_time"] = "16:30"
            e["dateSchedule"] = "Today & Weekends in October (10:30 AM – 4:30 PM)"
            # Ensure unique showings
            existing_dates = {s.get("date") for s in e.get("showings", [])}
            for ns in harvest_showings_to_add:
                if ns["date"] not in existing_dates:
                    e["showings"].append(ns)
                    existing_dates.add(ns["date"])
            print("Merged Harvest Days showings and rolled primary date to 2026-10-04.")

    # 2. Filter out the 3 duplicate IDs
    ids_to_remove = {
        "bloedel-conservatory-admission",
        "van50-pizzeria-ludica-board-games",
        "van50-vandusen-harvest-days-20261010"
    }
    events = [e for e in events if e.get("event_id") not in ids_to_remove]
    print(f"Deduplicated 3 redundant cards. Current count: {len(events)}")

    # 3. Calendar Date Roll-Forward for remaining active run events
    for e in events:
        eid = e.get("event_id")
        if eid == "van50-heist-arts-club":
            e["date"] = "2026-10-04"
            e["time"] = "14:00"
            e["start_time"] = "14:00"
            e["end_time"] = "16:00"
            e["dateSchedule"] = "Sunday, Oct 4, 2026 at 2:00 PM (Matinee)"
            print("Rolled HEIST to 2026-10-04 matinee.")
        elif eid == "van50-deadly-dinner-party":
            e["date"] = "2026-10-09"
            e["time"] = "19:00"
            e["start_time"] = "19:00"
            e["end_time"] = "20:30"
            e["dateSchedule"] = "Friday, Oct 9, 2026 at 7:00 PM (Runs through Oct 30)"
            print("Rolled Deadly Dinner Party to 2026-10-09.")
        elif eid == "vag-first-friday":
            e["date"] = "2026-11-06"
            e["time"] = "16:00"
            e["start_time"] = "16:00"
            e["end_time"] = "20:00"
            e["dateSchedule"] = "Friday, Nov 6, 2026 (4:00 PM – 8:00 PM)"
            print("Rolled VAG First Friday to 2026-11-06.")
        elif eid == "van50-burnaby-central-railway-mini-train":
            e["date"] = "2026-10-04"
            e["time"] = "11:00"
            e["start_time"] = "11:00"
            e["end_time"] = "17:00"
            e["dateSchedule"] = "Sunday, Oct 4, 2026 (11:00 AM – 5:00 PM)"
            print("Rolled Burnaby Central Railway to 2026-10-04.")

        # 4. Heal the 7 October/Halloween cards
        elif eid == "van50-rio-paul-anthony-talent-time-halloween-20261023":
            e["date"] = "2026-10-23"
            e["time"] = "20:00"
            e["start_time"] = "20:00"
            e["end_time"] = "22:30"
            e["category"] = "Comedy & Shows"
            e["categoryLabel"] = "Comedy & Shows"
            e["ticket_url"] = "https://riotheatre.ca/event/paul-anthonys-talent-time/"
            e["ticket_provider"] = "Rio Theatre Box Office"
            print("Healed Paul Anthony Talent Time Halloween.")
        elif eid == "van50-dr-sun-yat-sen-gongs-in-the-garden-20261018":
            e["date"] = "2026-10-18"
            e["time"] = "10:00"
            e["start_time"] = "10:00"
            e["end_time"] = "11:30"
            e["category"] = "Arts & Culture"
            e["categoryLabel"] = "Arts & Culture"
            e["details_url"] = "https://vancouverchinesegarden.com/events/"
            e["ticket_url"] = "https://vancouverchinesegarden.com/events/"
            e["ticket_provider"] = "Dr. Sun Yat-Sen Garden Box Office"
            print("Healed Gongs in the Garden.")
        elif eid == "van50-rickshaw-concrete-vehicles-20261008":
            e["date"] = "2026-10-08"
            e["time"] = "20:00"
            e["start_time"] = "20:00"
            e["end_time"] = "23:45"
            e["category"] = "Live Music"
            e["categoryLabel"] = "Live Music"
            e["details_url"] = "https://rickshawtheatre.com/show_listings/"
            e["ticket_url"] = "https://rickshawtheatre.com/show_listings/"
            e["ticket_provider"] = "Eventbrite / Rickshaw Box Office"
            print("Healed Concrete Vehicles at Rickshaw.")
        elif eid == "van50-roundhouse-diwali-in-vancouver-mehfil-20261107":
            e["date"] = "2026-11-07"
            e["time"] = "14:00"
            e["start_time"] = "14:00"
            e["end_time"] = "17:00"
            e["category"] = "Arts & Culture"
            e["categoryLabel"] = "Arts & Culture"
            e["details_url"] = "https://roundhouse.ca/events/diwali-in-vancouver-mehfil/"
            e["ticket_url"] = "https://roundhouse.ca/events/diwali-in-vancouver-mehfil/"
            e["ticket_provider"] = "Free Public Access (Roundhouse)"
            print("Healed Diwali Mehfil at Roundhouse.")
        elif eid == "van50-cinematheque-vampyr-live-score-20261031":
            e["date"] = "2026-10-31"
            e["time"] = "20:00"
            e["start_time"] = "20:00"
            e["end_time"] = "21:45"
            e["category"] = "Arts & Culture"
            e["categoryLabel"] = "Arts & Culture"
            e["ticket_url"] = "https://thecinematheque.ca/films/2026/vampyr-applied-silence"
            e["ticket_provider"] = "The Cinematheque Box Office"
            print("Healed Vampyr Live Score at Cinematheque.")
        elif eid == "van50-fox-bootylicious-halloween-20261030":
            e["date"] = "2026-10-30"
            e["time"] = "22:30"
            e["start_time"] = "22:30"
            e["end_time"] = "02:00"
            e["category"] = "Nightlife & Social"
            e["categoryLabel"] = "Nightlife & Social"
            e["details_url"] = "https://www.foxcabaret.com/monthly-calendar-list/"
            e["ticket_url"] = "https://www.foxcabaret.com/monthly-calendar-list/"
            e["ticket_provider"] = "Fox Cabaret Box Office"
            print("Healed BOO-tylicious Halloween at The Fox.")
        elif eid == "van50-moa-haida-eyes-curator-tour-20261008":
            e["date"] = "2026-10-08"
            e["time"] = "19:00"
            e["start_time"] = "19:00"
            e["end_time"] = "21:00"
            e["category"] = "Arts & Culture"
            e["categoryLabel"] = "Arts & Culture"
            e["details_url"] = "https://moa.ubc.ca/exhibition/i-use-my-haida-eyes/"
            e["ticket_url"] = "https://moa.ubc.ca/exhibition/i-use-my-haida-eyes/"
            e["ticket_provider"] = "Museum of Anthropology Box Office"
            print("Healed Haida Eyes Curator Tour at MOA.")

        # 5. Fix Vancouver Opera: Tosca taxonomy
        elif eid == "van50-queen-elizabeth-theatre-vancouver-opera-tosca":
            e["category"] = "Arts & Culture"
            e["categoryLabel"] = "Arts & Culture"
            clean_tags = [t for t in e.get("tags", []) if t not in {"laughs", "improv", "standup-comedy", "live-comedy"}]
            clean_tags.extend(["opera", "classical-music", "puccini", "theatre"])
            e["tags"] = sorted(list(set(clean_tags)))
            e["subTags"] = sorted(list(set(clean_tags)))
            print("Fixed Vancouver Opera: Tosca taxonomy to Arts & Culture.")

    save_json(EVENTS_PATH, events)
    print(f"Master catalog updated: {len(events)} active events.")

    # 6. Synchronize js/data.js
    sys.path.insert(0, os.path.join(WORKSPACE, "scripts"))
    try:
        from curator_server import sync_js_data_file
        sync_js_data_file()
        print("Synchronized js/data.js via curator_server.")
    except Exception as e:
        print(f"Direct sync fallback: {e}")
        from sync_events import sync_all
        sync_all()

    print("QC Audit and Healing Pass complete!")

if __name__ == "__main__":
    run_qc_pass()
