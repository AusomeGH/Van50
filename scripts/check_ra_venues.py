import urllib.request
import json

venues_to_check = [
    "Bleach Listening Room",
    "The Lido",
    "Hero's Welcome",
    "Village Studios",
    "Platform9",
    "Celebrities Night Club",
    "The American"
]

query = """
query GET_EVENTS {
  eventListings(filters: { areas: { eq: 39 } }, pageSize: 100, page: 1) {
    data {
      event {
        title
        contentUrl
        venue {
          id
          name
          address
          contentUrl
        }
      }
    }
  }
}
"""

req = urllib.request.Request(
    'https://ra.co/graphql',
    data=json.dumps({'query': query}).encode('utf-8'),
    headers={
        'User-Agent': 'Mozilla/5.0',
        'Content-Type': 'application/json',
        'Referer': 'https://ra.co/events/ca/vancouver'
    }
)

res = urllib.request.urlopen(req, timeout=12)
data = json.loads(res.read().decode('utf-8'))
listings = data.get('data', {}).get('eventListings', {}).get('data', [])

venue_map = {}
for item in listings:
    ev = item.get('event', {})
    v = ev.get('venue')
    if v and v.get('name'):
        name = v.get('name')
        if name not in venue_map:
            venue_map[name] = {
                'id': v.get('id'),
                'address': v.get('address'),
                'contentUrl': v.get('contentUrl')
            }

print(f"Total distinct venues found: {len(venue_map)}")
for target in venues_to_check:
    print(f"\nTarget: {target}")
    matched = False
    for k, val in venue_map.items():
        if target.lower() in k.lower() or k.lower() in target.lower():
            print(f"  Match: '{k}' -> id: {val['id']}, contentUrl: {val['contentUrl']}")
            matched = True
    if not matched:
        print("  No direct match in active listings.")
