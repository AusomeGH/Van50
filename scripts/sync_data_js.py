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
    r"\b(surrey|whalley|guildford|fleetwood|fraser heights|newton|bear creek|panorama\s+ridge|sullivan heights|cloverdale|clayton|south surrey|grandview heights|crescent beach|bridgeview|white rock)\b",
    re.IGNORECASE,
)
burnaby_re = re.compile(
    r"\b(burnaby|metrotown|brentwood|lougheed|deer lake|edmonds|simon fraser|sfu)\b",
    re.IGNORECASE,
)
richmond_re = re.compile(
    r"\b(richmond|steveston|brighouse|lansdowne|ironwood|minoru|terra nova)\b",
    re.IGNORECASE,
)
newwest_re = re.compile(
    r"\b(new westminster|new west|sapperton|queensborough)\b",
    re.IGNORECASE,
)
langley_re = re.compile(
    r"\b(langley|fort langley|willoughby|walnut grove|murrayville|brookswood|aldergrove)\b",
    re.IGNORECASE,
)
explicit_muni_re = re.compile(
    r",\s*(North Vancouver|West Vancouver|Burnaby|Richmond|Coquitlam|Port Coquitlam|Port Moody|New Westminster|Surrey|White Rock|Delta|Langley|Maple Ridge|Pitt Meadows|Vancouver)\s*,\s*BC\b",
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
    is_east_van_grandview = bool(re.search(r"grandview[- ]woodland", raw_hood, re.I) or re.search(r",\s*vancouver\s*,\s*bc\b", raw_addr, re.I))
    raw_loc = f"{raw_hood} {raw_addr}"
    muni_match = explicit_muni_re.search(raw_addr)
    if muni_match:
        muni_raw = re.sub(r"\s+", " ", muni_match.group(1)).strip().lower()
        if muni_raw in ("surrey", "white rock"):
            inferred_city, inferred_region = "Surrey", "Surrey"
        elif muni_raw == "burnaby":
            inferred_city, inferred_region = "Burnaby", "Burnaby"
        elif muni_raw == "richmond":
            inferred_city, inferred_region = "Richmond", "Richmond"
        elif muni_raw == "new westminster":
            inferred_city, inferred_region = "New Westminster", "New West"
        elif muni_raw == "langley":
            inferred_city, inferred_region = "Langley", "Langley"
        else:
            inferred_city, inferred_region = muni_match.group(1).strip(), "Vancouver"
    elif not is_east_van_grandview and langley_re.search(raw_loc):
        inferred_city, inferred_region = "Langley", "Langley"
    elif not is_east_van_grandview and burnaby_re.search(raw_loc):
        inferred_city, inferred_region = "Burnaby", "Burnaby"
    elif not is_east_van_grandview and richmond_re.search(raw_loc):
        inferred_city, inferred_region = "Richmond", "Richmond"
    elif not is_east_van_grandview and newwest_re.search(raw_loc):
        inferred_city, inferred_region = "New Westminster", "New West"
    elif not is_east_van_grandview and surrey_re.search(raw_loc):
        inferred_city, inferred_region = "Surrey", "Surrey"
    else:
        inferred_city, inferred_region = "Vancouver", "Vancouver"
    if ev.get("city") != inferred_city or ev.get("region") != inferred_region:
        ev["city"] = inferred_city
        ev["region"] = inferred_region
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

PUBLIC_STRIP_KEYS = {
    "dimension_audit",
    "proof_keyframes",
    "venue_grounding",
    "arbitration_log",
    "qc_raw_payload",
    "stagehand_trace",
}


def build_slim_public_event(ev: dict) -> dict:
    """Return a lightweight public event object for js/data.js without 10MB+ audit metadata."""
    da = ev.get("dimension_audit") if isinstance(ev.get("dimension_audit"), dict) else None
    out = {k: v for k, v in ev.items() if k not in PUBLIC_STRIP_KEYS}
    if da:
        if not out.get("holiday_affiliation") and not out.get("holidayAffiliation"):
            hol = (da.get("D008_holiday_affiliation") or da.get("D009_holiday_affiliation") or {})
            if isinstance(hol, dict) and hol.get("value") and hol.get("value") not in ("not_applicable", "none_available", "search_exhausted_null"):
                out["holiday_affiliation"] = hol["value"]
        if not out.get("transit_info") and not out.get("transitInfo"):
            tr = da.get("D408_transit_waypoints") or {}
            if isinstance(tr, dict) and tr.get("value") and tr.get("value") not in ("not_applicable", "none_available", "search_exhausted_null"):
                out["transit_info"] = tr["value"]
    return out


public_events = [build_slim_public_event(ev) for ev in events]

with open("js/data.js", "w", encoding="utf-8") as f:
    f.write("// Van50 — Vancouver & Surrey Events & Outings (Strictly <= $50 CAD)\n")
    f.write("// AUTO-GENERATED slim public catalog from data/events.json\n\n")
    f.write("const VANCOUVER_EVENTS = " + json.dumps(public_events, separators=(",", ":"), ensure_ascii=False) + ";\n\n")
    f.write("const MANUAL_REVIEW_QUEUE = [];\n\n")
    f.write("const SURREY_REFERENCE_SOURCES = " + json.dumps(surrey_sources, separators=(",", ":"), ensure_ascii=False) + ";\n\n")
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

const BURNABY_NEIGHBORHOODS = [
  "Metrotown & Deer Lake",
  "Brentwood & North Burnaby",
  "Lougheed & SFU",
  "Edmonds & South Burnaby"
];

const RICHMOND_NEIGHBORHOODS = [
  "City Centre & Brighouse",
  "Steveston Village",
  "East Richmond & Ironwood"
];

const NEW_WEST_NEIGHBORHOODS = [
  "Downtown & Columbia St",
  "Uptown & Sapperton",
  "Queensborough"
];

const LANGLEY_NEIGHBORHOODS = [
  "Langley City & Willowbrook",
  "Fort Langley",
  "Willoughby & Walnut Grove",
  "Murrayville & Aldergrove"
];

const NEIGHBORHOODS = [
  ...VANCOUVER_NEIGHBORHOODS,
  ...SURREY_NEIGHBORHOODS,
  ...BURNABY_NEIGHBORHOODS,
  ...RICHMOND_NEIGHBORHOODS,
  ...NEW_WEST_NEIGHBORHOODS,
  ...LANGLEY_NEIGHBORHOODS
];

window.VANCOUVER_NEIGHBORHOODS = VANCOUVER_NEIGHBORHOODS;
window.SURREY_NEIGHBORHOODS = SURREY_NEIGHBORHOODS;
window.BURNABY_NEIGHBORHOODS = BURNABY_NEIGHBORHOODS;
window.RICHMOND_NEIGHBORHOODS = RICHMOND_NEIGHBORHOODS;
window.NEW_WEST_NEIGHBORHOODS = NEW_WEST_NEIGHBORHOODS;
window.LANGLEY_NEIGHBORHOODS = LANGLEY_NEIGHBORHOODS;
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
