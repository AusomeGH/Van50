import urllib.request
import json

url = "https://www.showpass.com/api/public/events/?venue__slug=little-mountain-gallery"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        results = data.get('results', [])
        print(f"Showpass results count: {len(results)}")
        for r in results[:5]:
            print(f"Title: {r.get('name')} | Date: {r.get('starts_on')} | Slug: {r.get('slug')}")
except Exception as e:
    print(f"Error: {e}")
