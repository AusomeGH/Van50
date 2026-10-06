import os
import re

for name, p in [('events.json', 'data/events.json'), ('venues.json', 'data/venues.json'), ('data.js', 'js/data.js')]:
    text = open(p, 'r', encoding='utf-8').read()
    matches = re.findall(r'https?://[^\s"\']*vancouver\.ca[^\s"\']*\.aspx', text, re.I)
    print(f"{name}: {len(matches)} .aspx matches")
    for m in matches:
        print("  -", m)
