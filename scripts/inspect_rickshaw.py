import urllib.request
import re
import sys

if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')

urls = [
    ('ACTORS', 'https://rickshawtheatre.com/show_listings/actors/'),
    ('Amy Winehouse', 'https://rickshawtheatre.com/show_listings/amy-winehouse-tribute/'),
    ('Concrete Vehicles', 'https://rickshawtheatre.com/show_listings/concrete-vehicles/'),
    ('Rio Burlesque', 'https://riotheatre.ca/event/the-rio-theatre-burlesque-and-variety-show-halloween-edition/'),
    ('Gongs in the Garden', 'https://vancouverchinesegarden.com/events/')
]

for name, url in urls:
    print(f"\n=== {name} ===")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
            links = re.findall(r'href=[\'"]([^\'"\s<>]+)[\'"]', html)
            for l in set(links):
                low = l.lower()
                if any(k in low for k in ['eventbrite.ca/e/', 'eventbrite.com/e/', 'riotheatretickets.ca', 'tickets.', 'showpass.com']):
                    print("  -> Direct Ticket Link:", l)
    except Exception as e:
        print("  Error:", e)
