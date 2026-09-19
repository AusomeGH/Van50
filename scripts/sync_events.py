#!/usr/bin/env python3
"""
Van50 Multi-Source Automated Event Sync Worker & Fee Calculation Engine
Ingests, verifies, and calculates true ALL-IN checkout prices across 18+ ticketing platforms.

ENHANCEMENTS IMPLEMENTED:
1. Organized by Day of the Week (daysOfWeek array).
2. Consolidated Multi-Tier Events (Nat Bailey Stadium: Bleachers & Reserved Box merged with tiers).
3. TransLink transit information retained for navigation, but clean on cards.
4. Internal Ended Events Tracker with ISO timestamps (startIso, endIso).
5. Refined Category Taxonomy (Separated Cinema & Museums/Arts) + Secondary Sub-Tags.
6. Semantic Provider Badging ("Free Public Access", "Walk-in / Table Reservation", "[Platform] Verified").
7. Standardized Price Formatting ("Free ($0)", "$18.00 door", "$12.83 all-in ($10 + $2.83 fees)", "Free entry (~$14 food/drink)", "$18.50 – $24.50 all-in").
8. Sold-Out Watermark support (isSoldOut attribute).
9. Filter/Sort by Starting Time (Early Morning, Afternoon, Early Evening, Late Evening).
"""

import os
import sys
import json
import urllib.request
from datetime import datetime
import re

sys.stdout.reconfigure(encoding='utf-8', line_buffering=True)

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5'
}

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')
JS_DIR = os.path.join(BASE_DIR, 'js')
JSON_PATH = os.path.join(DATA_DIR, 'events.json')
JS_PATH = os.path.join(JS_DIR, 'data.js')
MANUAL_REVIEW_PATH = os.path.join(DATA_DIR, 'manual_review_queue.json')
DISCOVERY_SOURCES_PATH = os.path.join(DATA_DIR, 'discovery_sources.json')

# ==============================================================================
# LIVE PRICING SEARCH ENGINE IMPORT
# ==============================================================================
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pricing_search_engine import EventPricingSearchEngine, load_curator_learned_rules, auto_deny_and_archive_event
from venue_adapters import VenueAdapterRegistry
from dynamic_enricher import DynamicEnricher
from ra_events_adapter import ResidentAdvisorAdapter
from universal_venue_crawler import UniversalVenueCrawler
from universal_festival_crawler import UniversalFestivalCrawler
from universal_link_hunter import is_generic_url, AutonomousDeepLinkHunter



# ==============================================================================
# CURATED SEED CATALOG DEFINITION (ALL 9 ENHANCEMENTS APPLIED)
# ==============================================================================

def get_curated_seed_catalog():
    return [
        {
            "id": "seawall-lost-lagoon",
            "title": "Stanley Park Seawall & Lost Lagoon Walk",
            "venue": "Stanley Park Seawall",
            "address": "Georgia St & Park Dr, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": True,
            "frequency": "daily",
            "frequencyLabel": "Daily Spot",
            "daysOfWeek": ["daily"],
            "timeSlots": ["early-morning", "afternoon", "early-evening"],
            "category": "outdoors",
            "categoryLabel": "Walks & Outdoors",
            "categoryIcon": "🌊",
            "subTags": ["seawall", "ocean-walk", "stanley-park", "sunset"],
            "dateSchedule": "Daily • Open 24/7 (Best at sunset)",
            "startIso": "2026-09-08T06:00:00-07:00",
            "endIso": None,
            "isSoldOut": False,
            "websiteUrl": "https://vancouver.ca/parks-recreation-culture/stanley-park.aspx",
            "coordinates": [49.2988, -123.1384],
            "transitInfo": "#19 bus to Stanley Park or 5 min walk from Denman St",
            "description": "Scenic 9km coastal path offering uninterrupted views of Burrard Inlet, Lions Gate Bridge, and calm freshwater bird watching at Lost Lagoon."
        },
        {
            "id": "lynn-canyon-bridge",
            "title": "Lynn Canyon Suspension Bridge & Twin Falls",
            "venue": "Lynn Canyon Park",
            "address": "3663 Park Rd, North Vancouver",
            "neighborhood": "North Shore / Burnaby",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": True,
            "frequency": "daily",
            "frequencyLabel": "Daily Spot",
            "daysOfWeek": ["daily"],
            "timeSlots": ["early-morning", "afternoon", "early-evening"],
            "category": "outdoors",
            "categoryLabel": "Walks & Outdoors",
            "categoryIcon": "🌲",
            "subTags": ["suspension-bridge", "rainforest", "twin-falls", "free-hike"],
            "dateSchedule": "Daily • 7:00 AM - 7:00 PM",
            "startIso": "2026-09-08T07:00:00-07:00",
            "endIso": None,
            "isSoldOut": False,
            "websiteUrl": "https://ecologycentre.ca",
            "coordinates": [49.3438, -123.0189],
            "transitInfo": "SeaBus to Lonsdale Quay + #228 Lynn Valley bus directly to park gate",
            "description": "Vancouver's 100% free alternative to Capilano. Sway 50 meters above roaring canyon waters, temperate rainforest boardwalks, and emerald swimming holes."
        },
        {
            "id": "granville-island-market",
            "title": "Granville Island Public Market Boardwalk",
            "venue": "Granville Island Public Market",
            "address": "1689 Johnston St, Vancouver",
            "neighborhood": "Granville Island",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": True,
            "frequency": "daily",
            "frequencyLabel": "Daily Spot",
            "daysOfWeek": ["daily"],
            "timeSlots": ["early-morning", "afternoon", "early-evening"],
            "category": "outdoors",
            "categoryLabel": "Walks & Outdoors",
            "categoryIcon": "⛵",
            "subTags": ["public-market", "boardwalk", "buskers", "false-creek"],
            "dateSchedule": "Daily • 9:00 AM - 6:00 PM",
            "startIso": "2026-09-08T09:00:00-07:00",
            "endIso": None,
            "isSoldOut": False,
            "websiteUrl": "https://granvilleisland.com/public-market",
            "coordinates": [49.2718, -123.1342],
            "transitInfo": "#50 False Creek bus or False Creek Aquabus ferry docks",
            "description": "Explore bustling artisan food halls, timber marinas, busking circles, and panoramic False Creek waterfront views. Completely free to walk."
        },
        {
            "id": "kitsilano-showboat",
            "title": "Kitsilano Showboat: Community Summer Stage",
            "artist": "Local bands & community ensembles",
            "venue": "Kitsilano Beach Outdoor Amphitheatre",
            "address": "2300 Cornwall Ave, Vancouver",
            "neighborhood": "Kitsilano",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Mon, Wed, Fri)",
            "daysOfWeek": ["mon", "wed", "fri"],
            "timeSlots": ["early-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["outdoor-theatre", "community-concert", "kits-beach", "live-music"],
            "dateSchedule": "Mon, Wed & Fri Evenings • 7:00 PM - 9:00 PM",
            "startIso": "2026-09-09T19:00:00-07:00",
            "endIso": "2026-09-30T21:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://kitsilanoshowboat.com/",
            "coordinates": [49.2742, -123.1558],
            "transitInfo": "#2 Burrard or #4 / #7 bus from Downtown Vancouver",
            "description": "Since 1935, this beloved open-air outdoor stage overlooking English Bay and the North Shore mountains hosts free community concerts, jazz, and folk."
        },
        {
            "id": "vpl-central-rooftop",
            "title": "Vancouver Public Library Central Rooftop Garden",
            "venue": "VPL Central Library (Level 9)",
            "address": "350 W Georgia St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": True,
            "frequency": "daily",
            "frequencyLabel": "Daily Spot",
            "daysOfWeek": ["daily"],
            "timeSlots": ["early-morning", "afternoon", "early-evening"],
            "category": "arts",
            "categoryLabel": "Museums & Visual Arts",
            "categoryIcon": "🏛️",
            "subTags": ["architecture", "rooftop-terrace", "quiet-spot", "city-views"],
            "dateSchedule": "Monday - Sunday • 10:00 AM - 6:00 PM",
            "startIso": "2026-09-08T10:00:00-07:00",
            "endIso": None,
            "isSoldOut": False,
            "websiteUrl": "https://www.vpl.ca/branches/central/level-9/roofgarden",
            "coordinates": [49.2801, -123.1154],
            "transitInfo": "3 min walk from Vancouver City Centre SkyTrain",
            "description": "Architectural Roman Colosseum-inspired central library featuring the free public Phillips, Hager and North Garden rooftop terrace on Level 9 with city skyline and mountain views."
        },
        {
            "id": "sun-yat-sen-park",
            "title": "Dr. Sun Yat-Sen Public Chinese Garden Park",
            "venue": "Dr. Sun Yat-Sen Public Courtyard",
            "address": "578 Carrall St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": True,
            "frequency": "daily",
            "frequencyLabel": "Daily Spot",
            "daysOfWeek": ["daily"],
            "timeSlots": ["early-morning", "afternoon"],
            "category": "arts",
            "categoryLabel": "Museums & Visual Arts",
            "categoryIcon": "🏮",
            "subTags": ["ming-dynasty", "heritage-courtyard", "koi-pond", "chinatown"],
            "dateSchedule": "Daily • 9:30 AM - 4:30 PM",
            "startIso": "2026-09-08T09:30:00-07:00",
            "endIso": None,
            "isSoldOut": False,
            "websiteUrl": "https://vancouverchinesegarden.com/visit/",
            "coordinates": [49.2798, -123.1040],
            "transitInfo": "5 min walk from Stadium-Chinatown SkyTrain",
            "description": "The outer Ming Dynasty-style courtyard is completely free to enter, featuring stone pathways, jade ponds, weeping willows, and classical pavilion architecture."
        },
        {
            "id": "ubc-rose-garden",
            "title": "UBC Rose Garden & Wreck Beach Trail",
            "venue": "UBC Rose Garden & Trail 6",
            "address": "6301 NW Marine Dr, Vancouver",
            "neighborhood": "Kitsilano",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": True,
            "frequency": "daily",
            "frequencyLabel": "Daily Spot",
            "daysOfWeek": ["daily"],
            "timeSlots": ["early-morning", "afternoon", "early-evening"],
            "category": "outdoors",
            "categoryLabel": "Walks & Outdoors",
            "categoryIcon": "🌹",
            "subTags": ["rose-garden", "ocean-view", "ubc", "coastal-trail"],
            "dateSchedule": "Daily • Daylight hours (Best June - September)",
            "startIso": "2026-09-08T08:00:00-07:00",
            "endIso": None,
            "isSoldOut": False,
            "websiteUrl": "https://visit.ubc.ca/see-and-do/gardens-and-nature/ubc-rose-garden/",
            "coordinates": [49.2694, -123.2562],
            "transitInfo": "R4 RapidBus or Broadway Rapid Transit directly to UBC Bus Exchange",
            "description": "Iconic cliffside rose garden on Crescent Road overlooking Howe Sound and the snow-capped Coast Mountains, connecting to the scenic wooden stairway of Trail 6 down to Wreck Beach. 100% free public admission."
        },
        {
            "id": "queen-elizabeth-quarry",
            "title": "Queen Elizabeth Park Quarry Gardens & Viewpoint",
            "venue": "Queen Elizabeth Park",
            "address": "4600 Cambie St, Vancouver",
            "neighborhood": "Mount Pleasant",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": True,
            "frequency": "daily",
            "frequencyLabel": "Daily Spot",
            "daysOfWeek": ["daily"],
            "timeSlots": ["early-morning", "afternoon", "early-evening"],
            "category": "outdoors",
            "categoryLabel": "Walks & Outdoors",
            "categoryIcon": "🌺",
            "subTags": ["quarry-garden", "panoramic-view", "cambie-corridor", "city-view"],
            "dateSchedule": "Daily • 6:00 AM - 10:00 PM",
            "startIso": "2026-09-08T06:00:00-07:00",
            "endIso": None,
            "isSoldOut": False,
            "websiteUrl": "https://vancouver.ca/parks-recreation-culture/queen-elizabeth-park.aspx",
            "coordinates": [49.2417, -123.1126],
            "transitInfo": "10 min walk from King Edward Canada Line station",
            "description": "Highest point in the City of Vancouver (152m above sea level) featuring dramatic sunken quarry gardens, manicured perennial flowers, footbridges, and panoramic skyline vistas. Completely free public park."
        },
        {
            "id": "lmg-open-mic",
            "title": "Little Mountain Gallery: First Come First Serve Stand-Up Open Mic",
            "venue": "Little Mountain Gallery",
            "address": "110 Water St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 5.0,
            "showpassSlug": "first-come-first-serve-open-mic-2",
            "provider": "Showpass",
            "semanticProvider": "Showpass Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Fridays)",
            "daysOfWeek": ["fri"],
            "timeSlots": ["early-evening"],
            "category": "shows",
            "categoryLabel": "Comedy & Shows",
            "categoryIcon": "🎭",
            "subTags": ["stand-up", "comedy", "open-mic", "gastown"],
            "dateSchedule": "Fridays • 7:30 PM (Doors 7:00 PM)",
            "startIso": "2026-09-11T19:30:00-07:00",
            "endIso": "2026-12-31T21:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.showpass.com/first-come-first-serve-open-mic-2/",
            "coordinates": [49.2838, -123.1072],
            "transitInfo": "4 min walk from Waterfront SkyTrain station",
            "description": "Vancouver's premier comedy incubator in Gastown. Fast-paced open mic showcasing local pros testing fresh material alongside up-and-coming talent."
        },
        {
            "id": "bloedel-conservatory-dome",
            "title": "Bloedel Conservatory: Tropical Rainforest Dome",
            "venue": "Bloedel Conservatory",
            "address": "4600 Cambie St, Vancouver",
            "neighborhood": "Mount Pleasant",
            "basePrice": 7.90,
            "showpassSlug": "bloedel-conservatory",
            "provider": "Showpass",
            "semanticProvider": "Showpass Verified",
            "pricingType": "platform",
            "isDaily": True,
            "frequency": "daily",
            "frequencyLabel": "Daily Spot",
            "daysOfWeek": ["daily"],
            "timeSlots": ["early-morning", "afternoon"],
            "category": "arts",
            "categoryLabel": "Museums & Visual Arts",
            "categoryIcon": "🦜",
            "subTags": ["tropical-dome", "rainforest", "exotic-birds", "botanical"],
            "dateSchedule": "Daily • 10:00 AM - 5:00 PM",
            "startIso": "2026-09-08T10:00:00-07:00",
            "endIso": None,
            "isSoldOut": False,
            "websiteUrl": "https://www.showpass.com/o/bloedel-conservatory/",
            "coordinates": [49.2423, -123.1144],
            "transitInfo": "12 min walk from King Edward Canada Line station",
            "description": "Lush domed tropical paradise atop Queen Elizabeth Park containing over 500 exotic plants and flowers and more than 100 free-flying tropical birds."
        },
        {
            "id": "lmg-improv-jam",
            "title": "Little Mountain Gallery: Improv Jam Show (Open Stage)",
            "venue": "Little Mountain Gallery",
            "address": "110 Water St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 7.0,
            "showpassSlug": "improv-jam-show-103",
            "provider": "Showpass",
            "semanticProvider": "Showpass Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Tuesdays)",
            "daysOfWeek": ["tue"],
            "timeSlots": ["early-evening", "late-evening"],
            "category": "shows",
            "categoryLabel": "Comedy & Shows",
            "categoryIcon": "🎭",
            "subTags": ["improv", "comedy", "jam-session", "open-stage"],
            "dateSchedule": "Tuesdays • 8:30 PM",
            "startIso": "2026-09-08T20:30:00-07:00",
            "endIso": "2026-12-31T22:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.showpass.com/improv-jam-show-103/",
            "coordinates": [49.2838, -123.1072],
            "transitInfo": "4 min walk from Waterfront SkyTrain / SeaBus",
            "description": "A welcoming, raucous weekly improv jam where performers of all skill levels team up for spontaneous scenes and games in Gastown."
        },
        {
            "id": "ubc-thunderbirds-varsity",
            "title": "UBC Thunderbirds: Home Varsity Games",
            "venue": "War Memorial Gym & Thunderbird Stadium",
            "address": "6081 University Blvd, Vancouver",
            "neighborhood": "Kitsilano",
            "basePrice": 10.0,
            "fee": 1.75,
            "provider": "Paciolan",
            "semanticProvider": "Paciolan Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Game Days)",
            "daysOfWeek": ["fri", "sat"],
            "timeSlots": ["early-evening"],
            "category": "activities",
            "categoryLabel": "Games & Activities",
            "categoryIcon": "🦅",
            "subTags": ["varsity-sports", "basketball", "volleyball", "ubc-athletics"],
            "dateSchedule": "Friday & Saturday Evenings • 6:00 PM & 8:00 PM",
            "startIso": "2026-09-11T18:00:00-07:00",
            "endIso": "2027-03-31T22:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://gothunderbirds.ca/sports/2021/9/14/ticketing-details-2025-26.aspx",
            "coordinates": [49.2662, -123.2483],
            "transitInfo": "R4 41st Ave RapidBus or Broadway Rapid Transit to UBC Loop",
            "description": "High-octane U SPORTS national championship varsity basketball, volleyball, and football matches on the UBC Point Grey campus."
        },
        {
            "id": "eb-standup-mental-health",
            "title": "Stand Up For Mental Health Showcase",
            "venue": "Chill x Studio",
            "address": "1227 Richards St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 10.0,
            "provider": "Eventbrite",
            "semanticProvider": "Eventbrite Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "one-off",
            "frequencyLabel": "One-Off Show (Sept 22)",
            "daysOfWeek": ["tue"],
            "timeSlots": ["early-evening"],
            "category": "shows",
            "categoryLabel": "Comedy & Shows",
            "categoryIcon": "🎭",
            "subTags": ["stand-up", "mental-health", "community-comedy", "yaletown"],
            "dateSchedule": "Tuesday, Sept 22 • 7:30 PM",
            "startIso": "2026-09-22T19:30:00-07:00",
            "endIso": "2026-09-22T21:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.eventbrite.ca/e/stand-up-for-mental-health-summer-class-debut-tickets-1995574104867",
            "coordinates": [49.2748, -123.1265],
            "transitInfo": "3 min walk from Yaletown-Roundhouse Canada Line",
            "description": "Hilarious and heartwarming live stand-up showcase founded by comic David Granirer, turning mental health challenges into comedy gold."
        },
        {
            "id": "lmg-wed-open-mic",
            "title": "Little Mountain Gallery: Wednesday Stand-Up Open Mic",
            "venue": "Little Mountain Gallery",
            "address": "110 Water St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 10.0,
            "showpassSlug": "open-mic-116",
            "provider": "Showpass",
            "semanticProvider": "Showpass Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Wednesdays)",
            "daysOfWeek": ["wed"],
            "timeSlots": ["early-evening"],
            "category": "shows",
            "categoryLabel": "Comedy & Shows",
            "categoryIcon": "🎭",
            "subTags": ["stand-up", "comedy-lab", "open-mic", "gastown"],
            "dateSchedule": "Wednesdays • 7:30 PM",
            "startIso": "2026-09-09T19:30:00-07:00",
            "endIso": "2026-12-31T21:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.showpass.com/open-mic-116/",
            "coordinates": [49.2838, -123.1072],
            "transitInfo": "4 min walk from Waterfront SkyTrain",
            "description": "Midweek comedy laboratory where seasoned Vancouver touring comics and brave newcomers hone their tight five before weekend tours."
        },
        {
            "id": "viff-centre-matinee",
            "title": "VIFF Centre: Essential Indie Cinema & Matinee",
            "venue": "VIFF Centre (Seymour Atrium)",
            "address": "1181 Seymour St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 15.0,
            "fee": 1.50,
            "provider": "Agile Ticketing",
            "semanticProvider": "Agile Ticketing Verified",
            "pricingType": "platform",
            "tiers": [
                {"name": "General Admission (Adult)", "basePrice": 15.0, "price": 16.50, "label": "$16.50 all-in"},
                {"name": "Senior (65+)", "basePrice": 13.0, "price": 14.50, "label": "$14.50 all-in"},
                {"name": "Student / Youth", "basePrice": 12.0, "price": 13.50, "label": "$13.50 all-in"}
            ],
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Daily Slots)",
            "daysOfWeek": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
            "timeSlots": ["afternoon"],
            "category": "cinema",
            "categoryLabel": "Cinema",
            "categoryIcon": "🎬",
            "subTags": ["indie-film", "international-cinema", "viff", "matinee"],
            "dateSchedule": "Weekday & Weekend Matinees • 1:30 PM & 4:00 PM",
            "startIso": "2026-09-08T13:30:00-07:00",
            "endIso": "2026-12-31T18:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://viff.org/whats-on/a-sad-and-beautiful-world/#book",
            "coordinates": [49.2774, -123.1251],
            "transitInfo": "4 min walk from Yaletown-Roundhouse Canada Line",
            "description": "State-of-the-art non-profit cinema operated by the Vancouver International Film Festival showing international award-winners and Canadian indies."
        },
        {
            "id": "cinematheque-matinee",
            "title": "The Cinematheque: Art House & Essential Cinema",
            "venue": "The Cinematheque",
            "address": "1131 Howe St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 15.0,
            "fee": 0.0,
            "provider": "Agile Ticketing",
            "semanticProvider": "Agile Ticketing Verified",
            "pricingType": "platform",
            "tiers": [
                {"name": "General Admission (18+)", "basePrice": 15.0, "price": 15.0, "label": "$15.00 all-in"},
                {"name": "Senior (65+)", "basePrice": 13.0, "price": 13.0, "label": "$13.00 all-in"},
                {"name": "Student / Youth", "basePrice": 11.0, "price": 11.0, "label": "$11.00 all-in"}
            ],
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Wednesday – Monday",
            "daysOfWeek": ["mon", "wed", "thu", "fri", "sat", "sun"],
            "timeSlots": ["afternoon", "early-evening", "late-evening"],
            "category": "cinema",
            "categoryLabel": "Cinema",
            "categoryIcon": "🎬",
            "subTags": ["35mm", "film-history", "restored-classics", "auteur-cinema"],
            "dateSchedule": "Wednesday – Monday • 6:30 PM & 7:00 PM (Plus Weekend Matinees)",
            "startIso": "2026-09-09T18:30:00-07:00",
            "endIso": "2026-12-31T23:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://thecinematheque.ca/films/calendar",
            "coordinates": [49.2795, -123.1274],
            "transitInfo": "5 min walk from Vancouver City Centre SkyTrain",
            "description": "Vancouver's home for essential cinema, international film retrospectives, restored 35mm classics, and auteur independent cinema in Downtown. Screenings run Wednesday through Monday evenings with select weekend matinees."
        },
        {
            "id": "portside-pub-trivia",
            "title": "The Portside Pub: Gastown Brainstormer Trivia",
            "venue": "The Portside Pub",
            "address": "7 Alexander St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 0.0,
            "minimumSpend": 14.50,
            "provider": "OpenTable / Resy",
            "semanticProvider": "Walk-in / Table Reservation",
            "pricingType": "food-drink",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Tuesdays)",
            "daysOfWeek": ["tue"],
            "timeSlots": ["early-evening"],
            "category": "trivia",
            "categoryLabel": "Drinks & Trivia",
            "categoryIcon": "🧠",
            "subTags": ["pub-trivia", "craft-beer", "gastown-pub", "trivia-night"],
            "dateSchedule": "Tuesdays • 7:30 PM (Teams of 1-6)",
            "startIso": "2026-09-08T19:30:00-07:00",
            "endIso": "2026-12-31T22:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://theportsidepub.com/bookings/",
            "coordinates": [49.2842, -123.1042],
            "transitInfo": "4 min walk from Waterfront SkyTrain Station",
            "description": "East Coast-inspired multi-level Gastown pub hosting legendary weekly trivia with craft beer specials, brewery prizes, and zero entry fee."
        },
        {
            "id": "rio-late-night-cinema",
            "title": "Found Footage Fest: Live at The Rio Theatre",
            "venue": "The Rio Theatre",
            "address": "1660 E Broadway, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 32.00,
            "fee": 4.00,
            "provider": "Igniter Tickets",
            "semanticProvider": "Igniter Tickets Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "one-off",
            "frequencyLabel": "Special Event (Sept 9)",
            "daysOfWeek": ["wed"],
            "timeSlots": ["early-evening"],
            "category": "cinema",
            "categoryLabel": "Cinema",
            "categoryIcon": "🍿",
            "subTags": ["vhs-gems", "live-comedy", "indie-theatre", "cult-cinema"],
            "dateSchedule": "Wednesday, Sept 9 • 7:30 PM (Doors 7:00 PM)",
            "startIso": "2026-09-09T19:30:00-07:00",
            "endIso": "2026-09-09T22:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://riotheatretickets.ca/events/42273-found-footage-fest-porcelain-vhs-treasures",
            "coordinates": [49.2627, -123.0699],
            "transitInfo": "Steps from Commercial-Broadway SkyTrain Interchange",
            "description": "Commercial Drive's beloved independent cinema hosts the hilarious Found Footage Fest, showcasing rare VHS oddities, thrift store gems, and live commentary."
        },
        {
            "id": "fox-cabaret-indie-cinema",
            "title": "Double InDUMBnity: Screening at The Fox Cabaret",
            "venue": "The Fox Cabaret",
            "address": "2321 Main St, Vancouver",
            "neighborhood": "Mount Pleasant",
            "basePrice": 39.00,
            "provider": "Eventbrite",
            "semanticProvider": "Eventbrite Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "one-off",
            "frequencyLabel": "Screening (Sept 18)",
            "daysOfWeek": ["fri"],
            "timeSlots": ["early-evening"],
            "category": "cinema",
            "categoryLabel": "Cinema",
            "categoryIcon": "🎬",
            "subTags": ["indie-film", "comedy-screening", "projection-room", "fox-cabaret"],
            "dateSchedule": "Friday, Sept 18 • 7:00 PM (Doors 6:30 PM)",
            "startIso": "2026-09-18T19:00:00-07:00",
            "endIso": "2026-09-18T21:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.eventbrite.com/e/double-indumbnity-john-jonah-at-fox-cabaret-vancouver-tickets-1998392844794",
            "coordinates": [49.2638, -123.1012],
            "transitInfo": "Main & 7th Ave bus stop • 10 min walk from SkyTrain",
            "description": "Intimate indie comedy film screening in the restored vintage projection room upstairs at Mount Pleasant's historic Fox Cabaret."
        },
        {
            "id": "biltmore-cabaret-indie-music",
            "title": "Mama's Broke Live at The Biltmore",
            "artist": "Mama's Broke",
            "venue": "The Biltmore Cabaret",
            "address": "2755 Prince Edward St, Vancouver",
            "neighborhood": "Mount Pleasant",
            "basePrice": 11.00,
            "fee": 0.00,
            "provider": "AdmitOne",
            "semanticProvider": "AdmitOne Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "one-off",
            "frequencyLabel": "Live Concert (Oct 17)",
            "daysOfWeek": ["sat"],
            "timeSlots": ["early-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["indie-folk", "live-band", "biltmore", "concert"],
            "dateSchedule": "Saturday, Oct 17 • 7:00 PM (Doors)",
            "startIso": "2026-10-17T19:00:00-07:00",
            "endIso": "2026-10-17T23:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://admitone.com/events/mamas-broke-vancouver-169979",
            "coordinates": [49.2602, -123.0975],
            "transitInfo": "Main & 12th Ave bus corridor",
            "description": "Mount Pleasant's heritage indie concert lounge hosting folk duo Mama's Broke live with support, ticketed via AdmitOne."
        },
        {
            "id": "lmg-happy-hour-comedy",
            "title": "Little Mountain Gallery: Happy Hour Comedy Showcase",
            "venue": "Little Mountain Gallery",
            "address": "110 Water St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 15.00,
            "showpassSlug": "happy-hour-comedy-8",
            "provider": "Showpass",
            "semanticProvider": "Showpass Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Wednesdays)",
            "daysOfWeek": ["wed"],
            "timeSlots": ["early-evening"],
            "category": "shows",
            "categoryLabel": "Comedy & Shows",
            "categoryIcon": "🎭",
            "subTags": ["happy-hour", "stand-up", "comedy", "gastown"],
            "dateSchedule": "Wednesdays • 7:30 PM",
            "startIso": "2026-09-23T19:30:00-07:00",
            "endIso": "2026-12-31T21:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.showpass.com/happy-hour-comedy-8/",
            "coordinates": [49.2838, -123.1072],
            "transitInfo": "4 min walk from Waterfront Station",
            "description": "Early evening stand-up comedy showcase featuring top local Vancouver comics, drink specials, and high energy to kick off the night."
        },
        {
            "id": "lmg-seasoned-improv",
            "title": "Little Mountain Gallery: Seasoned All-Star Improv",
            "venue": "Little Mountain Gallery",
            "address": "110 Water St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 15.00,
            "showpassSlug": "seasoned-improv-comedy-29",
            "provider": "Showpass",
            "semanticProvider": "Showpass Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "monthly",
            "frequencyLabel": "Monthly (Nov 6)",
            "daysOfWeek": ["fri"],
            "timeSlots": ["early-evening"],
            "category": "shows",
            "categoryLabel": "Comedy & Shows",
            "categoryIcon": "🎭",
            "subTags": ["improv", "canadian-comedy-awards", "narrative-improv"],
            "dateSchedule": "Friday, Nov 6 • 7:30 PM (Monthly Series)",
            "startIso": "2026-11-06T19:30:00-07:00",
            "endIso": "2026-11-06T21:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.showpass.com/seasoned-improv-comedy-29/",
            "coordinates": [49.2838, -123.1072],
            "transitInfo": "Waterfront Station corridor",
            "description": "Veteran Vancouver improvisers and Canadian Comedy Award winners deliver lightning-fast spontaneous narrative comedy."
        },
        {
            "id": "lmg-decolonized-comedy",
            "title": "Who Wants to Be Decolonized? Comedy Showcase",
            "venue": "Little Mountain Gallery",
            "address": "110 Water St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 15.00,
            "showpassSlug": "who-wants-to-be-decolonized-5",
            "provider": "Showpass",
            "semanticProvider": "Showpass Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "monthly",
            "frequencyLabel": "Monthly (Sept 9)",
            "daysOfWeek": ["wed"],
            "timeSlots": ["early-evening"],
            "category": "shows",
            "categoryLabel": "Comedy & Shows",
            "categoryIcon": "🎭",
            "subTags": ["bipoc-comedy", "game-show", "satire", "stand-up"],
            "dateSchedule": "Wednesday, Sept 9 • 8:00 PM (Monthly Showcase)",
            "startIso": "2026-09-09T20:00:00-07:00",
            "endIso": "2026-09-09T22:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.showpass.com/who-wants-to-be-decolonized-5/",
            "coordinates": [49.2838, -123.1072],
            "transitInfo": "Gastown Water St corridor",
            "description": "A sharp, hilarious, and thought-provoking game-show style comedy panel confronting Canadian history and culture with BIPOC headliners."
        },
        {
            "id": "lmg-crowd-source",
            "title": "Little Mountain Gallery: Crowd Source Comedy",
            "venue": "Little Mountain Gallery",
            "address": "110 Water St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 15.00,
            "showpassSlug": "crowd-source-comedy-26",
            "provider": "Showpass",
            "semanticProvider": "Showpass Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "monthly",
            "frequencyLabel": "Monthly (Oct 3)",
            "daysOfWeek": ["sat"],
            "timeSlots": ["late-evening"],
            "category": "shows",
            "categoryLabel": "Comedy & Shows",
            "categoryIcon": "🎭",
            "subTags": ["interactive-comedy", "improv", "crowd-prompts", "late-show"],
            "dateSchedule": "Saturday, Oct 3 • 9:30 PM (Monthly Series)",
            "startIso": "2026-10-03T21:30:00-07:00",
            "endIso": "2026-10-03T23:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.showpass.com/crowd-source-comedy-26/",
            "coordinates": [49.2838, -123.1072],
            "transitInfo": "Gastown Water St corridor",
            "description": "High-wire interactive comedy show where audience text submissions, wild confessions, and internet rabbit holes become instant scene prompts."
        },
        # ======================================================================
        # CONSOLIDATED MULTI-TIER NAT BAILEY BASEBALL EVENT (Requirement 2)
        # ======================================================================
        {
            "id": "tm-canadians-baseball",
            "title": "Vancouver Canadians: Nat Bailey Stadium Baseball",
            "venue": "Scotiabank Field at Nat Bailey Stadium",
            "address": "4601 Ontario St, Vancouver",
            "neighborhood": "Mount Pleasant",
            "basePrice": 16.00,
            "facilityFee": 2.50,
            "provider": "Ticketmaster",
            "semanticProvider": "Ticketmaster Verified",
            "pricingType": "multi-tier",
            "tiers": [
                { "name": "Bleachers", "basePrice": 16.00, "price": 18.50, "label": "$18.50 all-in" },
                { "name": "Reserved Grandstand Box", "basePrice": 21.00, "price": 24.50, "label": "$24.50 all-in" }
            ],
            "isDaily": False,
            "frequency": "seasonal",
            "frequencyLabel": "Seasonal (Game Days)",
            "daysOfWeek": ["fri", "sat", "sun"],
            "timeSlots": ["afternoon", "early-evening"],
            "category": "activities",
            "categoryLabel": "Games & Activities",
            "categoryIcon": "⚾",
            "subTags": ["baseball", "milb", "blue-jays", "nat-bailey", "sushi-race"],
            "dateSchedule": "Game Days • Afternoon (1:05 PM) & Evening (7:05 PM) Matches",
            "startIso": "2026-09-11T13:05:00-07:00",
            "endIso": "2026-09-20T22:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.milb.com/vancouver/tickets/single-game-tickets",
            "coordinates": [49.2428, -123.1098],
            "transitInfo": "#3 Main Bus or 12 min walk from King Edward Canada Line",
            "description": "High-A Toronto Blue Jays affiliate baseball in historic Nat Bailey Stadium beside Queen Elizabeth Park, complete with the famous sushi mascot races. Choose between scenic open bleachers or covered grandstand box seats."
        },
        {
            "id": "fox-cabaret-dance-night",
            "title": "The Fox Cabaret: 90s Retro Dance Night",
            "venue": "The Fox Cabaret",
            "address": "2321 Main St, Vancouver",
            "neighborhood": "Mount Pleasant",
            "basePrice": 15.00,
            "provider": "Eventbrite",
            "semanticProvider": "Eventbrite Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Saturdays)",
            "daysOfWeek": ["sat"],
            "timeSlots": ["late-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["dance-party", "90s-music", "dj-night", "mount-pleasant"],
            "dateSchedule": "Saturdays • 10:30 PM - 2:00 AM",
            "startIso": "2026-09-12T22:30:00-07:00",
            "endIso": "2026-12-31T02:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.eventbrite.com/e/ultimate-90s-night-tickets-1996660198402",
            "coordinates": [49.2638, -123.1012],
            "transitInfo": "Main St & 7th Ave bus stop",
            "description": "Vancouver's most iconic retro dance party in Mount Pleasant. Resident DJs spin new wave, post-punk, synthpop, and 90s hip hop classics. Tickets verified via Eventbrite."
        },
        {
            "id": "eb-puff-magic-improv",
            "title": "Puff the Magic Improv Show (Revue Stage)",
            "venue": "Revue Stage Granville Island",
            "address": "1601 Johnston St, Vancouver",
            "neighborhood": "Granville Island",
            "basePrice": 25.00,
            "provider": "Eventbrite",
            "semanticProvider": "Eventbrite Verified",
            "pricingType": "platform",
            "tiers": [
                {"name": "General Admission", "basePrice": 25.0, "price": 25.0, "label": "$25.00 all-in"},
                {"name": "Early Bird / Student", "basePrice": 20.0, "price": 20.0, "label": "$20.00 all-in"}
            ],
            "isDaily": False,
            "frequency": "one-off",
            "frequencyLabel": "Live Show (Sept 26)",
            "daysOfWeek": ["sat"],
            "timeSlots": ["early-evening"],
            "category": "shows",
            "categoryLabel": "Comedy & Shows",
            "categoryIcon": "🎭",
            "subTags": ["improv", "revue-stage", "granville-island", "live-comedy"],
            "dateSchedule": "Saturday, Sept 26 • 8:00 PM (Doors 7:30 PM)",
            "startIso": "2026-09-26T20:00:00-07:00",
            "endIso": "2026-09-26T22:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.eventbrite.ca/e/puff-the-magic-improv-show-sept-26-2026-tickets-1990456461859",
            "coordinates": [49.2711, -123.1332],
            "transitInfo": "#50 False Creek bus or Aquabus ferry dock",
            "description": "High-octane spontaneous improv comedy featuring veteran Vancouver performers on Granville Island's waterfront Revue Stage."
        },
        {
            "id": "tightrope-impro-showcase",
            "title": "Vancouver's Next Top Improviser at Tightrope Impro",
            "venue": "Tightrope Impro Theatre",
            "address": "1330 Napier St, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 25.00,
            "provider": "Eventbrite",
            "semanticProvider": "Eventbrite Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Thursdays)",
            "daysOfWeek": ["thu"],
            "timeSlots": ["early-evening"],
            "category": "shows",
            "categoryLabel": "Comedy & Shows",
            "categoryIcon": "🎭",
            "subTags": ["improviser", "theatresports", "tournament", "commercial-drive"],
            "dateSchedule": "Thursdays • 8:00 PM",
            "startIso": "2026-09-10T20:00:00-07:00",
            "endIso": "2026-12-31T22:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.eventbrite.ca/e/vancouvers-next-top-improvisor-tickets-1636427351259",
            "coordinates": [49.2748, -123.0768],
            "transitInfo": "Commercial & Venables bus stop",
            "description": "Vancouver's premier competitive improv tournament showcasing top talent at Commercial Drive's intimate storefront theatre, verified live on Eventbrite."
        },
        {
            "id": "eb-alistair-ogden-rio",
            "title": "Alistair Ogden Live at The Rio Theatre",
            "venue": "The Rio Theatre",
            "address": "1660 E Broadway, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 35.00,
            "provider": "Eventbrite",
            "semanticProvider": "Eventbrite Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "one-off",
            "frequencyLabel": "One-Off Show (Dec 4)",
            "daysOfWeek": ["fri"],
            "timeSlots": ["early-evening"],
            "category": "shows",
            "categoryLabel": "Comedy & Shows",
            "categoryIcon": "🎭",
            "subTags": ["stand-up", "cbc-comedy", "headliner", "rio-theatre"],
            "dateSchedule": "Friday, Dec 4 • 7:30 PM (Doors 6:30 PM)",
            "startIso": "2026-12-04T19:30:00-07:00",
            "endIso": "2026-12-04T22:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.eventbrite.ca/e/alistair-ogden-live-at-the-rio-theatre-tickets-1987403826344",
            "coordinates": [49.2627, -123.0699],
            "transitInfo": "Steps from Commercial-Broadway SkyTrain",
            "description": "Award-winning stand-up comedian Alistair Ogden (CBC Comedy, Just For Laughs) headlines an evening of high-energy comedy at The Rio Theatre."
        },
        {
            "id": "the-improv-centre-weekend",
            "title": "The Improv Centre: Granville Island Weekend Showcase",
            "venue": "The Improv Centre",
            "address": "1502 Duranleau St, Vancouver",
            "neighborhood": "Granville Island",
            "basePrice": 30.00,
            "fee": 3.50,
            "provider": "AudienceView",
            "semanticProvider": "AudienceView Verified",
            "pricingType": "platform",
            "tiers": [
                { "name": "Regular Theatre Seat", "basePrice": 33.50, "price": 33.50, "label": "$33.50 all-in" },
                { "name": "Student / Senior Theatre Seat", "basePrice": 28.50, "price": 28.50, "label": "$28.50 all-in" }
            ],
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Fri & Sat)",
            "daysOfWeek": ["fri", "sat"],
            "timeSlots": ["early-evening", "late-evening"],
            "category": "shows",
            "categoryLabel": "Comedy & Shows",
            "categoryIcon": "🎭",
            "subTags": ["theatresports", "waterfront-theatre", "granville-island", "improv"],
            "dateSchedule": "Fridays & Saturdays • 7:30 PM & 9:30 PM",
            "startIso": "2026-09-11T19:30:00-07:00",
            "endIso": "2026-12-31T23:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://theimprovcentre.ca/shows/",
            "coordinates": [49.2706, -123.1363],
            "transitInfo": "#50 False Creek Bus or Aquabus ferry dock",
            "description": "Vancouver's premier waterfront theatre dedicated entirely to spontaneous comedy on Granville Island since 1980."
        },
        # ======================================================================
        # SOLD-OUT WATERMARK DEMONSTRATION SHOW (Requirement 8)
        # ======================================================================
        {
            "id": "rickshaw-indie-rock",
            "title": "Metal Church & Armored Saint Live at Rickshaw",
            "artist": "Metal Church, Armored Saint, Livekill",
            "venue": "The Rickshaw Theatre",
            "address": "254 E Hastings St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 35.00,
            "provider": "Eventbrite",
            "semanticProvider": "Eventbrite Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "one-off",
            "frequencyLabel": "One-Off Show (Nov 15)",
            "daysOfWeek": ["sun"],
            "timeSlots": ["early-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["heavy-metal", "rickshaw", "live-concert", "headliner"],
            "dateSchedule": "Sunday, Nov 15 • 6:00 PM (Doors)",
            "startIso": "2026-11-15T18:00:00-07:00",
            "endIso": "2026-11-15T23:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.eventbrite.ca/e/metal-church-and-armored-saint-with-livekill-tickets-1990053810518",
            "coordinates": [49.2813, -123.0984],
            "transitInfo": "5 min walk from Main & Hastings bus hub",
            "description": "Legendary converted East Hastings music hall hosts heavy metal icons Metal Church and Armored Saint on their co-headlining tour with LiveKill."
        },
        {
            "id": "science-world-after-dark",
            "title": "Science World After Dark: 19+ Adult Night",
            "venue": "Science World at TELUS World of Science",
            "address": "1455 Quebec St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 39.50,
            "provider": "Tickets.com",
            "semanticProvider": "Tickets.com Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "monthly",
            "frequencyLabel": "Monthly (3rd Thursday)",
            "daysOfWeek": ["thu"],
            "timeSlots": ["early-evening", "late-evening"],
            "category": "activities",
            "categoryLabel": "Games & Activities",
            "categoryIcon": "🧪",
            "subTags": ["19-plus", "geodesic-dome", "adult-science", "cocktails"],
            "dateSchedule": "Third Thursday of Month • 6:00 PM - 10:00 PM",
            "startIso": "2026-09-17T18:00:00-07:00",
            "endIso": "2026-09-17T22:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.scienceworld.ca/after-dark/",
            "coordinates": [49.2734, -123.1038],
            "transitInfo": "1 min walk from Main Street-Science World SkyTrain",
            "description": "Explore the iconic geodesic dome kid-free with adult science shows, hands-on physics exhibits, drinks, and guest DJs across two floors."
        },
        {
            "id": "vso-under-35-club",
            "title": "Vancouver Symphony Orchestra Live at The Orpheum",
            "artist": "Vancouver Symphony Orchestra",
            "venue": "The Orpheum Theatre",
            "address": "601 Smithe St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 35.00,
            "provider": "Box Office / Direct",
            "semanticProvider": "Box Office / Direct Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "monthly",
            "frequencyLabel": "Monthly Concerts",
            "daysOfWeek": ["sat", "sun"],
            "timeSlots": ["early-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["symphony", "orpheum", "classical-music", "under-35", "vso"],
            "dateSchedule": "Select Weekend Evenings • 8:00 PM",
            "startIso": "2026-09-19T20:00:00-07:00",
            "endIso": "2027-05-31T22:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.vancouversymphony.ca/all-access-pass/",
            "coordinates": [49.2804, -123.1206],
            "transitInfo": "Steps from Vancouver City Centre SkyTrain station",
            "description": "Experience world-class orchestral masterworks performed by the Vancouver Symphony Orchestra inside Vancouver's opulent 1927 Orpheum Theatre under a hand-painted ceiling dome. Standard balcony tickets start at $35, with $20 passes available for patrons under 35."
        },
        {
            "id": "cultch-theatre-series",
            "title": "The Cultch: Contemporary Stage Performance",
            "venue": "The Cultch (Historic Theatre)",
            "address": "1895 Venables St, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 25.00,
            "fee": 4.00,
            "provider": "AudienceView",
            "semanticProvider": "AudienceView Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "limited-run",
            "frequencyLabel": "Limited Run Series",
            "daysOfWeek": ["tue", "wed", "thu", "fri", "sat"],
            "timeSlots": ["early-evening"],
            "category": "shows",
            "categoryLabel": "Shows & Music",
            "categoryIcon": "🎭",
            "subTags": ["contemporary-theatre", "east-van", "performing-arts"],
            "dateSchedule": "Tuesday - Saturday Evenings • 7:30 PM",
            "startIso": "2026-09-15T19:30:00-07:00",
            "endIso": "2026-10-31T21:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://thecultch.com/box-office/",
            "coordinates": [49.2763, -123.0674],
            "transitInfo": "#20 Victoria or #22 Knight bus to Commercial & Venables",
            "description": "East Vancouver's premier multidisciplinary performing arts venue presenting cutting-edge local and international theatre, dance, and music."
        },
        {
            "id": "tightrope-workshop",
            "title": "Tightrope Theatre: First Step Improv Drop-In Class",
            "venue": "Tightrope Impro Theatre",
            "address": "1330 Napier St, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 40.00,
            "provider": "Independent Box Office",
            "semanticProvider": "Independent Box Office",
            "pricingType": "door",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Sundays)",
            "daysOfWeek": ["sun"],
            "timeSlots": ["afternoon"],
            "category": "activities",
            "categoryLabel": "Games & Activities",
            "categoryIcon": "🤝",
            "subTags": ["improv-workshop", "drop-in-class", "adult-learning", "commercial-drive"],
            "dateSchedule": "Sundays • 2:00 PM - 4:00 PM",
            "startIso": "2026-09-13T14:00:00-07:00",
            "endIso": "2026-12-31T16:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.tightropetheatre.com/classes",
            "coordinates": [49.2748, -123.0768],
            "transitInfo": "Commercial & Hastings bus corridor",
            "description": "A welcoming, low-pressure 2-hour community workshop introducing adults to active listening, collaborative 'yes, and' games, and spontaneous thinking."
        },
        {
            "id": "ludica-boardgames",
            "title": "Pizzeria Ludica: 1,200+ Board Game Night",
            "venue": "Pizzeria Ludica",
            "address": "189 Keefer Pl, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "price": 20.0,
            "basePrice": 20.0,
            "priceLabel": "$20.00 min spend",
            "provider": "Independent Box Office",
            "semanticProvider": "Walk-in / Table Reservation",
            "pricingType": "minimum-spend",
            "isDaily": True,
            "frequency": "daily",
            "frequencyLabel": "Daily Spot",
            "daysOfWeek": ["daily"],
            "timeSlots": ["afternoon", "early-evening", "late-evening"],
            "category": "activities",
            "categoryLabel": "Games & Activities",
            "categoryIcon": "🎲",
            "subTags": ["board-games", "tabletop", "wood-fired-pizza", "craft-beer"],
            "dateSchedule": "Daily from 4:30 PM • 2-Hour Table Limit When Busy",
            "startIso": "2026-09-08T16:30:00-07:00",
            "endIso": None,
            "isSoldOut": False,
            "websiteUrl": "https://www.pizzerialudica.com/",
            "coordinates": [49.2801, -123.1074],
            "transitInfo": "3 min walk from Stadium-Chinatown SkyTrain",
            "description": "Immerse yourself in Vancouver's ultimate board game parlor with over 1,200 titles ranging from party games to deep strategy epics. Enjoy authentic wood-fired Neapolitan pizza, craft beers, and Italian sodas with a $20.00 minimum spend per person (no separate game cover charge). Please note: During peak, busy evenings, table seating has a 2-hour maximum duration."
        },
        {
            "id": "stanley-pitch-putt",
            "title": "Stanley Park Pitch & Putt: 18-Hole Round",
            "venue": "Stanley Park Pitch & Putt",
            "address": "2099 Beach Ave, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 19.11,
            "provider": "Independent Box Office",
            "semanticProvider": "City of Vancouver Park",
            "pricingType": "door",
            "isDaily": True,
            "frequency": "daily",
            "frequencyLabel": "Daily Spot",
            "daysOfWeek": ["daily"],
            "timeSlots": ["early-morning", "afternoon"],
            "category": "activities",
            "categoryLabel": "Games & Activities",
            "categoryIcon": "⛳",
            "subTags": ["pitch-and-putt", "golf", "stanley-park", "english-bay"],
            "dateSchedule": "Daily • Daylight hours (First come, first served)",
            "startIso": "2026-09-08T08:00:00-07:00",
            "endIso": None,
            "isSoldOut": False,
            "websiteUrl": "https://vancouver.ca/parks-recreation-culture/stanley-park-pitch-putt.aspx",
            "coordinates": [49.2908, -123.1448],
            "transitInfo": "#19 bus to Stanley Park or 10 min walk from Denman St",
            "description": "City of Vancouver 18-hole par-three golf course nestled under towering coastal Douglas firs and weeping willows next to English Bay."
        },
        {
            "id": "vag-first-friday",
            "title": "Vancouver Art Gallery: Free First Friday Nights",
            "venue": "Vancouver Art Gallery",
            "address": "750 Hornby St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "BMO / Vancouver Art Gallery",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "monthly",
            "frequencyLabel": "Monthly (1st Friday)",
            "daysOfWeek": ["fri"],
            "timeSlots": ["afternoon", "early-evening"],
            "category": "arts",
            "categoryLabel": "Museums & Visual Arts",
            "categoryIcon": "🏛️",
            "subTags": ["contemporary-art", "emily-carr", "free-first-friday", "art-museum"],
            "dateSchedule": "First Friday of Each Month • 4:00 PM - 8:00 PM",
            "startIso": "2026-10-02T16:00:00-07:00",
            "endIso": "2026-10-02T20:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.vanartgallery.bc.ca/free",
            "venueUrl": "https://www.vanartgallery.bc.ca/visit",
            "coordinates": [49.2828, -123.1205],
            "transitInfo": "1 min walk from City Centre / Granville SkyTrain",
            "description": "100% free admission on the first Friday of each month. Explore major contemporary exhibits, Emily Carr masterworks, and live courtyard programming."
        },
        {
            "id": "shipyards-live-night",
            "title": "The Shipyards Live: Waterfront Music & Night Market",
            "artist": "Local bands & rotating indie artists",
            "venue": "The Shipyards District",
            "address": "125 Victory Ship Way, North Vancouver",
            "neighborhood": "North Shore / Burnaby",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Fridays)",
            "daysOfWeek": ["fri"],
            "timeSlots": ["early-evening", "late-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["night-market", "live-music", "pier-festival", "lonsdale-quay"],
            "dateSchedule": "Friday Evenings • 5:00 PM - 10:00 PM",
            "startIso": "2026-09-11T17:00:00-07:00",
            "endIso": "2026-09-25T22:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.cnv.org/Parks-Recreation/The-Shipyards",
            "coordinates": [49.3113, -123.0818],
            "transitInfo": "5 min walk from Lonsdale Quay SeaBus terminal",
            "description": "Waterfront pier festival featuring free live concerts, artisan night market, food trucks, and fire pits with skyline views across Burrard Inlet."
        },
        # ======================================================================
        # INTERNAL TRACKER DEMO: PAST/ENDED EVENT (Requirement 4)
        # ======================================================================
        {
            "id": "kits-labour-day-concert",
            "title": "Kits Beach Labour Day Sundown Finale",
            "artist": "Local brass bands & musicians",
            "venue": "Kitsilano Beach Park",
            "address": "1499 Arbutus St, Vancouver",
            "neighborhood": "Kitsilano",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "one-off",
            "frequencyLabel": "Ended Event",
            "daysOfWeek": ["mon"],
            "timeSlots": ["early-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["labour-day", "sunset-concert", "kits-beach"],
            "dateSchedule": "Monday, Sept 1, 2026 • 6:00 PM - 9:00 PM",
            "startIso": "2026-09-01T18:00:00-07:00",
            "endIso": "2026-09-01T21:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://kitsilanoshowboat.com/",
            "coordinates": [49.2724, -123.1534],
            "transitInfo": "#2 Burrard or #4 bus",
            "description": "Annual end-of-summer community musical celebration on Kitsilano Beach. (Demonstration ended event for internal tracker verification)."
        },
        # ======================================================================
        # EXPANSION CATALOG: STREET FESTIVALS, MARKETS, JAZZ, LECTURES & RECREATION
        # ======================================================================
        {
            "id": "car-free-day-vancouver",
            "title": "Car Free Day: Commercial Drive, Main Street & West End (Denman)",
            "venue": "Commercial Drive, Main Street & Denman Street",
            "address": "Commercial Dr, Main St & Denman St, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "annual",
            "frequencyLabel": "Annual Festival (September)",
            "daysOfWeek": ["sat", "sun"],
            "timeSlots": ["afternoon", "early-evening"],
            "category": "outdoors",
            "categoryLabel": "Walks & Outdoors",
            "categoryIcon": "🎉",
            "subTags": ["street-festival", "car-free", "community", "live-music", "artisan-market", "denman-street", "west-end"],
            "dateSchedule": "Annual Autumn Festival • 12:00 PM - 7:00 PM",
            "startIso": "2026-09-12T12:00:00-07:00",
            "endIso": "2026-09-13T19:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.carfreevancouver.org",
            "coordinates": [49.2685, -123.0694],
            "transitInfo": "Commercial-Broadway SkyTrain, Main St-Science World, or #5/#19 bus to Denman",
            "description": "Vancouver's premier annual car-free street celebrations combining Commercial Drive, Main Street, and the West End along Denman Street featuring multiple stages of live local music, food carts, artisan vendors, and community block parties."
        },
        {
            "id": "khatsahlano-street-party",
            "title": "Khatsahlano Street Party: West 4th Avenue",
            "artist": "Local indie bands (50+ Vancouver artists)",
            "venue": "West 4th Avenue (Burrard to Macdonald)",
            "address": "West 4th Ave, Vancouver",
            "neighborhood": "Kitsilano",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "annual",
            "frequencyLabel": "Annual Summer Festival",
            "daysOfWeek": ["sat"],
            "timeSlots": ["afternoon", "early-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["street-party", "indie-music", "kitsilano", "food-trucks", "outdoor-festival"],
            "dateSchedule": "Annual Summer Music Festival • 11:00 AM - 9:00 PM",
            "startIso": "2026-07-11T11:00:00-07:00",
            "endIso": "2026-07-11T21:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://khatsahlano.ca",
            "coordinates": [49.2681, -123.1582],
            "transitInfo": "#4 or #7 bus directly along West 4th Avenue",
            "description": "Vancouver's largest free 10-block indie music and arts festival on West 4th Avenue, showcasing over 50 top local musical acts across multiple stages, patio gardens, and street food."
        },
        {
            "id": "trout-lake-farmers-market",
            "title": "Trout Lake Farmers Market",
            "venue": "John Hendry Park (Trout Lake)",
            "address": "3360 Victoria Dr, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Saturdays)",
            "daysOfWeek": ["sat"],
            "timeSlots": ["early-morning", "afternoon"],
            "category": "activities",
            "categoryLabel": "Activities & Fun",
            "categoryIcon": "🥬",
            "subTags": ["farmers-market", "local-produce", "trout-lake", "food-trucks", "dog-friendly"],
            "dateSchedule": "Weekly (Saturdays) • 9:00 AM - 2:00 PM",
            "startIso": "2026-09-12T09:00:00-07:00",
            "endIso": "2026-09-12T14:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://eatlocal.org/markets/trout-lake/",
            "coordinates": [49.2558, -123.0642],
            "transitInfo": "10 min walk from Commercial-Broadway SkyTrain Station",
            "description": "Vancouver's original community farmers market situated beside scenic Trout Lake in John Hendry Park, featuring 60+ BC organic farms, artisanal bakers, craft cider, and hot food trucks."
        },
        {
            "id": "kitsilano-farmers-market",
            "title": "Kitsilano Community Farmers Market",
            "venue": "Kitsilano Community Centre Plaza",
            "address": "2690 Larch St, Vancouver",
            "neighborhood": "Kitsilano",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Sundays)",
            "daysOfWeek": ["sun"],
            "timeSlots": ["early-morning", "afternoon"],
            "category": "activities",
            "categoryLabel": "Activities & Fun",
            "categoryIcon": "🍓",
            "subTags": ["farmers-market", "kitsilano", "organic-produce", "baked-goods", "family-friendly"],
            "dateSchedule": "Weekly (Sundays) • 10:00 AM - 2:00 PM",
            "startIso": "2026-09-13T10:00:00-07:00",
            "endIso": "2026-09-13T14:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://eatlocal.org/markets/kitsilano/",
            "coordinates": [49.2618, -123.1617],
            "transitInfo": "Broadway Rapid Transit or #9 / #14 to Broadway & Larch St",
            "description": "Weekly Sunday neighborhood market in the heart of Kitsilano with farm-fresh Okanagan fruit, BC field vegetables, fresh pasta, artisanal cheeses, and live local acoustic music."
        },
        {
            "id": "guilt-and-co-live-jazz",
            "title": "Guilt & Co.: Nightly Live Jazz, Soul & Latin Music",
            "artist": "Local jazz & soul ensembles",
            "venue": "Guilt & Co.",
            "venueAliases": ["Guilt and Co", "Guilt & Co", "Guilt and Company"],
            "address": "1 Alexander St (Below Ground), Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "By-Donation / Artist Contribution",
            "pricingType": "donation",
            "isDaily": True,
            "frequency": "daily",
            "frequencyLabel": "Nightly 7 Days/Week",
            "daysOfWeek": ["daily"],
            "timeSlots": ["early-evening", "late-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["live-jazz", "gastown", "soul-music", "intimate-lounge", "cocktails"],
            "dateSchedule": "Daily / Nightly Sets • 7:00 PM & 9:30 PM",
            "startIso": "2026-09-09T19:00:00-07:00",
            "endIso": None,
            "isSoldOut": False,
            "websiteUrl": "https://www.guiltandcompany.com",
            "coordinates": [49.2835, -123.1039],
            "transitInfo": "5 min walk from Waterfront Station (SkyTrain & SeaBus)",
            "description": "Gastown's subterranean live music staple hosting world-class jazz, blues, Latin, and soul 365 nights a year. Free admission at the door with an optional suggested donation for the artists."
        },
        {
            "id": "vancouver-institute-lectures",
            "title": "The Vancouver Institute: Saturday Public Lecture Series",
            "venue": "UBC Instructional Resources Centre (IRC)",
            "address": "2194 Health Sciences Mall, Vancouver",
            "neighborhood": "Kitsilano",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Saturdays)",
            "daysOfWeek": ["sat"],
            "timeSlots": ["early-evening"],
            "category": "arts",
            "categoryLabel": "Museums & Visual Arts",
            "categoryIcon": "🎓",
            "subTags": ["public-lecture", "ubc", "science-arts", "free-knowledge", "community-talk"],
            "dateSchedule": "Weekly (Saturdays) • 8:15 PM",
            "startIso": "2026-09-12T20:15:00-07:00",
            "endIso": "2026-09-12T22:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://vaninstitute.ca",
            "coordinates": [49.2647, -123.2492],
            "transitInfo": "Broadway Rapid Transit or #4 / #14 trolley bus to UBC Bus Loop",
            "description": "Founded in 1916, Vancouver's longest-running free public lecture series bringing global scientists, authors, and thinkers to UBC IRC Lecture Hall No. 2 every Saturday evening during academic terms."
        },
        {
            "id": "iq2000-pub-trivia-vancouver",
            "title": "IQ 2000 Vancouver Pub Trivia Night",
            "venue": "Colony Main Street",
            "address": "2904 Main St, Vancouver",
            "neighborhood": "Mount Pleasant",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Walk-in / Table Reservation",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Tuesdays)",
            "daysOfWeek": ["tue"],
            "timeSlots": ["early-evening"],
            "category": "trivia",
            "categoryLabel": "Pub Trivia",
            "categoryIcon": "🧠",
            "subTags": ["pub-trivia", "iq-2000", "mount-pleasant", "craft-beer", "team-trivia"],
            "dateSchedule": "Weekly (Tuesdays) • 7:30 PM - 9:30 PM",
            "startIso": "2026-09-15T19:30:00-07:00",
            "endIso": "2026-09-15T21:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://iq2000trivia.com",
            "coordinates": [49.2586, -123.1009],
            "transitInfo": "#3 Main St bus to 13th Avenue",
            "description": "Vancouver's most popular multimedia pub quiz featuring high-energy pop culture rounds, music clues, visual puzzles, and gift card prizes. Free trivia admission with table food & beverage spend."
        },
        {
            "id": "runvan-community-run",
            "title": "RUNVAN Community Social Group Run",
            "venue": "RUNVAN Clubhouse & Seawall",
            "address": "1288 W Georgia St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Thursdays & Saturdays)",
            "daysOfWeek": ["thu", "sat"],
            "timeSlots": ["early-morning", "early-evening"],
            "category": "outdoors",
            "categoryLabel": "Walks & Outdoors",
            "categoryIcon": "🏃",
            "subTags": ["run-club", "seawall-run", "free-fitness", "community-social", "all-paces"],
            "dateSchedule": "Weekly (Thursdays 6:00 PM & Saturdays 8:30 AM)",
            "startIso": "2026-09-10T18:00:00-07:00",
            "endIso": "2026-09-10T19:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://runvan.org",
            "coordinates": [49.2882, -123.1278],
            "transitInfo": "Burrard SkyTrain Station (7 min walk)",
            "description": "Free community run club organized by the non-profit Vancouver International Marathon Society. All paces welcome for scenic 5K and 8K loops along Coal Harbour and the Stanley Park Seawall."
        },
        # ======================================================================
        # COMPLETE VANCOUVER FARMERS MARKETS NETWORK
        # ======================================================================
        {
            "id": "riley-park-farmers-market",
            "title": "Riley Park Farmers Market",
            "venue": "Riley Park Plaza (Nat Bailey Stadium)",
            "address": "4601 Ontario St, Vancouver",
            "neighborhood": "Mount Pleasant",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Saturdays)",
            "daysOfWeek": ["sat"],
            "timeSlots": ["early-morning", "afternoon"],
            "category": "activities",
            "categoryLabel": "Activities & Fun",
            "categoryIcon": "🌽",
            "subTags": ["farmers-market", "local-produce", "riley-park", "nat-bailey", "food-trucks"],
            "dateSchedule": "Weekly (Saturdays) • 10:00 AM - 2:00 PM",
            "startIso": "2026-09-12T10:00:00-07:00",
            "endIso": "2026-09-12T14:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://eatlocal.org/markets/riley-park/",
            "coordinates": [49.2435, -123.1066],
            "transitInfo": "#3 Main St bus or King Edward Canada Line station (12 min walk)",
            "description": "One of Vancouver's premier outdoor flagship markets situated outside Nat Bailey Stadium, showcasing 70+ local farms, artisan cheese makers, craft brewers, and local bakers."
        },
        {
            "id": "west-end-farmers-market",
            "title": "West End Farmers Market",
            "venue": "Nelson Park (West End)",
            "address": "1100 Comox St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Saturdays)",
            "daysOfWeek": ["sat"],
            "timeSlots": ["early-morning", "afternoon"],
            "category": "activities",
            "categoryLabel": "Activities & Fun",
            "categoryIcon": "🥕",
            "subTags": ["farmers-market", "west-end", "nelson-park", "downtown", "artisan-bakers"],
            "dateSchedule": "Weekly (Saturdays) • 9:00 AM - 2:00 PM",
            "startIso": "2026-09-12T09:00:00-07:00",
            "endIso": "2026-09-12T14:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://eatlocal.org/markets/west-end/",
            "coordinates": [49.2818, -123.1302],
            "transitInfo": "Burrard SkyTrain station or #5 / #6 Robson/Davie bus",
            "description": "Nestled in tree-lined Nelson Park next to Mole Hill heritage houses, featuring fresh urban greens, artisan sourdough, micro-batch kombucha, and hot lunch stalls in downtown Vancouver."
        },
        {
            "id": "mount-pleasant-farmers-market",
            "title": "Mount Pleasant Farmers Market",
            "venue": "Dude Chilling Park (Guelph Park)",
            "address": "2390 Brunswick St, Vancouver",
            "neighborhood": "Mount Pleasant",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Sundays)",
            "daysOfWeek": ["sun"],
            "timeSlots": ["early-morning", "afternoon"],
            "category": "activities",
            "categoryLabel": "Activities & Fun",
            "categoryIcon": "🌻",
            "subTags": ["farmers-market", "mount-pleasant", "dude-chilling-park", "craft-food", "community"],
            "dateSchedule": "Weekly (Sundays) • 10:00 AM - 2:00 PM",
            "startIso": "2026-09-13T10:00:00-07:00",
            "endIso": "2026-09-13T14:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://eatlocal.org/markets/mount-pleasant/",
            "coordinates": [49.2638, -123.0954],
            "transitInfo": "#8 Fraser bus or #9 / #99 Broadway to Fraser St",
            "description": "Vibrant Sunday market held on the grass at Dude Chilling Park with local fruit growers, honey harvesters, plant starts, fresh donuts, and laid-back East Van park community vibes."
        },
        {
            "id": "downtown-farmers-market",
            "title": "Downtown Mid-Week Farmers Market",
            "venue": "Vancouver Art Gallery Plaza (North)",
            "address": "750 Hornby St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Wednesdays)",
            "daysOfWeek": ["wed"],
            "timeSlots": ["afternoon", "early-evening"],
            "category": "activities",
            "categoryLabel": "Activities & Fun",
            "categoryIcon": "🍎",
            "subTags": ["farmers-market", "downtown", "art-gallery-plaza", "midweek-market", "grab-and-go"],
            "dateSchedule": "Weekly (Wednesdays) • 2:00 PM - 6:00 PM",
            "startIso": "2026-09-09T14:00:00-07:00",
            "endIso": "2026-09-09T18:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://eatlocal.org/markets/downtown/",
            "coordinates": [49.2831, -123.1205],
            "transitInfo": "Vancouver City Centre or Granville SkyTrain Station (2 min walk)",
            "description": "Convenient mid-week downtown market on the Vancouver Art Gallery plaza with fresh berries, hand-crafted pastries, gourmet food trucks, and farm-fresh produce for evening commuters."
        },
        {
            "id": "false-creek-farmers-market",
            "title": "False Creek Waterfront Farmers Market",
            "venue": "Concord Community Park (False Creek)",
            "address": "50 Pacific Blvd, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Thursdays)",
            "daysOfWeek": ["thu"],
            "timeSlots": ["afternoon", "early-evening"],
            "category": "activities",
            "categoryLabel": "Activities & Fun",
            "categoryIcon": "⛵",
            "subTags": ["farmers-market", "false-creek", "waterfront", "thursday-market", "seawall"],
            "dateSchedule": "Weekly (Thursdays) • 3:00 PM - 7:00 PM",
            "startIso": "2026-09-10T15:00:00-07:00",
            "endIso": "2026-09-10T19:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://eatlocal.org/markets/false-creek/",
            "coordinates": [49.2743, -123.1118],
            "transitInfo": "Stadium-Chinatown SkyTrain Station (6 min walk along seawall)",
            "description": "Thursday evening waterfront market overlooking False Creek with BC field berries, wild BC seafood, cold-pressed juices, baked treats, and seaside sunset park views."
        },
        {
            "id": "ubc-farm-farmers-market",
            "title": "UBC Farm Community Farmers Market",
            "venue": "UBC Farm (South Campus)",
            "address": "3461 Ross Dr, Vancouver",
            "neighborhood": "Kitsilano",
            "basePrice": 0.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Free Public Access",
            "pricingType": "free",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Saturdays)",
            "daysOfWeek": ["sat"],
            "timeSlots": ["early-morning", "afternoon"],
            "category": "activities",
            "categoryLabel": "Activities & Fun",
            "categoryIcon": "🚜",
            "subTags": ["farmers-market", "ubc-farm", "organic-certified", "farm-tours", "family-friendly"],
            "dateSchedule": "Weekly (Saturdays) • 10:00 AM - 2:00 PM",
            "startIso": "2026-09-12T10:00:00-07:00",
            "endIso": "2026-09-12T14:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://ubcfarm.ubc.ca/markets/",
            "coordinates": [49.2526, -123.2384],
            "transitInfo": "#68 UBC community shuttle or #41 / #49 bus to UBC South Campus",
            "description": "Vancouver's only certified organic working farm market set within a 24-hectare coastal forest. Features 30+ farm stalls, live acoustic music, food trucks, and free 12:00 PM farm tours."
        },
        # ======================================================================
        # INTIMATE SMALL-VENUE LIVE MUSIC & BANDS
        # ======================================================================
        {
            "id": "2nd-floor-gastown-sharon-minemoto",
            "title": "Live Jazz & Supper Club at 2nd Floor Gastown",
            "artist": "Rotating local jazz trios & guest artists",
            "performers": ["Sharon Minemoto Trio", "Rotating local jazz artists"],
            "venue": "2nd Floor Gastown",
            "venueAliases": ["Water Street Cafe", "Water St Cafe", "The Water St Cafe", "Sharon Minemoto"],
            "address": "300 Water St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 12.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Venue Door / Table Charge",
            "pricingType": "cover_charge",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Fridays)",
            "daysOfWeek": ["fri"],
            "timeSlots": ["early-evening", "late-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["live-jazz", "sharon-minemoto", "gastown", "supper-club", "piano-trio"],
            "dateSchedule": "Weekly (Fridays) • 7:30 PM & 9:30 PM Sets",
            "startIso": "2026-09-11T19:30:00-07:00",
            "endIso": "2026-09-11T22:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.waterstreetcafe.ca/2nd-floor-gastown",
            "coordinates": [49.2842, -123.1102],
            "transitInfo": "Waterfront Station (3 min walk)",
            "description": "Intimate 50-seat jazz listening room above the Water St. Cafe featuring rotating acclaimed Vancouver jazz pianists, trios, and guest artists. $12 live music cover added to dining bill."
        },
        {
            "id": "frankies-jazz-brad-turner",
            "title": "Weekend Live Jazz Showcase at Frankie's Jazz Club",
            "artist": "Rotating Canadian & international jazz artists",
            "performers": ["Brad Turner Quartet", "Rotating jazz artists"],
            "venue": "Frankie's Jazz Club",
            "venueAliases": ["Frankies", "Frankies Jazz Club", "Coastal Jazz", "Brad Turner"],
            "address": "755 Beatty St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 22.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Box Office / Direct Verified",
            "pricingType": "platform",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Saturdays)",
            "daysOfWeek": ["sat"],
            "timeSlots": ["early-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["live-jazz", "brad-turner", "downtown", "listening-room", "bebop"],
            "dateSchedule": "Weekly (Saturdays) • 8:00 PM (Doors 7:00 PM)",
            "startIso": "2026-09-12T20:00:00-07:00",
            "endIso": "2026-09-12T22:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.coastaljazz.ca",
            "coordinates": [49.2778, -123.1147],
            "transitInfo": "Stadium-Chinatown SkyTrain Station (2 min walk)",
            "description": "Vancouver's premier dedicated jazz supper club, operated in partnership with the Coastal Jazz & Blues Society. Weekend live showcases featuring rotating Canadian and international jazz artists."
        },
        {
            "id": "wise-hall-roots-revue",
            "title": "East Van Roots, Folk & Live Music at The WISE Hall",
            "artist": "Rotating local roots, folk & bluegrass acts",
            "performers": ["Rotating local roots, folk & bluegrass acts"],
            "venue": "The WISE Hall & Lounge",
            "venueAliases": ["The WISE", "Wise Hall", "WISE Lounge", "Roots & Bluegrass Revue"],
            "address": "1882 Adanac St, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 15.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Venue Door / Table Charge",
            "pricingType": "door",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Saturdays)",
            "daysOfWeek": ["sat"],
            "timeSlots": ["early-evening", "late-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["bluegrass", "roots-revue", "commercial-drive", "community-hall", "folk"],
            "dateSchedule": "Weekly (Saturdays) • 8:00 PM (Doors 7:00 PM)",
            "startIso": "2026-09-12T20:00:00-07:00",
            "endIso": "2026-09-12T23:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://thewise.ca",
            "coordinates": [49.2774, -123.0673],
            "transitInfo": "#20 Victoria or #14 Hastings bus to Commercial & Adanac",
            "description": "Historic East Vancouver community hall and downstairs lounge hosting high-energy bluegrass, old-time roots, and Americana stringbands with rotating local artists. Friendly neighborhood vibe with local taps."
        },
        {
            "id": "anza-club-bluegrass-jam",
            "title": "Pacific Bluegrass & Heritage Acoustic Jam at The Anza Club",
            "artist": "Pacific Bluegrass Heritage Collective",
            "venue": "The Anza Club",
            "address": "3 W 8th Ave, Vancouver",
            "neighborhood": "Mount Pleasant",
            "basePrice": 10.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Venue Door / Table Charge",
            "pricingType": "door",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Mondays)",
            "daysOfWeek": ["mon"],
            "timeSlots": ["early-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["bluegrass", "acoustic-jam", "mount-pleasant", "celtic", "social-club"],
            "dateSchedule": "Weekly (Mondays) • 7:30 PM - 10:30 PM",
            "startIso": "2026-09-14T19:30:00-07:00",
            "endIso": "2026-09-14T22:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.anzaclub.org",
            "coordinates": [49.2638, -123.1068],
            "transitInfo": "Broadway Rapid Transit or #9 to Broadway & Ontario (2 min walk)",
            "description": "Mount Pleasant's beloved non-profit social club hosting weekly acoustic bluegrass, old-time fiddle, and Celtic jam sessions. Listeners and pickers welcome, $10 general door."
        },
        {
            "id": "red-gate-dead-soft",
            "title": "Friday Night Live Indie & Underground at Red Gate",
            "artist": "Rotating local indie, punk & experimental bands",
            "performers": ["Dead Soft", "Babe Corner", "Sore Points", "Rotating local indie, punk & experimental bands"],
            "venue": "Red Gate Arts Society",
            "venueAliases": ["Red Gate", "Red Gate Arts Society", "Dead Soft", "Babe Corner"],
            "address": "1151 E Hastings St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 12.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Venue Door / Table Charge",
            "pricingType": "door",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Fridays)",
            "daysOfWeek": ["fri"],
            "timeSlots": ["early-evening", "late-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["indie-rock", "dead-soft", "babe-corner", "diy-venue", "post-punk", "all-ages"],
            "dateSchedule": "Weekly (Fridays) • 8:30 PM (Doors 8:00 PM)",
            "startIso": "2026-09-11T20:30:00-07:00",
            "endIso": "2026-09-11T23:45:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://redgate.tv/tickets/",
            "coordinates": [49.2811, -123.0805],
            "transitInfo": "#14 or #16 Hastings bus directly to Clark Dr",
            "description": "Vancouver's premier artist-run underground DIY music space hosting Friday night live indie, post-punk, and experimental bands. Rotating local acts, accessible, all-ages, $12 door PWYC."
        },
        {
            "id": "lanalous-the-jolts",
            "title": "Weekend Live Rock 'n' Roll at LanaLou's",
            "artist": "Rotating local punk, garage & rock bands",
            "performers": ["The Jolts", "Tough Customer", "Rotating local bands"],
            "venue": "LanaLou's",
            "venueAliases": ["Lanalous", "Lana Lou's", "Lana Lous", "The Jolts"],
            "address": "362 Powell St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 12.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Venue Door / Table Charge",
            "pricingType": "door",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly (Saturdays)",
            "daysOfWeek": ["sat"],
            "timeSlots": ["early-evening", "late-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["punk-rock", "the-jolts", "garage-rock", "strathcona", "all-ages"],
            "dateSchedule": "Weekly (Saturdays) • 8:00 PM (Doors 7:30 PM)",
            "startIso": "2026-09-12T20:00:00-07:00",
            "endIso": "2026-09-12T23:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://lanalous.com",
            "coordinates": [49.2831, -123.0954],
            "transitInfo": "#4 or #7 Powell bus to Dunlevy Ave",
            "description": "Strathcona's favorite colorful rock 'n' roll cafe hosting high-octane weekend live shows with rotating Vancouver garage punk and rock bands. 100% door proceeds support the performers."
        },
        {
            "id": "the-roxy-fab-fourever",
            "title": "Live Music & Weekend Party Rock at The Roxy",
            "artist": "The Roxy Rollers House Band & Weekend Guest Artists",
            "venue": "The Roxy Cabaret",
            "venueAliases": ["The Roxy", "Roxy Cabaret", "Roxy Nightclub"],
            "address": "932 Granville St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 12.0,
            "provider": "Box Office / Direct",
            "semanticProvider": "Venue Door / Table Charge",
            "pricingType": "door",
            "tiers": [
                {"name": "General Door Admission", "basePrice": 12.0, "price": 12.0, "label": "$12.00 door"}
            ],
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Thu – Sat Nights",
            "daysOfWeek": ["thu", "fri", "sat"],
            "timeSlots": ["late-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["party-band", "roxy-rollers", "granville-strip", "rock-covers", "live-music", "top-40"],
            "dateSchedule": "Thu, Fri & Sat Nights • Doors 8:00 PM • Live Band 10:00 PM",
            "startIso": "2026-09-17T20:00:00-07:00",
            "endIso": "2026-09-18T03:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://roxyvan.com/events",
            "coordinates": [49.2804, -123.1215],
            "transitInfo": "Granville SkyTrain Station (4 min walk)",
            "description": "Vancouver's legendary live party venue on the Granville Strip. Features resident house band The Roxy Rollers playing classic rock, pop anthems, and modern hits on Thursday, Friday, and Saturday weekend nights with resident DJs until 3:00/4:00 AM."
        },
        {
            "id": "roxy-we-outside-prismin",
            "title": "The Roxy & We Outside Present: Prismin / Noise Control / The Mini Boogie",
            "artist": "Prismin, Noise Control & The Mini Boogie",
            "venue": "The Roxy Cabaret",
            "venueAliases": ["The Roxy", "Roxy Cabaret", "Roxy Nightclub"],
            "address": "932 Granville St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 15.0,
            "provider": "Showpass",
            "semanticProvider": "Showpass Verified",
            "pricingType": "platform",
            "tiers": [
                {"name": "Advance Ticket", "basePrice": 15.0, "price": 17.50, "label": "$17.50 all-in"},
                {"name": "Door Admission", "basePrice": 25.0, "price": 25.0, "label": "$25.00 door"}
            ],
            "isDaily": False,
            "frequency": "limited-run",
            "frequencyLabel": "Tuesday, Sep 15",
            "daysOfWeek": [],
            "timeSlots": ["early-evening", "late-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["indie-rock", "local-bands", "live-music", "granville-strip"],
            "dateSchedule": "Tuesday, Sep 15 • Doors 8:00 PM",
            "startIso": "2026-09-15T20:00:00-07:00",
            "endIso": "2026-09-16T01:00:00-07:00",
            "confirmedDates": ["2026-09-15"],
            "isSoldOut": False,
            "websiteUrl": "https://roxyvan.com/events",
            "coordinates": [49.2804, -123.1215],
            "transitInfo": "Granville SkyTrain Station (4 min walk)",
            "description": "Live band showcase at The Roxy presented by We Outside featuring Prismin, Noise Control, and The Mini Boogie. +19 for entry. Tickets $15 advance on Showpass, $25 at door."
        },
        {
            "id": "roxy-live-acts-showcase",
            "title": "The Roxy & Live Acts Canada: GHULO / Focus Your Audio",
            "artist": "GHULO & Focus Your Audio",
            "venue": "The Roxy Cabaret",
            "venueAliases": ["The Roxy", "Roxy Cabaret", "Roxy Nightclub"],
            "address": "932 Granville St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 12.0,
            "provider": "Showpass",
            "semanticProvider": "Showpass Verified",
            "pricingType": "platform",
            "tiers": [
                {"name": "Advance Ticket", "basePrice": 12.0, "price": 14.16, "label": "$14.16 all-in"},
                {"name": "Door Admission", "basePrice": 15.0, "price": 15.0, "label": "$15.00 door"}
            ],
            "isDaily": False,
            "frequency": "limited-run",
            "frequencyLabel": "Wednesday, Sep 16",
            "daysOfWeek": [],
            "timeSlots": ["early-evening", "late-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["indie-rock", "live-acts-canada", "local-bands", "granville-strip"],
            "dateSchedule": "Wednesday, Sep 16 • Doors 8:00 PM",
            "startIso": "2026-09-16T20:00:00-07:00",
            "endIso": "2026-09-17T01:00:00-07:00",
            "confirmedDates": ["2026-09-16"],
            "isSoldOut": False,
            "websiteUrl": "https://roxyvan.com/events",
            "coordinates": [49.2804, -123.1215],
            "transitInfo": "Granville SkyTrain Station (4 min walk)",
            "description": "Live band showcase at The Roxy in partnership with Live Acts Canada featuring GHULO and Focus Your Audio. All proceeds support the bands. +19 for entry."
        },
        {
            "id": "roxy-country-sunday",
            "title": "The Roxy Presents: Live Band Line Dancing",
            "artist": "The Roxy Rollers Country Band & Dance Instructors",
            "venue": "The Roxy Cabaret",
            "venueAliases": ["The Roxy", "Roxy Cabaret", "Roxy Nightclub"],
            "address": "932 Granville St, Vancouver",
            "neighborhood": "Downtown / West End",
            "basePrice": 6.0,
            "provider": "Showpass",
            "semanticProvider": "Showpass Verified",
            "pricingType": "platform",
            "tiers": [
                {"name": "Advance Ticket", "basePrice": 6.0, "price": 7.24, "label": "$7.24 all-in"},
                {"name": "Door Admission", "basePrice": 8.0, "price": 8.0, "label": "$8.00 door"}
            ],
            "isDaily": False,
            "frequency": "limited-run",
            "frequencyLabel": "Sunday, Sept 27",
            "daysOfWeek": [],
            "timeSlots": ["early-evening", "late-evening"],
            "category": "music",
            "categoryLabel": "Live Music",
            "categoryIcon": "🎵",
            "subTags": ["country", "line-dancing", "live-band", "roxy-rollers", "dance-lesson", "granville-strip"],
            "dateSchedule": "Sunday, Sept 27 • Doors 9:00 PM • Line Dancing 9:30 PM",
            "startIso": "2026-09-27T21:00:00-07:00",
            "endIso": "2026-09-28T02:00:00-07:00",
            "confirmedDates": ["2026-09-27"],
            "isSoldOut": False,
            "websiteUrl": "https://roxyvan.com/events",
            "coordinates": [49.2804, -123.1215],
            "transitInfo": "Granville SkyTrain Station (4 min walk)",
            "description": "Special Sunday country night at The Roxy featuring professional line dancing instruction at 9:30 PM followed by live country hits performed by The Roxy Rollers Country Edition. Advance tickets $6.00 + fee on Showpass, $8 at door."
        },
        # ======================================================================
        # DEMONSTRATION UNVERIFIED EVENT (Quarantine Queue Trigger)
        # ======================================================================
        {
            "id": "unverified-eastside-cinema",
            "title": "Eastside Cinema Club: Unverified Community Screening",
            "venue": "Eastside Community Hall",
            "address": "1200 Commercial Dr, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 15.00,
            "provider": "Independent Box Office",
            "semanticProvider": "Independent Box Office",
            "pricingType": "door",
            "requiresManualReview": True,
            "flagReason": "Venue has no online checkout portal and ticket price ($15.00) is based on unconfirmed general door assumption.",
            "isDaily": False,
            "frequency": "one-off",
            "frequencyLabel": "Indie Night (Oct 1)",
            "daysOfWeek": ["sat"],
            "timeSlots": ["early-evening"],
            "category": "cinema",
            "categoryLabel": "Cinema",
            "categoryIcon": "🎬",
            "subTags": ["indie-film", "unverified-price"],
            "dateSchedule": "Saturday, Oct 1 • 7:00 PM",
            "startIso": "2026-10-01T19:00:00-07:00",
            "endIso": "2026-10-01T22:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://eastsidecinemaclub.example.com/tickets",
            "coordinates": [49.2748, -123.0699],
            "transitInfo": "Commercial Drive bus",
            "description": "Indie community screening with unverified door rate awaiting manual verification."
        },
        {
            "id": "cafe-au-clay-pottery-painting",
            "title": "Drop-in Pottery Painting & Studio Session",
            "venue": "Café au Clay Studios",
            "address": "1612 W 3rd Ave, Vancouver",
            "neighborhood": "Kitsilano",
            "basePrice": 24.00,
            "provider": "Direct Studio Drop-In / Walk-in",
            "semanticProvider": "Walk-in / Studio Reservation",
            "pricingType": "paid",
            "isDaily": False,
            "frequency": "daily",
            "frequencyLabel": "Daily Studio Sessions",
            "daysOfWeek": ["tue", "wed", "thu", "fri", "sat", "sun"],
            "timeSlots": ["afternoon", "early-evening"],
            "category": "crafts",
            "categoryLabel": "Crafts & Studios",
            "categoryIcon": "🎨",
            "subTags": ["pottery", "painting", "ceramics", "diy-crafts", "creative-date"],
            "dateSchedule": "Tue–Sun • 12:00 PM – 8:00 PM",
            "startIso": "2026-09-10T12:00:00-07:00",
            "endIso": "2026-09-10T20:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://cafeauclay.com/products/drop-in-pottery-painting",
            "coordinates": [49.2687, -123.1412],
            "transitInfo": "#84 UBC / VCC-Clark bus along 4th Ave or #7/#4 to Granville & 4th (5 min walk)",
            "description": "Choose from dozens of unglazed bisque pottery pieces (mugs, bowls, planters) and paint with studio underglazes. Includes studio time, glaze firing, and kiln processing."
        },
        {
            "id": "basic-inquiry-life-drawing",
            "title": "Life Drawing Drop-in Studio Sessions",
            "venue": "Basic Inquiry Life Drawing Society",
            "address": "1011 Main St, Vancouver",
            "neighborhood": "Gastown / Chinatown",
            "basePrice": 20.00,
            "provider": "Box Office / Direct",
            "semanticProvider": "Walk-in / Cash or Card at Door",
            "pricingType": "paid",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Multiple Weekly Sessions",
            "daysOfWeek": ["tue", "thu", "sat", "sun"],
            "timeSlots": ["afternoon", "early-evening"],
            "category": "crafts",
            "categoryLabel": "Crafts & Studios",
            "categoryIcon": "🎨",
            "subTags": ["life-drawing", "figure-drawing", "sketching", "artist-dropin", "fine-art"],
            "dateSchedule": "Tue, Thu, Sat & Sun • Multiple Sessions (e.g. 7:00 PM - 10:00 PM)",
            "startIso": "2026-09-10T19:00:00-07:00",
            "endIso": "2026-09-10T22:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://lifedrawing.org/session-fees-rates/",
            "coordinates": [49.2789, -123.1001],
            "transitInfo": "Main Street–Science World SkyTrain station (3 min walk)",
            "description": "Vancouver's historic artist-run life drawing society. Drop-in uninstructed figure drawing sessions with professional models, easels, and drawing horses in an authentic Chinatown studio."
        },
        {
            "id": "hand-eye-ceramics-open-studio",
            "title": "Hand Eye Ceramics: Community Open Studio Drop-In",
            "venue": "Hand Eye Ceramics",
            "address": "2202 Clark Dr, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 26.25,
            "provider": "Direct Studio Drop-In / Walk-in",
            "semanticProvider": "Studio Walk-In / Open Studio",
            "pricingType": "paid",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Tuesdays, Thursdays & Weekends",
            "daysOfWeek": ["tue", "thu", "sat", "sun"],
            "timeSlots": ["afternoon", "early-evening"],
            "category": "crafts",
            "categoryLabel": "Crafts & Studios",
            "categoryIcon": "🎨",
            "subTags": ["ceramics", "pottery-wheel", "clay-handbuilding", "open-studio", "commercial-drive"],
            "dateSchedule": "Tue & Thu 6:00 PM – 9:00 PM • Sat & Sun 1:00 PM – 5:00 PM",
            "startIso": "2026-09-10T18:00:00-07:00",
            "endIso": "2026-09-10T21:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://handeyeceramics.com/open-studio",
            "coordinates": [49.2655, -123.0776],
            "transitInfo": "#22 Knight bus or 8 min walk from VCC-Clark SkyTrain Station",
            "description": "Warm, sunny artist-run ceramic studio on Clark Drive. Welcomes potters and beginners with previous clay experience to drop in for self-directed open studio time. Includes access to wheels, slab roller, glazes, and equipment."
        },
        {
            "id": "claymates-ceramics-drop-in",
            "title": "Claymates Hand-Building Ceramics & Clay Workshop",
            "venue": "Claymates Ceramics Studio",
            "address": "1268 E Hastings St, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 35.00,
            "provider": "Direct Studio Drop-In / Walk-in",
            "semanticProvider": "Studio Booking / Walk-in",
            "pricingType": "paid",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly Sessions",
            "daysOfWeek": ["wed", "fri", "sat", "sun"],
            "timeSlots": ["afternoon", "early-evening"],
            "category": "crafts",
            "categoryLabel": "Crafts & Studios",
            "categoryIcon": "🎨",
            "subTags": ["ceramics", "clay-handbuilding", "pottery", "east-van-arts"],
            "dateSchedule": "Wed, Fri–Sun • 1:00 PM – 7:00 PM",
            "startIso": "2026-09-11T13:00:00-07:00",
            "endIso": "2026-09-11T16:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://claymatesceramicsstudio.com",
            "coordinates": [49.2811, -123.0782],
            "transitInfo": "#14 / #16 / #20 bus along Hastings St to Clark Dr (2 min walk)",
            "description": "Hands-on pottery hand-building in East Vancouver. Mold, sculpt, and texture your own ceramic creations with all clay, sculpting tools, and kiln firing included."
        },
        {
            "id": "slice-of-life-craft-night",
            "title": "Community Craft Night & Printmaking Studio",
            "venue": "Slice of Life Gallery & Studios",
            "address": "1636 Venables St, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 18.00,
            "provider": "Direct Studio Drop-In / Walk-in",
            "semanticProvider": "Walk-in / Studio Registration",
            "pricingType": "paid",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Weekly Craft Nights",
            "daysOfWeek": ["thu", "fri"],
            "timeSlots": ["early-evening"],
            "category": "crafts",
            "categoryLabel": "Crafts & Studios",
            "categoryIcon": "🎨",
            "subTags": ["craft-night", "printmaking", "linocut", "collage", "creative-social"],
            "dateSchedule": "Thursday & Friday Evenings • 6:30 PM – 9:30 PM",
            "startIso": "2026-09-10T18:30:00-07:00",
            "endIso": "2026-09-10T21:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.slicevancouver.ca/shop",
            "coordinates": [49.2764, -123.0716],
            "transitInfo": "#20 Victoria bus along Commercial Drive to Venables St (3 min walk)",
            "description": "East Van community craft gathering with printmaking, linocut stamping, collage, and zine-making materials provided. Relaxed, social creative vibe for beginners and pros alike."
        },
        {
            "id": "slice-of-life-life-drawing",
            "title": "Life Drawing Club at Slice of Life Gallery",
            "venue": "Slice of Life Gallery & Studios",
            "address": "1636 Venables St, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 15.00,
            "provider": "Direct Studio Drop-In / Walk-in",
            "semanticProvider": "Gallery Walk-In / Cash or Card",
            "pricingType": "paid",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Sundays & Wednesdays",
            "daysOfWeek": ["sun", "wed"],
            "timeSlots": ["early-morning", "early-evening"],
            "category": "crafts",
            "categoryLabel": "Crafts & Studios",
            "categoryIcon": "🎨",
            "subTags": ["life-drawing", "sketching", "figure-drawing", "artist-run", "commercial-drive"],
            "dateSchedule": "Sunday 10:30 AM (Gestures) • Wednesday 7:00 PM (Long Pose)",
            "startIso": "2026-09-13T10:30:00-07:00",
            "endIso": "2026-09-13T13:00:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.slicevancouver.ca/shop",
            "coordinates": [49.2764, -123.0716],
            "transitInfo": "#20 Victoria bus along Commercial Drive to Venables St (3 min walk)",
            "description": "Uninstructed community life drawing sessions inside Slice of Life's sunlit gallery. Features diverse professional models, relaxed beats, drawing boards, and a welcoming crowd of illustrators and sketchers."
        },
        {
            "id": "slice-of-life-clay-club",
            "title": "Clay Club: Hand-Building & Sculpting at Slice of Life",
            "venue": "Slice of Life Gallery & Studios",
            "address": "1636 Venables St, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 22.00,
            "provider": "Direct Studio Drop-In / Walk-in",
            "semanticProvider": "Gallery Walk-In / Cash or Card",
            "pricingType": "paid",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Sundays & Mondays",
            "daysOfWeek": ["sun", "mon"],
            "timeSlots": ["afternoon", "early-evening"],
            "category": "crafts",
            "categoryLabel": "Crafts & Studios",
            "categoryIcon": "🎨",
            "subTags": ["clay-club", "handbuilding", "pottery-sculpting", "craft-date", "commercial-drive"],
            "dateSchedule": "Sunday 2:00 PM – 4:30 PM • Monday 6:30 PM – 9:00 PM",
            "startIso": "2026-09-13T14:00:00-07:00",
            "endIso": "2026-09-13T16:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.slicevancouver.ca/clayclub",
            "coordinates": [49.2764, -123.0716],
            "transitInfo": "#20 Victoria bus along Commercial Drive to Venables St (3 min walk)",
            "description": "Casual Sunday afternoon and Monday evening clay social. Grab terracotta or stoneware clay, learn hand-building pinching and coiling techniques, and create mugs, dishes, or sculptures with studio underglazes and firing included."
        },
        {
            "id": "slice-of-life-lego-night",
            "title": "If You Build It: Adult LEGO Night at Slice of Life",
            "venue": "Slice of Life Gallery & Studios",
            "address": "1636 Venables St, Vancouver",
            "neighborhood": "Commercial Drive",
            "basePrice": 10.00,
            "provider": "Direct Studio Drop-In / Walk-in",
            "semanticProvider": "Gallery Walk-In / Cash or Card",
            "pricingType": "paid",
            "isDaily": False,
            "frequency": "weekly",
            "frequencyLabel": "Tuesday Evenings",
            "daysOfWeek": ["tue"],
            "timeSlots": ["early-evening", "late-evening"],
            "category": "social",
            "categoryLabel": "Community & Social",
            "categoryIcon": "🧩",
            "subTags": ["lego-night", "adult-lego", "social-night", "creative-date", "commercial-drive"],
            "dateSchedule": "Tuesday • 7:00 PM – 9:30 PM (Weekly)",
            "startIso": "2026-09-15T19:00:00-07:00",
            "endIso": "2026-09-15T21:30:00-07:00",
            "isSoldOut": False,
            "websiteUrl": "https://www.slicevancouver.ca/shop",
            "coordinates": [49.2764, -123.0716],
            "transitInfo": "#20 Victoria bus along Commercial Drive to Venables St (3 min walk)",
            "description": "Slice of Life's beloved weekly Tuesday LEGO night for adults. Sift through thousands of categorized bricks, participate in optional timed build challenges, or chill with friends and build freely over gallery drinks and tunes."
        },
        {
            "id": "public-disco-warehouse-party",
            "title": "Public Disco: Warehouse & Club Dance Fundraiser",
            "venue": "The Birdhouse",
            "organizer": "Public Disco Society",
            "isRoving": True,
            "editionVenue": "The Birdhouse",
            "address": "44 W 4th Ave, Vancouver",
            "neighborhood": "Mount Pleasant",
            "basePrice": 20.00,
            "provider": "Eventbrite / Public Disco",
            "semanticProvider": "Online Advance & Door Tickets",
            "pricingType": "paid",
            "isDaily": False,
            "frequency": "seasonal",
            "frequencyLabel": "Seasonal / Awaiting Schedule",
            "daysOfWeek": ["fri", "sat"],
            "timeSlots": ["late-evening"],
            "category": "music",
            "categoryLabel": "Music & Concerts",
            "categoryIcon": "🎵",
            "subTags": ["public-disco", "electronic", "house-music", "dance-party", "warehouse", "mount-pleasant"],
            "dateSchedule": "Awaiting next announced edition • Follow @publicdisco",
            "startIso": None,
            "endIso": None,
            "confirmedDates": [],
            "isSoldOut": False,
            "agePolicy": "19+ (Valid Government Photo ID Required)",
            "admissionPolicy": "Advance & Door Ticketed Fundraiser ($15 – $25)",
            "rovingNote": "Nomadic evening club fundraiser series hosted at licensed East Van venues (The Birdhouse / Red Gate Arts Society).",
            "websiteUrl": "https://publicdisco.ca/events",
            "coordinates": [49.2678, -123.1065],
            "transitInfo": "Olympic Village or Main Street-Science World SkyTrain (6 min walk)",
            "description": "High-energy indoor club and warehouse parties supporting Public Disco's free public programming. Immersive lighting, world-class sound, safe space policies, and positive dance floor vibes across East Vancouver cultural spaces."
        }
    ]


# ==============================================================================
# CURATED VENUE OFFICIAL HOMEPAGES DIRECTORY
# ==============================================================================

VENUE_URLS = {
    "Stanley Park Seawall": "https://vancouver.ca/parks-recreation-culture/stanley-park.aspx",
    "Lynn Canyon Park": "https://ecologycentre.ca",
    "Granville Island Public Market": "https://granvilleisland.com",
    "Kitsilano Beach Outdoor Amphitheatre": "https://kitsilanoshowboat.com",
    "VPL Central Library (Level 9)": "https://www.vpl.ca/branches/central/level-9/roofgarden",
    "Dr. Sun Yat-Sen Public Courtyard": "https://vancouverchinesegarden.com/visit/",
    "UBC Rose Garden & Trail 6": "https://visit.ubc.ca/see-and-do/gardens-and-nature/ubc-rose-garden/",
    "Queen Elizabeth Park": "https://vancouver.ca/parks-recreation-culture/queen-elizabeth-park.aspx",
    "Bloedel Conservatory": "https://www.showpass.com/o/bloedel-conservatory/",
    "Little Mountain Gallery": "https://littlemountaingallery.ca",
    "War Memorial Gym & Thunderbird Stadium": "https://gothunderbirds.ca",
    "Chill x Studio": "https://chillxstudio.com",
    "VIFF Centre (Seymour Atrium)": "https://viff.org",
    "The Cinematheque": "https://thecinematheque.ca",
    "The Portside Pub": "https://theportsidepub.com",
    "The Rio Theatre": "https://riotheatre.ca",
    "The Fox Cabaret": "https://www.foxcabaret.com",
    "The Biltmore Cabaret": "https://biltmorecabaret.com",
    "Scotiabank Field at Nat Bailey Stadium": "https://www.milb.com/vancouver",
    "Tightrope Impro Theatre": "https://tightropetheatre.com",
    "The Improv Centre": "https://theimprovcentre.ca",
    "The Rickshaw Theatre": "https://rickshawtheatre.com",
    "Rickshaw Theatre": "https://rickshawtheatre.com",
    "Hollywood Theatre": "https://hollywoodtheatre.ca",
    "The Hollywood Theatre": "https://hollywoodtheatre.ca",
    "Science World at TELUS World of Science": "https://www.scienceworld.ca",
    "Public Disco Society": "https://publicdisco.ca",
    "Public Disco": "https://publicdisco.ca",
    "The Orpheum Theatre": "https://vancouvercivictheatres.com/venues/orpheum/",
    "Pizzeria Ludica": "https://www.pizzerialudica.com/",
    "Stanley Park Pitch & Putt": "https://vancouver.ca/parks-recreation-culture/stanley-park-pitch-putt.aspx",
    "Vancouver Art Gallery": "https://www.vanartgallery.bc.ca",
    "The Shipyards District": "https://theshipyardsdistrict.ca",
    "Kitsilano Beach Park": "https://kitsilanoshowboat.com/",
    "Revue Stage Granville Island": "https://theimprovcentre.ca",
    "The Revue Stage": "https://theimprovcentre.ca",
    "Waterfront Theatre": "https://www.carouseltheatre.ca/waterfront-theatre/",
    "The Nest (Granville Island)": "https://www.granvilleisland.com/directory/nest",
    "Performance Works": "https://granvilleisland.com/directory/performance-works",
    "Carousel Theatre": "https://www.carouseltheatre.ca",
    "Arts Factory": "https://artsfactorysociety.ca",
    "VIFF Centre": "https://viff.org",
    "Rio Theatre": "https://riotheatre.ca",
    "SFU Goldcorp Centre for the Arts": "https://www.sfu.ca/woodwards.html",
    "Commercial Drive & Main Street": "https://www.carfreevancouver.org",
    "West 4th Avenue (Burrard to Macdonald)": "https://khatsahlano.ca",
    "John Hendry Park (Trout Lake)": "https://eatlocal.org/markets/trout-lake/",
    "Kitsilano Community Centre Plaza": "https://eatlocal.org/markets/kitsilano/",
    "Guilt & Co.": "https://www.guiltandcompany.com",
    "UBC Instructional Resources Centre (IRC)": "https://vaninstitute.ca",
    "Colony Main Street": "https://iq2000trivia.com",
    "RUNVAN Clubhouse & Seawall": "https://runvan.org",
    "Riley Park Plaza (Nat Bailey Stadium)": "https://eatlocal.org/markets/riley-park/",
    "Nelson Park (West End)": "https://eatlocal.org/markets/west-end/",
    "Dude Chilling Park (Guelph Park)": "https://eatlocal.org/markets/mount-pleasant/",
    "Vancouver Art Gallery Plaza (North)": "https://eatlocal.org/markets/downtown/",
    "Concord Community Park (False Creek)": "https://eatlocal.org/markets/false-creek/",
    "UBC Farm (South Campus)": "https://ubcfarm.ubc.ca/markets/",
    "2nd Floor Gastown": "https://www.waterstreetcafe.ca/2nd-floor-gastown",
    "Frankie's Jazz Club": "https://www.coastaljazz.ca",
    "The WISE Hall & Lounge": "https://thewise.ca",
    "The Anza Club": "https://www.anzaclub.org",
    "Red Gate Arts Society": "https://redgate.tv/tickets/",
    "LanaLou's": "https://lanalous.com",
    "The Roxy Cabaret": "https://www.roxyvan.com",
    "Café au Clay Studios": "https://cafeauclay.com",
    "Basic Inquiry Life Drawing Society": "https://lifedrawing.org",
    "Hand Eye Ceramics": "https://handeyeceramics.com",
    "Claymates Ceramics Studio": "https://claymatesceramicsstudio.com",
    "Slice of Life Gallery & Studios": "https://www.slicevancouver.ca",
    "Public Disco Society": "https://publicdisco.ca",
    "Bentall Centre Dunsmuir Plaza": "https://bentallcentre.com",
    "The Birdhouse": "https://www.birdhouse.ca",
    "The Waldorf": "https://atthewaldorf.com",
    "The Cobalt": "https://thecobalt.ca"
}

# Dynamically incorporate verified directory venues from data/venue_directory.json
VENUES_DIR_FILE = os.path.join(DATA_DIR, "venue_directory.json")
if os.path.exists(VENUES_DIR_FILE):
    try:
        with open(VENUES_DIR_FILE, "r", encoding="utf-8") as _vf:
            _vdata = json.load(_vf)
            raw_v = _vdata.get("venues", {})
            v_list = raw_v.values() if isinstance(raw_v, dict) else raw_v
            for _v in v_list:
                v_n = _v.get("name")
                v_u = _v.get("venueUrl") or _v.get("websiteUrl")
                if v_n and v_u and v_n not in VENUE_URLS:
                    VENUE_URLS[v_n] = v_u
    except Exception:
        pass


# ==============================================================================
# AUTOMATED URL DEEP-LINK NORMALIZER & SAFEGUARD PIPELINE
# ==============================================================================

PROHIBITED_GENERIC_URL_REDIRECTS = {
    "https://redgate.tv": "https://redgate.tv/tickets/",
    "https://redgate.tv/": "https://redgate.tv/tickets/",
    "http://redgate.tv": "https://redgate.tv/tickets/",
    "http://redgate.tv/": "https://redgate.tv/tickets/",
    "https://ubcfarm.ubc.ca": "https://ubcfarm.ubc.ca/markets/",
    "https://ubcfarm.ubc.ca/": "https://ubcfarm.ubc.ca/markets/",
    "https://ubcfarm.ubc.ca/food": "https://ubcfarm.ubc.ca/markets/",
    "https://ubcfarm.ubc.ca/food/": "https://ubcfarm.ubc.ca/markets/",
    "https://vplf.ca": "https://www.vpl.ca/branches/central/level-9/roofgarden",
    "https://vplf.ca/": "https://www.vpl.ca/branches/central/level-9/roofgarden",
    "http://vplf.ca": "https://www.vpl.ca/branches/central/level-9/roofgarden",
    "http://vplf.ca/": "https://www.vpl.ca/branches/central/level-9/roofgarden",
    "https://www.vplf.ca": "https://www.vpl.ca/branches/central/level-9/roofgarden",
    "https://www.vplf.ca/": "https://www.vpl.ca/branches/central/level-9/roofgarden",
    "https://vpl.ca/roofgarden": "https://www.vpl.ca/branches/central/level-9/roofgarden",
    "https://www.vpl.ca/roofgarden": "https://www.vpl.ca/branches/central/level-9/roofgarden",
    "https://botanicalgarden.ubc.ca/visit/": "https://visit.ubc.ca/see-and-do/gardens-and-nature/ubc-rose-garden/",
    "https://botanicalgarden.ubc.ca/visit": "https://visit.ubc.ca/see-and-do/gardens-and-nature/ubc-rose-garden/",
    "https://visit.ubc.ca": "https://visit.ubc.ca/see-and-do/gardens-and-nature/ubc-rose-garden/",
    "https://visit.ubc.ca/": "https://visit.ubc.ca/see-and-do/gardens-and-nature/ubc-rose-garden/",
    "https://vandusengarden.org": "https://vancouver.ca/parks-recreation-culture/queen-elizabeth-park.aspx",
    "https://vandusengarden.org/": "https://vancouver.ca/parks-recreation-culture/queen-elizabeth-park.aspx",
    "https://vancouverchinesegarden.com/tickets-checkout/": "https://vancouverchinesegarden.com/visit/",
    "https://vancouverchinesegarden.com/tickets-checkout": "https://vancouverchinesegarden.com/visit/",
    "https://cafeauclay.com": "https://cafeauclay.com/products/drop-in-pottery-painting",
    "https://cafeauclay.com/": "https://cafeauclay.com/products/drop-in-pottery-painting",
    "https://lifedrawing.org": "https://lifedrawing.org/sessions",
    "https://lifedrawing.org/": "https://lifedrawing.org/sessions",
    "https://handeyeceramics.com": "https://handeyeceramics.com/open-studio",
    "https://handeyeceramics.com/": "https://handeyeceramics.com/open-studio",
    "https://publicdisco.ca": "https://publicdisco.ca/events",
    "https://publicdisco.ca/": "https://publicdisco.ca/events"
}

def normalize_event_links(url: str, venue: str = "", item: dict = None) -> str:
    """
    Automated URL deep-link normalizer:
    Guarantees event URLs point to verified schedule/ticketing endpoints rather than
    generic catalog indices, institutional landing pages, separate paid attractions, or dead ends.
    """
    if not url:
        return url
    cleaned = url.strip()

    # 1. Exact prohibited roots
    if cleaned in PROHIBITED_GENERIC_URL_REDIRECTS:
        return PROHIBITED_GENERIC_URL_REDIRECTS[cleaned]

    # 2. Autonomous hunter resolution if item context is provided
    if item and not (item.get('isDaily') or item.get('frequency') == 'daily'):
        is_gen, _ = is_generic_url(cleaned)
        if is_gen:
            hunt_res = AutonomousDeepLinkHunter.hunt(item, cleaned)
            if hunt_res.get("resolved"):
                return hunt_res["deepUrl"]

    # Pattern-based normalization for Red Gate
    if "redgate.tv" in cleaned.lower():
        path = re.sub(r'^https?://(?:www\.)?redgate\.tv/?', '', cleaned, flags=re.IGNORECASE).strip('/')
        if not path or path in ('video', 'live', 'player', 'webtv'):
            return "https://redgate.tv/tickets/"

    # Pattern-based normalization for UBC Farm
    if "ubcfarm.ubc.ca" in cleaned.lower():
        if "/food" in cleaned.lower() or cleaned.rstrip('/') in ("https://ubcfarm.ubc.ca", "http://ubcfarm.ubc.ca"):
            return "https://ubcfarm.ubc.ca/markets/"

    # Pattern-based normalization for VPL Rooftop Garden
    if "vplf.ca" in cleaned.lower():
        return "https://www.vpl.ca/branches/central/level-9/roofgarden"

    # Pattern-based normalization for UBC Rose Garden (preventing paid Botanical Garden confusion)
    if "botanicalgarden.ubc.ca" in cleaned.lower() and ("rose" in venue.lower() or "rose" in cleaned.lower()):
        return "https://visit.ubc.ca/see-and-do/gardens-and-nature/ubc-rose-garden/"

    # Pattern-based normalization for Queen Elizabeth Park (preventing paid VanDusen confusion)
    if "vandusengarden.org" in cleaned.lower() and "queen" in venue.lower():
        return "https://vancouver.ca/parks-recreation-culture/queen-elizabeth-park.aspx"

    # Pattern-based normalization for Dr. Sun Yat-Sen Public Courtyard (preventing ticket checkout confusion)
    if "vancouverchinesegarden.com/tickets-checkout" in cleaned.lower():
        return "https://vancouverchinesegarden.com/visit/"

    return cleaned


# ==============================================================================
# AUTOMATED TITLE & RECURRENCE LINTER PIPELINE
# ==============================================================================

RECURRING_MUSIC_LINEUP_RULES = {
    "red-gate-dead-soft": {
        "title": "Friday Night Live Indie & Underground at Red Gate",
        "artist": "Rotating local indie, punk & experimental bands",
        "aliases": ["Dead Soft", "Babe Corner", "Sore Points"]
    },
    "2nd-floor-gastown-sharon-minemoto": {
        "title": "Live Jazz & Supper Club at 2nd Floor Gastown",
        "artist": "Rotating local jazz trios & guest artists",
        "aliases": ["Sharon Minemoto", "Sharon Minemoto Trio"]
    },
    "frankies-jazz-brad-turner": {
        "title": "Weekend Live Jazz Showcase at Frankie's Jazz Club",
        "artist": "Rotating Canadian & international jazz artists",
        "aliases": ["Brad Turner", "Brad Turner Quartet"]
    },
    "lanalous-the-jolts": {
        "title": "Weekend Live Rock 'n' Roll at LanaLou's",
        "artist": "Rotating local punk, garage & rock bands",
        "aliases": ["The Jolts", "Tough Customer"]
    },
    "wise-hall-roots-revue": {
        "title": "East Van Roots, Folk & Live Music at The WISE Hall",
        "artist": "Rotating local roots, folk & bluegrass acts",
        "aliases": ["Roots & Bluegrass Revue"]
    }
}

def lint_recurring_music_event(item: dict) -> tuple[str, str, list]:
    """
    Automated recurrence-vs-lineup linter:
    Prevents weekly recurring music series from being named after a single weekend's flyer lineup.
    Safeguards future discovered events by enforcing series naming while archiving specific artists
    into search-indexed aliases.
    """
    event_id = item.get('id', '')
    raw_title = item.get('title', '')
    raw_artist = item.get('artist') or ''
    freq = item.get('frequency', '')
    cat = item.get('category', '')

    # Check registered recurring venue rules
    if event_id in RECURRING_MUSIC_LINEUP_RULES:
        rule = RECURRING_MUSIC_LINEUP_RULES[event_id]
        return rule["title"], rule["artist"], rule["aliases"]

    # General heuristic for newly discovered weekly/daily music events:
    if cat == 'music' and freq in ('weekly', 'daily'):
        m = re.search(r'^(.*?)\s+with\s+(.*?)\s+Live at\s+(.*)$', raw_title, flags=re.IGNORECASE)
        if m:
            headliner = m.group(1).strip()
            venue = m.group(3).strip()
            series_title = f"Live Music & Local Bands at {venue}"
            rotating_artist = "Rotating local bands & guest artists"
            return series_title, rotating_artist, [headliner]

    return raw_title, raw_artist, []

def sanitize_event_title(title: str) -> str:
    """
    Sanitizes event titles by stripping demographic concession tags, ticket schemes,
    and admission noise so card names represent authentic cultural events rather than discount categories.
    """
    cleaned = title
    # 1. Under-XX clubs or demographic qualifiers
    cleaned = re.sub(r':\s*Under-?\d+\s*(?:Symphony\s*)?Club', ' Live at The Orpheum', cleaned, flags=re.IGNORECASE)
    # 2. Concession ticket noise
    cleaned = re.sub(r':\s*Varsity\s+Sports\s+Admission', ': Home Varsity Games', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'(?::|\()\s*(?:Student|Senior|Member|Youth|General)\s+(?:Admission|Rush|Discount|Pass|Tier)\)?', '', cleaned, flags=re.IGNORECASE)
    # 3. Trailing punctuation or whitespace
    cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip(' :-,')
    return cleaned


# ==============================================================================
# UNIFIED SYNCHRONIZATION PIPELINE
# ==============================================================================

def run_sync() -> bool:
    print(f"[{datetime.now().isoformat()}] Starting Van50 Sync Worker...")
    os.makedirs(DATA_DIR, exist_ok=True)
    os.makedirs(JS_DIR, exist_ok=True)

    catalog = get_curated_seed_catalog()
    verified_events = []
    quarantined_events = []
    rejected_count = 0

    providers_count = {}
    frequency_count = {}
    categories_count = {}

    for item in catalog:
        event_id = item['id']

        # 0. Skip permanently dismissed or archived items FIRST (honoring curator guidance)
        learned = load_curator_learned_rules()
        if event_id in learned.get("archived_event_ids", []):
            print(f"[SKIP ARCHIVED] '{item['title']}' is permanently dismissed/archived.")
            continue

        # 0b. Dynamic Live Venue Adapter Authentication
        if VenueAdapterRegistry.has_adapter(event_id):
            item = VenueAdapterRegistry.authenticate_event(event_id, item)

        # 0b. Dynamic Scrapers: Editorial, Taxonomy, Nomadic Metadata & Door Limits
        item = DynamicEnricher.enrich_event(item)

        provider = item['provider']
        freq = item.get('frequency', 'one-off')
        cat = item.get('category', 'shows')
        raw_url = item.get('websiteUrl', '').strip()

        semantic_provider = item.get('semanticProvider')
        if not semantic_provider:
            if "ticketweb.ca" in raw_url or "ticketweb.com" in raw_url or provider == "TicketWeb":
                semantic_provider = "TicketWeb Verified"
            elif "dice.fm" in raw_url or provider == "DICE":
                semantic_provider = "DICE Verified"
            elif "shotgun.live" in raw_url or provider == "Shotgun":
                semantic_provider = "Shotgun Verified"
            elif "spektrix" in raw_url or "thecultch.com" in raw_url or provider == "Spektrix":
                semantic_provider = "Spektrix Verified"
            elif "vancouversymphony.ca" in raw_url or "artsclub.com" in raw_url or provider == "Tessitura":
                semantic_provider = "Tessitura Verified"
            elif "tickettailor.com" in raw_url or "buytickets.at" in raw_url or provider == "Ticket Tailor":
                semantic_provider = "Ticket Tailor Verified"
            elif "zeffy.com" in raw_url or provider == "Zeffy":
                semantic_provider = "Zeffy Verified"
            elif "humanitix.com" in raw_url or provider == "Humanitix":
                semantic_provider = "Humanitix Verified"
            elif "universe.com" in raw_url or provider == "Universe":
                semantic_provider = "Universe Verified"
            elif "ticketmaster.ca" in raw_url or "ticketmaster.com" in raw_url or provider == "Ticketmaster":
                semantic_provider = "Ticketmaster Verified"
            elif "axs.com" in raw_url or provider == "AXS":
                semantic_provider = "AXS Verified"
            elif "vtix.com" in raw_url or "vtixonline.com" in raw_url or provider == "VTix":
                semantic_provider = "VTix Verified"
            else:
                semantic_provider = provider
        item['semanticProvider'] = semantic_provider

        # 1. Automated URL Normalization & Deep-Link Safeguard
        url = normalize_event_links(raw_url, item.get('venue', ''), item)
        if url != raw_url:
            print(f"[URL NORM] Deep link normalized for '{item['title']}': '{raw_url}' -> '{url}'")
            item['websiteUrl'] = url

        # Universal Generic Link Quality Gate
        is_daily = item.get('isDaily', False) or item.get('frequency') == 'daily'
        is_gen, gen_reason = is_generic_url(url)
        if is_gen and not is_daily:
            # Attempt Autonomous Deep Link Hunt
            hunt_res = AutonomousDeepLinkHunter.hunt(item, url)
            if hunt_res.get("resolved"):
                upgraded_url = hunt_res["deepUrl"]
                print(f"[AUTONOMOUS HUNTER] Upgraded generic link for '{item['title']}': '{url}' -> '{upgraded_url}'")
                url = upgraded_url
                item['websiteUrl'] = url
            else:
                # FAIL-CLOSED QUALITY GATE:
                # Strictly exclude non-daily events with unresolved generic links from public events.json
                print(f"[FAIL-CLOSED GATE] '{item['title']}' has generic link '{url}' ({gen_reason}). Quarantining for curator review.")
                quarantined_item = {
                    "id": event_id,
                    "title": item['title'],
                    "venue": item['venue'],
                    "address": item.get('address', ''),
                    "neighborhood": item.get('neighborhood', ''),
                    "attemptedPrice": float(item.get('basePrice', 0.0)),
                    "attemptedPriceLabel": "Free ($0)" if (float(item.get('basePrice', 0.0)) == 0.0 or item.get('pricingType') == 'free') else f"${float(item.get('basePrice', 0.0)):.2f} door",
                    "provider": provider,
                    "semanticProvider": semantic_provider,
                    "websiteUrl": url,
                    "category": cat,
                    "flaggedAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00"),
                    "flagReason": f"Generic Link: {gen_reason}. Autonomous Hunter could not locate a specific event checkout page.",
                    "reviewStatus": "pending_manual_review",
                    "notes": "Generic URL detected. Curator review required to verify or assign specific event link."
                }
                quarantined_events.append(quarantined_item)
                continue

        if not url.startswith('http') or len(url) < 14:
            print(f"[REJECT] '{item['title']}' rejected: invalid ticket link.")
            rejected_count += 1
            continue

        # STRICT LIVE CHECKOUT PRICING SEARCH & VERIFICATION
        search_res = EventPricingSearchEngine.search_and_verify(item)
        if search_res.get("isArchived") or search_res.get("isOverBudget"):
            print(f"[AUTO-DENIED OVERBUDGET] '{item['title']}' was auto-denied (over $50 limit). Bypassing quarantine.")
            continue

        if not search_res.get("isVerified", False):
            flag_reason = search_res.get("quarantineReason", "Unverified live checkout pricing")
            print(f"[QUARANTINE] '{item['title']}' flagged for manual review: {flag_reason}")
            quarantined_item = {
                "id": event_id,
                "title": item['title'],
                "venue": item['venue'],
                "address": item.get('address', ''),
                "neighborhood": item.get('neighborhood', ''),
                "attemptedPrice": float(item.get('basePrice', 0.0)),
                "attemptedPriceLabel": "Free ($0)" if (float(item.get('basePrice', 0.0)) == 0.0 or item.get('pricingType') == 'free') else f"${float(item.get('basePrice', 0.0)):.2f} door",
                "provider": provider,
                "semanticProvider": semantic_provider,
                "websiteUrl": url,
                "category": cat,
                "flaggedAt": datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00"),
                "flagReason": flag_reason,
                "reviewStatus": "pending_manual_review",
                "notes": "Live check-out payload was not confirmed. User manual review required before publishing in app."
            }
            quarantined_events.append(quarantined_item)
            continue

        final_price = search_res["finalPrice"]
        price_label = search_res["priceLabel"]
        tiers = search_res.get("tiers") or item.get('tiers', [])
        verification = search_res["verification"]

        # Unified Multi-Tier Price Label Formatting
        if tiers and len(tiers) > 1 and not item.get("isSoldOut"):
            tier_prices = [float(t.get('price', 0.0)) for t in tiers if 'price' in t]
            if tier_prices:
                min_t = min(tier_prices)
                max_t = max(tier_prices)
                if min_t == max_t:
                    price_label = f"${min_t:.2f} all-in"
                elif min_t == 0:
                    price_label = f"Free – ${max_t:.2f} all-in"
                else:
                    price_label = f"${min_t:.2f} – ${max_t:.2f} all-in"

        # Budget Cap Check (<= $50 CAD) - Auto-deny to archive, never burden curator
        if final_price > 50.00:
            print(f"[AUTO-DENIED & ARCHIVED] '{item['title']}' rejected: ${final_price:.2f} > $50.00 CAD")
            rejected_count += 1
            auto_deny_and_archive_event(item, reason=f"Auto-Denied: Verified price (${final_price:.2f} CAD) strictly exceeds $50.00 CAD budget limit")
            continue

        # 2. Automated Title Sanitization & Recurrence-vs-Lineup Linter
        raw_title = item['title']
        clean_title = sanitize_event_title(raw_title)
        if clean_title != raw_title:
            print(f"[TITLE LINT] Cleaned ticket-type noise: '{raw_title}' -> '{clean_title}'")

        series_title, series_artist, preserved_aliases = lint_recurring_music_event(item)
        if series_title != raw_title:
            clean_title = sanitize_event_title(series_title)
            print(f"[RECURRENCE LINT] Generalized weekly music title: '{raw_title}' -> '{clean_title}'")
        if series_artist and series_artist != item.get('artist'):
            print(f"[RECURRENCE LINT] Set rotating artist description: '{item.get('artist')}' -> '{series_artist}'")
            item['artist'] = series_artist

        # Preserve any archived band names in venueAliases for instant search discovery
        if preserved_aliases:
            existing_aliases = list(item.get('venueAliases', []))
            for a in preserved_aliases:
                if a not in existing_aliases:
                    existing_aliases.append(a)
            item['venueAliases'] = existing_aliases

        raw_venue_url = VENUE_URLS.get(item['venue'], f"https://www.google.com/search?q={urllib.parse.quote_plus(item['venue'] + ' Vancouver')}")
        venue_clean_url = normalize_event_links(raw_venue_url, item['venue'])

        record = {
            "id": event_id,
            "title": clean_title,
            "artist": item.get('artist'),
            "performers": item.get('performers'),
            "venue": item['venue'],
            "venueAliases": item.get('venueAliases', []),
            "address": item['address'],
            "neighborhood": item['neighborhood'],
            "price": final_price,
            "priceLabel": price_label,
            "pricingType": item.get('pricingType', 'platform'),
            "tiers": tiers,
            "isFree": (final_price == 0 and not any(t.get('price', 0) > 0 for t in tiers)),
            "isDaily": (item.get('isDaily', False) or freq == 'daily'),
            "frequency": freq,
            "frequencyLabel": item.get('frequencyLabel', freq.capitalize()),
            "daysOfWeek": item.get('daysOfWeek', ['daily']),
            "timeSlots": item.get('timeSlots', ['afternoon']),
            "category": cat,
            "categoryLabel": item.get('categoryLabel', 'Shows & Music'),
            "categoryIcon": item.get('categoryIcon', '🎟️'),
            "subTags": item.get('subTags', []),
            "dateSchedule": item['dateSchedule'],
            "startIso": item.get('startIso'),
            "endIso": item.get('endIso'),
            "confirmedDates": item.get('confirmedDates', []),
            "isSoldOut": item.get('isSoldOut', False),
            "websiteUrl": url,
            "venueUrl": venue_clean_url,
            "ticketProvider": semantic_provider,
            "rawProvider": provider,
            "coordinates": item['coordinates'],
            "transitInfo": item['transitInfo'],
            "organizer": item.get('organizer'),
            "isRoving": item.get('isRoving', False),
            "editionVenue": item.get('editionVenue'),
            "agePolicy": item.get('agePolicy'),
            "admissionPolicy": item.get('admissionPolicy'),
            "rovingNote": item.get('rovingNote'),
            "description": item['description'],
            "checkoutVerification": verification
        }

        verified_events.append(record)
        providers_count[semantic_provider] = providers_count.get(semantic_provider, 0) + 1
        frequency_count[freq] = frequency_count.get(freq, 0) + 1
        categories_count[cat] = categories_count.get(cat, 0) + 1

    # 3. Dynamic Resident Advisor (ra.co) Live Discovery Ingestion
    print("\n[SYNC] Harvesting live Vancouver electronic & dance events from Resident Advisor (ra.co)...")
    try:
        ra_events = ResidentAdvisorAdapter.harvest_under_50_events(max_items=8)
        for ra_ev in ra_events:
            # Skip duplicates
            if any(e['id'] == ra_ev['id'] or e['title'].lower() == ra_ev['title'].lower() for e in verified_events):
                continue
            # Dynamic metadata enrichment
            ra_ev = DynamicEnricher.enrich_event(ra_ev)
            if ra_ev['price'] <= 50.00:
                verified_events.append(ra_ev)
                p_label = ra_ev.get('ticketProvider', 'Resident Advisor Verified')
                providers_count[p_label] = providers_count.get(p_label, 0) + 1
                frequency_count[ra_ev.get('frequency', 'one-off')] = frequency_count.get(ra_ev.get('frequency', 'one-off'), 0) + 1
                categories_count[ra_ev.get('category', 'music')] = categories_count.get(ra_ev.get('category', 'music'), 0) + 1
                print(f"[RA SYNC] Added verified RA event: '{ra_ev['title']}' @ {ra_ev['venue']} ({ra_ev['priceLabel']})")
    except Exception as e:
        print(f"[SYNC ERROR] Failed to harvest Resident Advisor events: {e}")

    # 4. Universal Venue Calendar Crawler & Automated Ingestion
    print("\n[SYNC] Running Universal Venue Calendar Crawler across registered directory venues...")
    try:
        uv_verified, uv_quarantined = UniversalVenueCrawler.harvest_all_venues(["Hollywood Theatre", "Rickshaw Theatre", "The Rickshaw Theatre", "Public Disco Society"])
        for uv_ev in uv_verified:
            # Skip duplicates
            if any(e['id'] == uv_ev['id'] or e['title'].lower() == uv_ev['title'].lower() for e in verified_events):
                continue
            # Dynamic metadata enrichment & normalize links
            uv_ev = DynamicEnricher.enrich_event(uv_ev)
            raw_v_url = VENUE_URLS.get(uv_ev['venue'], uv_ev.get('venueUrl', ''))
            uv_ev['venueUrl'] = normalize_event_links(raw_v_url, uv_ev['venue'])

            p_label = uv_ev.get('ticketProvider')
            if not p_label:
                m_prov = re.search(r'(ticketweb|showpass|dice|vtix|admitone|eventbrite|playmor|zeffy|humanitix|universe)', uv_ev.get('websiteUrl', ''), re.I)
                p_label = f"{m_prov.group(1).capitalize()} Verified" if m_prov else f"{uv_ev['venue']} Verified"
                uv_ev['ticketProvider'] = p_label

            if uv_ev['price'] <= 50.00:
                verified_events.append(uv_ev)
                providers_count[p_label] = providers_count.get(p_label, 0) + 1
                frequency_count[uv_ev.get('frequency', 'one-off')] = frequency_count.get(uv_ev.get('frequency', 'one-off'), 0) + 1
                cat = uv_ev.get('category', 'shows')
                categories_count[cat] = categories_count.get(cat, 0) + 1
                print(f"[UNIVERSAL SYNC] Ingested verified venue event: '{uv_ev['title']}' @ {uv_ev['venue']} ({uv_ev['priceLabel']})")

        learned = load_curator_learned_rules()
        for q_ev in uv_quarantined:
            if q_ev.get('id') in learned.get("archived_event_ids", []):
                continue
            if not any(q.get('id') == q_ev.get('id') or q.get('title', '').lower() == q_ev.get('title', '').lower() for q in quarantined_events):
                quarantined_events.append(q_ev)
    except Exception as e:
        print(f"[SYNC ERROR] Failed to run Universal Venue Crawler: {e}")

    # 5. Universal Festival Crawler Show & Screening Ingestion
    print("\n[SYNC] Harvesting active festival shows and screenings from UniversalFestivalCrawler...")
    try:
        fest_events = UniversalFestivalCrawler.harvest_all_active_festival_events()
        for f_ev in fest_events:
            # Skip duplicates
            if any(e['id'] == f_ev['id'] or e['title'].lower() == f_ev['title'].lower() for e in verified_events):
                continue
            # Dynamic metadata enrichment & normalize links
            f_ev = DynamicEnricher.enrich_event(f_ev)
            raw_v_url = VENUE_URLS.get(f_ev['venue'], f_ev.get('venueUrl', ''))
            if raw_v_url:
                f_ev['venueUrl'] = normalize_event_links(raw_v_url, f_ev['venue'])

            if f_ev['price'] <= 50.00:
                verified_events.append(f_ev)
                p_label = f_ev.get('ticketProvider', 'Festival Box Office Verified')
                providers_count[p_label] = providers_count.get(p_label, 0) + 1
                frequency_count[f_ev.get('frequency', 'seasonal')] = frequency_count.get(f_ev.get('frequency', 'seasonal'), 0) + 1
                cat = f_ev.get('category', 'shows')
                categories_count[cat] = categories_count.get(cat, 0) + 1
                print(f"[FESTIVAL SYNC] Ingested verified festival show: '{f_ev['title']}' @ {f_ev['venue']} ({f_ev['priceLabel']})")
    except Exception as e:
        print(f"[SYNC ERROR] Failed to harvest festival events: {e}")

    # Preserve any manually approved events currently in events.json not re-crawled
    if os.path.exists(JSON_PATH):
        try:
            with open(JSON_PATH, 'r', encoding='utf-8') as f:
                old_db = json.load(f)
            for old_ev in old_db.get('events', []):
                if old_ev.get('checkoutVerification', {}).get('method') == 'manual_curator_review':
                    # If already in verified_events or quarantined in this sync run, do not re-add
                    if any(e.get('id') == old_ev.get('id') for e in verified_events):
                        continue
                    if any(q.get('id') == old_ev.get('id') for q in quarantined_events):
                        continue

                    # Strict Budget Cap Guard (Never restore > $50 events)
                    old_price = float(old_ev.get('price', 0.0))
                    if old_price > 50.00:
                        auto_deny_and_archive_event(old_ev, reason=f"Auto-Denied: Price (${old_price:.2f}) exceeds $50.00 CAD budget cap")
                        continue

                    # Strict Fail-Closed Generic Link Guard on manually approved items
                    old_is_daily = old_ev.get('isDaily', False) or old_ev.get('frequency') == 'daily'
                    is_gen, gen_reason = is_generic_url(old_ev.get('websiteUrl', ''))
                    if is_gen and not old_is_daily:
                        old_ev["isVerified"] = False
                        old_ev["flagReason"] = f"Generic Link: {gen_reason}"
                        old_ev["quarantineReason"] = f"Generic Link: {gen_reason}"
                        quarantined_events.append(old_ev)
                        print(f"[FAIL-CLOSED GATE] Manually approved event '{old_ev['title']}' has generic link '{old_ev.get('websiteUrl')}'. Re-quarantined.")
                        continue

                    # Run drift detection against live page
                    drift_check = EventPricingSearchEngine.check_curator_drift(old_ev)
                    if drift_check.get("isDrift"):
                        old_ev["isVerified"] = False
                        old_ev["isDrift"] = True
                        old_ev["flagReason"] = drift_check.get("quarantineReason")
                        old_ev["quarantineReason"] = drift_check.get("quarantineReason")
                        quarantined_events.append(old_ev)
                        print(f"[DRIFT DETECTED] Re-quarantined: '{old_ev['title']}' -> {drift_check.get('quarantineReason')}")
                    else:
                        verified_events.append(old_ev)
                        p_label = old_ev.get('ticketProvider') or old_ev.get('semanticProvider') or "Curator Verified"
                        providers_count[p_label] = providers_count.get(p_label, 0) + 1
                        cat = old_ev.get('category', 'shows')
                        categories_count[cat] = categories_count.get(cat, 0) + 1
                        print(f"[PRESERVE CURATOR] Retained manually approved event: '{old_ev['title']}'")
        except Exception as e:
            print(f"[WARN] Could not preserve previous curator reviews: {e}")

    print(f"\n[SYNC COMPLETE] Total verified catalog events: {len(verified_events)}")
    print(f"[QUARANTINE QUEUE] Total events flagged for manual review: {len(quarantined_events)}")
    print(f"Categories Breakdown: {categories_count}")
    print(f"Semantic Providers Breakdown: {providers_count}")

    timestamp = datetime.now().strftime("%Y-%m-%dT%H:%M:%S-07:00")
    discovery_sources = []
    if os.path.exists(DISCOVERY_SOURCES_PATH):
        try:
            with open(DISCOVERY_SOURCES_PATH, 'r', encoding='utf-8') as f:
                discovery_sources = json.load(f).get('sources', [])
        except Exception as e:
            print(f"[WARN] Failed to load discovery sources: {e}")

    database = {
        "metadata": {
            "version": "4.1.0",
            "appName": "Van50",
            "updatedAt": timestamp,
            "region": "Vancouver, BC",
            "budgetLimit": 50.00,
            "currency": "CAD",
            "feeInclusive": True,
            "totalEvents": len(verified_events),
            "providersCount": len(providers_count),
            "discoverySourcesCount": len(discovery_sources),
            "quarantinedCount": len(quarantined_events)
        },
        "events": verified_events
    }

    # 1. Write data/events.json
    with open(JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(database, f, indent=2, ensure_ascii=False)
    print(f"[OK] Successfully wrote {len(verified_events)} verified events to {JSON_PATH}")

    # 2. Write data/manual_review_queue.json
    review_queue_payload = {
        "metadata": {
            "version": "1.0.0",
            "updatedAt": timestamp,
            "pendingCount": len(quarantined_events),
            "description": "Events quarantined for manual user review due to unverified live checkout pricing."
        },
        "quarantinedEvents": quarantined_events
    }
    with open(MANUAL_REVIEW_PATH, 'w', encoding='utf-8') as f:
        json.dump(review_queue_payload, f, indent=2, ensure_ascii=False)
    print(f"[OK] Successfully wrote {len(quarantined_events)} quarantined events to {MANUAL_REVIEW_PATH}")

    # 3. Write client offline fallback js/data.js
    js_content = f"""// Van50 — Vancouver Events & Outings (Strictly <= $50 CAD)
// AUTO-GENERATED from central data/events.json on {timestamp}
// Single Reference Source Architecture • 0 Client-Side Scraping

const VANCOUVER_EVENTS = {json.dumps(verified_events, indent=2, ensure_ascii=False)};
const MANUAL_REVIEW_QUEUE = {json.dumps(quarantined_events, indent=2, ensure_ascii=False)};

// Neighborhood List (Multi-selection enabled)
const NEIGHBORHOODS = [
  "Gastown / Chinatown",
  "Mount Pleasant",
  "Commercial Drive",
  "Downtown / West End",
  "Kitsilano",
  "Granville Island",
  "North Shore / Burnaby"
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

// Refined Category Definitions (Split Live Music & Comedy/Shows)
const CATEGORIES = [
  {{ id: "all", label: "All", icon: "✨" }},
  {{ id: "music", label: "Live Music", icon: "🎵" }},
  {{ id: "shows", label: "Comedy & Shows", icon: "🎭" }},
  {{ id: "crafts", label: "Crafts & Studios", icon: "🎨" }},
  {{ id: "cinema", label: "Cinema", icon: "🎬" }},
  {{ id: "arts", label: "Museums & Arts", icon: "🏛️" }},
  {{ id: "outdoors", label: "Walks & Outdoors", icon: "🌲" }},
  {{ id: "activities", label: "Games & Activities", icon: "🎲" }},
  {{ id: "trivia", label: "Drinks & Trivia", icon: "🍻" }}
];

// Curated Venue Homepages Directory
const VENUE_URLS = {json.dumps(VENUE_URLS, indent=2, ensure_ascii=False)};

// Curated Discovery Sources Directory
const DISCOVERY_SOURCES = {json.dumps(discovery_sources, indent=2, ensure_ascii=False)};
"""
    with open(JS_PATH, 'w', encoding='utf-8') as f:
        f.write(js_content)
    print(f"[OK] Successfully wrote {JS_PATH}")
    return True


if __name__ == '__main__':
    ok = run_sync()
    sys.exit(0 if ok else 1)
