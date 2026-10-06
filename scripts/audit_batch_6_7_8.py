import json
import urllib.request
import urllib.error
import ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

data = json.load(open('data/events.json', encoding='utf-8'))

print(f"Total events in catalog: {len(data)}")

required_fields = [
    'event_id', 'title', 'venue_name', 'full_address', 'neighborhood',
    'ticket_url', 'pricing_all_in_cad', 'restrictions', 'date',
    'start_time', 'end_time', 'category'
]

for idx in range(50, len(data)):
    e = data[idx]
    eid = e.get('event_id') or e.get('id')
    title = e.get('title') or e.get('event_name')
    venue = e.get('venue_name')
    addr = e.get('full_address')
    neighborhood = e.get('neighborhood')
    t_url = e.get('ticket_url')
    prices = e.get('pricing_all_in_cad', {})
    restr = e.get('restrictions')
    date = e.get('date')
    st = e.get('start_time')
    et = e.get('end_time')
    
    missing = [f for f in required_fields if e.get(f) in (None, '', {})]
    over_50 = {k: v for k, v in prices.items() if isinstance(v, (int, float)) and v > 50}
    
    # Check URL status
    status = "N/A"
    if t_url:
        try:
            req = urllib.request.Request(
                t_url,
                headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
            )
            with urllib.request.urlopen(req, timeout=4, context=ctx) as resp:
                status = resp.status
        except urllib.error.HTTPError as he:
            status = f"HTTP {he.code}"
        except Exception as ex:
            status = f"ERR: {type(ex).__name__}"
            
    print(f"[{idx+1}] {eid}")
    print(f"   Title: {title}")
    print(f"   Venue: {venue} | Addr: {addr} ({neighborhood})")
    print(f"   Date: {date} | Hours: {st} - {et} | Restrictions: {restr}")
    print(f"   Prices: {prices}")
    print(f"   Ticket URL: {t_url} -> {status}")
    if missing:
        print(f"   MISSING FIELDS: {missing}")
    if over_50:
        print(f"   PRICE EXCEEDS $50: {over_50}")
    print("-" * 60)
