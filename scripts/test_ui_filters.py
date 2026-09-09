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
events = data['events']
metadata = data.get('metadata', {})

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
    assert e['price'] <= 50.00, f"Event {e['id']} exceeds budget cap: ${e['price']}"
    if e.get('tiers'):
        for t in e['tiers']:
            assert t['price'] <= 50.00, f"Event {e['id']} tier '{t['name']}' exceeds $50: ${t['price']}"

print("  ✓ Strict $50.00 CAD Budget Cap PASSED")

# ------------------------------------------------------------------------------
# Test 2: Client-Side Simulation of formatStandardPrice()
# ------------------------------------------------------------------------------
print("\n[TEST 2] Client-Side formatStandardPrice() Simulation:")

def simulate_format_standard_price(ev):
    tiers = ev.get('tiers') or []
    if len(tiers) > 1:
        min_p = min(t['price'] for t in tiers)
        max_p = max(t['price'] for t in tiers)
        if min_p == max_p:
            return 'Free ($0)' if min_p == 0 else f"${min_p:.2f} all-in"
        if min_p == 0:
            return f"Free – ${max_p:.2f} all-in"
        return f"${min_p:.2f} – ${max_p:.2f} all-in"
    if (ev.get('isFree') or ev['price'] == 0) and not any(t.get('price', 0) > 0 for t in tiers):
        return 'Free ($0)'
    if ev.get('pricingType') == 'door':
        return f"${ev['price']:.2f} door"
    if ev.get('pricingType') == 'food-drink':
        return f"Free entry (~${int(ev['price'])} food/drink)"
    return ev.get('priceLabel') or f"${ev['price']:.2f} all-in"

mixed_tier_count = 0
for ev in events:
    rendered = simulate_format_standard_price(ev)
    tiers = ev.get('tiers') or []
    
    # Layer 1 Assertion: Never let $0 override paid tiers
    if any(t.get('price', 0) > 0 for t in tiers):
        assert rendered != "Free ($0)", f"CRITICAL: Event {ev['id']} rendered Free ($0) despite having paid tickets!"
        assert ev.get('isFree') is False, f"CRITICAL: Event {ev['id']} marked isFree: True despite having paid tickets!"

    if len(tiers) > 1:
        mixed_tier_count += 1
        print(f"  • Multi-Tier Verified: {ev['id']:<28} -> Headline: '{rendered}' (Primary: ${ev['price']:.2f})")

print(f"  ✓ Validated {mixed_tier_count} multi-tier events with 0 incorrect Free overrides")

# Specific check on Improv Jam
jam = next(e for e in events if e['id'] == 'lmg-improv-jam')
assert jam['price'] == 10.24, f"Expected Improv Jam primary audience price to be 10.24, got {jam['price']}"
assert jam['isFree'] is False, "Improv Jam should not be isFree: True"
assert simulate_format_standard_price(jam) == "Free – $10.24 all-in"
print(f"  ✓ 'lmg-improv-jam' correctly verified at $10.24 Audience Rate (Performer: Free)")

# ------------------------------------------------------------------------------
# Test 3: Manual Review Quarantine Queue Integrity
# ------------------------------------------------------------------------------
print("\n[TEST 3] Quarantine Queue Policy Verification:")
assert len(quarantined) >= 3, f"Expected at least 3 quarantined events, found {len(quarantined)}"
for q in quarantined:
    assert 'flagReason' in q, f"Quarantined event {q['id']} missing flagReason!"
    print(f"  • Quarantined [{q['id']}]: {q['title']} -> {q['flagReason']}")

print(f"  ✓ Quarantine Queue verified ({len(quarantined)} items isolated from live app)")

# ------------------------------------------------------------------------------
# Test 4: One-Off and Advance Dates Alignment
# ------------------------------------------------------------------------------
print("\n[TEST 4] Date Alignment & Recurrence Tagging:")
advance_date_events = [
    'eb-puff-magic-improv',
    'rio-late-night-cinema',
    'fox-cabaret-indie-cinema',
    'tm-biltmore-emerging-artist',
    'eb-standup-mental-health',
    'eb-alistair-ogden-rio',
    'rickshaw-indie-rock'
]

for ev in events:
    if ev['id'] in advance_date_events:
        print(f"  • [OK] {ev['id']:<28} | freq={ev['frequency']:<8} | sched={ev['dateSchedule']}")
        assert ev['frequency'] == 'one-off', f"{ev['id']} should be tagged as one-off!"

print("\n" + "=" * 70)
print("ALL AUTOMATED TESTS & SIMULATIONS PASSED (0 Errors, 0 Discrepancies)!")
print("=" * 70)
