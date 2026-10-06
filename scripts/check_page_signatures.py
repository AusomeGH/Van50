import urllib.request
import re

url = "https://www.guiltandcompany.com/live-music"
headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
req = urllib.request.Request(url, headers=headers)

try:
    with urllib.request.urlopen(req) as resp:
        html = resp.read().decode('utf-8', errors='replace')
        print(f"Fetched {len(html)} bytes from {url}")
        
        # Check for tockify or other widgets
        matches = re.findall(r'(tockify[^"\'\s<>]+|data-tockify-[^=]+="[^"]+")', html, re.I)
        print("Tockify matches in HTML:")
        for m in set(matches):
            print("  -", m)
except Exception as e:
    print("Error:", e)
