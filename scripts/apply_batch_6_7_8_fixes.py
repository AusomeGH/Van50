import json

with open('data/events.json', 'r', encoding='utf-8') as f:
    events = json.load(f)

for e in events:
    eid = e.get('event_id') or e.get('id')
    
    # 1. Burnaby Central Railway
    if eid == 'van50-burnaby-central-railway-mini-train':
        e['ticket_url'] = 'https://bcsme.org'
        e['details_url'] = 'https://bcsme.org'
        e['ticket_provider'] = 'In-Person Kiosk'
        e['dateSchedule'] = 'Weekends & Thanksgiving Monday (thru Oct 12, 2026): 11:00 AM – 5:00 PM'
        
    # 2. Roundhouse Diwali Mehfil
    elif eid == 'van50-roundhouse-diwali-in-vancouver-mehfil-20261107':
        e['ticket_url'] = 'https://diwalifest.com/events/'
        e['details_url'] = 'https://roundhouse.ca/events/'
        e['ticket_provider'] = 'Diwali Fest Free Pre-Registration'
        
    # 3. Cinematheque Vampyr
    elif eid == 'van50-cinematheque-vampyr-live-score-20261031':
        e['ticket_url'] = 'https://thecinematheque.ca/films/2026/vampyr'
        e['details_url'] = 'https://thecinematheque.ca/films/2026/vampyr'
        e['ticket_provider'] = 'The Cinematheque Box Office'
        
    # 4. Stanley Pitch & Putt
    elif eid == 'stanley-pitch-putt':
        e['start_time'] = '08:00'
        e['end_time'] = '19:30'
        
    # 5. Queen Elizabeth Park Pitch & Putt
    elif eid == 'qe-park-pitch-putt':
        e['start_time'] = '08:00'
        e['end_time'] = '19:30'
        
    # 6. Rupert Park Pitch & Putt
    elif eid == 'rupert-park-pitch-putt':
        e['start_time'] = '08:00'
        e['end_time'] = '19:30'
        
    # 7. Central Park Pitch & Putt
    elif eid == 'central-park-pitch-putt':
        e['start_time'] = '08:00'
        e['end_time'] = '19:30'
        
    # 8. Bloedel Conservatory
    elif eid == 'van50-bloedel-conservatory-dome':
        e['start_time'] = '10:00'
        e['end_time'] = '17:00'
        
    # 9. Pizzeria Ludica
    elif eid == 'van50-ludica-boardgame-night':
        e['start_time'] = '16:00'
        e['end_time'] = '23:00'
        
    # 10. Guilt & Co Thursday Groove
    elif eid == 'van50-guilt-and-co-thursday-groove':
        e['date'] = '2026-10-08'
        e['start_time'] = '19:00'
        e['end_time'] = '01:00'
        e['show_1'] = {'date': '2026-10-08', 'start_time': '19:00', 'end_time': '01:00'}
        e['showings'] = [{'date': '2026-10-08', 'start_time': '19:00', 'end_time': '01:00'}]
        
    # 11. Guilt & Co Friday Jazz
    elif eid == 'van50-guilt-and-co-friday-jazz':
        e['date'] = '2026-10-09'
        e['start_time'] = '19:00'
        e['end_time'] = '02:00'
        e['show_1'] = {'date': '2026-10-09', 'start_time': '19:00', 'end_time': '02:00'}
        e['showings'] = [{'date': '2026-10-09', 'start_time': '19:00', 'end_time': '02:00'}]
        
    # 12. Guilt & Co Saturday Showcase
    elif eid == 'van50-guilt-and-co-saturday-showcase':
        e['date'] = '2026-10-10'
        e['start_time'] = '19:00'
        e['end_time'] = '02:00'
        e['show_1'] = {'date': '2026-10-10', 'start_time': '19:00', 'end_time': '02:00'}
        e['showings'] = [{'date': '2026-10-10', 'start_time': '19:00', 'end_time': '02:00'}]
        
    # 13. Guilt & Co Sunday Sessions
    elif eid == 'van50-guilt-and-co-sunday-sessions':
        e['date'] = '2026-10-11'
        e['start_time'] = '19:00'
        e['end_time'] = '01:00'
        e['show_1'] = {'date': '2026-10-04', 'start_time': '19:00', 'end_time': '01:00'}
        e['show_2'] = {'date': '2026-10-11', 'start_time': '19:00', 'end_time': '01:00'}
        e['showings'] = [
            {'date': '2026-10-04', 'start_time': '19:00', 'end_time': '01:00'},
            {'date': '2026-10-11', 'start_time': '19:00', 'end_time': '01:00'}
        ]

with open('data/events.json', 'w', encoding='utf-8') as f:
    json.dump(events, f, indent=2, ensure_ascii=False)

print("Updates applied cleanly to data/events.json.")
