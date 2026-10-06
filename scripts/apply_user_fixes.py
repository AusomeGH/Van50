import json

with open('data/events.json', 'r', encoding='utf-8') as f:
    events = json.load(f)

for e in events:
    eid = e.get('event_id') or e.get('id')
    
    # 1. Sunday Service (Oct 4)
    if eid == 'van50-scout-fox-sunday-service-20261004':
        e['ticket_url'] = 'https://square.link/u/mwz50eOL'
        e['details_url'] = 'https://thesundayservice.ca'
        e['ticket_provider'] = 'Square Checkout (The Sunday Service)'
        e['curator_notes'] = 'Direct 1-click Square checkout for Sunday Service Improv Co. at The Fox Cabaret.'
        
    # 2. Sunday Service (Oct 11)
    elif eid == 'van50-the-sunday-service-fox-20261011':
        e['ticket_url'] = 'https://square.link/u/qfKgyfj5'
        e['details_url'] = 'https://thesundayservice.ca'
        e['ticket_provider'] = 'Square Checkout (The Sunday Service)'
        e['curator_notes'] = 'Direct 1-click Square checkout for Sunday Service Improv Co. at The Fox Cabaret.'
        
    # 3. Blockbuster: Horrors & Hilarity
    elif eid == 'van50-scout-improv-centre-blockbuster-20261008':
        e['ticket_url'] = 'https://purchase.theimprovcentre.ca/EventAvailability?EventId=11601'
        e['details_url'] = 'https://theimprovcentre.ca/shows/'
        e['ticket_provider'] = 'The Improv Centre Box Office'
        e['curator_notes'] = 'Direct production ticketing checkout for Blockbuster: Horrors & Hilarity (EventId 11601).'
        
    # 4. Stanley Park Pitch & Putt canonical URL
    elif eid == 'stanley-pitch-putt':
        e['ticket_url'] = 'https://vancouver.ca/parks-recreation-culture/stanley-park-pitch-and-putt.aspx'
        e['details_url'] = 'https://vancouver.ca/parks-recreation-culture/stanley-park-pitch-and-putt.aspx'

with open('data/events.json', 'w', encoding='utf-8') as f:
    json.dump(events, f, indent=2, ensure_ascii=False)

print("Events updated successfully.")
