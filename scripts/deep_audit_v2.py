#!/usr/bin/env python3
"""
Van50 — Deep Audit & Verification Suite v2.0
Validates:
1. Ended Event Tracker & Isolation
2. Strict Budget Cap (<= $50.00 CAD)
3. Direct Ticketing Link Verification (No generic roots)
4. Multi-Tier Consolidation & Pricing Ranges
5. Day of the Week & Schedule Descriptors
6. Starting Time Slot Consistency
7. Category Taxonomy & Sub-Tags
8. Semantic Provider Badging
9. Standardized Price Formatting
10. Sold-Out Watermark Ribbon
11. Card Template TransLink Removal
12. Geographic Coordinates Accuracy
13. Live Check-Out Pricing & Quarantine Queue Integrity
"""

import os
import json
import re
import sys
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

print("=" * 80)
print("VAN50 DEEP AUDIT & ACCURACY VERIFICATION SUITE v2.0")
print(f"Audit Timestamp: {datetime.now().isoformat()}")
print("=" * 80)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(BASE_DIR, "data", "events.json")
MANUAL_QUEUE_PATH = os.path.join(BASE_DIR, "data", "manual_review_queue.json")
APP_JS_PATH = os.path.join(BASE_DIR, "js", "app.js")

# Load data
with open(JSON_PATH, "r", encoding="utf-8") as f:
    raw_db = json.load(f)

events = raw_db["events"]
metadata = raw_db["metadata"]

print(f"Catalog contains {len(events)} total records. Metadata version: {metadata.get('version')}")

issues_found = []
warnings_found = []

CURRENT_TIME = datetime.fromisoformat("2026-09-08T09:40:42-07:00")

# 1. Internal Tracker & Ended Events Check
active_events = []
ended_events = []

for e in events:
    if e.get("isDaily"):
        active_events.append(e)
    elif e.get("endIso"):
        end_dt = datetime.fromisoformat(e["endIso"])
        if end_dt < CURRENT_TIME:
            ended_events.append(e)
        else:
            active_events.append(e)
    else:
        active_events.append(e)

print(f"\n[1] Ended Event Tracker:")
print(f"  • Active Events: {len(active_events)}")
print(f"  • Ended Events Filtered: {len(ended_events)}")
for ee in ended_events:
    print(f"    - {ee['id']} ('{ee['title']}') ended at {ee['endIso']}")

# Check if any event in active_events has an endIso in the past
for ae in active_events:
    if ae.get("endIso"):
        edt = datetime.fromisoformat(ae["endIso"])
        if edt < CURRENT_TIME:
            issues_found.append(f"Active event {ae['id']} has past endIso: {ae['endIso']}")

# 2. Strict Budget Cap Check (<= $50.00 CAD)
print("\n[2] Strict Budget Cap Verification (<= $50.00 CAD):")
for ae in active_events:
    p = ae.get("price", 0.0)
    if p > 50.00:
        issues_found.append(f"Card {ae['id']} exceeds $50 budget limit: ${p:.2f}")
    if ae.get("tiers"):
        for t in ae["tiers"]:
            if t["price"] > 50.00:
                issues_found.append(f"Card {ae['id']} tier '{t['name']}' exceeds $50 limit: ${t['price']:.2f}")

# 3. Direct Ticketing Link Verification
print("\n[3] Direct Ticket / Deep Link Audit:")
urls_seen = {}
for ae in active_events:
    u = ae.get("websiteUrl", "").strip()
    if not u.startswith("http"):
        issues_found.append(f"Card {ae['id']} has invalid URL: '{u}'")
    # check for generic homepages
    domain_parts = u.replace("https://", "").replace("http://", "").split("/")
    path = "/".join(domain_parts[1:])
    if not path or path == "":
        warnings_found.append(f"Card {ae['id']} URL looks like a root homepage: '{u}'")
    urls_seen.setdefault(u, []).append(ae["id"])

for u, ids in urls_seen.items():
    if len(ids) > 1:
        issues_found.append(f"Duplicate URL shared by {ids}: {u}")

# 4. Multi-Tier Consolidation Audit
print("\n[4] Multi-Tier Consolidation Audit:")
multi_tier_events = [ae for ae in active_events if ae.get("tiers") and len(ae["tiers"]) > 1]
print(f"  • Found {len(multi_tier_events)} multi-tier event(s): {[m['id'] for m in multi_tier_events]}")
for m in multi_tier_events:
    p_label = m.get("priceLabel", "")
    min_t = min(t["price"] for t in m["tiers"])
    max_t = max(t["price"] for t in m["tiers"])
    valid_expected = [f"${min_t:.2f} – ${max_t:.2f} all-in"]
    if min_t == 0:
        valid_expected.append(f"Free – ${max_t:.2f} all-in")
    if p_label not in valid_expected:
        issues_found.append(f"Card {m['id']} priceLabel mismatch: '{p_label}' vs expected '{valid_expected}'")
    print(f"    - {m['id']}: {m['title']} | Tiers: {[t['name'] + ' ($' + str(t['price']) + ')' for t in m['tiers']]}")

# 5. Day of the Week Audit
print("\n[5] Day of the Week Consistency Audit:")
valid_days = {"mon", "tue", "wed", "thu", "fri", "sat", "sun", "daily"}
for ae in active_events:
    days = ae.get("daysOfWeek", [])
    if not days:
        issues_found.append(f"Card {ae['id']} missing daysOfWeek")
    for d in days:
        if d not in valid_days:
            issues_found.append(f"Card {ae['id']} has invalid day: '{d}'")

# 6. Starting Time Audit
print("\n[6] Starting Time Slot Consistency Audit:")
valid_slots = {"early-morning", "afternoon", "early-evening", "late-evening"}
for ae in active_events:
    slots = ae.get("timeSlots", [])
    if not slots:
        issues_found.append(f"Card {ae['id']} missing timeSlots")
    for s in slots:
        if s not in valid_slots:
            issues_found.append(f"Card {ae['id']} has invalid timeSlot: '{s}'")

# 7. Category & Sub-Tags Audit
print("\n[7] Category Taxonomy & Sub-Tags Audit:")
valid_cats = {"shows", "cinema", "arts", "outdoors", "activities", "trivia"}
for ae in active_events:
    cat = ae.get("category")
    if cat not in valid_cats:
        issues_found.append(f"Card {ae['id']} has invalid category: '{cat}'")
    subtags = ae.get("subTags", [])
    if not subtags or len(subtags) == 0:
        warnings_found.append(f"Card {ae['id']} has 0 sub-tags")

# 8. Semantic Provider Badging Audit
print("\n[8] Semantic Provider Badging Audit:")
for ae in active_events:
    sp = ae.get("ticketProvider", "")
    if not sp:
        issues_found.append(f"Card {ae['id']} missing ticketProvider")
    if ae.get("isFree") and sp == "Box Office / Direct":
        issues_found.append(f"Card {ae['id']} is free public outing but uses old 'Box Office / Direct'")

# 9. Standardized Price Formatting Check
print("\n[9] Standardized Price Formatting Audit:")
for ae in active_events:
    p_type = ae.get("pricingType")
    pl = ae.get("priceLabel", "")
    tiers = ae.get("tiers") or []
    if ae.get("isFree"):
        if pl != "Free ($0)":
            issues_found.append(f"Card {ae['id']} free price label is '{pl}' (expected 'Free ($0)')")
    elif len(tiers) > 1:
        # Multi-tier handled in Section 4
        pass
    elif p_type == "door":
        if "door" not in pl and not ae.get("isFree"):
            warnings_found.append(f"Card {ae['id']} is pricingType='door' but priceLabel is '{pl}'")
    elif p_type == "food-drink":
        if "food/drink" not in pl:
            warnings_found.append(f"Card {ae['id']} is pricingType='food-drink' but priceLabel is '{pl}'")

# 10. Sold-Out Watermark Audit
print("\n[10] Sold-Out Watermark Audit:")
sold_out = [ae for ae in active_events if ae.get("isSoldOut")]
print(f"  • Sold out count: {len(sold_out)}: {[s['id'] for s in sold_out]}")

# 11. Card Template TransLink Removal Audit
print("\n[11] Card Template TransLink Removal Audit:")
app_js_content = open(APP_JS_PATH, encoding="utf-8").read()
if "card-transit-row" in app_js_content:
    issues_found.append("Found lingering 'card-transit-row' in js/app.js")
else:
    print("  • TransLink card row successfully absent from js/app.js template.")

# 12. Geographic Coordinates Audit
print("\n[12] Geographic Coordinates Audit:")
for ae in active_events:
    coords = ae.get("coordinates", [])
    if len(coords) != 2:
        issues_found.append(f"Card {ae['id']} has invalid coordinates format: {coords}")
    elif not (49.15 <= coords[0] <= 49.45) or not (-123.35 <= coords[1] <= -122.90):
        issues_found.append(f"Card {ae['id']} coordinates out of range: {coords}")

# 13. Live Check-Out Pricing & Manual Review Quarantine Queue Audit
print("\n[13] Live Check-Out Pricing & Manual Review Quarantine Queue Audit:")
unverified_in_catalog = []
for ae in active_events:
    verif = ae.get("checkoutVerification")
    if not verif or verif.get("status") != "verified_live":
        unverified_in_catalog.append(ae["id"])
    elif not verif.get("feeBreakdown") or not verif.get("method"):
        issues_found.append(f"Card {ae['id']} has incomplete checkout verification: {verif}")

if unverified_in_catalog:
    issues_found.append(f"Found unverified events in published catalog: {unverified_in_catalog}")
else:
    print(f"  • 100% of active events ({len(active_events)}/{len(active_events)}) have verified live check-out pricing!")

# Inspect quarantine queue
if not os.path.exists(MANUAL_QUEUE_PATH):
    issues_found.append("manual_review_queue.json does not exist!")
else:
    queue_data = json.load(open(MANUAL_QUEUE_PATH, encoding="utf-8"))
    q_events = queue_data.get("quarantinedEvents", [])
    print(f"  • Quarantined events waiting for manual user review: {len(q_events)}")
    for qe in q_events:
        print(f"    - [{qe['id']}] {qe['title']} (${qe['attemptedPrice']}) | Flag reason: {qe['flagReason']}")
        if not qe.get("flagReason"):
            issues_found.append(f"Quarantined event {qe['id']} missing flagReason!")

# Print Summary
print("\n" + "=" * 80)
print(f"AUDIT SUMMARY: {len(issues_found)} Errors, {len(warnings_found)} Warnings.")
print("=" * 80)

if issues_found:
    print("\n[ERRORS DETECTED]:")
    for iss in issues_found:
        print(f"  ❌ {iss}")
    sys.exit(1)
else:
    print("\n✅ ZERO Critical Errors Detected.")

if warnings_found:
    print("\n[WARNINGS / NUANCES]:")
    for w in warnings_found:
        print(f"  ⚠️  {w}")
else:
    print("\n✅ ZERO Warnings Detected.")
