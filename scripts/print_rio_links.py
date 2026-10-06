import urllib.request
from bs4 import BeautifulSoup

url = 'https://riotheatre.ca/calendar/'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as resp:
    html = resp.read().decode('utf-8', errors='replace')

soup = BeautifulSoup(html, 'html.parser')
for a in soup.find_all('a', href=True):
    print(a['href'], "|", a.get_text(strip=True)[:40])
