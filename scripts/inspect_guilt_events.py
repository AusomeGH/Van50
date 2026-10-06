import json

with open('data/events.json', encoding='utf-8') as f:
    events = json.load(f)

guilt_events = [e for e in events if 'guilt' in e.get('event_id', '').lower() or 'guilt' in e.get('title', '').lower()]
print(f"Guilt events count: {len(guilt_events)}")
for e in guilt_events:
    print(json.dumps(e, indent=2))
