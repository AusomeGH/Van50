import urllib.request
import re
import sys

if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')

def find_eb(url):
    print(f"\n--- Checking {url} ---")
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            html = resp.read().decode('utf-8', errors='ignore')
            # Look for Eventbrite event links (must have /e/)
            matches = set(re.findall(r'https?://[a-zA-Z0-9.-]*eventbrite\.[a-z.]+/e/[a-zA-Z0-9-]+tickets-[0-9]+', html))
            for m in matches:
                print("  -> Found Eventbrite Event:", m)
            if not matches:
                # print any href containing eventbrite
                any_eb = set(re.findall(r'href=[\'"]([^\'"]*eventbrite[^\'"]*)[\'"]', html))
                print("  All EB links:", any_eb)
    except Exception as e:
        print("  Error:", e)

find_eb('https://rickshawtheatre.com/show_listings/actors/')
find_eb('https://rickshawtheatre.com/show_listings/concrete-vehicles/')
find_eb('https://concrete-vehicles-and-hillsboro.eventbrite.ca')
find_eb('https://krystle-dos-santos-amy-winehouse.eventbrite.ca')
