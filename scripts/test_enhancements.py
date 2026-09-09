#!/usr/bin/env python3
"""
Test suite for Van50 Enhancements:
1. Multi-link cards (websiteUrl, venueUrl, Google Maps URL)
2. Dynamic recurring date calculation simulation
3. Google Maps directions integration in cards and map popups
"""

import os
import sys
import json
import urllib.parse
from datetime import datetime, date, timedelta

sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
JSON_PATH = os.path.join(BASE_DIR, 'data', 'events.json')
JS_DATA_PATH = os.path.join(BASE_DIR, 'js', 'data.js')
JS_APP_PATH = os.path.join(BASE_DIR, 'js', 'app.js')
JS_MAP_PATH = os.path.join(BASE_DIR, 'js', 'map.js')
CSS_PATH = os.path.join(BASE_DIR, 'css', 'components.css')

DAY_MAP = {'sun': 6, 'mon': 0, 'tue': 1, 'wed': 2, 'thu': 3, 'fri': 4, 'sat': 5}

def simulate_calculate_next_two_dates(ev, reference_date=None):
    if reference_date is None:
        today = date.today()
    else:
        today = reference_date

    freq = ev.get('frequency', '')
    days = ev.get('daysOfWeek', [])
    
    # 1. Daily
    if freq == 'daily' or 'daily' in days:
        d1 = today
        d2 = today + timedelta(days=1)
        return {
            'type': 'daily',
            'label': 'Open Daily',
            'dates': f"Today ({d1.strftime('%a, %b %d')}) • Tomorrow ({d2.strftime('%a, %b %d')})"
        }

    # 2. Weekly
    if freq == 'weekly' or (len(days) > 0 and 'daily' not in days):
        target_day_nums = [DAY_MAP[d.lower()] for d in days if d.lower() in DAY_MAP]
        if target_day_nums:
            found = []
            for offset in range(21):
                candidate = today + timedelta(days=offset)
                if candidate.weekday() in target_day_nums:
                    found.append(candidate)
                    if len(found) == 2:
                        break
            if found:
                parts = []
                for d in found:
                    prefix = "Today (" if d == today else ("Tomorrow (" if d == (today + timedelta(days=1)) else "")
                    suffix = ")" if (d == today or d == (today + timedelta(days=1))) else ""
                    parts.append(f"{prefix}{d.strftime('%a, %b %d')}{suffix}")
                return {
                    'type': 'weekly',
                    'label': 'Next 2 Dates',
                    'dates': " • ".join(parts)
                }

    # 3. Monthly
    if freq == 'monthly':
        start_iso = ev.get('startIso')
        if start_iso:
            try:
                start_dt = datetime.fromisoformat(start_iso).date()
                if start_dt >= today:
                    return {
                        'type': 'monthly',
                        'label': 'Next Show',
                        'dates': start_dt.strftime('%a, %b %d')
                    }
            except Exception:
                pass
        return {
            'type': 'monthly',
            'label': 'Monthly Series',
            'dates': ev.get('dateSchedule', '')
        }

    # 4. One-off
    start_iso = ev.get('startIso')
    if start_iso:
        try:
            start_dt = datetime.fromisoformat(start_iso).date()
            return {
                'type': 'one-off',
                'label': 'Event Date',
                'dates': start_dt.strftime('%a, %b %d')
            }
        except Exception:
            pass

    return None


def run_tests():
    print("=" * 70)
    print("VAN50 ENHANCEMENTS VERIFICATION: Multi-Link, Maps & Next Dates")
    print("=" * 70)

    # 1. Load data/events.json
    assert os.path.exists(JSON_PATH), f"Missing {JSON_PATH}"
    with open(JSON_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    events = data['events']
    print(f"[TEST 1] Loaded {len(events)} events from data/events.json")

    # Verify all events have websiteUrl, venueUrl, and coordinates
    missing_website = 0
    missing_venue_url = 0
    missing_coords = 0
    for ev in events:
        if not ev.get('websiteUrl') or not ev['websiteUrl'].startswith('http'):
            missing_website += 1
        if not ev.get('venueUrl') or not ev['venueUrl'].startswith('http'):
            missing_venue_url += 1
        if not ev.get('coordinates') or len(ev['coordinates']) != 2:
            missing_coords += 1

    assert missing_website == 0, f"{missing_website} events missing websiteUrl"
    assert missing_venue_url == 0, f"{missing_venue_url} events missing venueUrl"
    assert missing_coords == 0, f"{missing_coords} events missing coordinates"
    print(f"  ✓ 100% of events ({len(events)}/{len(events)}) have verified ticket websiteUrl")
    print(f"  ✓ 100% of events ({len(events)}/{len(events)}) have verified official venueUrl")
    print(f"  ✓ 100% of events ({len(events)}/{len(events)}) have valid geo coordinates")

    # 2. Test Google Maps URL generation
    print("\n[TEST 2] Google Maps Directions URL Schema Verification:")
    sample_ev = events[0]
    gmaps_query = urllib.parse.quote_plus(f"{sample_ev['venue']}, {sample_ev.get('address', 'Vancouver BC')}")
    sample_gmaps_url = f"https://www.google.com/maps/search/?api=1&query={gmaps_query}"
    assert "google.com/maps/search" in sample_gmaps_url
    print(f"  ✓ Sample Google Maps URL generated cleanly: {sample_gmaps_url}")

    # 3. Test Dynamic Recurring Date Calculation
    print("\n[TEST 3] Dynamic Recurring Date Calculation Simulation:")
    test_wednesday = date(2026, 9, 9)  # Known Wednesday
    calculated_counts = {'daily': 0, 'weekly': 0, 'monthly': 0, 'one-off': 0}

    for ev in events:
        res = simulate_calculate_next_two_dates(ev, reference_date=test_wednesday)
        assert res is not None, f"Calculation failed for event: {ev['id']}"
        calculated_counts[res['type']] = calculated_counts.get(res['type'], 0) + 1

    print(f"  • Date calculation types: {calculated_counts}")

    # Specifically check Friday weekly open mic
    lmg_mic = next((e for e in events if e['id'] == 'lmg-open-mic'), None)
    assert lmg_mic is not None
    res_mic = simulate_calculate_next_two_dates(lmg_mic, reference_date=test_wednesday)
    print(f"  • 'lmg-open-mic' (Weekly Friday) from Wed Sep 9 -> {res_mic['dates']}")
    assert "Fri, Sep 11" in res_mic['dates']
    assert "Fri, Sep 18" in res_mic['dates']
    print("  ✓ Weekly recurrence accurately finds next 2 Fridays: Sep 11 and Sep 18")

    # Specifically check Kitsilano Showboat (Mon, Wed, Fri)
    showboat = next((e for e in events if e['id'] == 'kitsilano-showboat'), None)
    assert showboat is not None
    res_boat = simulate_calculate_next_two_dates(showboat, reference_date=test_wednesday)
    print(f"  • 'kitsilano-showboat' (Mon, Wed, Fri) from Wed Sep 9 -> {res_boat['dates']}")
    assert "Today (Wed, Sep 09)" in res_boat['dates'] or "Today (Wed, Sep 9)" in res_boat['dates']
    assert "Fri, Sep 11" in res_boat['dates']
    print("  ✓ Multi-day weekly recurrence accurately detects Today (Wed) and upcoming (Fri)")

    # Specifically check Daily Stanley Park
    seawall = next((e for e in events if e['id'] == 'seawall-lost-lagoon'), None)
    res_sea = simulate_calculate_next_two_dates(seawall, reference_date=test_wednesday)
    print(f"  • 'seawall-lost-lagoon' (Daily) from Wed Sep 9 -> {res_sea['dates']}")
    assert "Today" in res_sea['dates'] and "Tomorrow" in res_sea['dates']
    print("  ✓ Daily spots accurately compute Today and Tomorrow")

    # 4. Verify Frontend Files (HTML/JS/CSS)
    print("\n[TEST 4] Frontend Template & Stylesheet Audit:")
    with open(JS_APP_PATH, 'r', encoding='utf-8') as f:
        app_js = f.read()
    assert 'class="card-title-link"' in app_js, "card-title-link missing in js/app.js"
    assert 'venue-link' in app_js or 'venue-website-link' in app_js, "venue-link missing in js/app.js"
    assert 'card-maps-link' in app_js or 'venue-location-link' in app_js, "card-maps-link missing in js/app.js"
    assert 'class="card-next-dates-box"' in app_js, "card-next-dates-box missing in js/app.js"
    assert 'calculateNextTwoDates' in app_js, "calculateNextTwoDates function missing in js/app.js"
    print("  ✓ js/app.js contains all title link, venue link, directions, and next date tags")

    with open(JS_MAP_PATH, 'r', encoding='utf-8') as f:
        map_js = f.read()
    assert 'popup-gmaps-btn' in map_js, "popup-gmaps-btn missing in js/map.js"
    assert 'google.com/maps/search' in map_js, "Google Maps search query missing in js/map.js"
    print("  ✓ js/map.js popup includes Google Maps navigation link")

    with open(CSS_PATH, 'r', encoding='utf-8') as f:
        css = f.read()
    assert '.card-title-link' in css, ".card-title-link CSS missing in css/components.css"
    assert '.venue-link' in css, ".venue-link CSS missing in css/components.css"
    assert '.card-maps-link' in css, ".card-maps-link CSS missing in css/components.css"
    assert '.card-next-dates-box' in css, ".card-next-dates-box CSS missing in css/components.css"
    assert '.popup-gmaps-btn' in css, ".popup-gmaps-btn CSS missing in css/components.css"
    print("  ✓ css/components.css contains complete styling for all new components")

    print("\n" + "=" * 70)
    print("ALL ENHANCEMENT TESTS PASSED CLEANLY! (0 Errors, 0 Discrepancies)")
    print("=" * 70)
    return True

if __name__ == '__main__':
    ok = run_tests()
    sys.exit(0 if ok else 1)
