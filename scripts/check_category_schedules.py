import json

with open('data/events.json', encoding='utf-8') as f:
    events = json.load(f)

print("Checking schedule representations across categories:")
categories = {}
for e in events:
    cat = e.get('category', 'unknown')
    has_wh = bool(e.get('weekly_hours'))
    has_showings = bool(e.get('showings'))
    has_date = bool(e.get('date'))
    has_datesched = bool(e.get('dateSchedule'))
    if cat not in categories:
        categories[cat] = {'total': 0, 'has_wh': 0, 'has_showings': 0, 'has_date': 0, 'has_datesched': 0}
    categories[cat]['total'] += 1
    if has_wh: categories[cat]['has_wh'] += 1
    if has_showings: categories[cat]['has_showings'] += 1
    if has_date: categories[cat]['has_date'] += 1
    if has_datesched: categories[cat]['has_datesched'] += 1

for cat, counts in categories.items():
    print(f"{cat:<25} | total: {counts['total']:<3} | wh: {counts['has_wh']:<3} | showings: {counts['has_showings']:<3} | date: {counts['has_date']:<3} | datesched: {counts['has_datesched']:<3}")
