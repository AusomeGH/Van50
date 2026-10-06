import sys
sys.path.insert(0, 'scripts')
from universal_venue_crawler import UniversalVenueCrawler

meta = {
    'venue_name': 'Little Mountain Gallery',
    'calendarUrl': 'https://www.showpass.com/o/little-mountain-gallery/',
    'website_url': 'https://www.showpass.com/o/little-mountain-gallery/',
    'full_address': '110 E 5th Ave, Vancouver, BC V5T 1G8',
    'neighborhood': 'Mount Pleasant'
}

candidates = UniversalVenueCrawler.crawl_venue('Little Mountain Gallery', meta, max_candidates=10)
print(f"Discovered {len(candidates)} candidates from Little Mountain Gallery:")
for c in candidates[:5]:
    print(f" - [{c.get('date') or c.get('startIso')}] {c.get('title')} | Price: ${c.get('basePrice') or c.get('price')}")
