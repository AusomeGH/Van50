import urllib.request
import re

square_urls = [
    'https://square.link/u/mwz50eOL',
    'https://square.link/u/XKk7vSFa',
    'https://square.link/u/Ev4wVZae',
    'https://square.link/u/qfKgyfj5',
    'https://square.link/u/xZpU0S60',
    'https://square.link/u/tIe0lYbS'
]

for u in square_urls:
    try:
        req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req) as resp:
            final_url = resp.geturl()
            html = resp.read().decode('utf-8', errors='ignore')
            title_m = re.search(r'<title>([^<]+)</title>', html)
            title = title_m.group(1) if title_m else 'No title'
            print(f"{u} -> {final_url}\n   Title: {title}")
    except Exception as e:
        print(f"{u} -> Error: {e}")
