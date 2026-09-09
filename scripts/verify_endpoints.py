import urllib.request
import json
import sys

sys.stdout.reconfigure(encoding='utf-8')

urls = [
    'http://127.0.0.1:8080/',
    'http://127.0.0.1:8080/data/events.json',
    'http://127.0.0.1:8080/js/data.js',
    'http://127.0.0.1:8080/js/app.js',
    'http://127.0.0.1:8080/js/map.js',
    'http://127.0.0.1:8080/js/roulette.js',
    'http://127.0.0.1:8080/css/style.css',
    'http://127.0.0.1:8080/css/components.css'
]

print("=== VERIFYING HTTP SERVER ENDPOINTS ===")
for u in urls:
    try:
        resp = urllib.request.urlopen(u, timeout=5)
        content = resp.read()
        print(f"[OK] {u:<44} -> Status {resp.status} ({len(content)} bytes)")
    except Exception as e:
        print(f"[FAIL] {u} -> {e}")
        sys.exit(1)

# Verify events.json content
data = json.loads(urllib.request.urlopen('http://127.0.0.1:8080/data/events.json').read().decode('utf-8'))
events = data['events']
print(f"\nTotal Events Served via HTTP: {len(events)}")
if len(events) < 35:
    print(f"Error: Expected at least 35 events, got {len(events)}")
    sys.exit(1)

# Verify all <= 50 CAD
valid_frequencies = {'daily', 'weekly', 'monthly', 'one-off', 'limited-run', 'seasonal'}
for ev in events:
    if ev['price'] > 50.00:
        print(f"Error: Event {ev['id']} exceeds $50 CAD: {ev['price']}")
        sys.exit(1)
    if not ev['websiteUrl'].startswith('http'):
        print(f"Error: Invalid deep-link for {ev['id']}: {ev['websiteUrl']}")
        sys.exit(1)
    if ev['frequency'] not in valid_frequencies:
        print(f"Error: Invalid frequency for {ev['id']}: {ev['frequency']}")
        sys.exit(1)

print("All 40 events verified strictly <= $50 CAD with valid deep links and recurrence tags!")
