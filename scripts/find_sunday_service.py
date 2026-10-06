import urllib.request
import re
import json

url = "https://linktr.ee/Thesundayservice"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
try:
    with urllib.request.urlopen(req) as resp:
        html = resp.read().decode('utf-8', errors='ignore')
        m = re.search(r'<script id="__NEXT_DATA__" type="application/json">([^<]+)</script>', html)
        if m:
            data = json.loads(m.group(1))
            props = data.get('props', {}).get('pageProps', {})
            account = props.get('account', {})
            links = props.get('links', [])
            print("Account:", account.get('username'))
            for l in links:
                print(f"Title: {l.get('title')} -> URL: {l.get('url')}")
        else:
            print("No NEXT_DATA found, checking JSON in HTML...")
            all_urls = re.findall(r'"url":"(https?:[^"]+)"', html)
            for u in set(all_urls):
                print("Found url in json:", u.replace('\\/', '/'))
except Exception as e:
    print("Error:", e)
