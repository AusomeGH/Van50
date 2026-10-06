import urllib.request
import json
import datetime
import time

current_ms = int(time.time() * 1000)
# Start from beginning of current day
start_day_ms = current_ms - (24 * 3600 * 1000)

url = f"https://tockify.com/api/ngevent?calname=guiltandcompany&startms={start_day_ms}&max=20"
headers = {"User-Agent": "Mozilla/5.0"}
req = urllib.request.Request(url, headers=headers)

try:
    with urllib.request.urlopen(req) as resp:
        data = json.loads(resp.read().decode('utf-8'))
        events = data.get('events', [])
        print(f"Events starting from {start_day_ms}: {len(events)}")
        for i, ev in enumerate(events):
            content = ev.get('content', {})
            summary = content.get('summary', {}).get('text', 'No title')
            desc = content.get('description', {}).get('text', '')
            when = ev.get('when', {})
            start_m = when.get('start', {}).get('millis', 0)
            end_m = when.get('end', {}).get('millis', 0)
            
            # Vancouver time is UTC-7
            dt_start = datetime.datetime.fromtimestamp(start_m / 1000.0, tz=datetime.timezone(datetime.timedelta(hours=-7)))
            dt_end = datetime.datetime.fromtimestamp(end_m / 1000.0, tz=datetime.timezone(datetime.timedelta(hours=-7)))
            
            print(f"[{i+1}] {summary}")
            print(f"    Date/Time: {dt_start.strftime('%a, %b %d, %Y: %I:%M %p')} - {dt_end.strftime('%I:%M %p')}")
            print(f"    Desc preview: {desc[:100]}...")
except Exception as e:
    print(f"Error: {e}")
