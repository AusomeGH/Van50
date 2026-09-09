import sys
import os
import urllib.request
import concurrent.futures

# Add scripts directory to path to import sync_events
sys.path.insert(0, os.path.join(os.path.dirname(__file__)))
from sync_events import get_curated_seed_catalog

catalog = get_curated_seed_catalog()
print(f"Auditing {len(catalog)} events with 10 concurrent workers...\n", flush=True)

headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
}

def check_event(ev_tuple):
    i, ev = ev_tuple
    ev_id = ev['id']
    title = ev['title']
    url = ev.get('websiteUrl', '')
    provider = ev.get('provider', '')
    
    status = 'UNKNOWN'
    final_url = url
    error = None
    
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.getcode()
            final_url = resp.geturl()
    except urllib.error.HTTPError as e:
        status = e.code
        error = str(e)
    except urllib.error.URLError as e:
        status = 'URL_ERROR'
        error = str(e)
    except Exception as e:
        status = 'EXC'
        error = str(e)

    return {
        'index': i,
        'id': ev_id,
        'title': title,
        'provider': provider,
        'original_url': url,
        'status': status,
        'final_url': final_url,
        'error': error
    }

indexed_catalog = list(enumerate(catalog, 1))

with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
    results = list(executor.map(check_event, indexed_catalog))

results.sort(key=lambda r: r['index'])

for r in results:
    status_str = f"[{r['status']}]" if r['status'] == 200 else f"[FAIL {r['status']}]"
    print(f"{status_str:<12} #{r['index']:02d} {r['id']:<32} | {r['original_url']}", flush=True)
    if r['error']:
        print(f"             ERROR: {r['error']}", flush=True)
    if r['final_url'] != r['original_url']:
        print(f"             REDIRECT -> {r['final_url']}", flush=True)

ok_count = sum(1 for r in results if r['status'] == 200)
non_200 = [r for r in results if r['status'] != 200]

print("\n" + "="*80, flush=True)
print(f"TOTAL AUDITED: {len(results)} | SUCCESS (200): {ok_count} | NON-200: {len(non_200)}", flush=True)
print("="*80, flush=True)

if non_200:
    print("\nNON-200 EVENTS NEEDING REVIEW:", flush=True)
    for r in non_200:
        print(f"- {r['id']} ({r['status']}): {r['original_url']}", flush=True)
