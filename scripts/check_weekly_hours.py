import json

with open('data/events.json', encoding='utf-8') as f:
    events = json.load(f)

print(f"Total events: {len(events)}")
count_wh = 0
for idx, e in enumerate(events):
    wh = e.get('weekly_hours')
    if wh and isinstance(wh, dict):
        count_wh += 1
        valid_days = [k for k, v in wh.items() if v and 'not listed' not in str(v).lower() and 'closed' not in str(v).lower()]
        title = e.get('title', e.get('event_name', ''))
        lifecycle = e.get('lifecycle_type', '')
        category = e.get('category', '')
        date = e.get('date', '')
        print(f"[{idx}] {title[:35]:<35} | cat: {category[:15]:<15} | life: {lifecycle:<18} | date: {str(date):<10} | days: {len(valid_days)} ({list(wh.keys())})")

print(f"\nTotal with weekly_hours: {count_wh}")
