import urllib.request
import re

url = "https://theimprovcentre.ca/shows/"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
try:
    with urllib.request.urlopen(req) as resp:
        html = resp.read().decode('utf-8', errors='ignore')
        pos = html.find("Blockbuster: Horrors")
        if pos != -1:
            snippet = html[pos:pos+2000]
            print(snippet.encode('ascii', errors='replace').decode('ascii'))
except Exception as e:
    print("Error:", e)
