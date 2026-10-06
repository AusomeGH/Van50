import urllib.request
import json
from bs4 import BeautifulSoup

url = 'https://riotheatre.ca/calendar/'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as resp:
    html = resp.read().decode('utf-8', errors='replace')

soup = BeautifulSoup(html, 'html.parser')
for s in soup.find_all('script', type='application/ld+json'):
    if not s.string: continue
    try:
        data = json.loads(s.string)
        if isinstance(data, dict) and '@graph' in data:
            print("Found @graph with", len(data['@graph']), "items!")
            for it in data['@graph']:
                t = it.get('@type')
                print("  item type:", t, "| name:", it.get('name') or it.get('headline'))
        else:
            print("Regular JSON-LD:", type(data), data.get('@type') if isinstance(data, dict) else None)
    except Exception as e:
        print("Error parsing JSON:", e)
