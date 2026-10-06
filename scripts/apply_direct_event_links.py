import json

with open('data/events.json', 'r', encoding='utf-8') as f:
    events = json.load(f)

fixes = {
    'van50-sun-yat-sen-public-park': {
        'ticket_url': 'https://vancouverchinesegarden.com/',
        'details_url': 'https://vancouverchinesegarden.com/',
        'ticket_provider': 'Free Public Drop-In'
    },
    'van50-rio-burlesque-variety-20261017': {
        'ticket_url': 'https://riotheatretickets.ca/events/45131-the-rio-theatre-burlesque-variety-show',
        'details_url': 'https://riotheatre.ca/event/the-rio-theatre-burlesque-and-variety-show-halloween-edition/',
        'ticket_provider': 'The Rio Theatre Box Office'
    },
    'van50-actors-rickshaw-20261009': {
        'ticket_url': 'https://www.eventbrite.ca/e/actors-with-sacred-skin-maa-and-dj-evilyn-13-tickets-1982051235601',
        'details_url': 'https://rickshawtheatre.com/show_listings/actors-4/',
        'ticket_provider': 'Eventbrite (The Rickshaw Theatre)'
    },
    'van50-scout-rickshaw-amy-winehouse-20261017': {
        'ticket_url': 'https://www.eventbrite.ca/e/van-jazz-26-amy-winehouse-tribute-starring-krystle-dos-santos-tickets-1992451509099',
        'details_url': 'https://rickshawtheatre.com/show_listings/amy-winehouse-tribute-starring-krystle-dos-santos/',
        'ticket_provider': 'Eventbrite (The Rickshaw Theatre)'
    },
    'van50-dr-sun-yat-sen-gongs-in-the-garden-20261018': {
        'ticket_url': 'https://www.eventbrite.ca/e/gongs-in-the-garden-a-sunday-slowdown-tickets-1999457517258',
        'details_url': 'https://vancouverchinesegarden.com/events/',
        'ticket_provider': 'Eventbrite (Theta Space / Sun Yat-Sen Garden)'
    },
    'van50-rickshaw-concrete-vehicles-20261008': {
        'ticket_url': 'https://www.eventbrite.ca/e/concrete-vehicles-with-hillsboro-waitless-and-lola-tickets-1996181552760',
        'details_url': 'https://rickshawtheatre.com/show_listings/concrete-vehicles/',
        'ticket_provider': 'Eventbrite (The Rickshaw Theatre)'
    }
}

count = 0
for e in events:
    eid = e.get('event_id') or e.get('id')
    if eid in fixes:
        for k, v in fixes[eid].items():
            e[k] = v
        count += 1

with open('data/events.json', 'w', encoding='utf-8') as f:
    json.dump(events, f, indent=2, ensure_ascii=False)

print(f"Applied fixes to {count} events in data/events.json.")
