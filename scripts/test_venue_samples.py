import sys
sys.path.insert(0, 'scripts')
import json
from universal_venue_crawler import UniversalVenueCrawler

with open('data/venues.json', encoding='utf-8') as f:
    venues = json.load(f)

test_names = [
    'The Fox Cabaret',
    'The Biltmore Cabaret',
    'The Rio Theatre',
    'Guilt & Co.',
    'The Cinematheque',
    'VIFF Centre (Seymour Atrium)',
    'Vancouver Civic Theatres'
]

venues_dict = {v.get('venue_name'): v for v in venues if v.get('venue_name')}

for name in test_names:
    meta = venues_dict.get(name, {})
    url = meta.get('calendar_url') or meta.get('calendarUrl')
    print(f"\n--- Testing '{name}' ({url}) ---")
    cands = UniversalVenueCrawler.crawl_venue(name, meta, max_candidates=5)
    print(f"Result: {len(cands)} candidates found.")
    for c in cands[:3]:
        print(f"  * {c.get('title')} | Date: {c.get('date') or c.get('startIso')}")
