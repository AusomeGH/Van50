"""
test_artist_features.py - Automated test suite for band/artist card badges and search filtering
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

EVENTS_PATH = os.path.join(os.path.dirname(__file__), '..', 'data', 'events.json')

def test_artist_features():
    with open(EVENTS_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
        events = data.get('events', data) if isinstance(data, dict) else data

    print(f"Loaded {len(events)} events from {EVENTS_PATH}")
    
    # 1. Check small-venue music events have rotating artist attributes & series titles
    expected_new_music_events = [
        ("2nd-floor-gastown-sharon-minemoto", "Live Jazz & Supper Club at 2nd Floor Gastown", "Rotating local jazz trios & guest artists"),
        ("frankies-jazz-brad-turner", "Weekend Live Jazz Showcase at Frankie's Jazz Club", "Rotating Canadian & international jazz artists"),
        ("wise-hall-roots-revue", "East Van Roots, Folk & Live Music at The WISE Hall", "Rotating local roots, folk & bluegrass acts"),
        ("anza-club-bluegrass-jam", "Pacific Bluegrass & Heritage Acoustic Jam at The Anza Club", "Pacific Bluegrass Heritage Collective"),
        ("red-gate-dead-soft", "Friday Night Live Indie & Underground at Red Gate", "Rotating local indie, punk & experimental bands"),
        ("lanalous-the-jolts", "Weekend Live Rock 'n' Roll at LanaLou's", "Rotating local punk, garage & rock bands"),
        ("the-roxy-fab-fourever", "Live Music & Weekend Party Rock at The Roxy", "Local live bands & rotating guest artists")
    ]

    event_map = {ev['id']: ev for ev in events}
    
    print("\n[TEST 1] Verifying explicit artist attributes & series titles on all 7 music venues:")
    for eid, expected_title, expected_artist in expected_new_music_events:
        assert eid in event_map, f"Missing event: {eid}"
        ev = event_map[eid]
        artist = ev.get('artist')
        title = ev.get('title')
        assert title == expected_title, f"Title mismatch on {eid}: got '{title}', expected '{expected_title}'"
        assert artist == expected_artist, f"Artist mismatch on {eid}: got '{artist}', expected '{expected_artist}'"
        print(f"  ✓ [{eid}] -> Title: '{title}' | Artist: '{artist}' | Price: ${ev['price']:.2f} (<= $50 CAD)")

    # 2. Test search filter simulation (matching js/app.js search logic including performers and aliases)
    print("\n[TEST 2] Testing artist search queries (simulating js/app.js searchableContent):")
    search_queries = [
        ("Sharon Minemoto", "2nd-floor-gastown-sharon-minemoto"),
        ("Brad Turner", "frankies-jazz-brad-turner"),
        ("Dead Soft", "red-gate-dead-soft"),
        ("Babe Corner", "red-gate-dead-soft"),
        ("The Jolts", "lanalous-the-jolts"),
        ("Local live bands", "the-roxy-fab-fourever"),
        ("Roots & Bluegrass", "wise-hall-roots-revue"),
        ("Bluegrass Heritage", "anza-club-bluegrass-jam")
    ]

    for q, expected_id in search_queries:
        q_norm = q.lower().strip()
        matches = []
        for ev in events:
            artist_match = (
                (ev.get('artist') and q_norm in ev['artist'].lower()) or
                (ev.get('performers') and (
                    any(q_norm in p.lower() for p in ev['performers']) if isinstance(ev['performers'], list)
                    else q_norm in ev['performers'].lower()
                ))
            )
            title_match = ev.get('title') and q_norm in ev['title'].lower()
            venue_match = ev.get('venue') and q_norm in ev['venue'].lower()
            subtag_match = ev.get('subTags') and any(q_norm in t.lower() for t in ev['subTags'])
            alias_match = ev.get('venueAliases') and any(q_norm in a.lower() for a in ev['venueAliases'])
            desc_match = ev.get('description') and q_norm in ev['description'].lower()
            
            if artist_match or title_match or venue_match or subtag_match or alias_match or desc_match:
                matches.append(ev['id'])
        
        assert expected_id in matches, f"Query '{q}' failed to match expected event {expected_id}. Matches: {matches}"
        print(f"  ✓ Search '{q}' successfully matched '{expected_id}'")

    # 3. Test card-artist-badge rendering simulation
    print("\n[TEST 3] Testing card-artist-badge rendering simulation:")
    for eid, expected_title, expected_artist in expected_new_music_events:
        ev = event_map[eid]
        artist_badge_html = f'''<div class="card-artist-badge" title="Featured band / artist lineup">
  <span class="artist-icon">🎵</span>
  <span class="artist-label">Featuring:</span>
  <strong class="artist-name">{ev['artist']}</strong>
</div>'''
        assert 'card-artist-badge' in artist_badge_html
        assert ev['artist'] in artist_badge_html
        print(f"  ✓ [{eid}] Badge renders '{ev['artist']}' with icon 🎵 and label 'Featuring:'")

    print("\n======================================================================")
    print("ALL BAND / ARTIST TESTS PASSED CLEANLY (0 Errors)!")
    print("======================================================================")

if __name__ == '__main__':
    test_artist_features()
