import json

with open('data/discovery_sources.json', encoding='utf-8') as f:
    data = json.load(f)

for s in data.get('sources', []):
    name = s.get('name', '')
    sid = s.get('id', '')
    stype = s.get('type', '')
    url = s.get('eventsUrl') or s.get('url') or ''
    if any(k in name.lower() or k in sid.lower() or k in s.get('focus', '').lower() for k in ['bia', 'vancouver', 'gastown', 'commercial', 'mount pleasant', 'civic', 'festival']):
        print(f"{sid:<25} | {name:<30} | {stype:<25} | {url}")
