import urllib.request
import json
import datetime
import time

current_ms = int(time.time() * 1000)
# Start from 24 hours ago
start_day_ms = current_ms - (24 * 3600 * 1000)

url = f"https://tockify.com/api/ngevent?calname=guiltandcompany&startms={start_day_ms}&max=30"
headers = {"User-Agent": "Mozilla/5.0"}
req = urllib.request.Request(url, headers=headers)

with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read().decode('utf-8'))
    events = data.get('events', [])

print(f"Total Tockify events: {len(events)}\n")
for i, ev in enumerate(events):
    content = ev.get('content', {})
    summary = content.get('summary', {}).get('text', 'No title')
    desc = content.get('description', {}).get('text', '')
    tags = content.get('tagset', {}).get('tags', {}).get('default', [])
    when = ev.get('when', {})
    start_m = when.get('start', {}).get('millis', 0)
    end_m = when.get('end', {}).get('millis', 0)
    
    # Vancouver is UTC-7 in October (PDT)
    dt_start = datetime.datetime.fromtimestamp(start_m / 1000.0, tz=datetime.timezone(datetime.timedelta(hours=-7)))
    dt_end = datetime.datetime.fromtimestamp(end_m / 1000.0, tz=datetime.timezone(datetime.timedelta(hours=-7)))
    
    date_str = dt_start.strftime('%Y-%m-%d')
    day_name = dt_start.strftime('%A')
    time_str = f"{dt_start.strftime('%I:%M %p').lstrip('0')} – {dt_end.strftime('%I:%M %p').lstrip('0')}"
    
    img = ''
    if content.get('imageSets'):
        img_id = content['imageSets'][0].get('id')
        if img_id:
            img = f"https://tockify.com/api/image/full/{img_id}"

    print(f"Event #{i+1}:")
    print(f"  Artist/Title: {summary}")
    print(f"  Date: {date_str} ({day_name})")
    print(f"  Time: {time_str}")
    print(f"  Tags: {tags}")
    print(f"  Image: {img}")
    print(f"  Description: {desc[:140]}...")
    print("-" * 60)
