import urllib.request
import re

def check_roundhouse():
    url = "https://roundhouse.ca/events/"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as resp:
            content = resp.read().decode('utf-8', errors='ignore')
            links = re.findall(r'href=["\'](https?://roundhouse\.ca/[^"\']+)["\']', content)
            diwali_links = [l for l in links if 'diwali' in l.lower() or 'mehfil' in l.lower()]
            print("Diwali links found:", diwali_links)
    except Exception as e:
        print("Roundhouse error:", e)

def check_cinematheque():
    url = "https://thecinematheque.ca/films/"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req) as resp:
            content = resp.read().decode('utf-8', errors='ignore')
            links = re.findall(r'href=["\'](https?://thecinematheque\.ca/films/[^"\']+)["\']', content)
            vampyr_links = [l for l in links if 'vampyr' in l.lower()]
            print("Vampyr links found:", vampyr_links)
    except Exception as e:
        print("Cinematheque error:", e)

if __name__ == '__main__':
    check_roundhouse()
    check_cinematheque()
