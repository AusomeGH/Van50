import json

with open('data/manual_review_queue.json', 'r', encoding='utf-8') as f:
    q = json.load(f)

events = q.get('quarantinedEvents', [])
print(f"Total Quarantined Items: {len(events)}")
for i, e in enumerate(events):
    eid = e.get('id')
    title = e.get('title') or e.get('event_name')
    venue = e.get('venue') or e.get('venue_name')
    date = e.get('date') or (e.get('show_1', {}).get('date') if isinstance(e.get('show_1'), dict) else None)
    t_url = e.get('ticket_url') or e.get('details_url') or e.get('discovery_url')
    reason = e.get('quarantineReason') or e.get('reason') or e.get('unconfirmedDetails')
    print(f"[{i+1}] ID: {eid}")
    print(f"    Title: {title} @ {venue}")
    print(f"    Date: {date}")
    print(f"    URL: {t_url}")
    print(f"    Reason: {reason}")
    print("-" * 50)
