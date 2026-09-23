"""
Comprehensive test script for 7-Dimension Screenshot OCR verification.
"""
import sys
import json
import os

sys.path.append(os.path.join(os.path.dirname(__file__), "..", "scripts"))

from screenshot_verifier import verify_screenshot_against_event

def test_on_sample_image():
    sample_path = os.path.join("data", "curator_screenshots", "sample_email_full.png")
    if not os.path.exists(sample_path):
        print("Sample image not found, skipping live image test")
        return
        
    mock_card = {
        "id": "mock-sunset-collective",
        "title": "Indie Rock Showcase: The Sunset Collective",
        "venue": "The Fox Cabaret",
        "address": "2321 Main St, Vancouver",
        "category": "music",
        "price": 18.0,
        "dateSchedule": "Friday, September 25, 2026 at 8:00 PM",
        "provider": "Eventbrite"
    }
    
    print("Testing verify_screenshot_against_event on sample_email_full.png...")
    res = verify_screenshot_against_event(sample_path, mock_card)
    print("Result success:", res.get("success"))
    print("Dimensions extracted:", list(res.get("dimensions", {}).keys()))
    for dim_key, dim_val in res.get("dimensions", {}).items():
        print(f" - [{dim_key}]: {dim_val.get('name')} | Extracted: {dim_val.get('extracted')} | Match: {dim_val.get('isMatch')}")

if __name__ == "__main__":
    test_on_sample_image()
