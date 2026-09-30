import json
import os
import shutil
from datetime import datetime

BASE_DIR = r"c:\Users\Micro\.gemini\antigravity-ide\scratch\van50"
DATA_DIR = os.path.join(BASE_DIR, "data")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")

os.makedirs(BACKUP_DIR, exist_ok=True)
ts = datetime.now().strftime("%Y-%m-%d_%H%M%S")
shutil.copy2(QUEUE_PATH, os.path.join(BACKUP_DIR, f"queue_pre_scout_{ts}.json"))

with open(QUEUE_PATH, "r", encoding="utf-8") as f:
    queue = json.load(f)

quarantined = queue.get("quarantinedEvents", [])
existing_ids = {e.get("id") or e.get("event_id") for e in quarantined}

SCOUTED_DISCOVERIES = [
    {
        "id": "van50-scout-cultch-palestine-comedy-20261009",
        "title": "Palestine Comedy Club Showcase",
        "venue": "York Theatre",
        "address": "639 Commercial Dr, Vancouver, BC V5L 3W3",
        "neighborhood": "Commercial Drive & East Vancouver",
        "cluster": "Commercial Drive & East Vancouver",
        "category": "shows",
        "categoryLabel": "Comedy & Shows",
        "date": "2026-10-09",
        "time": "19:30",
        "price": 20.0,
        "priceLabel": "$20.00 CAD",
        "websiteUrl": "https://thecultch.com",
        "ticket_url": "https://thecultch.com",
        "ticket_provider": "The Cultch Box Office",
        "description": "Six Palestinian stand-up comedians perform live on stage alongside a screening of their documentary road movie, presented by The Cultch in partnership with Rumble Theatre.",
        "lineup": "Palestine Comedy Club Ensemble",
        "restrictions": "All Ages / 14+",
        "quarantineReason": "AI Scout Discovery (2026-09-29): Newly scouted from The Cultch & York Theatre calendar. Awaiting live-checkout cart basket inspection.",
        "unconfirmedDetails": ["Live-checkout cart pending audit."]
    },
    {
        "id": "van50-scout-rio-28days-double-bill-20261028",
        "title": "28 Days Later / 28 Weeks Later: Halloween Double Feature",
        "venue": "The Rio Theatre",
        "address": "1660 E Broadway, Vancouver, BC V5N 1W1",
        "neighborhood": "Commercial Drive & East Vancouver",
        "cluster": "Commercial Drive & East Vancouver",
        "category": "cinema",
        "categoryLabel": "Indie Cinema",
        "date": "2026-10-28",
        "time": "18:30",
        "price": 15.0,
        "priceLabel": "$15.00 advance double feature / $10.50 single",
        "websiteUrl": "https://riotheatre.ca",
        "ticket_url": "https://riotheatre.ca",
        "ticket_provider": "The Rio Theatre Box Office",
        "description": "The Rio Theatre presents a post-apocalyptic Halloween double bill featuring Danny Boyle's seminal 28 Days Later followed by 28 Weeks Later on the big screen.",
        "lineup": "Danny Boyle / Juan Carlos Fresnadillo Screenings",
        "restrictions": "19+ (Valid ID required)",
        "quarantineReason": "AI Scout Discovery (2026-09-29): Newly scouted from The Rio Theatre October calendar. Awaiting live-checkout cart basket inspection.",
        "unconfirmedDetails": ["Live-checkout cart pending audit."]
    },
    {
        "id": "van50-scout-cinematheque-kwaidan-20261012",
        "title": "Forbidden Rooms: Kwaidan (1964)",
        "venue": "The Cinematheque",
        "address": "1131 Howe St, Vancouver, BC V6Z 1R1",
        "neighborhood": "Downtown, Gastown & Yaletown",
        "cluster": "Downtown, Gastown & Yaletown",
        "category": "cinema",
        "categoryLabel": "Indie Cinema",
        "date": "2026-10-12",
        "time": "19:00",
        "price": 14.0,
        "priceLabel": "$14.00 regular / $12.00 student-senior",
        "websiteUrl": "https://thecinematheque.ca",
        "ticket_url": "https://thecinematheque.ca",
        "ticket_provider": "The Cinematheque Box Office",
        "description": "Masaki Kobayashi's breathtaking, Oscar-nominated supernatural horror anthology screened as part of the curated Forbidden Rooms: Halloween on Howe series.",
        "lineup": "Masaki Kobayashi Retrospective",
        "restrictions": "All Ages",
        "quarantineReason": "AI Scout Discovery (2026-09-29): Newly scouted from The Cinematheque October calendar. Awaiting live-checkout cart basket inspection.",
        "unconfirmedDetails": ["Live-checkout cart pending audit."]
    },
    {
        "id": "van50-scout-cinematheque-hello-destroyer-20261027",
        "title": "Hello Destroyer (Free Public Screening)",
        "venue": "The Cinematheque",
        "address": "1131 Howe St, Vancouver, BC V6Z 1R1",
        "neighborhood": "Downtown, Gastown & Yaletown",
        "cluster": "Downtown, Gastown & Yaletown",
        "category": "cinema",
        "categoryLabel": "Indie Cinema",
        "date": "2026-10-27",
        "time": "19:00",
        "price": 0.0,
        "priceLabel": "Free ($0.00)",
        "websiteUrl": "https://thecinematheque.ca",
        "ticket_url": "https://thecinematheque.ca",
        "ticket_provider": "The Cinematheque Free Access",
        "description": "Special free public admission screening of Kevan Funk's acclaimed Canadian hockey drama Hello Destroyer exploring institutionalized athletic violence.",
        "lineup": "Kevan Funk Screening",
        "restrictions": "All Ages",
        "quarantineReason": "AI Scout Discovery (2026-09-29): Newly scouted from The Cinematheque. Free public admission tier.",
        "unconfirmedDetails": ["Free admission pre-registration / door capacity check."]
    },
    {
        "id": "van50-scout-lmg-20-20-20-comedy-20261017",
        "title": "20/20/20 Vancouver Stand-Up Comedy Showcase",
        "venue": "Little Mountain Gallery",
        "address": "110 E 5th Ave, Vancouver, BC V5T 1G8",
        "neighborhood": "Mount Pleasant & South Vancouver",
        "cluster": "Mount Pleasant & South Vancouver",
        "category": "shows",
        "categoryLabel": "Comedy & Shows",
        "date": "2026-10-17",
        "time": "20:00",
        "price": 18.99,
        "priceLabel": "$18.99 – $29.25 CAD all-in",
        "websiteUrl": "https://www.showpass.com/o/little-mountain-gallery/",
        "ticket_url": "https://www.showpass.com/o/little-mountain-gallery/",
        "ticket_provider": "Showpass",
        "description": "Fast-paced standup comedy showcase where 20 of Vancouver's top touring and local comedians deliver their sharpest material at Little Mountain Gallery.",
        "lineup": "20 Vancouver Standup Comedians",
        "restrictions": "19+ (Valid ID required)",
        "quarantineReason": "AI Scout Discovery (2026-09-29): Newly scouted from Little Mountain Gallery Showpass hub. Awaiting live-checkout cart basket inspection.",
        "unconfirmedDetails": ["Live-checkout cart pending audit."]
    },
    {
        "id": "van50-scout-lmg-the-setup-20261024",
        "title": "The Setup at Little Mountain Gallery",
        "venue": "Little Mountain Gallery",
        "address": "110 E 5th Ave, Vancouver, BC V5T 1G8",
        "neighborhood": "Mount Pleasant & South Vancouver",
        "cluster": "Mount Pleasant & South Vancouver",
        "category": "shows",
        "categoryLabel": "Comedy & Shows",
        "date": "2026-10-24",
        "time": "20:30",
        "price": 17.96,
        "priceLabel": "$17.96 – $24.12 CAD all-in",
        "websiteUrl": "https://www.showpass.com/o/little-mountain-gallery/",
        "ticket_url": "https://www.showpass.com/o/little-mountain-gallery/",
        "ticket_provider": "Showpass",
        "description": "Monthly underground comedy showcase featuring sharp standup, absurd characters, and special surprise guests in Mount Pleasant.",
        "lineup": "The Setup Comedy Ensemble",
        "restrictions": "19+ (Valid ID required)",
        "quarantineReason": "AI Scout Discovery (2026-09-29): Newly scouted from Little Mountain Gallery Showpass hub. Awaiting live-checkout cart basket inspection.",
        "unconfirmedDetails": ["Live-checkout cart pending audit."]
    },
    {
        "id": "van50-scout-improv-centre-blockbuster-20261008",
        "title": "Blockbuster: Horrors & Hilarity Live Improv",
        "venue": "The Improv Centre",
        "address": "1502 Duranleau St, Vancouver, BC V6H 3S4",
        "neighborhood": "Granville Island & False Creek",
        "cluster": "Granville Island & False Creek",
        "category": "shows",
        "categoryLabel": "Comedy & Shows",
        "date": "2026-10-08",
        "time": "19:00",
        "price": 20.0,
        "priceLabel": "$15.00 – $25.00 CAD",
        "websiteUrl": "https://theimprovcentre.ca/shows/",
        "ticket_url": "https://theimprovcentre.ca/shows/",
        "ticket_provider": "The Improv Centre Box Office",
        "description": "The Improv Centre ensemble creates a completely unscripted, spontaneous horror-comedy blockbuster live on stage on Granville Island.",
        "lineup": "The Improv Centre Ensemble",
        "restrictions": "All Ages / Youth Welcome",
        "quarantineReason": "AI Scout Discovery (2026-09-29): Newly scouted from The Improv Centre October calendar. Awaiting live-checkout cart basket inspection.",
        "unconfirmedDetails": ["Live-checkout cart pending audit."]
    },
    {
        "id": "van50-scout-fox-cheap-thrills-20261002",
        "title": "Cheap Thrills Dance Party",
        "venue": "The Fox Cabaret",
        "address": "2321 Main St, Vancouver, BC V5T 3C9",
        "neighborhood": "Mount Pleasant & South Vancouver",
        "cluster": "Mount Pleasant & South Vancouver",
        "category": "shows",
        "categoryLabel": "Comedy & Shows",
        "date": "2026-10-02",
        "time": "22:30",
        "price": 8.0,
        "priceLabel": "$8.00 advance / $10.00 door",
        "websiteUrl": "https://foxcabaret.com/calendar",
        "ticket_url": "https://foxcabaret.com/calendar",
        "ticket_provider": "Fox Cabaret Box Office / Eventbrite",
        "description": "Budget-friendly weekend kickoff dance party spinning indie pop, classic disco, and retro dance anthems late night on Main Street.",
        "lineup": "Fox Cabaret Resident DJs",
        "restrictions": "19+ (Valid ID required)",
        "quarantineReason": "AI Scout Discovery (2026-09-29): Newly scouted from The Fox Cabaret calendar. Awaiting live-checkout cart basket inspection.",
        "unconfirmedDetails": ["Live-checkout cart pending audit."]
    },
    {
        "id": "van50-scout-rickshaw-dangelo-tribute-20261018",
        "title": "Dawn Pemberton & The Brown Sugar: The Music of D'Angelo",
        "venue": "Rickshaw Theatre",
        "address": "254 E Hastings St, Vancouver, BC V6A 1P1",
        "neighborhood": "Downtown, Gastown & Yaletown",
        "cluster": "Downtown, Gastown & Yaletown",
        "category": "music",
        "categoryLabel": "Live Music",
        "date": "2026-10-18",
        "time": "19:30",
        "price": 30.0,
        "priceLabel": "$30.00 advance + s/c",
        "websiteUrl": "https://rickshawtheatre.com/events/",
        "ticket_url": "https://rickshawtheatre.com/events/",
        "ticket_provider": "Rickshaw Box Office / Infidels Jazz",
        "description": "Vancouver soul icon Dawn Pemberton leads an 8-piece power ensemble celebrating the neo-soul grooves and catalog of D'Angelo at the Rickshaw Theatre.",
        "lineup": "Dawn Pemberton & The Brown Sugar",
        "restrictions": "19+ (Valid ID required)",
        "quarantineReason": "AI Scout Discovery (2026-09-29): Newly scouted from Rickshaw Theatre calendar. Awaiting live-checkout cart basket inspection.",
        "unconfirmedDetails": ["Live-checkout cart pending audit."]
    },
    {
        "id": "van50-scout-rickshaw-amy-winehouse-20261017",
        "title": "Amy Winehouse Tribute with Krystle Dos Santos",
        "venue": "Rickshaw Theatre",
        "address": "254 E Hastings St, Vancouver, BC V6A 1P1",
        "neighborhood": "Downtown, Gastown & Yaletown",
        "cluster": "Downtown, Gastown & Yaletown",
        "category": "music",
        "categoryLabel": "Live Music",
        "date": "2026-10-17",
        "time": "19:30",
        "price": 30.0,
        "priceLabel": "$30.00 advance + s/c",
        "websiteUrl": "https://rickshawtheatre.com/events/",
        "ticket_url": "https://rickshawtheatre.com/events/",
        "ticket_provider": "Rickshaw Box Office / Infidels Jazz",
        "description": "Two-time Western Canadian Music Award winner Krystle Dos Santos channels the raw emotion and timeless soul of Amy Winehouse with an all-star rhythm section.",
        "lineup": "Krystle Dos Santos & Infidels Jazz",
        "restrictions": "19+ (Valid ID required)",
        "quarantineReason": "AI Scout Discovery (2026-09-29): Newly scouted from Rickshaw Theatre calendar. Awaiting live-checkout cart basket inspection.",
        "unconfirmedDetails": ["Live-checkout cart pending audit."]
    }
]

added_count = 0
for disc in SCOUTED_DISCOVERIES:
    if disc["id"] not in existing_ids:
        quarantined.append(disc)
        existing_ids.add(disc["id"])
        added_count += 1

queue["quarantinedEvents"] = quarantined
queue["pendingCount"] = len(quarantined)
if "metadata" in queue:
    queue["metadata"]["pendingCount"] = len(quarantined)
    queue["metadata"]["updatedAt"] = datetime.now().strftime("%Y-%m-%d")

with open(QUEUE_PATH, "w", encoding="utf-8") as f:
    json.dump(queue, f, indent=2, ensure_ascii=False)

print(f"[AI SCOUT PASS COMPLETED]")
print(f"Newly Discovered Events Scouted: {added_count}")
print(f"Total In Quarantine Review Queue: {len(quarantined)}")
print(f"Rule 4 Compliance: 100% of newly scouted events deposited directly to quarantine.")
