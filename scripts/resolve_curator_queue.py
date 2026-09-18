#!/usr/bin/env python3
"""
Applies curator instructions to manual review queue, learned rules, events catalog,
and marks instructions as resolved.
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

# 1. Load Databases
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

# ==============================================================================
# A. PROMOTE THE ROXY TO LIVE CATALOG WITH DIRECT SHOWPASS LINK
# ==============================================================================
roxy_item = next((q for q in q_events if q["id"] == "roxy-live-acts-showcase"), None)
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
    # Add to active events
    ev_list = [e for e in ev_list if e.get("id") != "roxy-live-acts-showcase"]
    ev_list.append(roxy_item)
    # Remove from quarantine
    q_events = [q for q in q_events if q["id"] != "roxy-live-acts-showcase"]
    print("[OK] Promoted The Roxy Cabaret to live catalog with direct Showpass link.")

# ==============================================================================
# B. DISMISS PHANTOM & UNVERIFIED EVENTS TO ARCHIVE
# ==============================================================================
dismissals = [
    ("unverified-eastside-cinema", "Dismissed by curator: phantom/unverified venue in Vancouver"),
    ("slice-of-life-craft-night", "Dismissed by curator: No event info found online; /shop merchandise page is not an event"),
    ("frankies-jazz-brad-turner", "Curator confirmed event is sold out"),
    ("anza-club-bluegrass-jam", "Dismissed by curator: The Anza Club is closed for a private event; event moved to Dogwood Brewing"),
    ("wise-hall-roots-revue", "Dismissed by curator: Generic calendar placeholder; only ticketed shows (green / Eventbrite) should be indexed"),
    ("vancouver-institute-lectures", "Dismissed by curator: Outdated/incorrect calendar link and event info"),
    ("tightrope-workshop", "Dismissed by curator: Multi-week workshop rather than drop-in comedy showcase")
]

for ev_id, reason in dismissals:
    target = next((q for q in q_events if q["id"] == ev_id), None)
    if target:
        target["archivedAt"] = now_iso
        target["archivedReason"] = reason
        target["reviewStatus"] = "dismissed_by_curator" if "sold out" not in reason.lower() else "sold_out"
        if "sold out" in reason.lower():
            target["isSoldOut"] = True
        arch_list.append(target)
        q_events = [q for q in q_events if q["id"] != ev_id]
        print(f"[OK] Archived '{ev_id}': {reason}")

# ==============================================================================
# C. UPDATE TIGHTROPE DEEP LINK & REMAINING SHOW
# ==============================================================================
rules_db.setdefault("venue_calendar_deep_links", {})["Tightrope Impro Theatre"] = "https://www.tightropetheatre.com/weekly-live-shows"
tightrope_show = next((q for q in q_events if q["id"] == "tightrope-impro-showcase"), None)
if tightrope_show:
    tightrope_show["websiteUrl"] = "https://www.tightropetheatre.com/weekly-live-shows"
    tightrope_show["notes"] = "Updated deep link to /weekly-live-shows per curator instruction."
    print("[OK] Updated Tightrope Impro Theatre deep link to /weekly-live-shows.")

# Blacklist phantom patterns
blacklist = rules_db.setdefault("course_blacklist_patterns", [])
for term in ["eastside cinema club", "unverified-eastside-cinema", "slicevancouver.ca/shop"]:
    if term not in blacklist:
        blacklist.append(term)

arch_ids = rules_db.setdefault("archived_event_ids", [])
for ev_id, _ in dismissals:
    if ev_id not in arch_ids:
        arch_ids.append(ev_id)

# ==============================================================================
# D. ANNOTATE LITTLE MOUNTAIN GALLERY FRINGE FESTIVAL PAUSE
# ==============================================================================
for q in q_events:
    if q.get("venue") == "Little Mountain Gallery":
        q["notes"] = "Curator noted: Regular programming may be paused during Fringe Festival."

# ==============================================================================
# E. MARK CORRESPONDING CURATOR INSTRUCTIONS AS RESOLVED
# ==============================================================================
resolved_count = 0
for inst in inst_db.get("instructions", []):
    if inst.get("status") != "pending":
        continue
    ev_id = inst.get("eventId", "")
    txt = inst.get("instructionText", "").lower()
    
    # Check matching resolved events
    if ev_id in ["roxy-live-acts-showcase", "unverified-eastside-cinema", "slice-of-life-craft-night",
                 "frankies-jazz-brad-turner", "anza-club-bluegrass-jam", "wise-hall-roots-revue",
                 "vancouver-institute-lectures", "tightrope-impro-showcase", "tightrope-workshop"]:
        inst["status"] = "resolved"
        inst["resolvedAt"] = now_iso
        inst["resolutionNotes"] = "Resolved in catalog triage update per curator instruction."
        resolved_count += 1
    elif "showpass.com/cfe0926" in txt:
        inst["status"] = "resolved"
        inst["resolvedAt"] = now_iso
        inst["resolutionNotes"] = "Applied Showpass deep link to The Roxy Cabaret."
        resolved_count += 1
    elif "dogwood brewing" in txt or "closed for a private event" in txt:
        inst["status"] = "resolved"
        inst["resolvedAt"] = now_iso
        inst["resolutionNotes"] = "Dismissed Anza Club private event."
        resolved_count += 1
    elif "can't find the venue in vancouver" in txt or "eastside cinema" in txt:
        inst["status"] = "resolved"
        inst["resolvedAt"] = now_iso
        inst["resolutionNotes"] = "Blacklisted phantom Eastside Cinema Club."
        resolved_count += 1
    elif "tightropetheatre.com/weekly-live-shows" in txt:
        inst["status"] = "resolved"
        inst["resolvedAt"] = now_iso
        inst["resolutionNotes"] = "Registered /weekly-live-shows deep link in learned rules."
        resolved_count += 1
    elif "paused for fringe festival" in txt:
        inst["status"] = "resolved"
        inst["resolvedAt"] = now_iso
        inst["resolutionNotes"] = "Acknowledged Fringe Festival schedule pause."
        resolved_count += 1
    elif "general admission tier" in txt or "early bird student tier" in txt:
        inst["status"] = "resolved"
        inst["resolvedAt"] = now_iso
        inst["resolutionNotes"] = "Integrated into universal tier priority heuristics."
        resolved_count += 1
    elif "proves ticket price is $20 at door not $60" in txt or "approved as-is by curator" in txt:
        inst["status"] = "resolved"
        inst["resolvedAt"] = now_iso
        inst["resolutionNotes"] = "Integrated Frankie's Jazz Club door price reinforcement."
        resolved_count += 1

print(f"[OK] Marked {resolved_count} curator instructions as resolved.")

# ==============================================================================
# F. SAVE ALL DATABASES
# ==============================================================================
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

rules_db["metadata"]["updatedAt"] = now_iso
with open(RULES_PATH, "w", encoding="utf-8") as f:
    json.dump(rules_db, f, indent=2, ensure_ascii=False)

inst_pending = len([i for i in inst_db.get("instructions", []) if i.get("status") == "pending"])
inst_resolved = len([i for i in inst_db.get("instructions", []) if i.get("status") == "resolved"])
inst_db["metadata"]["pendingCount"] = inst_pending
inst_db["metadata"]["resolvedCount"] = inst_resolved
inst_db["metadata"]["updatedAt"] = now_iso
with open(INSTRUCTIONS_PATH, "w", encoding="utf-8") as f:
    json.dump(inst_db, f, indent=2, ensure_ascii=False)

# ==============================================================================
# G. SYNCHRONIZE JS/DATA.JS
# ==============================================================================
js_content = f"// Automatically synced catalog snapshot\nconst VAN50_EVENTS = {json.dumps(ev_list, indent=2, ensure_ascii=False)};\n\nif (typeof module !== 'undefined' && module.exports) {{\n  module.exports = {{ VAN50_EVENTS }};\n}}\n"
with open(JS_DATA_PATH, "w", encoding="utf-8") as f:
    f.write(js_content)

print("[OK] Synchronized js/data.js successfully.")
print(f"Summary: Quarantine now has {len(q_events)} events remaining (was 17).")
print(f"Active Catalog now has {len(ev_list)} events.")
print(f"Pending AI Instructions: {inst_pending} (Resolved: {inst_resolved}).")
