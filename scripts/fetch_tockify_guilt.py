import urllib.request
import json
import datetime

url = "https://tockify.com/api/ngevent?calname=guiltandcompany&max=30"
headers = {"User-Agent": "Mozilla/5.0"}
req = urllib.request.Request(url, headers=headers)

try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        events = data.get('events', [])
        print(f"Total events returned from Tockify: {len(events)}")
        for i, ev in enumerate(events[:15]):
            summary = ev.get('summary', {}).get('text', 'No title')
            content = ev.get('content', {}).get('text', '')
            start = ev.get('when', {}).get('start', {})
            millis = start.get('millis', 0)
            dt = datetime.datetime.fromtimestamp(millis / 1000.0, tz=datetime.timezone.utc) if millis else 'Unknown'
            print(f"\n--- Event {i+1} ---")
            print(f"Title: {summary}")
            print(f"Time (UTC): {dt}")
            print(f"Content preview: {content[:120]}...")
except Exception as e:
    print(f"Error fetching: {e}")
