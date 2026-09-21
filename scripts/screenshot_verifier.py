#!/usr/bin/env python3
"""
Van50 Screenshot OCR & Card Alignment Verifier
Leverages native Windows Media OCR (Windows.Media.Ocr.OcrEngine) to extract text
from ticket checkout, venue calendar, and event poster screenshots, and validates
all extracted details against candidate event card metadata.
"""

import os
import sys
import re
import json
import base64
import tempfile
import subprocess
from datetime import datetime
from typing import Dict, Any, Optional, Tuple, List

PS_OCR_SCRIPT = """
param([string]$ImagePath)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName 'System.Drawing'
Add-Type -AssemblyName 'System.Runtime.WindowsRuntime'
[Windows.Media.Ocr.OcrEngine, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation.UniversalApiContract, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null

$fileTask = [Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)
$asTaskGeneric = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod } | Select-Object -First 1
$asTask = $asTaskGeneric.MakeGenericMethod([Windows.Storage.StorageFile])
$file = $asTask.Invoke($null, @($fileTask)).GetAwaiter().GetResult()

$streamTask = $file.OpenAsync([Windows.Storage.FileAccessMode]::Read)
$asTaskStream = $asTaskGeneric.MakeGenericMethod([Windows.Storage.Streams.IRandomAccessStream])
$stream = $asTaskStream.Invoke($null, @($streamTask)).GetAwaiter().GetResult()

$decoderTask = [Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)
$asTaskDecoder = $asTaskGeneric.MakeGenericMethod([Windows.Graphics.Imaging.BitmapDecoder])
$decoder = $asTaskDecoder.Invoke($null, @($decoderTask)).GetAwaiter().GetResult()

$bitmapTask = $decoder.GetSoftwareBitmapAsync()
$asTaskBitmap = $asTaskGeneric.MakeGenericMethod([Windows.Graphics.Imaging.SoftwareBitmap])
$bitmap = $asTaskBitmap.Invoke($null, @($bitmapTask)).GetAwaiter().GetResult()

$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $engine) {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new("en-US"))
}

$ocrTask = $engine.RecognizeAsync($bitmap)
$asTaskOcr = $asTaskGeneric.MakeGenericMethod([Windows.Media.Ocr.OcrResult])
$result = $asTaskOcr.Invoke($null, @($ocrTask)).GetAwaiter().GetResult()

Write-Output $result.Text
"""

_ps_script_path = None

def _get_powershell_script_file() -> str:
    global _ps_script_path
    if _ps_script_path and os.path.exists(_ps_script_path):
        return _ps_script_path
    
    script_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".cache")
    os.makedirs(script_dir, exist_ok=True)
    _ps_script_path = os.path.join(script_dir, "native_ocr.ps1")
    with open(_ps_script_path, "w", encoding="utf-8") as f:
        f.write(PS_OCR_SCRIPT)
    return _ps_script_path


def run_native_ocr(image_path: str) -> str:
    """Executes Windows Native OCR on an image file and returns extracted text."""
    if not os.path.exists(image_path):
        raise FileNotFoundError(f"Image not found at: {image_path}")
    
    ps_file = _get_powershell_script_file()
    cmd = [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-File", ps_file,
        "-ImagePath", os.path.abspath(image_path)
    ]
    
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=20)
    if proc.returncode != 0:
        err = proc.stderr.strip() or proc.stdout.strip()
        raise RuntimeError(f"OCR execution failed: {err}")
    
    return proc.stdout.strip()


def run_ocr_on_base64(base64_data: str) -> Tuple[str, str]:
    """Runs OCR on base64 image data. Saves to temp file and returns (extracted_text, temp_path)."""
    # Clean header if present (e.g. data:image/png;base64,...)
    if "," in base64_data:
        base64_data = base64_data.split(",", 1)[1]
    
    raw_bytes = base64.b64decode(base64_data)
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        tmp.write(raw_bytes)
        tmp_path = tmp.name
    
    try:
        text = run_native_ocr(tmp_path)
        return text, tmp_path
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def parse_ocr_text(text: str) -> Dict[str, Any]:
    """
    Parses OCR text with heuristics tailored to Canadian ticketing platforms & venue notices:
    - Ticketmaster, TicketWeb, Eventbrite, Showpass, Agile, etc.
    - Extracts all-in checkout totals, base price, fees, dates, venues, titles, age limits.
    """
    normalized_text = " ".join(text.split())
    lower_text = normalized_text.lower()
    
    # 1. Price extraction patterns
    # Matches patterns like CA $40.75, $40.75, $15, 40.75 CAD, etc.
    price_pattern = re.compile(r'(?:ca\s*)?\$?\s*([0-9]{1,4}(?:\.[0-9]{2})?)\s*(?:cad)?', re.IGNORECASE)
    
    # Specific checkout subtotal phrases:
    # "SUBTOTAL Including taxes ... CA $40.75", "Tickets: CA $40.75", "Total: $XX.XX", "Subtotal: $XX.XX"
    total_matches = []
    
    # Heuristic A: Look for "SUBTOTAL" or "Total" or "Tickets:" or "Amount Due"
    subtotal_re = re.compile(
        r'(?:subtotal|total|tickets:|amount\s*due|final\s*price|order\s*total)[^$0-9]{0,40}(?:ca\s*)?\$?\s*([0-9]{1,4}\.[0-9]{2})',
        re.IGNORECASE
    )
    for m in subtotal_re.finditer(normalized_text):
        try:
            val = float(m.group(1))
            if 0 < val <= 150.0:
                total_matches.append(val)
        except ValueError:
            pass

    # Heuristic B: Face Value & Service fee breakdown
    # Pattern 1: Ticketmaster column format "@ CA $30.00 CA $10.75"
    tm_col_match = re.search(r'@\s*(?:ca\s*)?\$?\s*([0-9]{1,4}\.[0-9]{2})\s+(?:ca\s*)?\$?\s*([0-9]{1,4}\.[0-9]{2})', normalized_text, re.IGNORECASE)
    base_price = None
    fee_amount = None
    if tm_col_match:
        try:
            base_price = float(tm_col_match.group(1))
            fee_amount = float(tm_col_match.group(2))
        except ValueError:
            pass

    if base_price is None:
        face_val_match = re.search(r'face\s*value[^$0-9]{0,30}(?:ca\s*)?\$?\s*([0-9]{1,4}(?:\.[0-9]{2})?)', normalized_text, re.IGNORECASE)
        if face_val_match:
            try:
                base_price = float(face_val_match.group(1))
            except ValueError:
                pass

    if fee_amount is None:
        service_fee_match = re.search(r'service\s*fee[^$0-9]{0,30}(?:ca\s*)?\$?\s*([0-9]{1,4}(?:\.[0-9]{2})?)', normalized_text, re.IGNORECASE)
        if service_fee_match:
            try:
                fee_amount = float(service_fee_match.group(1))
            except ValueError:
                pass
            
    # If base and fee found, sum is an authoritative checkout total
    computed_breakdown_total = None
    if base_price is not None and fee_amount is not None:
        computed_breakdown_total = round(base_price + fee_amount, 2)
        if computed_breakdown_total not in total_matches:
            total_matches.insert(0, computed_breakdown_total)

    # All generic dollar amounts
    all_dollar_matches = []
    for m in re.finditer(r'(?:ca\s*\$\s*|\$\s*)([0-9]{1,4}(?:\.[0-9]{2})?)', normalized_text, re.IGNORECASE):
        try:
            v = float(m.group(1))
            if 0 <= v <= 100.0:
                all_dollar_matches.append(v)
        except ValueError:
            pass

    # Determine most likely total checkout price
    detected_total_price = None
    if computed_breakdown_total is not None:
        detected_total_price = computed_breakdown_total
    elif total_matches:
        detected_total_price = total_matches[0]
    elif all_dollar_matches:
        # Check if multiple values exist, usually the largest is the all-in total
        detected_total_price = max(all_dollar_matches)

    # Build human-readable fee breakdown explanation
    fee_breakdown_str = ""
    if base_price is not None and fee_amount is not None:
        fee_breakdown_str = f"${base_price:.2f} base ticket + ${fee_amount:.2f} service fee/processing (${detected_total_price:.2f} all-in total)"
    elif detected_total_price is not None:
        fee_breakdown_str = f"${detected_total_price:.2f} CAD verified all-in checkout rate"
    elif "free" in lower_text or "all ages free" in lower_text or "$0" in normalized_text:
        detected_total_price = 0.0
        fee_breakdown_str = "Free public admission ($0.00)"

    # 2. Date & Time extraction
    # Patterns like "Sun Oct 04 7:00 PM", "Sept 25, 2026", "October 4", "19:00"
    date_match = re.search(
        r'\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:\s*,?\s*\d{4})?(?:\s+\d{1,2}:\d{2}\s*(?:am|pm)?)?',
        normalized_text,
        re.IGNORECASE
    )
    extracted_date = date_match.group(0).strip() if date_match else None
    if not extracted_date:
        short_date_match = re.search(
            r'\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?',
            normalized_text,
            re.IGNORECASE
        )
        extracted_date = short_date_match.group(0).strip() if short_date_match else None

    # 3. Age Policy
    age_policy = None
    if any(k in lower_text for k in ["19+", "19 & over", "19 and over", "no minors"]):
        age_policy = "19+"
    elif any(k in lower_text for k in ["all ages", "family friendly"]):
        age_policy = "All Ages"

    # 4. Status Checks (Sold Out, Private Rental, Festival Pause)
    is_sold_out = any(k in lower_text for k in ["sold out", "off sale", "at capacity", "no tickets available", "tickets currently unavailable"])
    is_private = any(k in lower_text for k in ["private event", "private rental", "closed for private", "private booking"])
    is_paused = any(k in lower_text for k in ["paused for", "fringe festival", "regular programming paused"])

    # 5. Detected ticketing provider
    provider = "Direct / Box Office"
    if "ticketmaster" in lower_text:
        provider = "Ticketmaster"
    elif "ticketweb" in lower_text:
        provider = "TicketWeb"
    elif "showpass" in lower_text:
        provider = "Showpass"
    elif "eventbrite" in lower_text:
        provider = "Eventbrite"
    elif "turntabletickets" in lower_text:
        provider = "Turntable Tickets"
    elif "agile" in lower_text or "agileticketing" in lower_text:
        provider = "Agile Ticketing"
    elif "paypal" in lower_text:
        provider = "PayPal"

    return {
        "raw_text": normalized_text,
        "total_price": detected_total_price,
        "base_price": base_price,
        "fee_amount": fee_amount,
        "fee_breakdown": fee_breakdown_str,
        "all_detected_prices": all_dollar_matches,
        "extracted_date": extracted_date,
        "age_policy": age_policy,
        "is_sold_out": is_sold_out,
        "is_private": is_private,
        "is_paused": is_paused,
        "provider": provider
    }


def _token_overlap(str1: str, str2: str) -> float:
    """Computes simple word-level token overlap similarity between 0.0 and 1.0."""
    t1 = set(re.findall(r'\w+', str1.lower()))
    t2 = set(re.findall(r'\w+', str2.lower()))
    if not t1 or not t2:
        return 0.0
    common = t1.intersection(t2)
    return len(common) / max(len(t1), 1)


def compare_ocr_with_card(ocr_data: Dict[str, Any], event_card: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compares extracted screenshot data with candidate event card fields.
    Returns alignment status, match booleans, and discrepancy warnings.
    """
    raw_ocr = ocr_data.get("raw_text", "").lower()
    card_title = (event_card.get("title") or "").strip()
    card_venue = (event_card.get("venue") or "").strip()
    card_artist = (event_card.get("artist") or "").strip()
    card_price = float(event_card.get("price", event_card.get("attemptedPrice", 0.0)))
    card_date = event_card.get("dateSchedule") or event_card.get("startIso") or ""
    
    # 1. Venue Alignment Check
    # Normalize venue names (remove common suffixes like 'the', 'vancouver')
    clean_card_venue = re.sub(r'\b(the|theatre|theater|pub|cabaret|gallery|club|vancouver|bc)\b', '', card_venue.lower()).strip()
    # Handle common OCR typo (e.g. "HOIlywood" -> "hollywood")
    fuzzy_raw = raw_ocr.replace("hoilywood", "hollywood").replace("theatre", "theater")
    clean_fuzzy = clean_card_venue.replace("theatre", "theater")
    
    venue_match = False
    if clean_fuzzy and clean_fuzzy in fuzzy_raw:
        venue_match = True
    elif _token_overlap(card_venue, raw_ocr) >= 0.5:
        venue_match = True

    # 2. Title & Artist Alignment Check
    title_match = False
    if card_artist and card_artist.lower() in raw_ocr:
        title_match = True
    elif card_title:
        # Check token overlap
        clean_title = re.sub(r'[:\-–—].*$', '', card_title) # strip subtitle
        if clean_title.lower() in raw_ocr or _token_overlap(clean_title, raw_ocr) >= 0.5:
            title_match = True

    # 3. Price Alignment Check
    ocr_price = ocr_data.get("total_price")
    price_match = False
    price_discrepancy = None
    
    if ocr_price is not None:
        if abs(ocr_price - card_price) < 0.05:
            price_match = True
        else:
            price_match = False
            price_discrepancy = {
                "cardPrice": card_price,
                "screenshotPrice": ocr_price,
                "difference": round(ocr_price - card_price, 2),
                "message": f"Card displays ${card_price:.2f}, but screenshot checkout total is ${ocr_price:.2f} CAD."
            }
    else:
        price_discrepancy = {
            "cardPrice": card_price,
            "screenshotPrice": None,
            "difference": 0.0,
            "message": "Could not unambiguously detect a final checkout total on this screenshot."
        }

    # 4. Date Alignment Check
    date_match = True # Default true if no date in OCR
    ocr_date = ocr_data.get("extracted_date")
    if ocr_date:
        # Check if month & day overlap
        date_tokens = set(re.findall(r'\b[a-z]{3,9}\b|\b\d{1,2}\b', ocr_date.lower()))
        card_date_tokens = set(re.findall(r'\b[a-z]{3,9}\b|\b\d{1,2}\b', card_date.lower()))
        common_date = date_tokens.intersection(card_date_tokens)
        date_match = len(common_date) >= 1

    # 5. Status Warnings
    status_warning = None
    if ocr_data.get("is_sold_out"):
        status_warning = "⚠️ Screenshot indicates this event or ticket tier is SOLD OUT."
    elif ocr_data.get("is_private"):
        status_warning = "⚠️ Screenshot indicates venue is CLOSED for a private rental/event."
    elif ocr_data.get("is_paused"):
        status_warning = "⚠️ Screenshot indicates regular programming is paused."

    # Overall alignment verdict
    is_fully_aligned = venue_match and title_match and price_match
    
    return {
        "success": True,
        "isFullyAligned": is_fully_aligned,
        "venue": {
            "cardVenue": card_venue,
            "matchedInScreenshot": venue_match
        },
        "title": {
            "cardTitle": card_title,
            "matchedInScreenshot": title_match
        },
        "price": {
            "cardPrice": card_price,
            "screenshotPrice": ocr_price,
            "isMatch": price_match,
            "discrepancy": price_discrepancy,
            "feeBreakdown": ocr_data.get("fee_breakdown")
        },
        "date": {
            "cardDate": card_date,
            "screenshotDate": ocr_date,
            "isMatch": date_match
        },
        "agePolicy": ocr_data.get("age_policy"),
        "statusWarning": status_warning,
        "provider": ocr_data.get("provider")
    }


def verify_screenshot_against_event(image_path_or_base64: str, event_card: Dict[str, Any]) -> Dict[str, Any]:
    """
    High-level entrypoint:
    Runs OCR on image (path or base64), parses details, and validates against event card.
    """
    temp_path = None
    try:
        if len(image_path_or_base64) > 500 or image_path_or_base64.startswith("data:") or ";base64," in image_path_or_base64:
            text, temp_path = run_ocr_on_base64(image_path_or_base64)
        else:
            text = run_native_ocr(image_path_or_base64)
            
        parsed = parse_ocr_text(text)
        comparison = compare_ocr_with_card(parsed, event_card)
        comparison["extracted"] = parsed
        comparison["aligned"] = comparison.get("isFullyAligned", False)
        comparison["alignment"] = {
            "venueMatch": comparison.get("venue", {}).get("matchedInScreenshot", False),
            "titleMatch": comparison.get("title", {}).get("matchedInScreenshot", False),
            "dateMatch": comparison.get("date", {}).get("isMatch", False),
            "priceMatch": comparison.get("price", {}).get("isMatch", False),
        }
        comparison["ocrSummary"] = {
            "detectedVenue": event_card.get("venue") if comparison["alignment"]["venueMatch"] else None,
            "detectedTitle": event_card.get("title") if comparison["alignment"]["titleMatch"] else None,
            "detectedDate": parsed.get("extracted_date"),
            "agePolicy": parsed.get("age_policy") or "Standard / All Ages",
            "soldOut": parsed.get("is_sold_out", False),
            "privateEvent": parsed.get("is_private", False),
            "rawPriceMatches": parsed.get("detected_dollar_values", [])
        }
        comparison["warnings"] = []
        if comparison.get("statusWarning"):
            comparison["warnings"].append(comparison["statusWarning"])
        disc = comparison.get("price", {}).get("discrepancy")
        if disc and isinstance(disc, dict) and disc.get("message"):
            comparison["warnings"].append(disc["message"])
        return comparison
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass


if __name__ == "__main__":
    if len(sys.argv) > 1:
        test_img = sys.argv[1]
        print(f"Testing OCR on: {test_img}")
        res_text = run_native_ocr(test_img)
        print("=== EXTRACTED TEXT ===")
        print(res_text)
        print("\n=== PARSED METRICS ===")
        parsed = parse_ocr_text(res_text)
        print(json.dumps(parsed, indent=2))
        
        # Test mock card comparison if card json provided
        if len(sys.argv) > 2:
            with open(sys.argv[2], "r", encoding="utf-8") as f:
                card = json.load(f)
            comp = compare_ocr_with_card(parsed, card)
            print("\n=== CARD COMPARISON ===")
            print(json.dumps(comp, indent=2))
    else:
        print("Usage: python screenshot_verifier.py <path_to_screenshot.png> [optional_card.json]")
