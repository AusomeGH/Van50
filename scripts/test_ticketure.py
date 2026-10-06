import urllib.request
import json
import re

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'}

url = "https://tickets.vanartgallery.bc.ca/api/events/f301c77c-bd64-ff9b-78dc-1ea8a59b70a2"
try:
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        data = json.load(resp)
        print("Ticketure Event API response keys:", data.keys())
        print(json.dumps(data, indent=2)[:1000])
except Exception as e:
    print("API fetch error:", e)
