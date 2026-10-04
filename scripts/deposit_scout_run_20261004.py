import json
import os
import sys
from datetime import datetime

BASE_DIR = r"C:\Users\Micro\.gemini\antigravity-ide\scratch\van50"
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_JSON = os.path.join(DATA_DIR, "events.json")
VENUES_JSON = os.path.join(DATA_DIR, "venues.json")
BENCHMARKS_JSON = os.path.join(DATA_DIR, "ai_runtime_benchmarks.json")

today_str = datetime.now().strftime("%Y-%m-%d")

# 1. Update Venues with York Theatre and MOA UBC
with open(VENUES_JSON, "r", encoding="utf-8") as vf:
    venues = json.load(vf)

existing_vnames = {v.get("venue_name", "").lower() for v in venues}

new_venues = [
    {
        "venue_name": "York Theatre (The Cultch)",
        "full_address": "639 Commercial Dr, Vancouver, BC V5L 3W3",
        "neighborhood": "Commercial Drive & East Vancouver",
        "category": "Theatre & Comedy",
        "website_url": "https://thecultch.com/venues/york-theatre/",
        "coordinates": [49.2783, -123.0694],
        "access_model": "fenced_facility",
        "typical_drink_spend": "$7.50 craft beer / $9.00 wine",
        "notes": "Historic 370-seat East Vancouver proscenium theatre operated by The Cultch."
    },
    {
        "venue_name": "Museum of Anthropology (MOA) at UBC",
        "full_address": "6393 NW Marine Dr, Vancouver, BC V6T 1Z2",
        "neighborhood": "Point Grey & UBC",
        "category": "Museums & Galleries",
        "website_url": "https://moa.ubc.ca",
        "coordinates": [49.2694, -123.2592],
        "access_model": "fenced_facility",
        "typical_drink_spend": "$4.50 coffee at MOA Cafe",
        "notes": "World-renowned Arthur Erickson-designed museum overlooking the Strait of Georgia."
    }
]

venues_added = 0
for nv in new_venues:
    if nv["venue_name"].lower() not in existing_vnames:
        venues.append(nv)
        existing_vnames.add(nv["venue_name"].lower())
        venues_added += 1
        print(f"[NEW VENUE REGISTERED] {nv['venue_name']}")

with open(VENUES_JSON, "w", encoding="utf-8") as vf:
    json.dump(venues, vf, indent=2, ensure_ascii=False)

# 2. Update Events with 5 verified discoveries
with open(EVENTS_JSON, "r", encoding="utf-8") as ef:
    events = json.load(ef)

existing_eids = {e.get("event_id") or e.get("id") for e in events}

new_events = [
    {
        "event_id": "van50-cultch-comedy-on-the-drive-20261024",
        "event_name": "Comedy on the Drive",
        "title": "Comedy on the Drive",
        "category": "shows",
        "categoryLabel": "Comedy & Shows",
        "venue_name": "York Theatre (The Cultch)",
        "full_address": "639 Commercial Dr, Vancouver, BC V5L 3W3",
        "neighborhood": "Commercial Drive & East Vancouver",
        "description": "The Cultch presents Comedy on the Drive at the historic York Theatre, showcasing a hilarious, high-energy lineup of Vancouver's top touring standup comedians and local improv favorites.",
        "pricing_all_in_cad": {
            "regular": 29.50,
            "senior": 29.50,
            "student": 29.50,
            "member": 25.00
        },
        "operating_hours": "Box Office 6:00 PM, Show 7:00 PM",
        "days_open": "Sat",
        "show_1": {
            "date": "2026-10-24",
            "start_time": "19:00",
            "end_time": "21:00",
            "cost": 29.50
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": "https://thecultch.com",
        "details_url": "https://thecultch.com",
        "ticket_url": "https://thecultch.com",
        "ticket_provider": "The Cultch Box Office",
        "tags": [
            "comedy",
            "stand-up",
            "york-theatre",
            "the-cultch",
            "commercial-drive",
            "east-van",
            "live-comedy",
            "nightlife",
            "19-plus",
            "indie-theatre",
            "local-talent",
            "budget-friendly"
        ],
        "festival_affiliation": "None",
        "approval_status": "Auto-Approved",
        "curator_notes": "Verified Cultch ticketing. Advance tier $25.00 + service fee = $29.50 CAD all-in.",
        "price": 29.50,
        "access_model": "fenced_facility",
        "pricing_model": "flat_ticket",
        "price_adult": 29.50,
        "price_member": 25.00,
        "dateSchedule": "Saturday, Oct 24, 2026 at 7:00 PM (Doors 6:00 PM)",
        "frequency": "One-Time Show",
        "lineup": "Curated Vancouver touring standup comedians & guests",
        "restrictions": "19+ (Licensed venue)",
        "is_sold_out": False,
        "waypoints": [],
        "showings": [
            {"date": "2026-10-24", "start_time": "19:00", "end_time": "21:00", "cost": 29.50}
        ],
        "holidays": [],
        "subTags": [
            "comedy",
            "stand-up",
            "york-theatre",
            "the-cultch",
            "commercial-drive",
            "east-van",
            "live-comedy",
            "nightlife",
            "19-plus",
            "indie-theatre",
            "local-talent",
            "budget-friendly"
        ]
    },
    {
        "event_id": "van50-cinematheque-vampyr-live-score-20261031",
        "event_name": "Vampyr × Applied Silence [Live Score]",
        "title": "Vampyr × Applied Silence [Live Score]",
        "category": "cinema",
        "categoryLabel": "Indie Cinema",
        "venue_name": "The Cinematheque",
        "full_address": "1131 Howe St, Vancouver, BC V6Z 1R1",
        "neighborhood": "Downtown, Gastown & Yaletown",
        "description": "Part of Forbidden Rooms: Halloween on Howe. Carl Theodor Dreyer's hallucinatory 1932 vampire masterwork screened on Halloween night accompanied by a live acoustic-electronic original score by ambient duo Applied Silence.",
        "pricing_all_in_cad": {
            "regular": 30.00,
            "senior": 30.00,
            "student": 30.00,
            "member": 25.00
        },
        "operating_hours": "Doors 7:30 PM, Screening 8:00 PM",
        "days_open": "Sat",
        "show_1": {
            "date": "2026-10-31",
            "start_time": "20:00",
            "end_time": "21:45",
            "cost": 30.00
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": "https://thecinematheque.ca",
        "details_url": "https://thecinematheque.ca",
        "ticket_url": "https://thecinematheque.ca",
        "ticket_provider": "The Cinematheque Box Office",
        "tags": [
            "halloween",
            "cinematheque",
            "vampyr",
            "applied-silence",
            "live-score",
            "silent-film",
            "horror",
            "classic-cinema",
            "downtown",
            "howe-street",
            "indie-cinema",
            "special-event",
            "18-plus",
            "holiday-event"
        ],
        "festival_affiliation": "None",
        "approval_status": "Auto-Approved",
        "curator_notes": "Live score Halloween special. Verified $30.00 CAD admission (Indigenous admission $0).",
        "price": 30.00,
        "access_model": "fenced_facility",
        "pricing_model": "flat_ticket",
        "price_adult": 30.00,
        "tier_custom_name_1": "Indigenous Peoples",
        "tier_custom_price_1": 0.0,
        "dateSchedule": "Saturday, Oct 31, 2026 at 8:00 PM",
        "frequency": "One-Time Show",
        "lineup": "Carl Theodor Dreyer Film / Applied Silence (Live Score)",
        "restrictions": "18+ (The Cinematheque membership included)",
        "is_sold_out": False,
        "waypoints": [],
        "showings": [
            {"date": "2026-10-31", "start_time": "20:00", "end_time": "21:45", "cost": 30.00}
        ],
        "holiday_detected": "halloween",
        "holidays": ["halloween"],
        "subTags": [
            "halloween",
            "cinematheque",
            "vampyr",
            "applied-silence",
            "live-score",
            "silent-film",
            "horror",
            "classic-cinema",
            "downtown",
            "howe-street",
            "indie-cinema",
            "special-event",
            "18-plus",
            "holiday-event"
        ]
    },
    {
        "event_id": "van50-firehall-red-demon-20261014",
        "event_name": "Red Demon (vAct & Firehall Arts Centre)",
        "title": "Red Demon (vAct & Firehall Arts Centre)",
        "category": "shows",
        "categoryLabel": "Comedy & Shows",
        "venue_name": "Firehall Arts Centre",
        "full_address": "280 E Cordova St, Vancouver, BC V6A 1L3",
        "neighborhood": "Downtown Eastside & Strathcona",
        "description": "Firehall Arts Centre presents Hideki Noda's internationally acclaimed fable Red Demon in association with Vancouver Asian Canadian Theatre (vAct), directed by Donna Spencer in the historic fire station theatre.",
        "pricing_all_in_cad": {
            "regular": 32.00,
            "senior": 30.00,
            "student": 30.00,
            "member": 20.00
        },
        "operating_hours": "Evening 7:30 PM, Weekend Matinee 3:00 PM",
        "days_open": "Tue-Sun",
        "show_1": {
            "date": "2026-10-14",
            "start_time": "19:30",
            "end_time": "21:30",
            "cost": 32.00
        },
        "show_2": {
            "date": "2026-10-15",
            "start_time": "19:30",
            "end_time": "21:30",
            "cost": 32.00
        },
        "show_3": {
            "date": "2026-10-17",
            "start_time": "15:00",
            "end_time": "17:00",
            "cost": 32.00
        },
        "discovery_url": "https://firehallartscentre.ca",
        "details_url": "https://firehallartscentre.ca",
        "ticket_url": "https://firehallartscentre.ca",
        "ticket_provider": "Firehall Arts Centre Box Office",
        "tags": [
            "theatre",
            "stage-play",
            "firehall-arts-centre",
            "vact",
            "downtown-eastside",
            "strathcona",
            "asian-canadian-theatre",
            "live-performance",
            "culture",
            "twenty-tuesdays",
            "budget-friendly",
            "arts"
        ],
        "festival_affiliation": "None",
        "approval_status": "Auto-Approved",
        "curator_notes": "Live ticket verified. Side tier $32.00 CAD, centre $39.00, students/seniors $30.00, Twenty Tuesdays $20.00.",
        "price": 32.00,
        "access_model": "fenced_facility",
        "pricing_model": "flat_ticket",
        "price_adult": 32.00,
        "price_student": 30.00,
        "price_member": 30.00,
        "tier_custom_name_1": "Twenty Tuesdays",
        "tier_custom_price_1": 20.00,
        "dateSchedule": "Oct 8 – Oct 18, 2026 (Evenings 7:30 PM, Matinees 3:00 PM)",
        "frequency": "Multi-Date Theatrical Run",
        "lineup": "vAct & Firehall Professional Ensemble Cast, Dir. Donna Spencer",
        "restrictions": "All Ages / General Admission",
        "is_sold_out": False,
        "waypoints": [],
        "showings": [
            {"date": "2026-10-14", "start_time": "19:30", "end_time": "21:30", "cost": 32.00},
            {"date": "2026-10-15", "start_time": "19:30", "end_time": "21:30", "cost": 32.00},
            {"date": "2026-10-17", "start_time": "15:00", "end_time": "17:00", "cost": 32.00}
        ],
        "holidays": [],
        "subTags": [
            "theatre",
            "stage-play",
            "firehall-arts-centre",
            "vact",
            "downtown-eastside",
            "strathcona",
            "asian-canadian-theatre",
            "live-performance",
            "culture",
            "twenty-tuesdays",
            "budget-friendly",
            "arts"
        ]
    },
    {
        "event_id": "van50-fox-bootylicious-halloween-20261030",
        "event_name": "Halloween Friday at The Fox: BOO-tylicious",
        "title": "Halloween Friday at The Fox: BOO-tylicious",
        "category": "music",
        "categoryLabel": "Nightlife & Music",
        "venue_name": "The Fox Cabaret",
        "full_address": "2321 Main St, Vancouver, BC V5T 3C9",
        "neighborhood": "Mount Pleasant & South Vancouver",
        "description": "Celebrate Halloween Friday at Mount Pleasant's Fox Cabaret with BOO-tylicious: a spooky, high-energy throwback dance party spinning 90s and 2000s party anthems with costume contests and drink specials.",
        "pricing_all_in_cad": {
            "regular": 24.50,
            "senior": 24.50,
            "student": 24.50,
            "member": 20.00
        },
        "operating_hours": "Doors 10:30 PM – 2:00 AM",
        "days_open": "Fri",
        "show_1": {
            "date": "2026-10-30",
            "start_time": "22:30",
            "end_time": "02:00",
            "cost": 24.50
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": "https://foxcabaret.com",
        "details_url": "https://foxcabaret.com",
        "ticket_url": "https://www.eventbrite.ca",
        "ticket_provider": "Eventbrite / Fox Box Office",
        "tags": [
            "halloween",
            "fox-cabaret",
            "dance-party",
            "throwback",
            "90s-music",
            "2000s-music",
            "mount-pleasant",
            "main-street",
            "nightlife",
            "dj",
            "costume-contest",
            "19-plus",
            "holiday-event"
        ],
        "festival_affiliation": "None",
        "approval_status": "Auto-Approved",
        "curator_notes": "Verified online tier $20.00 + Eventbrite fees = $24.50 CAD all-in. Door $30.00 cash.",
        "price": 24.50,
        "access_model": "fenced_facility",
        "pricing_model": "flat_ticket",
        "price_adult": 24.50,
        "dateSchedule": "Friday, Oct 30, 2026 at 10:30 PM",
        "frequency": "One-Time Party",
        "lineup": "Resident Fox Cabaret Throwback DJs",
        "restrictions": "19+ with two pieces of valid government photo ID",
        "is_sold_out": False,
        "waypoints": [],
        "showings": [
            {"date": "2026-10-30", "start_time": "22:30", "end_time": "02:00", "cost": 24.50}
        ],
        "holiday_detected": "halloween",
        "holidays": ["halloween"],
        "subTags": [
            "halloween",
            "fox-cabaret",
            "dance-party",
            "throwback",
            "90s-music",
            "2000s-music",
            "mount-pleasant",
            "main-street",
            "nightlife",
            "dj",
            "costume-contest",
            "19-plus",
            "holiday-event"
        ]
    },
    {
        "event_id": "van50-moa-haida-eyes-curator-tour-20261008",
        "event_name": "I Use My Haida Eyes: History Robes & Curator Tour",
        "title": "I Use My Haida Eyes: History Robes & Curator Tour",
        "category": "culture",
        "categoryLabel": "Arts & Culture",
        "venue_name": "Museum of Anthropology (MOA) at UBC",
        "full_address": "6393 NW Marine Dr, Vancouver, BC V6T 1Z2",
        "neighborhood": "Point Grey & UBC",
        "description": "Final days of master Haida weaver Jut-ke-Nay Hazel Wilson's monumental ceremonial history robes exhibition at MOA, featuring an exclusive evening curator tour led by Jordan Wilson and Raymond Boisjoly.",
        "pricing_all_in_cad": {
            "regular": 13.00,
            "senior": 11.50,
            "student": 11.50,
            "member": 0.00
        },
        "operating_hours": "Thursday 10:00 AM – 9:00 PM (Curator Tour 7:00 PM)",
        "days_open": "Thu",
        "show_1": {
            "date": "2026-10-08",
            "start_time": "19:00",
            "end_time": "21:00",
            "cost": 13.00
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": "https://moa.ubc.ca",
        "details_url": "https://moa.ubc.ca",
        "ticket_url": "https://moa.ubc.ca",
        "ticket_provider": "MOA Box Office",
        "tags": [
            "moa",
            "museum-of-anthropology",
            "ubc",
            "indigenous-art",
            "haida-culture",
            "curator-tour",
            "textiles",
            "ceremonial-robes",
            "arts-and-culture",
            "point-grey",
            "half-price-thursdays",
            "budget-friendly",
            "all-ages"
        ],
        "festival_affiliation": "None",
        "approval_status": "Auto-Approved",
        "curator_notes": "Thursday evening half-price admission after 5:00 PM: $13.00 CAD adults. Indigenous peoples free ($0).",
        "price": 13.00,
        "access_model": "fenced_facility",
        "pricing_model": "flat_ticket",
        "price_adult": 13.00,
        "price_student": 11.50,
        "price_member": 0.00,
        "tier_custom_name_1": "Indigenous Peoples",
        "tier_custom_price_1": 0.00,
        "tier_custom_name_2": "Regular Daytime Admission",
        "tier_custom_price_2": 26.00,
        "dateSchedule": "Thursday, Oct 8, 2026 at 7:00 PM (Museum open until 9:00 PM)",
        "frequency": "Feature Exhibition Tour",
        "lineup": "Jut-ke-Nay Hazel Wilson Exhibition; Curators Jordan Wilson & Raymond Boisjoly",
        "restrictions": "All Ages / Family Friendly",
        "is_sold_out": False,
        "waypoints": [],
        "showings": [
            {"date": "2026-10-08", "start_time": "19:00", "end_time": "21:00", "cost": 13.00}
        ],
        "holidays": [],
        "subTags": [
            "moa",
            "museum-of-anthropology",
            "ubc",
            "indigenous-art",
            "haida-culture",
            "curator-tour",
            "textiles",
            "ceremonial-robes",
            "arts-and-culture",
            "point-grey",
            "half-price-thursdays",
            "budget-friendly",
            "all-ages"
        ]
    }
]

added_count = 0
for ne in new_events:
    eid = ne["event_id"]
    if eid not in existing_eids:
        events.append(ne)
        existing_eids.add(eid)
        added_count += 1
        print(f"[ACTIVE EVENT ADDED] {ne['event_name']} (${ne['price']} CAD)")

with open(EVENTS_JSON, "w", encoding="utf-8") as ef:
    json.dump(events, ef, indent=2, ensure_ascii=False)
print(f"[CATALOG] Saved {len(events)} active events (+{added_count} newly scouted).")

# 3. Synchronize js/data.js
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from curator_server import sync_js_data_file
sync_js_data_file()
print("[OK] js/data.js synchronized.")
