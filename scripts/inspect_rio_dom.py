import urllib.request
from bs4 import BeautifulSoup
import re

url = 'https://riotheatre.ca/calendar/'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as resp:
    html = resp.read().decode('utf-8', errors='replace')

soup = BeautifulSoup(html, 'html.parser')
print("Total <a> tags:", len(soup.find_all('a')))

# Check links containing /event/ or /movie/ or ticket
event_links = []
for a in soup.find_all('a', href=True):
    href = a['href']
    if any(k in href for k in ['/event/', '/movie/', '/events/', 'event_id', 'riotheatrecda.ca']):
        event_links.append((href, a.get_text(strip=True)))

print("Event links found:", len(event_links))
for h, t in event_links[:10]:
    print(" ", h, "->", t)
