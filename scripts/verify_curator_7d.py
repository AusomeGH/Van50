import urllib.request
import json
import base64
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
sys.stdout.reconfigure(encoding='utf-8')

TOKEN = "Professor-Urban-Freebase9"
BASE_URL = "http://127.0.0.1:8080"

print("==================================================")
print("VERIFYING 7 LIVE DIMENSIONS IN CURATOR MODE")
print("==================================================")

# 1. Verify Curator Authentication
print("\n[Step 1] Authenticating with Curator Studio...")
auth_req = urllib.request.Request(
    f"{BASE_URL}/api/curator/auth",
    data=json.dumps({"password": TOKEN}).encode("utf-8"),
    headers={"Content-Type": "application/json"}
)
with urllib.request.urlopen(auth_req, timeout=5) as resp:
    auth_data = json.loads(resp.read().decode("utf-8"))
    assert auth_data.get("success") is True, f"Authentication failed: {auth_data}"
    token = auth_data.get("token")
    print(f"  [OK] Authenticated successfully! Token received.")

# 2. Check Queue
print("\n[Step 2] Fetching Quarantine Queue...")
q_req = urllib.request.Request(
    f"{BASE_URL}/api/curator/queue",
    headers={"Curator-Token": token}
)
with urllib.request.urlopen(q_req, timeout=5) as resp:
    q_data = json.loads(resp.read().decode("utf-8"))
    events = q_data.get("quarantinedEvents", [])
    print(f"  [OK] Found {len(events)} events in review queue.")
    assert len(events) >= 1, "Review queue is empty!"
    sample_ev = events[0]
    print(f"  [OK] Target event: '{sample_ev.get('title')}' at '{sample_ev.get('venue')}'")

# 3. Test Verify Screenshot Endpoint for all 7 dimensions
print("\n[Step 3] Testing /api/curator/verify-screenshot with base64 image...")
sample_img_path = os.path.join(os.path.dirname(__file__), "..", "data", "curator_screenshots", "sample_email_full.png")
assert os.path.exists(sample_img_path), f"Sample image not found: {sample_img_path}"

with open(sample_img_path, "rb") as f:
    b64_img = "data:image/png;base64," + base64.b64encode(f.read()).decode("utf-8")

verify_req = urllib.request.Request(
    f"{BASE_URL}/api/curator/verify-screenshot",
    data=json.dumps({
        "eventId": sample_ev.get("id"),
        "screenshotBase64": b64_img
    }).encode("utf-8"),
    headers={"Content-Type": "application/json", "Curator-Token": token}
)

with urllib.request.urlopen(verify_req, timeout=15) as resp:
    result = json.loads(resp.read().decode("utf-8"))
    assert result.get("success") is True, f"Verification failed: {result}"
    dims = result.get("dimensions", {})
    
    print("  [OK] API successfully returned structured dimensions!")
    expected_keys = ['date', 'frequency', 'category', 'location', 'price', 'link', 'description']
    for k in expected_keys:
        assert k in dims, f"Missing dimension key: {k}"
        d = dims[k]
        print(f"    - [{d.get('icon', '🔹')}] {d.get('name')}:")
        print(f"        Extracted:    {d.get('extracted')}")
        print(f"        Display:      {d.get('displayValue')}")
        print(f"        Card Value:   {d.get('cardValue')}")
        print(f"        Match Status: {d.get('status')} (isMatch={d.get('isMatch')})")
        print(f"        Can Apply:    {d.get('canApply')}")

# 4. Check HTML DOM structure for the 7 Dimension Grid and Controls
print("\n[Step 4] Validating curator.html DOM Elements...")
curator_html_path = os.path.join(os.path.dirname(__file__), "..", "curator.html")
with open(curator_html_path, "r", encoding="utf-8") as f:
    html_content = f.read()

required_html_ids = [
    "ai-screenshot-alignment-panel",
    "ai-ocr-dimensions-grid",
    "btn-apply-all-dimensions",
    "ai-dim-card-date",
    "ai-dim-card-frequency",
    "ai-dim-card-category",
    "ai-dim-card-location",
    "ai-dim-card-price",
    "ai-dim-card-link",
    "ai-dim-card-description",
    "btn-apply-dim-date",
    "btn-apply-dim-frequency",
    "btn-apply-dim-category",
    "btn-apply-dim-location",
    "btn-apply-dim-price",
    "btn-apply-dim-link",
    "btn-apply-dim-description",
    "ai-approve-price",
    "ai-approve-category",
    "ai-approve-date",
    "ai-approve-venue",
    "ai-approve-note"
]

for hid in required_html_ids:
    assert f'id="{hid}"' in html_content, f"Missing HTML element id: {hid}"
    print(f"  [OK] Verified DOM element: #{hid}")

# 5. Check CSS rules in curator.css
print("\n[Step 5] Validating css/curator.css Rules...")
curator_css_path = os.path.join(os.path.dirname(__file__), "..", "css", "curator.css")
with open(curator_css_path, "r", encoding="utf-8") as f:
    css_content = f.read()

required_css_classes = [
    ".curator-dimensions-grid",
    ".curator-dimension-card",
    ".dim-status-confirmed",
    ".dim-status-discrepancy",
    ".dim-status-notice",
    ".dim-pill",
    ".dim-val-prominent",
    ".btn-dim-apply"
]

for ccls in required_css_classes:
    assert ccls in css_content, f"Missing CSS class: {ccls}"
    print(f"  [OK] Verified CSS class: {ccls}")

# 6. Check js/curator.js functions
print("\n[Step 6] Validating js/curator.js Logic...")
curator_js_path = os.path.join(os.path.dirname(__file__), "..", "js", "curator.js")
with open(curator_js_path, "r", encoding="utf-8") as f:
    js_content = f.read()

required_js_snippets = [
    "LIVE_DIMENSION_KEYS",
    "applyAllExtractedDimensions",
    "applySingleDimension",
    "triggerScreenshotVerification",
    "btn-apply-all-dimensions",
    "ai-ocr-dimensions-grid",
    "ai-approve-date",
    "ai-approve-venue",
    "📸 Verify Screenshot"
]

for snip in required_js_snippets:
    assert snip in js_content, f"Missing JS pattern: {snip}"
    print(f"  [OK] Verified JS logic pattern: {snip}")

print("\n==================================================")
print("✓ ALL TESTS PASSED: 7 Live Dimensions Extraction Fully Operational!")
print("==================================================")
