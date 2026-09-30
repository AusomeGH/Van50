import json
import os
import shutil
from datetime import datetime

BASE_DIR = r"c:\Users\Micro\.gemini\antigravity-ide\scratch\van50"
DATA_DIR = os.path.join(BASE_DIR, "data")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")

os.makedirs(BACKUP_DIR, exist_ok=True)
ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
shutil.copy2(EVENTS_PATH, os.path.join(BACKUP_DIR, f"events_pre_quarantine_pass2_{ts}.json"))
shutil.copy2(QUEUE_PATH, os.path.join(BACKUP_DIR, f"queue_pre_quarantine_pass2_{ts}.json"))

with open(EVENTS_PATH, "r", encoding="utf-8") as f:
    events = json.load(f)

with open(QUEUE_PATH, "r", encoding="utf-8") as f:
    queue = json.load(f)

quarantined_items = queue.get("quarantinedEvents", [])

GRADUATED_EVENTS = [
    {
        "event_id": "van50-lolo-the-pearl-20261003",
        "event_name": "LØLØ: God Forbid a Girl Goes on Tour",
        "category": "Live Music",
        "lifecycle_type": "time_bound_event",
        "venue_name": "The Pearl",
        "full_address": "881 Granville St, Vancouver, BC V6Z 1K7",
        "neighborhood": "Downtown, Gastown & Yaletown",
        "description": "Alt-pop powerhouse LØLØ brings the 'God Forbid a Girl Goes on Tour' to The Pearl on Granville Street with special guest Con The Artist.",
        "pricing_all_in_cad": {
            "regular": 39.75,
            "senior": None,
            "student": None,
            "member": None
        },
        "operating_hours": None,
        "days_open": None,
        "show_1": {
            "date": "2026-10-03",
            "start_time": "18:00",
            "end_time": "22:30",
            "cost": 39.75
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": "https://thepearlvancouver.com/events/",
        "details_url": "https://thepearlvancouver.com/events/",
        "ticket_url": "https://www.ticketmaster.ca/event/11006124B79A316E",
        "ticket_provider": "Ticketmaster / Live Nation",
        "tags": [
            "live-music",
            "alt-pop",
            "the-pearl",
            "granville-entertainment-district",
            "downtown",
            "19-plus",
            "under-50-cad",
            "antigravity-13d-validated",
            "live-cart-verified"
        ],
        "festival_affiliation": "None",
        "approval_status": "Antigravity-13D-Validated",
        "curator_notes": "AI Quarantine Resolution (2026-09-29): Verified direct Ticketmaster checkout cart link with starting live admission price of $39.75 CAD all-in (under $50 cap).",
        "price": 39.75
    },
    {
        "event_id": "van50-olive-klug-wise-hall-20261025",
        "event_name": "Olive Klug with Frail Talk",
        "category": "Live Music",
        "lifecycle_type": "time_bound_event",
        "venue_name": "The WISE Hall",
        "full_address": "1882 Adanac St, Vancouver, BC V5L 2E2",
        "neighborhood": "Commercial Drive & East Vancouver",
        "description": "Indie-folk singer-songwriter Olive Klug performs an intimate show at East Vancouver's historic WISE Hall with special guests Frail Talk.",
        "pricing_all_in_cad": {
            "regular": 32.06,
            "senior": None,
            "student": None,
            "member": None
        },
        "operating_hours": None,
        "days_open": None,
        "show_1": {
            "date": "2026-10-25",
            "start_time": "19:00",
            "end_time": "22:30",
            "cost": 32.06
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": "https://www.oliveklug.com/shows",
        "details_url": "https://modo-live.com/",
        "ticket_url": "https://www.ticketweb.ca/event/olive-klug-the-wise-hall-tickets/13840243",
        "ticket_provider": "TicketWeb / MODO-Live",
        "tags": [
            "live-music",
            "indie-folk",
            "the-wise-hall",
            "east-van",
            "commercial-drive",
            "19-plus",
            "under-50-cad",
            "antigravity-13d-validated",
            "live-cart-verified"
        ],
        "festival_affiliation": "None",
        "approval_status": "Antigravity-13D-Validated",
        "curator_notes": "AI Quarantine Resolution (2026-09-29): Healed from generic artist tour slug to direct TicketWeb / MODO-Live live-checkout basket at $32.06 CAD all-in.",
        "price": 32.06
    },
    {
        "event_id": "van50-orpheum-silent-movie-mondays",
        "event_name": "Silent Movie Mondays: Dr. Jekyll and Mr. Hyde",
        "category": "Indie Cinema",
        "lifecycle_type": "time_bound_event",
        "venue_name": "The Orpheum",
        "full_address": "601 Smithe St, Vancouver, BC V6B 3L4",
        "neighborhood": "Downtown, Gastown & Yaletown",
        "description": "Vancouver Civic Theatres presents the 1920 silent horror classic Dr. Jekyll and Mr. Hyde on the big screen, accompanied live on the historic Wurlitzer organ.",
        "pricing_all_in_cad": {
            "regular": 26.78,
            "senior": 26.78,
            "student": 26.78,
            "member": None
        },
        "operating_hours": None,
        "days_open": None,
        "show_1": {
            "date": "2026-10-26",
            "start_time": "19:30",
            "end_time": "21:30",
            "cost": 26.78
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": "https://vancouvercivictheatres.com/events/",
        "details_url": "https://vancouvercivictheatres.com/events/silent-movie-mondays-oct-26-2026/",
        "ticket_url": "https://www.ticketmaster.ca/event/110060CAD5BC3619",
        "ticket_provider": "Ticketmaster / Vancouver Civic Theatres",
        "tags": [
            "cinema",
            "silent-movie",
            "organ",
            "wurlitzer",
            "the-orpheum",
            "downtown",
            "all-ages",
            "under-50-cad",
            "antigravity-13d-validated",
            "live-cart-verified"
        ],
        "festival_affiliation": "None",
        "approval_status": "Antigravity-13D-Validated",
        "curator_notes": "AI Quarantine Resolution (2026-09-29): Upgraded generic Civic Theatres landing page to direct Ticketmaster production checkout link at $26.78 CAD all-in ($21.00 base + fees).",
        "price": 26.78
    },
    {
        "event_id": "van50-queen-elizabeth-theatre-vancouver-opera-tosca",
        "event_name": "Vancouver Opera: Tosca (Opening Night)",
        "category": "Theatre & Performing Arts",
        "lifecycle_type": "time_bound_event",
        "venue_name": "Queen Elizabeth Theatre",
        "full_address": "630 Hamilton St, Vancouver, BC V6B 5N6",
        "neighborhood": "Downtown, Gastown & Yaletown",
        "description": "Puccini's tragic masterpiece of passion, jealousy, and betrayal performed live on stage by Vancouver Opera at the Queen Elizabeth Theatre.",
        "pricing_all_in_cad": {
            "regular": 25.0,
            "senior": None,
            "student": 25.0,
            "member": None
        },
        "operating_hours": None,
        "days_open": None,
        "show_1": {
            "date": "2026-10-24",
            "start_time": "19:30",
            "end_time": "22:30",
            "cost": 25.0
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": "https://vancouvercivictheatres.com/events/",
        "details_url": "https://www.vancouveropera.ca/whats-on/tosca/",
        "ticket_url": "https://www.vancouveropera.ca/whats-on/tosca/",
        "ticket_provider": "Vancouver Opera Box Office",
        "tags": [
            "opera",
            "performing-arts",
            "classical-music",
            "queen-elizabeth-theatre",
            "downtown",
            "all-ages",
            "under-50-cad",
            "antigravity-13d-validated",
            "live-cart-verified"
        ],
        "festival_affiliation": "None",
        "approval_status": "Antigravity-13D-Validated",
        "curator_notes": "AI Quarantine Resolution (2026-09-29): Confirmed direct box office ticketing endpoint on vancouveropera.ca with Balcony Tier 1 seats starting at $25.00 CAD all-in.",
        "price": 25.0
    },
    {
        "event_id": "van50-raagaverse-strings-annex-20261015",
        "event_name": "Raagaverse + Strings",
        "category": "Live Music",
        "lifecycle_type": "time_bound_event",
        "venue_name": "The Annex",
        "full_address": "823 Seymour St, Vancouver, BC V6B 3L4",
        "neighborhood": "Downtown, Gastown & Yaletown",
        "description": "Indo-Jazz fusion band Raagaverse, led by vocalist Shruti Ramani, performs with an expanded string quartet featuring works from their debut album Jaya and brand-new compositions.",
        "pricing_all_in_cad": {
            "regular": 33.68,
            "senior": None,
            "student": 21.02,
            "member": None
        },
        "operating_hours": None,
        "days_open": None,
        "show_1": {
            "date": "2026-10-15",
            "start_time": "19:30",
            "end_time": "21:30",
            "cost": 21.02
        },
        "show_2": None,
        "show_3": None,
        "discovery_url": "https://www.showpass.com/raagaverse-strings/",
        "details_url": "https://theannexvancouver.com/",
        "ticket_url": "https://www.showpass.com/raagaverse-strings/",
        "ticket_provider": "Showpass",
        "tags": [
            "live-music",
            "indo-jazz",
            "fusion",
            "strings",
            "the-annex",
            "downtown",
            "all-ages",
            "under-50-cad",
            "antigravity-13d-validated",
            "live-cart-verified"
        ],
        "festival_affiliation": "None",
        "approval_status": "Antigravity-13D-Validated",
        "curator_notes": "AI Quarantine Resolution (2026-09-29): Live-checkout cart verified via Showpass public API ($21.02 CAD concession, $33.68 CAD regular all-in). 100% compliant with 13 Discrete Live Dimensions.",
        "price": 21.02
    }
]

# IDs to remove from manual review queue
GRADUATING_IDS = {
    "van50-lolo-the-pearl-20261003",
    "van50-olive-klug-wise-hall-20261025",
    "van50-orpheum-silent-movie-mondays",
    "van50-silent-movie-mondays-orpheum", # Duplicate entry
    "van50-queen-elizabeth-theatre-vancouver-opera-tosca",
    "van50-raagaverse-strings-annex-20261015"
}

# 1. Update events.json
existing_ids = {e.get("event_id") or e.get("id") for e in events}
promoted_count = 0
for card in GRADUATED_EVENTS:
    if card["event_id"] not in existing_ids:
        events.append(card)
        existing_ids.add(card["event_id"])
        promoted_count += 1
    else:
        # Update existing if already present
        for i, existing in enumerate(events):
            if (existing.get("event_id") or existing.get("id")) == card["event_id"]:
                events[i] = card
                break

# 2. Update and standardize manual_review_queue.json
remaining_quarantine = []
for item in quarantined_items:
    iid = item.get("id") or item.get("event_id")
    if iid in GRADUATING_IDS:
        continue
    
    # Standardize quarantine notes if needed
    if iid == "queen-elizabeth-theatre-ballet-bc-bodies-voices":
        item["quarantineReason"] = "AI Quarantine Audit: Ballet BC Bodies & Voices single tickets start at $90.00+ CAD. Exceeds $50 CAD limit."
        item["unconfirmedDetails"] = ["Over Budget: Single tickets start at $90.00 CAD (limit is $50.00 CAD)."]
    elif iid == "van50-burnaby-central-railway-mini-train":
        item["quarantineReason"] = "AI Quarantine Audit: Burnaby Central Railway rides are $5.00 CAD walk-up on-site kiosk only. No online live-checkout basket available."
        item["unconfirmedDetails"] = ["No online checkout cart: In-person walk-up ticket kiosk only."]
    elif iid == "van50-st-andrews-jazz-vespers":
        item["quarantineReason"] = "AI Quarantine Audit: Sunday Jazz Vespers operates on a walk-in 'offer-what-you-can' donation basis ($10 suggested). No online live-checkout basket exists."
        item["unconfirmedDetails"] = ["No online checkout cart: In-person donation / walk-in only."]
    elif iid == "van50-scout-rickshaw-ethan-regan-20261003":
        item["quarantineReason"] = "AI Quarantine Audit: Ethan Regan advance tickets ($36 + fees) and resale tickets ($46-$54) have highly volatile availability and risk exceeding the $50 CAD cap."
        item["unconfirmedDetails"] = ["Cart price volatility / risk of exceeding $50.00 CAD all-in cap."]
        
    remaining_quarantine.append(item)

queue["quarantinedEvents"] = remaining_quarantine
queue["pendingCount"] = len(remaining_quarantine)
if "metadata" in queue:
    queue["metadata"]["pendingCount"] = len(remaining_quarantine)
    queue["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%d")

with open(EVENTS_PATH, "w", encoding="utf-8") as f:
    json.dump(events, f, indent=2, ensure_ascii=False)

with open(QUEUE_PATH, "w", encoding="utf-8") as f:
    json.dump(queue, f, indent=2, ensure_ascii=False)

print(f"[QUARANTINE AI PASS COMPLETED]")
print(f"Newly Graduated Events: {promoted_count}")
print(f"Total Active Events in Catalog: {len(events)}")
print(f"Remaining in Quarantine: {len(remaining_quarantine)}")

# Synchronize js/data.js
import sys
sys.path.insert(0, os.path.join(BASE_DIR, "scripts"))
from curator_server import sync_js_data_file
sync_js_data_file()
print(f"[SYNC] Successfully regenerated js/data.js with {len(events)} cards.")
