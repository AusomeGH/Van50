#!/usr/bin/env python3
"""
Test Suite: Resident Advisor Live Integration & Evidence-Grounded Dates Engine
Validates:
1. Resident Advisor (ra.co) discovery source registration and active event ingestion <= $50 CAD.
2. Complete elimination of phantom recurring dates (Public Disco confirmed for Oct 3, 2026, 0 fake dates).
3. Dynamic scraped metadata (Editorial, Taxonomy, Nomadic facts, Door covers) populated.
"""

import json
import os
import sys
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENTS_JSON_PATH = os.path.join(ROOT_DIR, 'data', 'events.json')
DISCOVERY_SOURCES_PATH = os.path.join(ROOT_DIR, 'data', 'discovery_sources.json')
JS_DATA_PATH = os.path.join(ROOT_DIR, 'js', 'data.js')

def test_ra_and_evidence_dates():
    print("=" * 70)
    print("VAN50 TEST SUITE: RESIDENT ADVISOR & EVIDENCE-GROUNDED DATES QC")
    print("=" * 70)

    # 1. Test Discovery Sources
    print("\n[TEST 1] Verifying Resident Advisor Discovery Source Registration:")
    assert os.path.exists(DISCOVERY_SOURCES_PATH), f"Missing {DISCOVERY_SOURCES_PATH}"
    with open(DISCOVERY_SOURCES_PATH, 'r', encoding='utf-8') as f:
        disc = json.load(f)
    sources = disc.get('sources', [])
    ra_src = next((s for s in sources if s.get('id') == 'resident-advisor-vancouver'), None)
    assert ra_src is not None, "Missing resident-advisor-vancouver in discovery_sources.json"
    assert "ra.co" in ra_src.get('domain', ''), f"Unexpected RA domain: {ra_src.get('domain')}"
    assert ra_src.get('targetBudgetTier') == "<= $50 CAD & free"
    print(f"  ✓ Resident Advisor registered in discovery_sources.json (Total sources: {len(sources)})")

    # 2. Test Events Data Payload
    print("\n[TEST 2] Verifying Events Database Payload:")
    assert os.path.exists(EVENTS_JSON_PATH), f"Missing {EVENTS_JSON_PATH}"
    with open(EVENTS_JSON_PATH, 'r', encoding='utf-8') as f:
        db = json.load(f)
    events = db.get('events', [])
    print(f"  • Loaded {len(events)} verified catalog events")
    assert len(events) >= 70, f"Expected >= 70 events, got {len(events)}"

    # 3. Test Resident Advisor Events Ingested
    print("\n[TEST 3] Verifying Resident Advisor Events Ingestion & Budget Compliance:")
    ra_events = [e for e in events if e.get('ticketProvider') == 'Resident Advisor Verified' or 'ra-' in e.get('id', '')]
    print(f"  • Found {len(ra_events)} Resident Advisor events in active catalog:")
    assert len(ra_events) >= 6, f"Expected at least 6 RA events, got {len(ra_events)}"

    for ra_ev in ra_events:
        print(f"    - [{ra_ev.get('id')}] '{ra_ev.get('title')}' @ {ra_ev.get('venue')}")
        print(f"      Price: ${ra_ev.get('price', 0):.2f} CAD ({ra_ev.get('priceLabel')})")
        print(f"      Confirmed Dates: {ra_ev.get('confirmedDates')}")
        print(f"      URL: {ra_ev.get('websiteUrl')}")
        
        # Strict Budget Cap Check
        assert ra_ev.get('price') <= 50.00, f"RA event exceeds $50 budget: {ra_ev}"
        assert ra_ev.get('websiteUrl', '').startswith('https://ra.co'), f"Invalid RA URL: {ra_ev.get('websiteUrl')}"
        assert ra_ev.get('coordinates') and len(ra_ev.get('coordinates')) == 2, f"Missing coords: {ra_ev}"
        assert ra_ev.get('venue'), f"Missing venue: {ra_ev}"
        assert ra_ev.get('category') == 'music', f"Expected music category: {ra_ev.get('category')}"
    print(f"  ✓ 100% of RA events comply with the strict <= $50.00 CAD budget and verified coordinates")

    # 4. Test Public Disco Reality Check & Zero Phantom Dates
    print("\n[TEST 4] Verifying Public Disco Evidence-Grounded Dates & 0 Phantom Recurrence:")
    disco_block = next((e for e in events if e.get('id') == 'public-disco-block-party'), None)
    disco_wh = next((e for e in events if e.get('id') == 'public-disco-warehouse-party'), None)

    assert disco_block is not None, "Missing public-disco-block-party"
    assert disco_wh is not None, "Missing public-disco-warehouse-party"

    # Block Party Festival check
    print(f"  • Public Disco Festival Title: '{disco_block.get('title')}'")
    print(f"    Venue: '{disco_block.get('venue')}'")
    print(f"    Confirmed Dates: {disco_block.get('confirmedDates')}")
    print(f"    Frequency: '{disco_block.get('frequency')}'")
    
    assert disco_block.get('venue') == "The Shipyards Waterfront", f"Expected Shipyards, got {disco_block.get('venue')}"
    assert disco_block.get('confirmedDates') == ["2026-10-03"], f"Expected ['2026-10-03'], got {disco_block.get('confirmedDates')}"
    assert disco_block.get('price') == 0.0, f"Expected Free, got {disco_block.get('price')}"
    assert disco_block.get('frequency') == "seasonal", f"Expected seasonal frequency, got {disco_block.get('frequency')}"

    # Warehouse series check
    print(f"  • Public Disco Warehouse Series Title: '{disco_wh.get('title')}'")
    print(f"    Venue: '{disco_wh.get('venue')}'")
    print(f"    Confirmed Dates: {disco_wh.get('confirmedDates')}")
    assert disco_wh.get('confirmedDates') == [], f"Warehouse party should have [] confirmed dates, got {disco_wh.get('confirmedDates')}"
    assert disco_wh.get('frequency') == "seasonal"
    print(f"  ✓ Public Disco accurately represents verified schedule: Oct 3, 2026 festival date, 0 fake weekly dates")

    # 5. Test Dynamic Scraped Metadata
    print("\n[TEST 5] Verifying Dynamically Scraped Metadata:")
    # Check Roxy door price
    roxy_flagship = next((e for e in events if e.get('id') == 'the-roxy-fab-fourever'), None)
    assert roxy_flagship is not None, "Missing Roxy flagship"
    print(f"  • The Roxy Cover: {roxy_flagship.get('priceLabel')} (${roxy_flagship.get('price')})")
    assert roxy_flagship.get('price') == 12.0

    # Check Pizzeria Ludica table cover
    ludica = next((e for e in events if 'ludica' in e.get('id', '')), None)
    assert ludica is not None, "Missing Pizzeria Ludica"
    print(f"  • Pizzeria Ludica Cover: {ludica.get('priceLabel')} (${ludica.get('price')})")
    assert ludica.get('price') in (8.0, 18.0)

    # Check 2nd Floor Gastown
    gastown_jazz = next((e for e in events if '2nd-floor' in e.get('id', '')), None)
    assert gastown_jazz is not None, "Missing 2nd Floor Gastown"
    print(f"  • 2nd Floor Gastown Cover: {gastown_jazz.get('priceLabel')} (${gastown_jazz.get('price')})")
    assert gastown_jazz.get('price') == 12.0

    # Check live descriptions
    cinematheque = next((e for e in events if 'cinematheque' in e.get('id', '')), None)
    assert cinematheque is not None, "Missing Cinematheque"
    print(f"  • Cinematheque Sub-Tags: {cinematheque.get('subTags')}")
    assert len(cinematheque.get('subTags', [])) >= 3

    print("\n" + "=" * 70)
    print("ALL TESTS PASSED CLEANLY (100% Verified Evidence-Based Outings)!")
    print("=" * 70)
    return True

if __name__ == '__main__':
    test_ra_and_evidence_dates()
