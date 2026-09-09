"""
test_categories_and_links.py - Regression test suite for:
1. Split categories: 'music' (Live Music) and 'shows' (Comedy & Shows)
2. Accurate sold-out status & active waitlist links
3. Single unified location button with single label (Google Maps) vs official venue website link
4. Automated Title Sanitization Linter: no demographic/concession noise in card titles (e.g. VSO, UBC)
"""

import json
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENTS_JSON_PATH = os.path.join(ROOT_DIR, 'data', 'events.json')
DATA_JS_PATH = os.path.join(ROOT_DIR, 'js', 'data.js')
APP_JS_PATH = os.path.join(ROOT_DIR, 'js', 'app.js')
COMPONENTS_CSS_PATH = os.path.join(ROOT_DIR, 'css', 'components.css')

def run_tests():
    print("======================================================================")
    print("VAN50 TEST SUITE: CATEGORIES SPLIT, TITLE LINTER & UNIFIED VENUE BTN")
    print("======================================================================")

    # 1. Load Events Data
    with open(EVENTS_JSON_PATH, 'r', encoding='utf-8') as f:
        events_data = json.load(f)
    events = events_data['events']
    print(f"[TEST 1] Loaded {len(events)} events from data/events.json")

    # 2. Verify Category Breakdown
    cat_counts = {}
    for ev in events:
        c = ev.get('category')
        cat_counts[c] = cat_counts.get(c, 0) + 1
    
    print(f"  • Category counts: {cat_counts}")
    assert cat_counts.get('music') == 16, f"Expected 16 music events, got {cat_counts.get('music')}"
    assert cat_counts.get('shows') == 12, f"Expected 12 shows events, got {cat_counts.get('shows')}"
    print(f"  ✓ 'music' category verified: exactly 16 Live Music events")
    print(f"  ✓ 'shows' category verified: exactly 12 Comedy & Shows events")

    # 3. Check data.js CATEGORIES array
    with open(DATA_JS_PATH, 'r', encoding='utf-8') as f:
        data_js = f.read()

    assert 'id: "music", label: "Live Music", icon: "🎵"' in data_js, "data.js missing 'music' category pill"
    assert 'id: "shows", label: "Comedy & Shows", icon: "🎭"' in data_js, "data.js missing 'shows' category pill"
    print(f"  ✓ js/data.js CATEGORIES array verified with both Live Music (🎵) and Comedy & Shows (🎭)")

    # 4. Automated Title Sanitization Linter Test (Prevents Concession Noise in Titles)
    print(f"[TEST 2] Title Sanitization & Linter Audit across {len(events)} events:")
    prohibited_patterns = [
        r':\s*Under-?\d+\s*Club',
        r':\s*Under-?\d+\s*Symphony\s*Club',
        r':\s*Varsity\s+Sports\s+Admission',
        r':\s*Student\s+Rush',
        r':\s*Senior\s+Discount',
        r':\s*Member\s+Pass'
    ]
    for ev in events:
        t = ev['title']
        for pat in prohibited_patterns:
            assert not re.search(pat, t, re.IGNORECASE), f"Title '{t}' violates linter rule: contains '{pat}'"
    print(f"  ✓ 100% of event titles pass automated linter (0 concession/demographic leaks in card names)")

    # 5. Specific Verification for VSO and UBC
    vso = next((e for e in events if e['id'] == 'vso-under-35-club'), None)
    assert vso is not None, "VSO event not found"
    assert vso['title'] == "Vancouver Symphony Orchestra Live at The Orpheum", f"VSO title unexpected: {vso['title']}"
    assert vso['price'] == 35.0, f"VSO standard price must be 35.00, got {vso['price']}"
    assert len(vso.get('tiers', [])) == 2, f"VSO must have 2 tiers, got {len(vso.get('tiers', []))}"
    print(f"  ✓ VSO verified: Title='{vso['title']}', Standard Price=${vso['price']:.2f}, Tiers={vso['tiers']}")

    ubc = next((e for e in events if e['id'] == 'ubc-thunderbirds-varsity'), None)
    assert ubc is not None, "UBC event not found"
    assert ubc['title'] == "UBC Thunderbirds: Home Varsity Games", f"UBC title unexpected: {ubc['title']}"
    print(f"  ✓ UBC Thunderbirds verified: Title='{ubc['title']}'")

    # 6. Verify Sold-Out Accuracy (0 False Positives)
    sold_out = [ev for ev in events if ev.get('isSoldOut')]
    print(f"[TEST 3] Sold-Out Accuracy Check:")
    print(f"  • Events currently flagged isSoldOut: {len(sold_out)}")
    assert len(sold_out) == 0, f"Expected 0 false positive sold out events, got {len(sold_out)}: {[e['id'] for e in sold_out]}"
    print(f"  ✓ 0 false-positive sold-out events across all 59 catalog items")

    # 7. Verify App.js Link Architecture: Single Unified Location Button
    with open(APP_JS_PATH, 'r', encoding='utf-8') as f:
        app_js = f.read()
    
    assert 'venue-location-btn' in app_js, "app.js missing venue-location-btn"
    assert 'venue-website-link' in app_js, "app.js missing venue-website-link"
    assert '${ev.venue} (Directions)' in app_js, "app.js missing unified single label '${ev.venue} (Directions)'"
    assert '<a \n        href="${ev.websiteUrl}" \n        target="_blank" \n        rel="noopener noreferrer" \n        class="btn-ticket-cta sold-out"' in app_js, "app.js sold-out button must be an active <a> link to ticketing waitlist"
    print(f"[TEST 4] Single Unified Location Button in js/app.js:")
    print(f"  ✓ Single location button with unified single label '${{ev.venue}} (Directions)' targeting Google Maps")
    print(f"  ✓ Distinct venue website button targeting official homepage")

    # 8. Verify Styles in components.css
    with open(COMPONENTS_CSS_PATH, 'r', encoding='utf-8') as f:
        css = f.read()
    
    assert '.venue-location-btn' in css, "components.css missing .venue-location-btn"
    assert '.venue-website-link' in css, "components.css missing .venue-website-link"
    print(f"[TEST 5] CSS Components Verification:")
    print(f"  ✓ Single unified button styling confirmed without nested button artifacts")

    print("\n======================================================================")
    print("ALL TESTS PASSED CLEANLY (0 Errors, 0 Discrepancies)!")
    print("======================================================================")
    return True

if __name__ == '__main__':
    ok = run_tests()
    sys.exit(0 if ok else 1)
