import json
import re

def parse_eventbrite_organizer(html, calendar_url, venue_meta):
    events = []
    match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html)
    if not match:
        return events
    try:
        data = json.loads(match.group(1))
        pageProps = data.get('props', {}).get('pageProps', {})
        upcoming = pageProps.get('upcomingEvents', [])
        for ev in upcoming:
            name = (ev.get('name') or '').strip()
            url = ev.get('url')
            if not name or not url:
                continue
            
            # Format clean title
            clean_title = name
            if "jokes please" in name.lower():
                clean_title = "Stand Up Comedy: Jokes Please!"
            
            s_date = ev.get('start_date')
            s_time = ev.get('start_time', '20:00:00')[:5]
            
            # Pricing
            avail = ev.get('ticket_availability', {})
            min_price = avail.get('minimum_ticket_price', {})
            price_val = 18.37
            if min_price and min_price.get('major_value'):
                try:
                    price_val = float(min_price['major_value'])
                except:
                    price_val = 18.37
            elif avail.get('is_free'):
                price_val = 0.0

            p_venue = ev.get('primary_venue', {})
            addr_data = p_venue.get('address', {})
            
            events.append({
                "title": clean_title,
                "ticketUrl": url,
                "dateStr": f"{s_date} at {s_time}",
                "startIso": f"{s_date}T{s_time}:00",
                "scrapedBasePrice": price_val,
                "isSoldOut": avail.get('is_sold_out', False),
                "isInternal": False,
                "description": ev.get('summary') or "Weekly stand-up comedy show in Mount Pleasant featuring top local and touring comedians.",
                "detection": "eventbrite_organizer_api"
            })
    except Exception as ex:
        print("Error parsing EB organizer:", ex)
    return events

# Test on live HTML
import urllib.request
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'}
req = urllib.request.Request('https://www.eventbrite.ca/o/jokes-please-31441829869', headers=headers)
with urllib.request.urlopen(req) as resp:
    html = resp.read().decode('utf-8', errors='ignore')
    cands = parse_eventbrite_organizer(html, 'https://www.eventbrite.ca/o/jokes-please-31441829869', {})
    print(f"Extracted {len(cands)} candidates:")
    for c in cands:
        print(json.dumps(c, indent=2))
