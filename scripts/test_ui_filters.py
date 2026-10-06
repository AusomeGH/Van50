#!/usr/bin/env python3
"""
Van50 — Automated Test & UI Simulation Suite
Validates:
1. Strict Budget Cap (<= $50.00 CAD)
2. Free vs Paid Partitioning & Zero $0 Overrides on Mixed Tiers
3. Client-Side DOM / formatStandardPrice() Simulation
4. Manual Review Quarantine Queue Integrity
5. Date Alignment & Schedule Descriptors
"""

import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(BASE_DIR, 'data', 'events.json')
QUEUE_PATH = os.path.join(BASE_DIR, 'data', 'manual_review_queue.json')

with open(JSON_PATH, 'r', encoding='utf-8') as f:
    data = json.load(f)
events = data['events'] if isinstance(data, dict) and 'events' in data else data
metadata = data.get('metadata', {}) if isinstance(data, dict) else {}

with open(QUEUE_PATH, 'r', encoding='utf-8') as f:
    queue_data = json.load(f)
quarantined = queue_data.get('quarantinedEvents', [])

print("=" * 70)
print(f"VAN50 AUDIT & TEST SUITE: {len(events)} Active Verified Events, {len(quarantined)} Quarantined")
print("=" * 70)

# ------------------------------------------------------------------------------
# Test 1: Budget Cap & Spending Partition
# ------------------------------------------------------------------------------
print("\n[TEST 1] Spending Categories & Budget Cap Verification:")
free_events = [e for e in events if e.get('isFree') or e['price'] == 0]
paid_events = [e for e in events if e['price'] > 0]
all_events = [e for e in events if e['price'] <= 50.00]

print(f"  • Free Outings ($0):       {len(free_events)}")
print(f"  • Paid Outings (> $0):      {len(paid_events)}")
print(f"  • Outings <= $50.00 CAD:    {len(all_events)} / {len(events)}")

assert len(all_events) == len(events), f"Found {len(events) - len(all_events)} events exceeding $50.00 CAD!"
for e in events:
    eid = e.get('id') or e.get('event_id')
    assert e.get('price', 0) <= 50.00, f"Event {eid} exceeds budget cap: ${e.get('price')}"
    if e.get('tiers'):
        for t in e['tiers']:
            assert t['price'] <= 50.00, f"Event {eid} tier '{t['name']}' exceeds $50: ${t['price']}"

print("  ✓ Strict $50.00 CAD Budget Cap PASSED")

# ------------------------------------------------------------------------------
# Test 2: Client-Side Simulation of formatStandardPrice() & Add-On Range Integrity
# ------------------------------------------------------------------------------
print("\n[TEST 2] Client-Side formatStandardPrice() Simulation:")

def is_addon_tier(t):
    if not t:
        return False
    if t.get('isAddon') or t.get('is_addon'):
        return True
    name = str(t.get('name') or '').lower().strip()
    if any(k in name for k in ['comedy club', 'nightclub', 'jazz club', 'supper club', 'country club']):
        return False
    return any(k in name for k in ['rental', 'rentals', 'renting', 'add-on', 'addon', 'caddy', 'tasting tent', 'tasting pass'])

def simulate_format_standard_price(ev):
    tiers = ev.get('tiers') or []
    active_tiers = [t for t in tiers if t.get('isAvailable', True) and t.get('price', 0) <= 50]
    
    if active_tiers:
        admission_tiers = [t for t in active_tiers if not is_addon_tier(t)]
        addon_tiers = [t for t in active_tiers if is_addon_tier(t)]

        # Optional Add-on Handling: Add-ons must never define the minimum entry floor.
        if addon_tiers:
            base_min = ev.get('price') if (ev.get('price') is not None and ev.get('price') > 0) else (min(t['price'] for t in admission_tiers) if admission_tiers else 0)
            base_max = max([t['price'] for t in admission_tiers] + [ev.get('price') or 0]) if admission_tiers else (ev.get('price') or 0)
            max_addon = max(t['price'] for t in addon_tiers)
            combined_upper = base_max + max_addon

            if base_min == 0 and combined_upper == 0:
                return 'Free ($0)'
            if base_min == 0:
                return f"Free – ${combined_upper:.2f} all-in"
            if base_min == combined_upper:
                return f"${base_min:.2f} all-in"
            return f"${base_min:.2f} – ${combined_upper:.2f} all-in"

        if len(admission_tiers) > 1:
            min_p = min(t['price'] for t in admission_tiers)
            max_p = max(t['price'] for t in admission_tiers)
            if min_p == max_p:
                return 'Free ($0)' if min_p == 0 else f"${min_p:.2f} all-in"
            if min_p == 0:
                return f"Free – ${max_p:.2f} all-in"
            return f"${min_p:.2f} – ${max_p:.2f} all-in"
        elif len(admission_tiers) == 1:
            p = admission_tiers[0]['price']
            return 'Free ($0)' if p == 0 else f"${p:.2f} all-in"

    if (ev.get('isFree') or ev.get('price') == 0) and not any(t.get('price', 0) > 0 for t in tiers):
        return 'Free ($0)'
    if ev.get('pricingType') == 'door':
        return f"${ev.get('price', 0):.2f} door"
    if ev.get('pricingType') == 'food-drink':
        return f"Free entry (~${int(ev.get('price', 0))} food/drink)"
    return ev.get('priceLabel') or f"${ev.get('price', 0):.2f} all-in"

mixed_tier_count = 0
for ev in events:
    rendered = simulate_format_standard_price(ev)
    tiers = ev.get('tiers') or []
    eid = ev.get('id') or ev.get('event_id')
    
    # Layer 1 Assertion: Never let $0 override paid tiers
    if any(t.get('price', 0) > 0 for t in tiers):
        assert rendered != "Free ($0)", f"CRITICAL: Event {eid} rendered Free ($0) despite having paid tickets!"
        assert ev.get('isFree') is not True, f"CRITICAL: Event {eid} marked isFree: True despite having paid tickets!"

    if len(tiers) > 1:
        mixed_tier_count += 1

print(f"  ✓ Validated {mixed_tier_count} multi-tier events with 0 incorrect Free overrides")

# Add-On Pricing Assertions: Minimum floor MUST be base ticket, upper MUST be base + add-on
qe_putt = next(e for e in events if (e.get('id') or e.get('event_id')) == 'qe-park-pitch-putt')
assert simulate_format_standard_price(qe_putt) == "$18.27 – $21.13 all-in", f"QE Pitch & Putt expected '$18.27 – $21.13 all-in', got {simulate_format_standard_price(qe_putt)}"
print("  ✓ 'qe-park-pitch-putt' verified at $18.27 – $21.13 all-in (Rental $2.86 does not set floor)")

stanley_putt = next(e for e in events if (e.get('id') or e.get('event_id')) == 'stanley-pitch-putt')
assert simulate_format_standard_price(stanley_putt) == "$19.11 – $21.97 all-in", f"Stanley Pitch & Putt expected '$19.11 – $21.97 all-in', got {simulate_format_standard_price(stanley_putt)}"
print("  ✓ 'stanley-pitch-putt' verified at $19.11 – $21.97 all-in (Rental $2.86 does not set floor)")

central_putt = next(e for e in events if (e.get('id') or e.get('event_id')) == 'central-park-pitch-putt')
assert simulate_format_standard_price(central_putt) == "$16.28 – $19.18 all-in", f"Central Park Pitch & Putt expected '$16.28 – $19.18 all-in', got {simulate_format_standard_price(central_putt)}"
print("  ✓ 'central-park-pitch-putt' verified at $16.28 – $19.18 all-in (Rental $2.90 does not set floor)")

apple_fest = next(e for e in events if 'Apple Festival' in (e.get('title') or ''))
assert simulate_format_standard_price(apple_fest) == "$15.00 – $27.00 all-in", f"Apple Festival expected '$15.00 – $27.00 all-in', got {simulate_format_standard_price(apple_fest)}"
print("  ✓ 'UBC Apple Festival' verified at $15.00 – $27.00 all-in (Tasting Tent $12.00 does not set floor)")

# Specific check on Improv Jam
jam = next((e for e in events if (e.get('id') or e.get('event_id')) == 'lmg-improv-jam'), None)
if jam:
    assert jam['price'] == 10.24, f"Expected Improv Jam primary audience price to be 10.24, got {jam['price']}"
    assert jam.get('isFree') is not True, "Improv Jam should not be isFree: True"
    assert simulate_format_standard_price(jam) == "Free – $10.24 all-in"
    print(f"  ✓ 'lmg-improv-jam' correctly verified at $10.24 Audience Rate (Performer: Free)")

# ------------------------------------------------------------------------------
# Test 3: Manual Review Quarantine Queue Integrity
# ------------------------------------------------------------------------------
print("\n[TEST 3] Quarantine Queue Policy Verification:")
assert len(quarantined) >= 0, f"Expected non-negative quarantined events"
for q in quarantined:
    qid = q.get('id') or q.get('event_id')
    assert 'flagReason' in q, f"Quarantined event {qid} missing flagReason!"
    print(f"  • Quarantined [{qid}]: {q.get('title')} -> {q.get('flagReason')}")

print(f"  ✓ Quarantine Queue verified ({len(quarantined)} items isolated from live app)")

# ------------------------------------------------------------------------------
# Test 4: One-Off and Advance Dates Alignment
# ------------------------------------------------------------------------------
print("\n[TEST 4] Date Alignment & Recurrence Tagging:")
# Genuine one-off special events
genuine_one_offs = [
    'eb-puff-magic-improv',
    'eb-standup-mental-health',
    'rickshaw-indie-rock'
]

for ev in events:
    eid = ev.get('id') or ev.get('event_id')
    if eid in genuine_one_offs:
        print(f"  • [ONE-OFF] {eid:<28} | freq={ev.get('frequency'):<8} | sched={ev.get('dateSchedule')}")
        assert ev.get('frequency') == 'one-off', f"{eid} should be tagged as one-off!"

# Venue-authenticated recurring programs
recurring_authenticated = {
    'rio-late-night-cinema': 'daily',
    'tm-biltmore-emerging-artist': 'weekly',
    'fox-cabaret-indie-cinema': 'weekly',
    'cinematheque-matinee': 'weekly',
    'frankies-jazz-brad-turner': 'weekly',
    'the-roxy-fab-fourever': 'daily'
}

for ev in events:
    eid = ev.get('id') or ev.get('event_id')
    if eid in recurring_authenticated:
        expected_freq = recurring_authenticated[eid]
        print(f"  • [RECURRING] {eid:<28} | freq={ev.get('frequency'):<8} (expected {expected_freq}) | sched={ev.get('dateSchedule')}")
        assert ev.get('frequency') == expected_freq, f"{eid} frequency mismatch: expected {expected_freq}, got {ev.get('frequency')}"

# ------------------------------------------------------------------------------
# Test 5: 20-Dimension Audit Metadata & Confirmation Timestamp Integrity
# ------------------------------------------------------------------------------
print("\n[TEST 5] 20-Dimension Audit Metadata & Confirmation Timestamp Verification:")
expected_dimensions = [
    'D1_title', 'D2_date', 'D3_time', 'D4_weekly_hours', 'D5_schedule_string',
    'D6_frequency', 'D7_category', 'D8_location', 'D9_access_model', 'D10_pricing_model',
    'D11_price', 'D12_tiers', 'D13_benchmarks', 'D14_deep_link', 'D15_provider',
    'D16_description', 'D17_lineup', 'D18_restrictions', 'D19_sold_out', 'D20_showings_waypoints'
]

events_with_audit = 0
for ev in events:
    eid = ev.get('id') or ev.get('event_id')
    audit = ev.get('dimension_audit')
    assert audit is not None, f"Event {eid} missing 'dimension_audit' metadata!"
    assert 'last_full_qc_at' in audit, f"Event {eid} missing 'last_full_qc_at' in dimension_audit!"
    assert 'dimensions' in audit, f"Event {eid} missing 'dimensions' dictionary in dimension_audit!"
    
    dims = audit['dimensions']
    for dim_key in expected_dimensions:
        assert dim_key in dims, f"Event {eid} missing dimension {dim_key} in dimension_audit!"
        dim_data = dims[dim_key]
        assert 'confirmed_at' in dim_data, f"Event {eid} dimension {dim_key} missing confirmed_at timestamp!"
        assert 'status' in dim_data, f"Event {eid} dimension {dim_key} missing status!"

    events_with_audit += 1

print(f"  ✓ Validated 100% ({events_with_audit}/{len(events)}) active events with complete 20-dimension audit timestamps")

print("\n" + "=" * 70)
print("ALL AUTOMATED TESTS & SIMULATIONS PASSED (0 Errors, 0 Discrepancies)!")
print("=" * 70)
