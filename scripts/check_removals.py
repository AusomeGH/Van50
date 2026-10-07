import json

with open('data/events.json', 'r', encoding='utf-8') as f:
    events = json.load(f)

for e in events:
    t = (e.get('title') or e.get('event_name') or '').strip()
    if t.startswith(',') or t == '2026':
        print(f"Broken title: '{t}' | ID: {e.get('event_id')} | URL: {e.get('ticket_url')}")
