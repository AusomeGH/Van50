import json

with open('data/events.json', 'r', encoding='utf-8') as f:
    events = json.load(f)

titles = sorted([(e.get('title') or e.get('event_name'), e.get('venue_name'), e.get('ticket_url')) for e in events], key=lambda x: str(x[0]))
for t, v, u in titles:
    if len(t) < 8 or any(w in t.lower() for w in ['help', 'contact', 'support', 'terms', 'privacy', 'permit', 'resource', 'submit', 'policy', 'list', 'about', 'cookie']):
        print(f"'{t}' @ '{v}' -> {u}")
