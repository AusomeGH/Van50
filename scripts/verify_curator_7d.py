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

    # Explicitly verify Event Name extraction & title change detection
    desc_dim = dims.get('description', {})
    extracted_title = desc_dim.get('extractedTitle')
    print(f"\n  [OK] Dimension 7 Extracted Title: '{extracted_title}'")
    assert extracted_title, "Dimension 7 failed to extract event name from screenshot!"
    assert "Sunset Collective" in extracted_title or "Indie Rock" in extracted_title, f"Extracted title mismatch: {extracted_title}"
    assert desc_dim.get('hasTitleChange') is True, f"Expected hasTitleChange=True, got {desc_dim.get('hasTitleChange')}"

    title_block = result.get('title', {})
    assert title_block.get('extractedTitle') == extracted_title, "Top-level title block mismatch!"
    assert title_block.get('hasTitleChange') is True, "Top-level title block hasTitleChange must be True!"
    print(f"  [OK] Title discrepancy properly flagged: card='{title_block.get('cardTitle')}' vs extracted='{title_block.get('extractedTitle')}'")

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
    "ai-dim-val-title",
    "ai-dim-compare-title",
    "ai-dim-badge-title",
    "btn-apply-dim-title",
    "btn-apply-dim-date",
    "btn-apply-dim-frequency",
    "btn-apply-dim-category",
    "btn-apply-dim-location",
    "btn-apply-dim-price",
    "btn-apply-dim-link",
    "btn-apply-dim-description",
    "ai-approve-title",
    "ai-approve-title-badge",
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
    ".dim-event-title-box",
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
    "ai-approve-title",
    "ai-dim-val-title",
    "dimKey === 'title'",
    "approvedTitle",
    "ai-approve-date",
    "ai-approve-venue",
    "📸 Verify Screenshot"
]

for snip in required_js_snippets:
    assert snip in js_content, f"Missing JS pattern: {snip}"
    print(f"  [OK] Verified JS logic pattern: {snip}")

# 7. Test AI Instruction approval workflow with modified Event Name
print("\n[Step 7] Testing Approval Flow with Extracted Event Name Mutation...")
test_event_id = sample_ev.get("id")
new_verified_title = f"{extracted_title} (Verified)"
instruction_payload = {
    "action": "queue_and_approve",
    "eventId": test_event_id,
    "eventTitle": sample_ev.get("title"),
    "approvedTitle": new_verified_title,
    "venueName": "Chill x Studio",
    "sourceUrl": "https://chillxstudio.com",
    "instructionText": "Updating event name based on flyer screenshot verification.",
    "approvedPrice": 10.0,
    "approvedCategory": "shows",
    "approvedDate": "Friday, September 25",
    "approvedVenue": "Chill x Studio",
    "curatorNote": "Screenshot OCR extracted actual showcase title and verified $10 door price."
}

inst_req = urllib.request.Request(
    f"{BASE_URL}/api/curator/instruction",
    data=json.dumps(instruction_payload).encode("utf-8"),
    headers={"Content-Type": "application/json", "Curator-Token": token}
)

with urllib.request.urlopen(inst_req, timeout=10) as resp:
    inst_resp = json.loads(resp.read().decode("utf-8"))
    assert inst_resp.get("success") is True, f"Instruction approval failed: {inst_resp}"
    print(f"  [OK] API instruction queued & approved: {inst_resp.get('message')}")

# Verify in events.json that title was persisted
events_json_path = os.path.join(os.path.dirname(__file__), "..", "data", "events.json")
with open(events_json_path, "r", encoding="utf-8") as f:
    events_data = json.load(f)

approved_ev = next((e for e in events_data.get("events", []) if e.get("id") == test_event_id), None)
assert approved_ev is not None, f"Approved event '{test_event_id}' not found in events.json!"
assert approved_ev.get("title") == new_verified_title, f"Event title was not updated in events.json! Expected '{new_verified_title}', got '{approved_ev.get('title')}'"
snapshot = approved_ev.get("checkoutVerification", {}).get("curatorSnapshot", {})
assert snapshot.get("approvedTitle") == new_verified_title, f"Snapshot approvedTitle mismatch: {snapshot.get('approvedTitle')}"
print(f"  [OK] Confirmed events.json updated with approved title: '{approved_ev.get('title')}'")

print("\n==================================================")
print("✓ ALL TESTS PASSED: Event Name Extraction & Change Detection 100% Operational!")
print("==================================================")

