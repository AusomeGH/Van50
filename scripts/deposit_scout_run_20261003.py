import json
import os
import shutil
from datetime import datetime

BASE_DIR = r"C:\Users\Micro\.gemini\antigravity-ide\scratch\van50"
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_JSON = os.path.join(DATA_DIR, "events.json")
QUEUE_JSON = os.path.join(DATA_DIR, "manual_review_queue.json")
HOLIDAYS_JSON = os.path.join(DATA_DIR, "approved_holidays.json")
FESTIVALS_JSON = os.path.join(DATA_DIR, "festivals.json")
VENUES_JSON = os.path.join(DATA_DIR, "venues.json")

today_str = datetime.now().strftime("%Y-%m-%d")

# 1. Update Approved Holidays with new pending holiday candidate
with open(HOLIDAYS_JSON, "r", encoding="utf-8") as hf:
    holidays_data = json.load(hf)

pending_holidays = holidays_data.setdefault("pendingHolidays", [])
pending_ids = {h.get("id") for h in pending_holidays}

new_holiday = {
    "id": "dia-de-los-muertos",
    "label": "Día de los Muertos / Day of the Dead",
    "icon": "💀",
    "detectedInEvent": "van50-latincouver-catrinas-procession-gastown-20261102",
    "eventTitle": "Catrinas Procession: Día de los Muertos",
    "detectedAt": today_str,
    "status": "pending"
}

if "dia-de-los-muertos" not in pending_ids:
    pending_holidays.append(new_holiday)
    holidays_data["metadata"]["updatedAt"] = today_str
    with open(HOLIDAYS_JSON, "w", encoding="utf-8") as hf:
        json.dump(holidays_data, hf, indent=2, ensure_ascii=False)
    print(f"[HOLIDAY] Added 'dia-de-los-muertos' to pending holidays in {HOLIDAYS_JSON}")

# 2. Update Manual Review Queue with the quarantined unapproved holiday event
with open(QUEUE_JSON, "r", encoding="utf-8") as qf:
    queue_data = json.load(qf)

queue_events = queue_data.setdefault("quarantinedEvents", [])
queue_ids = {e.get("id") or e.get("event_id") for e in queue_events}

quarantined_candidate = {
    "id": "van50-latincouver-catrinas-procession-gastown-20261102",
    "title": "Catrinas Procession: Día de los Muertos",
    "artist": "Latincouver Catrinas Ensemble",
    "venue": "Gastown Historic District",
    "address": "Maple Tree Square to Water St, Vancouver, BC",
    "neighborhood": "Downtown, Gastown & Yaletown",
    "cluster": "Downtown, Gastown & Yaletown",
    "category": "culture",
    "categoryLabel": "Arts & Culture",
    "date": "2026-11-02",
    "time": "17:00",
    "price": 0.0,
    "priceLabel": "Free ($0.00)",
    "websiteUrl": "https://latincouver.ca",
    "ticket_url": "https://latincouver.ca",
    "ticket_provider": "Free Public Access (Latincouver)",
    "description": "Latincouver leads an evocative twilight procession of Catrinas in traditional Mexican calavera face paint and ornate costumes through historic Gastown to honour Día de los Muertos.",
    "lineup": "Latincouver Catrinas ensemble, Mexican folkloric dancers, traditional musicians",
    "restrictions": "All Ages / Free Outdoor Public Gathering",
    "quarantineReason": "Pending Holiday Approval: 'dia-de-los-muertos'. New holiday detected by Scout AI awaiting Curator Studio review.",
    "flaggedAt": today_str,
    "unconfirmedDetails": ["Holiday approval pending in Curator Studio."],
    "holiday_detected": "dia-de-los-muertos",
    "tags": ["dia-de-los-muertos", "day-of-the-dead", "catrinas", "latincouver", "gastown", "mexican-culture", "calaveras", "procession", "free-public-access", "autumn", "remembrance", "all-ages", "family-friendly", "street-festival", "vancouver-heritage"]
}

if quarantined_candidate["id"] not in queue_ids:
    queue_events.append(quarantined_candidate)
    queue_data["metadata"]["pendingCount"] = len(queue_events)
    queue_data["metadata"]["updatedAt"] = today_str
    with open(QUEUE_JSON, "w", encoding="utf-8") as qf:
        json.dump(queue_data, qf, indent=2, ensure_ascii=False)
    print(f"[QUEUE] Quarantined candidate '{quarantined_candidate['title']}' awaiting holiday approval.")

# 3. Update Active Events with 5 verified discoveries
with open(EVENTS_JSON, "r", encoding="utf-8") as ef:
    active_events = json.load(ef)

active_ids = {e.get("event_id") or e.get("id") for e in active_events}

new_active_events = [
    {
        "event_id": "van50-vandusen-harvest-days-20261010",
        "event_name": "Harvest Days at VanDusen Botanical Garden",
        "title": "Harvest Days at VanDusen Botanical Garden",
        "category": "outdoors",
        "categoryLabel": "Outdoors & Nature",
        "venue_name": "VanDusen Botanical Garden",
        "full_address": "5251 Oak St, Vancouver, BC V6M 4H1",
        "neighborhood": "Shaughnessy & South Vancouver",
        "description": "VanDusen Botanical Garden celebrates the autumn harvest with live bluegrass and family folk music by the hedge maze, lawn games, honey tastings and gardening tips in the Discovery Tent, and eco-friendly biodegradable sculptures by local artist Nickie Lewis.",
        "pricing_all_in_cad": {
            "regular": 13.27,
            "senior": 10.61,
            "student": 9.28,
            "member": 0.0
        },
        "operating_hours": "10:00 AM – 5:00 PM (Harvest Days activities 10:30 AM – 4:30 PM)",
        "days_open": "Weekends + Thanksgiving Mon",
        "show_1": {
            "date": "2026-10-10",
            "start_time": "10:30",
            "end_time": "16:30",
            "cost": 13.27
        },
        "show_2": {
            "date": "2026-10-11",
            "start_time": "10:30",
            "end_time": "16:30",
            "cost": 13.27
        },
        "show_3": {
            "date": "2026-10-12",
            "start_time": "10:30",
            "end_time": "16:30",
            "cost": 13.27
        },
        "discovery_url": "https://vancouver.ca/parks-recreation-culture/vandusen-botanical-garden.aspx",
        "details_url": "https://vancouver.ca/parks-recreation-culture/vandusen-botanical-garden.aspx",
        "ticket_url": "https://vancouver.ca/parks-recreation-culture/vandusen-botanical-garden.aspx",
        "ticket_provider": "City of Vancouver VanDusen Box Office",
        "tags": [
            "thanksgiving",
            "halloween",
            "harvest-days",
            "vandusen",
            "botanical-garden",
            "autumn",
            "fall-colours",
            "live-music",
            "bluegrass",
            "folk-music",
            "lawn-games",
            "honey-tasting",
            "eco-sculptures",
            "family-friendly",
            "all-ages",
            "nature",
            "pumpkins",
            "outdoor-outings",
            "budget-friendly",
            "vancouver-parks"
        ],
        "festival_affiliation": "None",
        "approval_status": "Auto-Approved",
        "curator_notes": "Live cart verified. Adult $13.27 CAD, senior $10.61, youth $9.28, child $6.63. Under $50 all-in. Thanksgiving long weekend included.",
        "price": 13.27,
        "access_model": "fenced_facility",
        "pricing_model": "flat_ticket",
        "price_adult": 13.27,
        "price_student": 9.28,
        "price_member": 0.0,
        "tier_custom_name_1": "Child (5-12)",
        "tier_custom_price_1": 6.63,
        "tier_custom_name_2": "Tot (0-4)",
        "tier_custom_price_2": 0.0,
        "dateSchedule": "Weekends Sep 26 – Oct 18 & Thanksgiving Mon Oct 12 (10:30 AM – 4:30 PM)",
        "frequency": "Multi-Date Seasonal Run",
        "lineup": "Curated local bluegrass & folk musicians, Nickie Lewis (eco-sculptor)",
        "restrictions": "All Ages / Family Friendly",
        "is_sold_out": False,
        "waypoints": [],
        "showings": [
            {"date": "2026-10-10", "start_time": "10:30", "end_time": "16:30", "cost": 13.27},
            {"date": "2026-10-11", "start_time": "10:30", "end_time": "16:30", "cost": 13.27},
            {"date": "2026-10-12", "start_time": "10:30", "end_time": "16:30", "cost": 13.27},
            {"date": "2026-10-17", "start_time": "10:30", "end_time": "16:30", "cost": 13.27},
            {"date": "2026-10-18", "start_time": "10:30", "end_time": "16:30", "cost": 13.27}
        ],
        "holiday_detected": "thanksgiving",
        "holidays": ["thanksgiving", "halloween"],
        "subTags": [
            "thanksgiving",
            "halloween",
            "harvest-days",
            "vandusen",
            "botanical-garden",
            "autumn",
            "fall-colours",
            "live-music",
            "bluegrass",
            "folk-music",
            "lawn-games",
            "honey-tasting",
            "eco-sculptures",
            "family-friendly",
            "all-ages",
            "nature",
            "pumpkins",
            "outdoor-outings",
            "budget-friendly",
            "vancouver-parks"
        ]
    },
    {
        "event_id": "van50-rio-paul-anthony-talent-time-halloween-20261023",
        "event_name": "Paul Anthony's Talent Time: Halloween Special",
        "title": "Paul Anthony's Talent Time: Halloween Special",
        "category": "shows",
        "categoryLabel": "Comedy & Shows",
        "venue_name": "The Rio Theatre",
        "full_address": "1660 E Broadway, Vancouver, BC V5N 1W1",
        "neighborhood": "Commercial Drive & East Vancouver",
        "description": "Vancouver's beloved comedy-variety institution returns for a spooky Halloween edition hosted by Paul Anthony and Ryan Beil, featuring weird and wonderful acts, spooky musical guests, costume contests, and comedic chaos.",
        "pricing_all_in_cad": {
            "regular": 26.50,
            "senior": 26.50,
            "student": 26.50,
            "member": 22.00
        },
        "operating_hours": "Doors 7:15 PM, Show 8:00 PM",
        "days_open": "Fri",
        "show_1": {
            "date": "2026-10-23",
            "start_time": "20:00",
            "end_time": "22:30",
            "cost": 26.50
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": "https://riotheatre.ca",
        "details_url": "https://riotheatre.ca",
        "ticket_url": "https://riotheatretickets.ca",
        "ticket_provider": "The Rio Theatre Box Office",
        "tags": [
            "halloween",
            "talent-time",
            "paul-anthony",
            "ryan-beil",
            "rio-theatre",
            "comedy",
            "variety-show",
            "spooky",
            "costume-contest",
            "commercial-drive",
            "east-van",
            "indie-theatre",
            "craft-beer",
            "live-entertainment",
            "19-plus",
            "cult-classic",
            "nightlife",
            "holiday-event"
        ],
        "festival_affiliation": "None",
        "approval_status": "Auto-Approved",
        "curator_notes": "Verified Rio Theatre ticketing. Advance tickets $22.00 + fees = $26.50 all-in CAD.",
        "price": 26.50,
        "access_model": "fenced_facility",
        "pricing_model": "flat_ticket",
        "price_adult": 26.50,
        "price_member": 22.00,
        "dateSchedule": "Friday, Oct 23, 2026 at 8:00 PM (Doors 7:15 PM)",
        "frequency": "One-Time Show",
        "lineup": "Paul Anthony, Ryan Beil, musical guests, spooky variety performers",
        "restrictions": "19+ with valid government-issued photo ID",
        "is_sold_out": False,
        "waypoints": [],
        "showings": [
            {"date": "2026-10-23", "start_time": "20:00", "end_time": "22:30", "cost": 26.50}
        ],
        "holiday_detected": "halloween",
        "holidays": ["halloween"],
        "subTags": [
            "halloween",
            "talent-time",
            "paul-anthony",
            "ryan-beil",
            "rio-theatre",
            "comedy",
            "variety-show",
            "spooky",
            "costume-contest",
            "commercial-drive",
            "east-van",
            "indie-theatre",
            "craft-beer",
            "live-entertainment",
            "19-plus",
            "cult-classic",
            "nightlife",
            "holiday-event"
        ]
    },
    {
        "event_id": "van50-dr-sun-yat-sen-gongs-in-the-garden-20261018",
        "event_name": "Gongs in the Garden: Autumn Sunday Reset",
        "title": "Gongs in the Garden: Autumn Sunday Reset",
        "category": "culture",
        "categoryLabel": "Arts & Culture",
        "venue_name": "Dr. Sun Yat-Sen Classical Chinese Garden",
        "full_address": "578 Carrall St, Vancouver, BC V6A 5M3",
        "neighborhood": "Chinatown",
        "description": "Immerse yourself in the classical Ming Dynasty courtyard architecture of Dr. Sun Yat-Sen Garden for an acoustic sound bath and gong meditation session, designed to ground the senses and embrace autumn.",
        "pricing_all_in_cad": {
            "regular": 38.74,
            "senior": 38.74,
            "student": 38.74,
            "member": 35.00
        },
        "operating_hours": "10:00 AM – 11:30 AM",
        "days_open": "Sun",
        "show_1": {
            "date": "2026-10-18",
            "start_time": "10:00",
            "end_time": "11:30",
            "cost": 38.74
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": "https://vancouverchinesegarden.com/events",
        "details_url": "https://vancouverchinesegarden.com/events",
        "ticket_url": "https://www.eventbrite.ca",
        "ticket_provider": "Eventbrite",
        "tags": [
            "sun-yat-sen",
            "chinatown",
            "sound-bath",
            "gong-meditation",
            "wellness",
            "mindfulness",
            "classical-chinese-garden",
            "autumn",
            "tranquility",
            "meditation",
            "heritage",
            "acoustic",
            "stress-relief",
            "weekend-morning",
            "peaceful",
            "all-ages"
        ],
        "festival_affiliation": "None",
        "approval_status": "Auto-Approved",
        "curator_notes": "Verified all-in Eventbrite cart total CA$38.74 CAD (admission to garden included).",
        "price": 38.74,
        "access_model": "fenced_facility",
        "pricing_model": "flat_ticket",
        "price_adult": 38.74,
        "dateSchedule": "Sunday, Oct 18, 2026 at 10:00 AM",
        "frequency": "One-Time",
        "lineup": "Certified Sound Bath Practitioner & Classical Gong Masters",
        "restrictions": "All Ages / General Admission (bring your own yoga mat/blanket)",
        "is_sold_out": False,
        "waypoints": [],
        "showings": [
            {"date": "2026-10-18", "start_time": "10:00", "end_time": "11:30", "cost": 38.74}
        ],
        "holidays": [],
        "subTags": [
            "sun-yat-sen",
            "chinatown",
            "sound-bath",
            "gong-meditation",
            "wellness",
            "mindfulness",
            "classical-chinese-garden",
            "autumn",
            "tranquility",
            "meditation",
            "heritage",
            "acoustic",
            "stress-relief",
            "weekend-morning",
            "peaceful",
            "all-ages"
        ]
    },
    {
        "event_id": "van50-rickshaw-concrete-vehicles-20261008",
        "event_name": "Concrete Vehicles with Hillsboro, WAIT//LESS, and LöLä",
        "title": "Concrete Vehicles with Hillsboro, WAIT//LESS, and LöLä",
        "category": "music",
        "categoryLabel": "Live Music",
        "venue_name": "Rickshaw Theatre",
        "full_address": "254 E Hastings St, Vancouver, BC V6A 1P1",
        "neighborhood": "Downtown Eastside & Hastings",
        "description": "Vancouver post-punk and heavy indie four-piece Concrete Vehicles headline the Rickshaw Theatre stage alongside atmospheric alt-rockers Hillsboro, WAIT//LESS, and LöLä.",
        "pricing_all_in_cad": {
            "regular": 24.40,
            "senior": 24.40,
            "student": 24.40,
            "member": 24.40
        },
        "operating_hours": "Doors 7:00 PM, Show 8:00 PM",
        "days_open": "Thu",
        "show_1": {
            "date": "2026-10-08",
            "start_time": "20:00",
            "end_time": "23:45",
            "cost": 24.40
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": "https://rickshawtheatre.com",
        "details_url": "https://rickshawtheatre.com",
        "ticket_url": "https://www.eventbrite.ca",
        "ticket_provider": "Eventbrite",
        "tags": [
            "rickshaw-theatre",
            "concrete-vehicles",
            "hillsboro",
            "wait-less",
            "lola",
            "post-punk",
            "indie-rock",
            "alternative",
            "live-music",
            "hastings",
            "east-van",
            "19-plus",
            "concert",
            "local-bands",
            "vancouver-music-scene"
        ],
        "festival_affiliation": "None",
        "approval_status": "Auto-Approved",
        "curator_notes": "Verified all-in Eventbrite cart total $24.40 CAD.",
        "price": 24.40,
        "access_model": "fenced_facility",
        "pricing_model": "flat_ticket",
        "price_adult": 24.40,
        "dateSchedule": "Thursday, Oct 8, 2026 at 8:00 PM (Doors 7:00 PM)",
        "frequency": "One-Time Show",
        "lineup": "Concrete Vehicles, Hillsboro, WAIT//LESS, LöLä",
        "restrictions": "19+ with valid government-issued photo ID",
        "is_sold_out": False,
        "waypoints": [],
        "showings": [
            {"date": "2026-10-08", "start_time": "20:00", "end_time": "23:45", "cost": 24.40}
        ],
        "holidays": [],
        "subTags": [
            "rickshaw-theatre",
            "concrete-vehicles",
            "hillsboro",
            "wait-less",
            "lola",
            "post-punk",
            "indie-rock",
            "alternative",
            "live-music",
            "hastings",
            "east-van",
            "19-plus",
            "concert",
            "local-bands",
            "vancouver-music-scene"
        ]
    },
    {
        "event_id": "van50-roundhouse-diwali-in-vancouver-mehfil-20261107",
        "event_name": "Diwali in Vancouver: Mehfil at Roundhouse",
        "title": "Diwali in Vancouver: Mehfil at Roundhouse",
        "category": "culture",
        "categoryLabel": "Arts & Culture",
        "venue_name": "Roundhouse Community Arts & Recreation Centre",
        "full_address": "181 Roundhouse Mews, Vancouver, BC V6Z 2W3",
        "neighborhood": "Yaletown",
        "description": "Diwali Fest presents a lively multicultural celebration of the Festival of Lights inside the Roundhouse Exhibition Hall, featuring classical South Asian dance, live music, rangoli art demonstrations, and family workshops.",
        "pricing_all_in_cad": {
            "regular": 0.0,
            "senior": 0.0,
            "student": 0.0,
            "member": 0.0
        },
        "operating_hours": "2:00 PM – 5:00 PM",
        "days_open": "Sat",
        "show_1": {
            "date": "2026-11-07",
            "start_time": "14:00",
            "end_time": "17:00",
            "cost": 0.0
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": "https://www.diwalifest.ca",
        "details_url": "https://www.diwalifest.ca",
        "ticket_url": "https://www.diwalifest.ca",
        "ticket_provider": "Diwali Celebration Society / Roundhouse Box Office",
        "tags": [
            "diwali",
            "diwali-fest",
            "festival-of-lights",
            "roundhouse",
            "yaletown",
            "south-asian",
            "indian-classical-dance",
            "bhangra",
            "kathak",
            "rangoli",
            "live-music",
            "free-event",
            "free-admission",
            "family-friendly",
            "all-ages",
            "community-cultural",
            "holiday-celebration"
        ],
        "festival_affiliation": "Diwali Fest",
        "approval_status": "Auto-Approved",
        "curator_notes": "Free community celebration ($0.00 CAD). Pre-registration required for hall capacity.",
        "price": 0.0,
        "access_model": "fenced_facility",
        "pricing_model": "free_access",
        "price_adult": 0.0,
        "dateSchedule": "Saturday, Nov 7, 2026, 2:00 PM – 5:00 PM",
        "frequency": "Annual Festival Showcase",
        "lineup": "Curated Diwali Fest South Asian musicians, dance performers, and rangoli artists",
        "restrictions": "All Ages / Family Friendly (Pre-registration required)",
        "is_sold_out": False,
        "waypoints": [],
        "showings": [
            {"date": "2026-11-07", "start_time": "14:00", "end_time": "17:00", "cost": 0.0}
        ],
        "holiday_detected": "diwali",
        "holidays": ["diwali"],
        "subTags": [
            "diwali",
            "diwali-fest",
            "festival-of-lights",
            "roundhouse",
            "yaletown",
            "south-asian",
            "indian-classical-dance",
            "bhangra",
            "kathak",
            "rangoli",
            "live-music",
            "free-event",
            "free-admission",
            "family-friendly",
            "all-ages",
            "community-cultural",
            "holiday-celebration"
        ]
    }
]

added_count = 0
for ne in new_active_events:
    eid = ne["event_id"]
    if eid not in active_ids:
        active_events.append(ne)
        active_ids.add(eid)
        added_count += 1
        print(f"[ACTIVE EVENT ADDED] {ne['event_name']} (${ne['price']} CAD)")

with open(EVENTS_JSON, "w", encoding="utf-8") as ef:
    json.dump(active_events, ef, indent=2, ensure_ascii=False)
print(f"[CATALOG] Saved {len(active_events)} active events (+{added_count} newly scouted).")

# 4. Update Festivals with Diwali Fest and Día de los Muertos
with open(FESTIVALS_JSON, "r", encoding="utf-8") as ff:
    festivals = json.load(ff)

existing_fest_names = {f.get("festival_name", "").lower() for f in festivals}

new_festivals = [
    {
        "festival_name": "Diwali Fest (Festival of Lights)",
        "website_url": "https://www.diwalifest.ca",
        "schedule_url": "https://www.diwalifest.ca",
        "location": "Roundhouse Community Centre, Evergreen Cultural Centre, Surrey City Hall",
        "start_date": "2026-11-05",
        "end_date": "2026-11-15",
        "description": "Annual multicultural celebration of Diwali presenting South Asian music, dance, theatre, and visual arts across Metro Vancouver.",
        "category": "Arts & Culture",
        "access_model": "open_public_space",
        "pricing_model": "free_access",
        "price": 0.0,
        "coordinates": [49.2734, -123.1215],
        "lineup": "Curated South Asian musicians, dance troupes, and visual artists",
        "restrictions": "All Ages / Family Friendly",
        "is_sold_out": False,
        "waypoints": [],
        "showings": [
            {"date": "2026-11-07", "start_time": "14:00", "end_time": "17:00", "cost": 0.0}
        ]
    },
    {
        "festival_name": "Día de los Muertos Festival (Day of the Dead)",
        "website_url": "https://latincouver.ca",
        "schedule_url": "https://latincouver.ca",
        "location": "Granville Island & Gastown Historic District, Vancouver",
        "start_date": "2026-10-31",
        "end_date": "2026-11-02",
        "description": "Latincouver's annual cultural celebration honouring loved ones with traditional Mexican markets, Catrinas twilight procession, music, and art.",
        "category": "Arts & Culture",
        "access_model": "open_public_space",
        "pricing_model": "free_access",
        "price": 0.0,
        "coordinates": [49.2838, -123.1065],
        "lineup": "Latincouver traditional Catrinas, folkloric dancers, Mexican artisans",
        "restrictions": "All Ages / Family Friendly",
        "is_sold_out": False,
        "waypoints": [],
        "showings": [
            {"date": "2026-11-02", "start_time": "17:00", "end_time": "18:00", "cost": 0.0}
        ]
    }
]

for nf in new_festivals:
    if nf["festival_name"].lower() not in existing_fest_names:
        festivals.append(nf)
        existing_fest_names.add(nf["festival_name"].lower())
        print(f"[NEW FESTIVAL REGISTERED] {nf['festival_name']}")

with open(FESTIVALS_JSON, "w", encoding="utf-8") as ff:
    json.dump(festivals, ff, indent=2, ensure_ascii=False)

# 5. Synchronize js/data.js
import sys
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from curator_server import sync_js_data_file
sync_js_data_file()
print("[OK] js/data.js fully synchronized with updated catalogs!")
