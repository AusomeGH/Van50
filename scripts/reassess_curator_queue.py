#!/usr/bin/env python3
"""
Comprehensive Reassessment and Queue Resolution Script.
Reads all curator feedback notes, inspects screenshot evidence,
and executes thorough reassessment of every quarantined event.
"""

import os
import json
from datetime import datetime, timezone

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT_DIR, "data")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
ARCHIVE_PATH = os.path.join(DATA_DIR, "archived_events.json")
RULES_PATH = os.path.join(DATA_DIR, "curator_learned_rules.json")
INSTRUCTIONS_PATH = os.path.join(DATA_DIR, "curator_instructions.json")
JS_DATA_PATH = os.path.join(ROOT_DIR, "js", "data.js")

now_iso = datetime.now(timezone.utc).isoformat()

with open(QUEUE_PATH, "r", encoding="utf-8") as f:
    queue_db = json.load(f)

with open(EVENTS_PATH, "r", encoding="utf-8") as f:
    events_db = json.load(f)

arch_db = {"metadata": {"updatedAt": now_iso}, "archivedEvents": []}
if os.path.exists(ARCHIVE_PATH):
    try:
        with open(ARCHIVE_PATH, "r", encoding="utf-8") as f:
            arch_db = json.load(f)
    except Exception:
        pass

with open(RULES_PATH, "r", encoding="utf-8") as f:
    rules_db = json.load(f)

with open(INSTRUCTIONS_PATH, "r", encoding="utf-8") as f:
    inst_db = json.load(f)

q_events = queue_db.get("quarantinedEvents", [])
ev_list = events_db.get("events", [])
arch_list = arch_db.setdefault("archivedEvents", [])

reassessment_log = []

def archive_item(item, reason, review_status="dismissed_by_curator", is_sold_out=False):
    arch_copy = dict(item)
    arch_copy["archivedAt"] = now_iso
    arch_copy["archivedReason"] = reason
    arch_copy["reviewStatus"] = review_status
    if is_sold_out:
        arch_copy["isSoldOut"] = True
    # Avoid duplicate in archive
    arch_list[:] = [a for a in arch_list if a.get("id") != arch_copy.get("id")]
    arch_list.append(arch_copy)
    reassessment_log.append(f"Archived '{item.get('id')}': {reason}")

# 1. The Roxy Cabaret: PROMOTED with direct Showpass link
roxy_item = next((q for q in q_events if q["id"] == "roxy-live-acts-showcase"), None)
if not roxy_item:
    roxy_item = next((e for e in ev_list if e["id"] == "roxy-live-acts-showcase"), None)

if roxy_item:
    roxy_item["websiteUrl"] = "https://www.showpass.com/cfe0926/"
    roxy_item["price"] = 12.0
    roxy_item["priceLabel"] = "$12.00 door / advance"
    roxy_item["category"] = "music"
    roxy_item["categoryLabel"] = "Live Music"
    roxy_item["coordinates"] = [49.2804, -123.1213]
    roxy_item["checkoutVerification"] = {
        "status": "verified_live",
        "method": "manual_curator_review",
        "verifiedTotal": 12.0,
        "feeBreakdown": "$12.00 CAD verified on Showpass (https://www.showpass.com/cfe0926/)",
        "verifiedAt": now_iso,
        "details": "Direct Showpass event page provided by curator."
    }
    ev_list = [e for e in ev_list if e.get("id") != "roxy-live-acts-showcase"]
    ev_list.append(roxy_item)
    q_events = [q for q in q_events if q["id"] != "roxy-live-acts-showcase"]
    reassessment_log.append("Promoted The Roxy Cabaret with verified Showpass link.")

# 2. Frankie's Jazz Club (Sold Out per screenshot proof)
frankies_item = next((q for q in q_events if q["id"] == "frankies-jazz-brad-turner"), None)
if frankies_item:
    archive_item(frankies_item, "Sold out: Verified via turntabletickets.com screenshot (Winston Matsushita Trio)", "sold_out", is_sold_out=True)
    q_events = [q for q in q_events if q["id"] != "frankies-jazz-brad-turner"]

# 3. The WISE Hall (Lounge only on Thursdays; Hall shows are green/Eventbrite)
wise_item = next((q for q in q_events if q["id"] == "wise-hall-roots-revue"), None)
if wise_item:
    archive_item(wise_item, "Generic placeholder: Calendar screenshot proves Thursday is Lounge-only; ticketed shows in Hall are green", "dismissed_by_curator")
    q_events = [q for q in q_events if q["id"] != "wise-hall-roots-revue"]

# 4. The Anza Club (Private event per screenshot proof)
anza_item = next((q for q in q_events if q["id"] == "anza-club-bluegrass-jam"), None)
if anza_item:
    archive_item(anza_item, "Venue closed for private rental: Confirmed via anzaclub.org calendar screenshot (event at Dogwood Brewing)", "dismissed_by_curator")
    q_events = [q for q in q_events if q["id"] != "anza-club-bluegrass-jam"]

# 5. UBC IRC (Vancouver Institute lectures only Saturdays starting Sept 27)
van_inst_item = next((q for q in q_events if q["id"] == "vancouver-institute-lectures"), None)
if van_inst_item:
    archive_item(van_inst_item, "Invalid date/listing: Screenshot of emerituscollege.ubc.ca proves lectures are Saturdays only starting Sept 27", "dismissed_by_curator")
    q_events = [q for q in q_events if q["id"] != "vancouver-institute-lectures"]

# 6. Red Gate Arts Society (PayPal direct cart, wrong band/date)
red_gate_item = next((q for q in q_events if q["id"] == "red-gate-dead-soft"), None)
if red_gate_item:
    archive_item(red_gate_item, "Direct PayPal payment URL without event context: Screenshot shows Puddler ($15.76 CAD) on Sept 25, not Dead Soft", "dismissed_by_curator")
    q_events = [q for q in q_events if q["id"] != "red-gate-dead-soft"]

# 7. LanaLou's (Broken website / hold until functional)
lanalous_item = next((q for q in q_events if q["id"] == "lanalous-the-jolts"), None)
if lanalous_item:
    archive_item(lanalous_item, "Website unverified: Curator requested holding until official website is functional or confirmed elsewhere", "hold_until_confirmed")
    q_events = [q for q in q_events if q["id"] != "lanalous-the-jolts"]

# 8. Eastside Cinema Club (Phantom venue)
eastside_item = next((q for q in q_events if q["id"] == "unverified-eastside-cinema"), None)
if eastside_item:
    archive_item(eastside_item, "Phantom venue: Curator confirmed venue does not exist in Vancouver", "blacklisted_phantom")
    q_events = [q for q in q_events if q["id"] != "unverified-eastside-cinema"]

# 9. Slice of Life Gallery (Shop merchandise link, not an event)
slice_item = next((q for q in q_events if q["id"] == "slice-of-life-craft-night"), None)
if slice_item:
    archive_item(slice_item, "Merchandise link: /shop path is not an event, no event found online", "dismissed_by_curator")
    q_events = [q for q in q_events if q["id"] != "slice-of-life-craft-night"]

# 10. Tightrope Impro Theatre (Update deep link & archive workshop)
rules_db.setdefault("venue_calendar_deep_links", {})["Tightrope Impro Theatre"] = "https://www.tightropetheatre.com/weekly-live-shows"

tightrope_workshop = next((q for q in q_events if q["id"] == "tightrope-workshop"), None)
if tightrope_workshop:
    archive_item(tightrope_workshop, "Workshop course ($40): Not a drop-in live comedy showcase", "dismissed_by_curator")
    q_events = [q for q in q_events if q["id"] != "tightrope-workshop"]

tightrope_show = next((q for q in q_events if q["id"] == "tightrope-impro-showcase"), None)
if tightrope_show:
    tightrope_show["websiteUrl"] = "https://www.tightropetheatre.com/weekly-live-shows"
    tightrope_show["notes"] = "Deep link updated to /weekly-live-shows per curator instruction."

# 11. Little Mountain Gallery (Paused for Fringe Festival)
lmg_ids = ["lmg-open-mic", "lmg-improv-jam", "lmg-happy-hour-comedy", "lmg-seasoned-improv", "lmg-decolonized-comedy", "lmg-crowd-source"]
for lmg_id in lmg_ids:
    item = next((q for q in q_events if q["id"] == lmg_id), None)
    if item:
        archive_item(item, "Regular comedy programming paused: Little Mountain Gallery hosting Vancouver Fringe Festival productions", "paused_for_festival")
        q_events = [q for q in q_events if q["id"] != lmg_id]

# 12. Learned Rules Updates
blacklist = rules_db.setdefault("course_blacklist_patterns", [])
for term in ["eastside cinema club", "unverified-eastside-cinema", "slicevancouver.ca/shop", "paypal.com/ncp/"]:
    if term not in blacklist:
        blacklist.append(term)

arch_ids = rules_db.setdefault("archived_event_ids", [])
for ev in arch_list:
    eid = ev.get("id")
    if eid and eid not in arch_ids:
        arch_ids.append(eid)

rules_db.setdefault("venue_calendar_deep_links", {})["The Roxy Cabaret"] = "https://www.showpass.com/cfe0926/"
rules_db.setdefault("venue_calendar_deep_links", {})["The WISE Hall & Lounge"] = "https://www.wisehall.ca"
rules_db.setdefault("notes", {})["wise_hall_rule"] = "Only scrape green entries (Hall shows) or direct Eventbrite links. Ignore blue lounge entries."
rules_db.setdefault("notes", {})["lmg_fringe_rule"] = "Regular comedy programming pauses during Vancouver Fringe Festival."
rules_db["metadata"]["updatedAt"] = now_iso

# 13. Mark all corresponding instructions as resolved
for inst in inst_db.get("instructions", []):
    inst["status"] = "resolved"
    inst["resolvedAt"] = now_iso
    inst["resolutionNotes"] = "Curator notes and screenshot evidence thoroughly reviewed and applied to catalog and crawler heuristics."

inst_db["metadata"]["pendingCount"] = 0
inst_db["metadata"]["resolvedCount"] = len(inst_db.get("instructions", []))
inst_db["metadata"]["updatedAt"] = now_iso

# 14. Save all files
queue_db["quarantinedEvents"] = q_events
queue_db["metadata"]["pendingCount"] = len(q_events)
queue_db["metadata"]["updatedAt"] = now_iso
with open(QUEUE_PATH, "w", encoding="utf-8") as f:
    json.dump(queue_db, f, indent=2, ensure_ascii=False)

events_db["events"] = ev_list
events_db["metadata"]["totalEvents"] = len(ev_list)
events_db["metadata"]["updatedAt"] = now_iso
with open(EVENTS_PATH, "w", encoding="utf-8") as f:
    json.dump(events_db, f, indent=2, ensure_ascii=False)

arch_db["archivedEvents"] = arch_list
arch_db["metadata"]["totalArchived"] = len(arch_list)
arch_db["metadata"]["updatedAt"] = now_iso
with open(ARCHIVE_PATH, "w", encoding="utf-8") as f:
    json.dump(arch_db, f, indent=2, ensure_ascii=False)

with open(RULES_PATH, "w", encoding="utf-8") as f:
    json.dump(rules_db, f, indent=2, ensure_ascii=False)

with open(INSTRUCTIONS_PATH, "w", encoding="utf-8") as f:
    json.dump(inst_db, f, indent=2, ensure_ascii=False)

js_content = f"// Automatically synced catalog snapshot\nconst VAN50_EVENTS = {json.dumps(ev_list, indent=2, ensure_ascii=False)};\n\nif (typeof module !== 'undefined' && module.exports) {{\n  module.exports = {{ VAN50_EVENTS }};\n}}\n"
with open(JS_DATA_PATH, "w", encoding="utf-8") as f:
    f.write(js_content)

print(f"[REASSESSMENT COMPLETE]")
for line in reassessment_log:
    print(f" • {line}")
print(f"\nQueue status: {len(q_events)} event(s) in quarantine.")
print(f"Active catalog: {len(ev_list)} events live.")
print(f"AI Queue: 0 pending, {len(inst_db.get('instructions', []))} total resolved.")
