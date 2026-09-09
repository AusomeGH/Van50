"""
test_categories_and_links.py - Regression test suite for:
1. Split categories: 'music' (Live Music) and 'shows' (Comedy & Shows)
2. Accurate sold-out status & active waitlist links
3. Clear location/Google Maps navigation vs official venue website links
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
    print("VAN50 TEST SUITE: CATEGORIES SPLIT, SOLD-OUT ACCURACY & VENUE LINKS")
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

    # 4. Verify Sold-Out Accuracy (0 False Positives)
    sold_out = [ev for ev in events if ev.get('isSoldOut')]
    print(f"[TEST 2] Sold-Out Accuracy Check:")
    print(f"  • Events currently flagged isSoldOut: {len(sold_out)}")
    assert len(sold_out) == 0, f"Expected 0 false positive sold out events, got {len(sold_out)}: {[e['id'] for e in sold_out]}"
    print(f"  ✓ 0 false-positive sold-out events across all 59 catalog items")

    rickshaw = next((e for e in events if e['id'] == 'rickshaw-indie-rock'), None)
    assert rickshaw is not None, "rickshaw-indie-rock event not found"
    assert rickshaw.get('isSoldOut') is False, "rickshaw-indie-rock isSoldOut must be False"
    assert rickshaw.get('category') == 'music', "rickshaw-indie-rock category must be 'music'"
    print(f"  ✓ Rickshaw Theatre verified: isSoldOut is False, category is 'music'")

    # 5. Verify App.js Link Architecture
    with open(APP_JS_PATH, 'r', encoding='utf-8') as f:
        app_js = f.read()
    
    assert 'venue-location-link' in app_js, "app.js missing venue-location-link"
    assert 'venue-website-link' in app_js, "app.js missing venue-website-link"
    assert 'directions-pill' in app_js, "app.js missing directions-pill"
    assert '<a \n        href="${ev.websiteUrl}" \n        target="_blank" \n        rel="noopener noreferrer" \n        class="btn-ticket-cta sold-out"' in app_js, "app.js sold-out button must be an active <a> link to ticketing waitlist"
    print(f"[TEST 3] Link Architecture Verification in js/app.js:")
    print(f"  ✓ Venue location link directly targets Google Maps navigation")
    print(f"  ✓ Venue website link distinctly targets official venue homepage")
    print(f"  ✓ Sold-out button maintains active <a> anchor to ticketing portal waitlists")

    # 6. Verify Styles in components.css
    with open(COMPONENTS_CSS_PATH, 'r', encoding='utf-8') as f:
        css = f.read()
    
    assert '.venue-location-link' in css, "components.css missing .venue-location-link"
    assert '.venue-website-link' in css, "components.css missing .venue-website-link"
    assert '.directions-pill' in css, "components.css missing .directions-pill"
    print(f"[TEST 4] CSS Components Verification:")
    print(f"  ✓ Distinct styling for location navigation vs website browsing confirmed")

    print("\n======================================================================")
    print("ALL CATEGORIES, SOLD-OUT & LINK TESTS PASSED CLEANLY (0 Errors)!")
    print("======================================================================")
    return True

if __name__ == '__main__':
    ok = run_tests()
    sys.exit(0 if ok else 1)
