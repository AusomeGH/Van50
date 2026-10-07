import urllib.request
import re
import json

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'}

url = 'https://www.eventbrite.ca/o/jokes-please-31441829869'
req = urllib.request.Request(url, headers=headers)
with urllib.request.urlopen(req, timeout=10) as resp:
    html = resp.read().decode('utf-8', errors='ignore')
    match = re.search(r'<script id=\"__NEXT_DATA__\" type=\"application/json\">(.*?)</script>', html)
    if match:
        data = json.loads(match.group(1))
        pageProps = data.get('props', {}).get('pageProps', {})
        events = pageProps.get('upcomingEvents', [])
        print("Upcoming Events Full JSON:")
        print(json.dumps(events, indent=2))
