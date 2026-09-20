import json
import os
import sys
import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
EVENTS_PATH = os.path.join(BASE_DIR, "data", "events.json")
VENUES_PATH = os.path.join(BASE_DIR, "data", "venue_directory.json")
JS_DATA_PATH = os.path.join(BASE_DIR, "js", "data.js")

# Option B Regional Super-Clusters
OPTION_B_NEIGHBORHOODS = [
    "Downtown, Gastown & Yaletown",
    "Mount Pleasant & South Vancouver",
    "Commercial Drive & East Vancouver",
    "Kitsilano, Point Grey & UBC",
    "Granville Island & False Creek",
    "North Shore, Burnaby & Metro"
]

def map_super_cluster(ev_or_venue):
    old_n = ev_or_venue.get('neighborhood', '')
    title_l = ev_or_venue.get('title', '').lower() if 'title' in ev_or_venue else ''
    venue_l = ev_or_venue.get('venue', ev_or_venue.get('name', '')).lower()
    ev_id = ev_or_venue.get('id', ev_or_venue.get('venueId', '')).lower()

    # Granville Island & False Creek
    if ('granville island' in old_n.lower() or 'granville island' in venue_l or 
        'false creek' in title_l or 'false creek' in venue_l or 'science world' in venue_l):
        return 'Granville Island & False Creek'

    # Kitsilano, Point Grey & UBC
    if ('kitsilano' in old_n.lower() or 'ubc' in old_n.lower() or 'ubc' in venue_l or 
        'ubc' in title_l or 'point grey' in old_n.lower() or 'hollywood' in venue_l or 
        'showboat' in title_l or 'wreck beach' in title_l):
        return 'Kitsilano, Point Grey & UBC'

    # Mount Pleasant & South Vancouver
    if ('mount pleasant' in old_n.lower() or 'south vancouver' in old_n.lower() or 
        'cambie' in old_n.lower() or 'queen elizabeth' in venue_l or 'bloedel' in venue_l or 
        'riley park' in title_l or 'nat bailey' in venue_l or 'main street' in old_n.lower() or
        'marpole' in old_n.lower() or 'oakridge' in old_n.lower() or 'fraser' in old_n.lower() or
        'qe-park' in ev_id):
        return 'Mount Pleasant & South Vancouver'

    # Commercial Drive & East Vancouver
    if ('commercial drive' in old_n.lower() or 'east van' in old_n.lower() or 
        'hastings' in old_n.lower() or 'rupert' in venue_l or 'slice of life' in venue_l or 
        'hand eye' in venue_l or 'cafe au clay' in venue_l or 'trout lake' in title_l or 
        'dude chilling' in venue_l or 'rio theatre' in venue_l or 'rio' in old_n.lower() or
        'arts factory' in venue_l or 'cultch' in venue_l):
        return 'Commercial Drive & East Vancouver'

    # North Shore, Burnaby & Metro
    if ('north shore' in old_n.lower() or 'burnaby' in old_n.lower() or 'lynn canyon' in venue_l or 
        'shipyards' in venue_l or 'central park' in venue_l or 'lonsdale' in venue_l):
        return 'North Shore, Burnaby & Metro'

    # Downtown, Gastown & Yaletown (default central core)
    return 'Downtown, Gastown & Yaletown'

# 1. Update data/events.json
with open(EVENTS_PATH, "r", encoding="utf-8") as f:
    events_data = json.load(f)

events = events_data["events"]

# Fringe Shows Reviews and Shrunk Descriptions (Reduced to Fringe: prefix, No membership required)
FRINGE_UPDATES = {
    "fest-vancouver-fringe-festival-waterfront-theatre": {
        "title": "Fringe: Behind The Wall (A Thriller Musical)",
        "price": 18.00,
        "priceLabel": "$18.00 all-in",
        "pricingType": "fixed",
        "description": "A fast-paced psychological thriller musical by Kay Snell & Landon Dueck about an apartment tenant investigating bizarre sounds through the wall.\n\n★ Fringe Reviews: \"Tightly scripted, provocative, and delightful... laugh-out-loud funny and delightfully creepy with powerhouse vocals.\" (reviews.fringetheatre.ca)"
    },
    "fest-vancouver-fringe-festival-the-nest-granville-island": {
        "title": "Fringe: The Light Bringer (Solo Dramedy)",
        "price": 18.00,
        "priceLabel": "$18.00 all-in",
        "pricingType": "fixed",
        "description": "Award-winning one-woman coming-of-age dramedy by Laila Lee recounting her Palestinian-Muslim upbringing in the American South.\n\n★ Fringe Reviews: \"A raw, hilarious, and moving tour de force.\" Golden Lanyard Award Winner & Stir Vancouver Top Festival Pick."
    },
    "fest-vancouver-fringe-festival-performance-works": {
        "title": "Fringe: Las Mujeronas (Flamenco & Storytelling)",
        "price": 18.00,
        "priceLabel": "$18.00 all-in",
        "pricingType": "fixed",
        "description": "A vibrant collective of Latina flamenco artists weaving dance, poetry, live guitar, and powerful stories of immigration and sisterhood.\n\n★ Fringe Reviews: \"Pure magic with electric stage presence... an acoustically gorgeous, must-watch immersive journey.\" (reviews.fringetheatre.ca)"
    },
    "fest-vancouver-fringe-festival-carousel-theatre": {
        "title": "Fringe: Delusions and Grandeur (Cello & Clown)",
        "price": 18.00,
        "priceLabel": "$18.00 all-in",
        "pricingType": "fixed",
        "description": "Karen Hall's sold-out solo clowning and classical cello tour de force exploring vulnerability, ego, and perfectionism.\n\n★ Fringe Reviews: \"Fascinating and brilliantly creative... her comedic timing is as impeccable as her playing.\" (VanCityVince & Stage Raw Best Solo Performance Award)."
    },
    "fest-vancouver-fringe-festival-arts-factory": {
        "title": "Fringe: Daddy Issues (Stand-Up Comedy)",
        "price": 18.00,
        "priceLabel": "$18.00 all-in",
        "pricingType": "fixed",
        "description": "Canadian comedian & author Michaela Chung delivers an unapologetic, hilarious stand-up set on family, dating, and identity in your 30s.\n\n★ Fringe Reviews: \"Hilariously relatable and razor-sharp... blends warm autobiographical storytelling with effortless improv.\" (Vancouver Arts Review)."
    },
    "fest-vancouver-fringe-festival-the-revue-stage": {
        "title": "Fringe: MIA (Digital Mystery & Drama)",
        "price": 18.00,
        "priceLabel": "$18.00 all-in",
        "pricingType": "fixed",
        "description": "An interactive psychological drama about an annual internet puzzle hunt that spirals into obsession and human connection.\n\n★ Fringe Reviews: \"A wonderful discovery with remarkable character chemistry and captivating audio/visual design.\" (reviews.fringetheatre.ca)"
    }
}

COMMON_FRINGE_TIERS = [
    {
        "name": "Single Show Ticket",
        "price": 18.00,
        "label": "$18.00 all-in",
        "description": "$15.00 artist base price + $3.00 ticketing fee (100% of base price directly to artists; no membership required)"
    }
]

MARKET_UPDATES = {
    "trout-lake-farmers-market": {
        "category": "markets",
        "categories": ["markets", "social"],
        "categoryLabel": "Markets",
        "categoryIcon": "🧺"
    },
    "kitsilano-farmers-market": {
        "category": "markets",
        "categories": ["markets", "social"],
        "categoryLabel": "Markets",
        "categoryIcon": "🧺"
    },
    "riley-park-farmers-market": {
        "category": "markets",
        "categories": ["markets", "social"],
        "categoryLabel": "Markets",
        "categoryIcon": "🧺"
    },
    "west-end-farmers-market": {
        "category": "markets",
        "categories": ["markets", "social"],
        "categoryLabel": "Markets",
        "categoryIcon": "🧺"
    },
    "mount-pleasant-farmers-market": {
        "category": "markets",
        "categories": ["markets", "social"],
        "categoryLabel": "Markets",
        "categoryIcon": "🧺"
    },
    "downtown-farmers-market": {
        "category": "markets",
        "categories": ["markets", "social"],
        "categoryLabel": "Markets",
        "categoryIcon": "🧺"
    },
    "false-creek-farmers-market": {
        "category": "markets",
        "categories": ["markets", "social"],
        "categoryLabel": "Markets",
        "categoryIcon": "🧺"
    },
    "ubc-farm-farmers-market": {
        "category": "markets",
        "categories": ["markets", "social"],
        "categoryLabel": "Markets",
        "categoryIcon": "🧺"
    },
    "granville-island-market": {
        "category": "markets",
        "categories": ["markets", "outdoors"],
        "categoryLabel": "Markets",
        "categoryIcon": "🧺"
    },
    "shipyards-live-night": {
        "category": "markets",
        "categories": ["markets", "music"],
        "categoryLabel": "Markets",
        "categoryIcon": "🧺"
    },
    "public-disco-shipyards-stage-takeover": {
        "category": "music",
        "categories": ["music", "markets"],
        "categoryLabel": "Live Music",
        "categoryIcon": "🎵"
    }
}

# Separate non-festival events and merge with the full harvest of active festival events (96 Fringe shows + 4 VIFF)
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from universal_festival_crawler import UniversalFestivalCrawler

non_fest_events = [ev for ev in events if not ev.get("id", "").startswith("fest-")]

PITCH_PUTT_UPDATES = {
    "stanley-pitch-putt": {
        "price": 17.50,
        "priceLabel": "$17.50 door",
        "category": "outdoors",
        "categories": ["outdoors", "social"],
        "categoryLabel": "Outdoors",
        "categoryIcon": "🌲"
    },
    "qe-park-pitch-putt": {
        "price": 17.50,
        "priceLabel": "$17.50 door",
        "category": "outdoors",
        "categories": ["outdoors", "social"],
        "categoryLabel": "Outdoors",
        "categoryIcon": "🌲"
    },
    "rupert-park-pitch-putt": {
        "price": 17.50,
        "priceLabel": "$17.50 door",
        "category": "outdoors",
        "categories": ["outdoors", "social"],
        "categoryLabel": "Outdoors",
        "categoryIcon": "🌲"
    },
    "central-park-pitch-putt": {
        "price": 17.50,
        "priceLabel": "$17.50 door",
        "category": "outdoors",
        "categories": ["outdoors", "social"],
        "categoryLabel": "Outdoors",
        "categoryIcon": "🌲"
    }
}

for ev in non_fest_events:
    ev["neighborhood"] = map_super_cluster(ev)
    if ev["id"] in MARKET_UPDATES:
        m = MARKET_UPDATES[ev["id"]]
        ev["category"] = m["category"]
        ev["categories"] = m["categories"]
        ev["categoryLabel"] = m["categoryLabel"]
        ev["categoryIcon"] = m["categoryIcon"]
    if ev["id"] in PITCH_PUTT_UPDATES:
        pu = PITCH_PUTT_UPDATES[ev["id"]]
        ev["price"] = pu["price"]
        ev["priceLabel"] = pu["priceLabel"]
        ev["category"] = pu["category"]
        ev["categories"] = pu["categories"]
        ev["categoryLabel"] = pu["categoryLabel"]
        ev["categoryIcon"] = pu["categoryIcon"]

fest_events = UniversalFestivalCrawler.harvest_all_active_festival_events(datetime.date(2026, 9, 19))
for fe in fest_events:
    fe["neighborhood"] = map_super_cluster(fe)
    if "fringe" in fe.get("id", ""):
        if not fe.get("confirmedDates"):
            fe["confirmedDates"] = [f"2026-09-{d:02d}" for d in range(10, 21)]
    if fe["id"] in FRINGE_UPDATES:
        fe["title"] = FRINGE_UPDATES[fe["id"]]["title"]
        fe["description"] = FRINGE_UPDATES[fe["id"]]["description"]

all_compiled_events = non_fest_events + fest_events
events = all_compiled_events
events_data["events"] = all_compiled_events
events_data["metadata"]["totalEvents"] = len(all_compiled_events)
events_data["metadata"]["updatedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()

with open(EVENTS_PATH, "w", encoding="utf-8") as f:
    json.dump(events_data, f, indent=2, ensure_ascii=False)

print(f"Updated {len(events)} events in data/events.json ({len(non_fest_events)} core + {len(fest_events)} festival shows).")

# 2. Update data/venue_directory.json
with open(VENUES_PATH, "r", encoding="utf-8") as f:
    venues_data = json.load(f)

for vname, vobj in venues_data["venues"].items():
    vobj["neighborhood"] = map_super_cluster(vobj)

with open(VENUES_PATH, "w", encoding="utf-8") as f:
    json.dump(venues_data, f, indent=2, ensure_ascii=False)

print(f"Updated venue_directory.json neighborhoods.")

# 3. Update js/data.js
# Regenerate js/data.js with new NEIGHBORHOODS
venue_urls = {v["name"]: v["url"] for v in venues_data["venues"].values() if "name" in v and "url" in v}
quarantined_path = os.path.join(BASE_DIR, "data", "manual_review_queue.json")
quarantined = []
if os.path.exists(quarantined_path):
    with open(quarantined_path, "r", encoding="utf-8") as f:
        quarantined = json.load(f)

timestamp = datetime.datetime.now().astimezone().isoformat()

js_content = f"""// Van50 — Vancouver Events & Outings (Strictly <= $50 CAD)
// AUTO-GENERATED from central data/events.json on {timestamp}
// Single Reference Source Architecture • 0 Client-Side Scraping

const VANCOUVER_EVENTS = {json.dumps(events, indent=2, ensure_ascii=False)};
const MANUAL_REVIEW_QUEUE = {json.dumps(quarantined, indent=2, ensure_ascii=False)};

// Regional Super-Clusters (Option B)
const NEIGHBORHOODS = {json.dumps(OPTION_B_NEIGHBORHOODS, indent=2, ensure_ascii=False)};

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
  {{ id: "daily", label: "Daily Spots", icon: "☀️", color: "#f59e0b" }},
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
const VENUE_URLS = {json.dumps(venue_urls, indent=2, ensure_ascii=False)};
"""

with open(JS_DATA_PATH, "w", encoding="utf-8") as f:
    f.write(js_content)

print(f"Updated js/data.js with Option B super-clusters.")
