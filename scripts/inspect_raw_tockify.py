import urllib.request
import json

url = "https://tockify.com/api/ngevent?calname=guiltandcompany&max=5"
headers = {"User-Agent": "Mozilla/5.0"}
req = urllib.request.Request(url, headers=headers)

with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    events = data.get('events', [])
    if events:
        print("Keys of first event:", list(events[0].keys()))
        print(json.dumps(events[0], indent=2))
