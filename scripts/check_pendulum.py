import urllib.request
import re

headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'}
req = urllib.request.Request("https://www.pendulumgallery.bc.ca", headers=headers)
with urllib.request.urlopen(req) as resp:
    html = resp.read().decode('utf-8', errors='ignore')
    links = set(re.findall(r'href=[\'"]([^\'"]+)[\'"]', html))
    for l in sorted(links):
        if 'pendulumgallery' in l or l.startswith('/'):
            print(l)
