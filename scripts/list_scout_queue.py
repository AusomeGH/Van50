import json

with open('data/venues.json', encoding='utf-8') as f:
    venues = json.load(f)

if isinstance(venues, list):
    venue_list = [v for v in venues if v.get('calendar_url') or v.get('calendarUrl')]
else:
    venue_list = [v for v in venues.values() if v.get('calendar_url') or v.get('calendarUrl')]

print(f"Total venues with calendars: {len(venue_list)}")
for i, v in enumerate(venue_list[:20], 1):
    name = v.get('venue_name', '')
    url = v.get('calendar_url') or v.get('calendarUrl')
    print(f"{i:2d}. {name:<35} | {url}")
