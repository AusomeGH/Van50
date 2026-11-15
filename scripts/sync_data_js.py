import json
import re

with open("data/events.json", "r", encoding="utf-8-sig") as f:
    events = json.load(f)

surrey_sources = []
try:
    with open("data/surrey_reference_sources.json", "r", encoding="utf-8-sig") as f:
        surrey_sources = json.load(f)
except Exception:
    pass

surrey_re = re.compile(
    r"\b(surrey|whalley|guildford|fleetwood|fraser heights|newton|bear creek|panorama|sullivan heights|cloverdale|clayton|south surrey|grandview heights|crescent beach|bridgeview)\b",
    re.IGNORECASE,
)

updated_events = False

DROP_IN_SCHEDULE_FIXES = {
    "van50-bloedel-conservatory-dome": {
        "dateSchedule": "Daily: 10:00 AM – 5:00 PM",
        "weekly_hours": "Daily: 10:00 AM - 5:00 PM",
        "time": "10:00 AM – 5:00 PM",
    },
    "van50-canada-place-promenade": {
        "dateSchedule": "Daily: 6:00 AM – 11:00 PM • Free Outdoor Promenade",
        "weekly_hours": "Daily: 6:00 AM - 11:00 PM",
        "time": "6:00 AM – 11:00 PM",
    },
    "van50-the-shipyards-lonsdale-quay": {
        "dateSchedule": "Daily: 10:00 AM – 8:00 PM (Outdoor Waterfront Plaza 24/7)",
        "weekly_hours": "Daily: 10:00 AM - 8:00 PM",
        "time": "10:00 AM – 8:00 PM",
    },
    "van50-vancouver-art-gallery-free-access": {
        "dateSchedule": "Wed–Mon: 10:00 AM – 5:00 PM • Fri: 10:00 AM – 8:00 PM (Closed Tuesdays)",
        "weekly_hours": "Wed-Thu: 10:00 AM - 5:00 PM; Fri: 10:00 AM - 8:00 PM; Sat-Mon: 10:00 AM - 5:00 PM; Tue: Closed",
        "time": "10:00 AM – 5:00 PM (Fri until 8:00 PM)",
    },
    "van50-bill-reid-gallery-indigenous-art": {
        "dateSchedule": "Wed–Sun: 10:00 AM – 5:00 PM (Closed Mon–Tue)",
        "weekly_hours": "Wed-Sun: 10:00 AM - 5:00 PM; Mon-Tue: Closed",
        "time": "10:00 AM – 5:00 PM",
    },
    "van50-sun-yat-sen-public-park": {
        "dateSchedule": "Wed–Sun: 9:30 AM – 4:00 PM (Closed Mon–Tue)",
        "weekly_hours": "Wed-Sun: 9:30 AM - 4:00 PM; Mon-Tue: Closed",
        "time": "9:30 AM – 4:00 PM",
    },
    "stanley-park-seawall-rose-garden": {
        "dateSchedule": "Open Daily: 6:00 AM – 10:00 PM",
        "weekly_hours": "Daily: 6:00 AM - 10:00 PM",
        "time": "6:00 AM – 10:00 PM",
    },
    "stanley-park-siwash-rock": {
        "dateSchedule": "Open Daily: 6:00 AM – 10:00 PM",
        "weekly_hours": "Daily: 6:00 AM - 10:00 PM",
        "time": "6:00 AM – 10:00 PM",
    },
    "van50-diwali-fest-diwali-celebration-society-diwali-in-surrey-nov-15-2026": {
        "weekly_hours": None,
    },
}

# 1. Ensure every existing compiled event has city, region, lat, lng, url, day, recurrence
for ev in events:
    ev_id = ev.get("id") or ev.get("event_id")
    if ev_id in DROP_IN_SCHEDULE_FIXES:
        for k, v in DROP_IN_SCHEDULE_FIXES[ev_id].items():
            if ev.get(k) != v:
                ev[k] = v
                updated_events = True
    raw_hood = str(ev.get("neighborhood") or "")
    raw_addr = f"{ev.get('address') or ''} {ev.get('full_address') or ''}"
    is_east_van_grandview = bool(re.search(r"grandview[- ]woodland", raw_hood, re.I) or re.search(r"\bvancouver\b", raw_addr, re.I))
    raw_loc = f"{raw_hood} {raw_addr}"
    inferred_city = "Surrey" if (not is_east_van_grandview and surrey_re.search(raw_loc)) else "Vancouver"
    if ev.get("city") != inferred_city or ev.get("region") != inferred_city:
        ev["city"] = inferred_city
        ev["region"] = inferred_city
        updated_events = True
    coords = ev.get("coordinates")
    if isinstance(coords, list) and len(coords) >= 2:
        if ev.get("lat") is None:
            ev["lat"] = float(coords[0])
            updated_events = True
        if ev.get("lng") is None:
            ev["lng"] = float(coords[1])
            updated_events = True
    if not ev.get("url"):
        ev["url"] = (
            ev.get("ticket_url")
            or ev.get("details_url")
            or (ev.get("links") or {}).get("best_available")
            or "https://vancouver.ca"
        )
        updated_events = True
    if not ev.get("day"):
        ev["day"] = ev.get("date") or "Daily"
        updated_events = True
    if not ev.get("recurrence"):
        ev["recurrence"] = ev.get("frequency") or ev.get("frequencyLabel") or "Recurring"
        updated_events = True


for src_path in ("data/discovery_sources.json", "data/scout_master_sources.json"):
    try:
        with open(src_path, "r", encoding="utf-8-sig") as f:
            doc = json.load(f)
        if isinstance(doc, dict):
            doc["SURREY_REFERENCE_SOURCES"] = surrey_sources
            with open(src_path, "w", encoding="utf-8") as f:
                json.dump(doc, f, indent=2, ensure_ascii=False)
    except Exception:
        pass

# Maintain Dual Numbering invariant: Event_Num_Perm and Event_Num_Card
for idx, ev in enumerate(events):
    card_num = idx + 1
    perm_id = f"Event_Num_Perm_{card_num:09d}"
    card_id = f"Event_Num_Card_{card_num:09d}"
    if ev.get("Event_Num_Perm") != perm_id:
        ev["Event_Num_Perm"] = perm_id
        updated_events = True
    if ev.get("Event_Num_Card") != card_id:
        ev["Event_Num_Card"] = card_id
        updated_events = True


if updated_events:
    with open("data/events.json", "w", encoding="utf-8") as f:
        json.dump(events, f, indent=2, ensure_ascii=False)

quarantined = []
try:
    with open("data/manual_review_queue.json", "r", encoding="utf-8-sig") as f:
        q = json.load(f)
        quarantined = q.get("quarantinedEvents", q.get("items", [])) if isinstance(q, dict) else (q if isinstance(q, list) else [])
except Exception:
    pass

surrey_sources = []
try:
    with open("data/surrey_reference_sources.json", "r", encoding="utf-8-sig") as f:
        surrey_sources = json.load(f)
except Exception:
    pass

with open("js/data.js", "w", encoding="utf-8") as f:
    f.write("// Van50 — Vancouver & Surrey Events & Outings (Strictly <= $50 CAD)\n")
    f.write("// AUTO-GENERATED from central data/events.json\n\n")
    f.write("const VANCOUVER_EVENTS = " + json.dumps(events, indent=2, ensure_ascii=False) + ";\n\n")
    f.write("const MANUAL_REVIEW_QUEUE = " + json.dumps(quarantined, indent=2, ensure_ascii=False) + ";\n\n")
    f.write("const SURREY_REFERENCE_SOURCES = " + json.dumps(surrey_sources, indent=2, ensure_ascii=False) + ";\n\n")
    f.write("""window.VAN50_EVENTS = VANCOUVER_EVENTS;
window.VANCOUVER_EVENTS = VANCOUVER_EVENTS;
window.SURREY_REFERENCE_SOURCES = SURREY_REFERENCE_SOURCES;

const VANCOUVER_NEIGHBORHOODS = [
  "Downtown, Gastown & Yaletown",
  "Mount Pleasant & South Vancouver",
  "Commercial Drive & East Vancouver",
  "Kitsilano, Point Grey & UBC",
  "Granville Island & False Creek",
  "North Shore, Burnaby & Metro"
];

const SURREY_NEIGHBORHOODS = [
  "Surrey Central / Whalley",
  "Guildford",
  "Fleetwood",
  "Newton",
  "Cloverdale",
  "South Surrey"
];

const NEIGHBORHOODS = [
  ...VANCOUVER_NEIGHBORHOODS,
  ...SURREY_NEIGHBORHOODS
];

window.VANCOUVER_NEIGHBORHOODS = VANCOUVER_NEIGHBORHOODS;
window.SURREY_NEIGHBORHOODS = SURREY_NEIGHBORHOODS;
window.NEIGHBORHOODS = NEIGHBORHOODS;

const DAYS_OF_WEEK = [
  { id: "all", label: "All Days", icon: "🗓️" },
  { id: "mon", label: "Mon", full: "Monday" },
  { id: "tue", label: "Tue", full: "Tuesday" },
  { id: "wed", label: "Wed", full: "Wednesday" },
  { id: "thu", label: "Thu", full: "Thursday" },
  { id: "fri", label: "Fri", full: "Friday" },
  { id: "sat", label: "Sat", full: "Saturday" },
  { id: "sun", label: "Sun", full: "Sunday" }
];
""")

print("Sync completed successfully.")
