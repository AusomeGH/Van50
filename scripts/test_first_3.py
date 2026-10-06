import urllib.request
import re
import json

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'}

def test_fetch(name, url):
    print(f"\n--- Testing {name} ---")
    print(f"URL: {url}")
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            final_url = resp.geturl()
            status = resp.status
            html = resp.read().decode('utf-8', errors='ignore')
            print(f"Status: {status} | Final URL: {final_url}")
            print(f"Length: {len(html)} bytes")
            if "Cloudflare" in html and "blocked" in html:
                print("WARNING: Cloudflare block page detected!")
            
            # Find links
            links = re.findall(r'href=[\'"]([^\'"]+)[\'"]', html)
            candidates = [l for l in set(links) if any(k in l.lower() for k in ['ticket', 'admission', 'book', 'visit', 'pricing', 'hours'])]
            print(f"Found {len(candidates)} relevant link candidates:")
            for c in sorted(candidates)[:8]:
                print(f"  -> {c}")
    except Exception as e:
        print(f"Error fetching: {e}")

# Event 1: Pendulum Gallery
test_fetch("Pendulum Gallery", "https://www.pendulumgallery.bc.ca")

# Event 2: Stanley Park
test_fetch("Stanley Park", "https://vancouver.ca/parks-recreation-culture/stanley-park.aspx")

# Event 3: Vancouver Art Gallery
test_fetch("Vancouver Art Gallery Visit", "https://www.vanartgallery.bc.ca/visit")
