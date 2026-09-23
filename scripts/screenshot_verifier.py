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
    Extracts all 7 live dimensions:
    1. Date & Time (Schedule)
    2. Frequency (One-off, weekly, daily, multi-day)
    3. Category (Shows, Music, Cinema, Arts, Outdoors, Activities, Social, Trivia)
    4. Location / Venue & Street Address / Neighborhood
    5. Price (<= $50 CAD ceiling, base price, fees, GST, tiers)
    6. Link & Ticketing Provider
    7. Description, Lineup, Age Policy & Restrictions
    """
    normalized_text = " ".join(text.split())
    lower_text = normalized_text.lower()
    
    # ----------------------------------------------------
    # 1. PRICE & CHECKOUT BREAKDOWN (Dimension 5)
    # ----------------------------------------------------
    total_matches = []
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
            
    computed_breakdown_total = None
    if base_price is not None and fee_amount is not None:
        computed_breakdown_total = round(base_price + fee_amount, 2)
        if computed_breakdown_total not in total_matches:
            total_matches.insert(0, computed_breakdown_total)

    # Detect advance vs door tiers
    detected_tiers = []
    m_adv = re.search(r'(?:advance|adv|online)[^$0-9]{0,20}(?:ca\s*)?\$?\s*([0-9]{1,3}(?:\.[0-9]{2})?)', lower_text)
    if m_adv:
        try:
            detected_tiers.append({"name": "Advance / Online", "price": float(m_adv.group(1))})
        except ValueError:
            pass
            
    m_door = re.search(r'(?:door|at door|walk-up)[^$0-9]{0,20}(?:ca\s*)?\$?\s*([0-9]{1,3}(?:\.[0-9]{2})?)', lower_text)
    if m_door:
        try:
            detected_tiers.append({"name": "Door", "price": float(m_door.group(1))})
        except ValueError:
            pass

    # Generic dollar amounts
    all_dollar_matches = []
    for m in re.finditer(r'(?:ca\s*\$\s*|\$\s*|s\s*)([0-9]{1,4}(?:\.[0-9]{2})?)', normalized_text, re.IGNORECASE):
        try:
            v = float(m.group(1))
            if 0 <= v <= 150.0:
                all_dollar_matches.append(v)
        except ValueError:
            pass

    # Spaced OCR dollars like "S 1 8 00" -> 18.00
    m_spaced = re.search(r'(?:s|\$)\s*([0-9])\s*([0-9])\s*([0-9]{2})', lower_text)
    if m_spaced:
        try:
            spaced_val = float(f"{m_spaced.group(1)}{m_spaced.group(2)}.{m_spaced.group(3)}")
            if spaced_val not in all_dollar_matches:
                all_dollar_matches.append(spaced_val)
        except ValueError:
            pass

    detected_total_price = None
    if computed_breakdown_total is not None:
        detected_total_price = computed_breakdown_total
    elif detected_tiers:
        detected_total_price = detected_tiers[0]["price"] # Prefer advance tier
    elif total_matches:
        detected_total_price = total_matches[0]
    elif any(k in lower_text for k in ["free", "free admission", "free rsvp", "no cover", "pwyc", "pay what you can", "$0"]):
        detected_total_price = 0.0
    elif all_dollar_matches:
        detected_total_price = max(all_dollar_matches)

    fee_breakdown_str = ""
    if base_price is not None and fee_amount is not None:
        fee_breakdown_str = f"${base_price:.2f} base ticket + ${fee_amount:.2f} service fee/processing (${detected_total_price:.2f} all-in total)"
    elif detected_total_price == 0.0:
        fee_breakdown_str = "Free public admission ($0.00)"
    elif detected_tiers and len(detected_tiers) > 1:
        fee_breakdown_str = f"${detected_total_price:.2f} CAD advance tier (${detected_tiers[1]['price']:.2f} door)"
    elif detected_total_price is not None:
        fee_breakdown_str = f"${detected_total_price:.2f} CAD verified all-in checkout rate"

    # ----------------------------------------------------
    # 2. DATE & TIME (SCHEDULE) (Dimension 1)
    # ----------------------------------------------------
    date_match = re.search(
        r'\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*,?\s*'
        r'(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}'
        r'(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?'
        r'(?:\s+(?:at|from|@)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?'
        r'(?:\s*(?:-|–|to)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?',
        normalized_text,
        re.IGNORECASE
    )
    extracted_date = date_match.group(0).strip() if date_match else None
    if not extracted_date:
        short_date_match = re.search(
            r'\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}'
            r'(?:st|nd|rd|th)?(?:\s*,?\s*\d{4})?'
            r'(?:\s+(?:at|from|@)?\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?',
            normalized_text,
            re.IGNORECASE
        )
        extracted_date = short_date_match.group(0).strip() if short_date_match else None

    m_doors = re.search(r'doors(?:\s*open)?(?:\s*at)?\s*:?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)', normalized_text, re.IGNORECASE)
    doors_time = m_doors.group(1).strip() if m_doors else None

    m_show = re.search(r'(?:show|showtime|starts?)(?:\s*at)?\s*:?\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)', normalized_text, re.IGNORECASE)
    show_time = m_show.group(1).strip() if m_show else None

    # ----------------------------------------------------
    # 3. FREQUENCY (Dimension 2)
    # ----------------------------------------------------
    detected_freq = "one-off"
    freq_label = "One-off Event / Screening"
    days_found = []
    days_map = {
        'monday': 'mon', 'tuesday': 'tue', 'wednesday': 'wed', 'thursday': 'thu', 
        'friday': 'fri', 'saturday': 'sat', 'sunday': 'sun'
    }
    for day_full, day_abbr in days_map.items():
        if re.search(rf'\b(?:every\s+{day_full}|{day_full}s|every\s+{day_abbr}|{day_abbr}s)\b', lower_text):
            days_found.append(day_abbr)
            
    if any(k in lower_text for k in ["daily", "7 days/week", "open daily", "every day", "nightly", "daylight hours"]):
        detected_freq = "daily"
        freq_label = "Daily Drop-In / Outing"
    elif days_found:
        detected_freq = "weekly"
        freq_label = f"Weekly ({', '.join([d.title() for d in days_found])})"
    elif any(k in lower_text for k in ["multi-day", "2-day", "weekend run", "festival pass", "oct 9 & 10", "sept 30 & oct 8"]):
        detected_freq = "multi-day"
        freq_label = "Multi-Day Series / Festival"

    # ----------------------------------------------------
    # 4. CATEGORY (Dimension 3)
    # ----------------------------------------------------
    cat_scores = {
        'shows': 0, 'music': 0, 'cinema': 0, 'arts': 0, 
        'outdoors': 0, 'activities': 0, 'trivia': 0, 'social': 0, 'festivals': 0
    }
    keywords_map = {
        'shows': ['comedy', 'stand-up', 'standup', 'comedian', 'comedians', 'improv', 'theatre', 'theater', 'sketch', 'play', 'drama', 'showcase'],
        'music': ['indie rock', 'live music', 'concert', 'band', 'bands', 'jazz', 'orchestra', 'symphony', 'choir', 'dj set', 'techno', 'house music', 'post-punk', 'singer', 'vocalist', 'guitar', 'electronic'],
        'cinema': ['film', 'movie', 'cinema', 'screening', '35mm', 'matinee', 'viff', 'cinematheque', 'premiere', 'documentary'],
        'arts': ['exhibition', 'gallery', 'paintings', 'sculptures', 'printmaking', 'ceramic', 'ceramics', 'pottery', 'museum', 'visual arts', 'artist'],
        'outdoors': ['park', 'garden', 'courtyard', 'seawall', 'nature', 'walking tour', 'beach', 'pitch and putt', 'trail', 'hike'],
        'activities': ['board games', 'chess', 'tabletop', 'puzzle', 'workshop', 'clay', 'arcade', 'bowling'],
        'trivia': ['trivia', 'brainstormer', 'pub quiz', 'quiz night'],
        'social': ['mixer', 'dance party', 'warehouse party', 'nightlife', 'party', 'social gathering'],
        'festivals': ['festival', 'fringe', 'block party', 'fest', 'carnival']
    }
    matched_kws = []
    for cat, kws in keywords_map.items():
        for kw in kws:
            if kw in lower_text:
                cat_scores[cat] += 2
                matched_kws.append(kw)
                
    best_cat = max(cat_scores, key=cat_scores.get)
    if cat_scores[best_cat] == 0:
        best_cat = 'shows'
        
    cat_meta = {
        'shows': ('🎭', 'Comedy & Shows'),
        'music': ('🎵', 'Live Music'),
        'cinema': ('🎬', 'Indie Cinema'),
        'arts': ('🏛️', 'Museums & Visual Arts'),
        'outdoors': ('🌊', 'Walks & Outdoors'),
        'activities': ('🎲', 'Games & Activities'),
        'trivia': ('🧠', 'Drinks & Trivia'),
        'social': ('🪩', 'Social & Nightlife'),
        'festivals': ('🎪', 'Festivals')
    }
    cat_icon, cat_label = cat_meta.get(best_cat, ('🏷️', 'Event'))

    # ----------------------------------------------------
    # 5. LOCATION / VENUE & ADDRESS (Dimension 4)
    # ----------------------------------------------------
    m_venue = re.search(r'venue\s*:?\s*([^(\n,]+(?:\([^)]+\))?)', normalized_text, re.IGNORECASE)
    detected_venue = m_venue.group(1).strip() if m_venue else None
    if detected_venue and '(' in detected_venue:
        # Strip trailing parenthesized address from venue name
        detected_venue = re.sub(r'\s*\([^)]*\)', '', detected_venue).strip()

    m_addr = re.search(r'\b\d{2,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Way|Dr|Drive|Pl|Place)\b', normalized_text)
    detected_addr = m_addr.group(0).strip() if m_addr else None
    
    neighborhoods = [
        "Downtown", "Gastown", "Yaletown", "West End", "Chinatown",
        "Mount Pleasant", "Commercial Drive", "Kitsilano", "Granville Island",
        "East Vancouver", "East Van", "North Shore", "Burnaby", "UBC"
    ]
    detected_hood = None
    for hood in neighborhoods:
        if hood.lower() in lower_text:
            detected_hood = hood
            break

    # ----------------------------------------------------
    # 6. LINK & TICKETING PROVIDER (Dimension 6)
    # ----------------------------------------------------
    provider = "Direct / Box Office"
    providers = [
        ("Eventbrite", ["eventbrite"]),
        ("Showpass", ["showpass"]),
        ("TicketWeb", ["ticketweb"]),
        ("AdmitOne", ["admitone"]),
        ("Ticketmaster", ["ticketmaster"]),
        ("Dice", ["dice.fm", "dice"]),
        ("Shotgun", ["shotgun.live", "shotgun"]),
        ("VTix", ["vtixonline", "vtix"]),
        ("Ticket Tailor", ["tickettailor"]),
        ("Zeffy", ["zeffy"]),
        ("OpenTable", ["opentable"]),
        ("PayPal", ["paypal"])
    ]
    for p_name, p_keys in providers:
        if any(k in lower_text for k in p_keys):
            provider = p_name
            break

    m_urls = re.findall(r'https?://[^\s)]+', normalized_text)

    # ----------------------------------------------------
    # 7. DESCRIPTION, LINEUP & AGE POLICY (Dimension 7)
    # ----------------------------------------------------
    m_title = re.search(r'(?:^\d+\.\s*|showcase:\s*|\bfeaturing\s*:?\s*)([A-Z][^\n:]{5,60})', normalized_text)
    detected_title = m_title.group(1).strip() if m_title else None

    m_lineup = re.search(r'(?:featuring|lineup|alongside|with guest|hosted by)\s*:?\s*([^.\n;]+)', normalized_text, re.IGNORECASE)
    detected_lineup = m_lineup.group(1).strip() if m_lineup else None

    age_policy = "All Ages"
    if any(k in lower_text for k in ["19+", "19 & over", "19 and over", "no minors"]):
        age_policy = "19+"
    elif any(k in lower_text for k in ["all ages", "family friendly"]):
        age_policy = "All Ages"

    is_sold_out = any(k in lower_text for k in ["sold out", "off sale", "at capacity", "no tickets available", "tickets currently unavailable"])
    is_private = any(k in lower_text for k in ["private event", "private rental", "closed for private", "private booking"])
    is_paused = any(k in lower_text for k in ["paused for", "fringe festival", "regular programming paused"])

    snippet = normalized_text[:160] + "..." if len(normalized_text) > 160 else normalized_text

    return {
        "raw_text": normalized_text,
        "total_price": detected_total_price,
        "base_price": base_price,
        "fee_amount": fee_amount,
        "fee_breakdown": fee_breakdown_str,
        "all_detected_prices": all_dollar_matches,
        "tiers": detected_tiers,
        "is_under_50": (detected_total_price is not None and detected_total_price <= 50.0),
        
        "extracted_date": extracted_date,
        "doors_time": doors_time,
        "show_time": show_time,
        
        "detected_frequency": detected_freq,
        "frequency_label": freq_label,
        
        "category": best_cat,
        "category_icon": cat_icon,
        "category_label": cat_label,
        "category_keywords": matched_kws[:4],
        
        "detected_venue": detected_venue,
        "detected_address": detected_addr,
        "detected_neighborhood": detected_hood,
        
        "provider": provider,
        "detected_urls": m_urls[:3],
        
        "detected_title": detected_title,
        "detected_lineup": detected_lineup,
        "age_policy": age_policy,
        "is_sold_out": is_sold_out,
        "is_private": is_private,
        "is_paused": is_paused,
        "snippet": snippet
    }


def _token_overlap(str1: str, str2: str) -> float:
    """Computes simple word-level token overlap similarity between 0.0 and 1.0."""
    t1 = set(re.findall(r'\w+', (str1 or '').lower()))
    t2 = set(re.findall(r'\w+', (str2 or '').lower()))
    if not t1 or not t2:
        return 0.0
    common = t1.intersection(t2)
    return len(common) / max(len(t1), 1)


def compare_ocr_with_card(ocr_data: Dict[str, Any], event_card: Dict[str, Any]) -> Dict[str, Any]:
    """
    Compares extracted screenshot data with candidate event card fields across all 7 dimensions.
    Returns alignment status, match booleans, detailed 7-dimension payload, and discrepancy warnings.
    """
    raw_ocr = ocr_data.get("raw_text", "").lower()
    event_card = event_card or {}
    card_title = (event_card.get("title") or "").strip()
    card_venue = (event_card.get("venue") or "").strip()
    card_artist = (event_card.get("artist") or "").strip()
    card_price = float(event_card.get("price", event_card.get("attemptedPrice", 0.0)))
    card_date = event_card.get("dateSchedule") or event_card.get("startIso") or ""
    card_category = event_card.get("category") or "shows"
    card_freq = event_card.get("frequency") or "one-off"
    card_provider = event_card.get("provider") or event_card.get("ticketProvider") or "Direct"
    
    # 1. Venue Alignment Check
    clean_card_venue = re.sub(r'\b(the|theatre|theater|pub|cabaret|gallery|club|vancouver|bc)\b', '', card_venue.lower()).strip()
    fuzzy_raw = raw_ocr.replace("hoilywood", "hollywood").replace("theatre", "theater")
    clean_fuzzy = clean_card_venue.replace("theatre", "theater")
    
    venue_match = False
    detected_v = ocr_data.get("detected_venue") or ""
    if clean_fuzzy and clean_fuzzy in fuzzy_raw:
        venue_match = True
    elif detected_v and (detected_v.lower() in card_venue.lower() or card_venue.lower() in detected_v.lower()):
        venue_match = True
    elif _token_overlap(card_venue, raw_ocr) >= 0.5:
        venue_match = True

    # 2. Title & Artist Alignment Check
    title_match = False
    detected_t = ocr_data.get("detected_title") or ""
    if card_artist and card_artist.lower() in raw_ocr:
        title_match = True
    elif card_title:
        clean_title = re.sub(r'[:\-–—].*$', '', card_title).strip()
        if clean_title.lower() in raw_ocr or _token_overlap(clean_title, raw_ocr) >= 0.4:
            title_match = True
        elif detected_t and _token_overlap(detected_t, card_title) >= 0.4:
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
    date_match = True
    ocr_date = ocr_data.get("extracted_date")
    if ocr_date and card_date:
        date_tokens = set(re.findall(r'\b[a-z]{3,9}\b|\b\d{1,2}\b', ocr_date.lower()))
        card_date_tokens = set(re.findall(r'\b[a-z]{3,9}\b|\b\d{1,2}\b', card_date.lower()))
        common_date = date_tokens.intersection(card_date_tokens)
        date_match = len(common_date) >= 1
    elif ocr_date and not card_date:
        date_match = False

    # 5. Category Alignment
    ocr_cat = ocr_data.get("category") or "shows"
    category_match = (ocr_cat.lower() == card_category.lower())

    # 6. Frequency Alignment
    ocr_freq = ocr_data.get("detected_frequency") or "one-off"
    frequency_match = (ocr_freq.lower() == card_freq.lower())

    # 7. Provider Alignment
    ocr_provider = ocr_data.get("provider") or "Direct"
    provider_match = (ocr_provider.lower() in card_provider.lower() or card_provider.lower() in ocr_provider.lower())

    # Status Warnings
    status_warning = None
    if ocr_data.get("is_sold_out"):
        status_warning = "⚠️ Screenshot indicates this event or ticket tier is SOLD OUT."
    elif ocr_data.get("is_private"):
        status_warning = "⚠️ Screenshot indicates venue is CLOSED for a private rental/event."
    elif ocr_data.get("is_paused"):
        status_warning = "⚠️ Screenshot indicates regular programming is paused."

    # Assemble Structured 7-Dimension Dictionary
    # Dimension 1: Date & Time (Schedule)
    date_display_parts = []
    if ocr_date:
        date_display_parts.append(ocr_date)
    if ocr_data.get("doors_time"):
        date_display_parts.append(f"Doors: {ocr_data.get('doors_time')}")
    if ocr_data.get("show_time"):
        date_display_parts.append(f"Show: {ocr_data.get('show_time')}")
    date_display = " • ".join(date_display_parts) if date_display_parts else "No date detected on screenshot"

    # Dimension 2: Frequency
    freq_display = ocr_data.get("frequency_label", "One-off Show")

    # Dimension 3: Category
    cat_keywords = ocr_data.get("category_keywords", [])
    cat_kw_str = f" ({', '.join(cat_keywords[:3])})" if cat_keywords else ""
    cat_display = f"{ocr_data.get('category_icon', '🏷️')} {ocr_data.get('category_label', 'Event')}{cat_kw_str}"

    # Dimension 4: Venue & Location
    loc_components = [c for c in [ocr_data.get("detected_venue"), ocr_data.get("detected_address"), ocr_data.get("detected_neighborhood")] if c]
    location_display = " • ".join(loc_components) if loc_components else (card_venue or "Venue unverified")

    # Dimension 5: Price & Fees
    if ocr_data.get("fee_breakdown"):
        price_display = ocr_data.get("fee_breakdown")
    elif ocr_price is not None:
        price_display = f"${ocr_price:.2f} CAD" if ocr_price > 0 else "Free ($0.00 CAD)"
    else:
        price_display = "No checkout total detected"

    # Dimension 6: Link & Provider
    detected_urls = ocr_data.get("detected_urls", [])
    link_display = f"{ocr_provider}" + (f" ({detected_urls[0]})" if detected_urls else "")

    # Dimension 7: Description, Lineup & Restrictions
    desc_elements = []
    if ocr_data.get("detected_title"):
        desc_elements.append(f"Title: {ocr_data.get('detected_title')}")
    if ocr_data.get("detected_lineup"):
        desc_elements.append(f"Lineup: {ocr_data.get('detected_lineup')}")
    if ocr_data.get("age_policy"):
        desc_elements.append(f"Policy: {ocr_data.get('age_policy')}")
    if ocr_data.get("is_sold_out"):
        desc_elements.append("🚨 SOLD OUT")
    elif ocr_data.get("is_private"):
        desc_elements.append("🚨 PRIVATE EVENT")
    desc_display = " • ".join(desc_elements) if desc_elements else (ocr_data.get("snippet", "")[:100] or card_title)

    dimensions = {
        "date": {
            "key": "date",
            "name": "1. Date & Schedule",
            "icon": "📅",
            "extracted": ocr_date,
            "displayValue": date_display,
            "cardValue": card_date or "Pending Review",
            "isMatch": date_match,
            "canApply": bool(ocr_date),
            "status": "confirmed" if date_match else ("discrepancy" if ocr_date else "unconfirmed"),
            "details": {
                "extractedDate": ocr_date,
                "doorsTime": ocr_data.get("doors_time"),
                "showTime": ocr_data.get("show_time")
            }
        },
        "frequency": {
            "key": "frequency",
            "name": "2. Frequency",
            "icon": "🔄",
            "extracted": ocr_freq,
            "displayValue": freq_display,
            "cardValue": event_card.get("frequencyLabel") or card_freq,
            "isMatch": frequency_match,
            "canApply": True,
            "status": "confirmed" if frequency_match else "inferred",
            "details": {
                "detectedFrequency": ocr_freq,
                "frequencyLabel": ocr_data.get("frequency_label", "One-off Show")
            }
        },
        "category": {
            "key": "category",
            "name": "3. Category",
            "icon": ocr_data.get("category_icon", "🏷️"),
            "extracted": ocr_cat,
            "displayValue": cat_display,
            "cardValue": event_card.get("categoryLabel") or card_category,
            "isMatch": category_match,
            "canApply": True,
            "status": "confirmed" if category_match else "inferred",
            "details": {
                "category": ocr_cat,
                "categoryLabel": ocr_data.get("category_label", "Event"),
                "categoryIcon": ocr_data.get("category_icon", "🏷️"),
                "keywords": ocr_data.get("category_keywords", [])
            }
        },
        "location": {
            "key": "location",
            "name": "4. Venue & Location",
            "icon": "📍",
            "extracted": ocr_data.get("detected_venue") or card_venue,
            "displayValue": location_display,
            "cardValue": card_venue or "Not specified",
            "isMatch": venue_match,
            "canApply": bool(ocr_data.get("detected_venue")),
            "status": "confirmed" if venue_match else "unconfirmed",
            "details": {
                "venue": ocr_data.get("detected_venue") or card_venue or "Venue",
                "address": ocr_data.get("detected_address") or event_card.get("address") or "",
                "neighborhood": ocr_data.get("detected_neighborhood") or event_card.get("neighborhood") or ""
            }
        },
        "price": {
            "key": "price",
            "name": "5. Price (<= $50 CAD)",
            "icon": "💰",
            "extracted": ocr_price,
            "displayValue": price_display,
            "cardValue": f"${card_price:.2f} CAD",
            "isMatch": price_match,
            "canApply": (ocr_price is not None),
            "status": "confirmed" if price_match else "discrepancy",
            "details": {
                "total": ocr_price,
                "basePrice": ocr_data.get("base_price"),
                "feeAmount": ocr_data.get("fee_amount"),
                "breakdown": ocr_data.get("fee_breakdown", ""),
                "isUnder50": ocr_data.get("is_under_50", True),
                "tiers": ocr_data.get("tiers", [])
            }
        },
        "link": {
            "key": "link",
            "name": "6. Link & Provider",
            "icon": "🔗",
            "extracted": ocr_provider,
            "displayValue": link_display,
            "cardValue": card_provider,
            "isMatch": provider_match,
            "canApply": bool(ocr_provider != "Direct / Box Office"),
            "status": "confirmed" if provider_match else "inferred",
            "details": {
                "provider": ocr_provider,
                "urls": detected_urls
            }
        },
        "description": {
            "key": "description",
            "name": "7. Description & Details",
            "icon": "📝",
            "extracted": ocr_data.get("detected_title") or card_title,
            "displayValue": desc_display,
            "cardValue": card_title,
            "isMatch": title_match,
            "canApply": bool(ocr_data.get("detected_title") or ocr_data.get("detected_lineup")),
            "status": "confirmed" if title_match else "notice",
            "details": {
                "title": ocr_data.get("detected_title") or card_title,
                "lineup": ocr_data.get("detected_lineup") or card_artist,
                "agePolicy": ocr_data.get("age_policy", "All Ages"),
                "isSoldOut": ocr_data.get("is_sold_out", False),
                "isPrivate": ocr_data.get("is_private", False),
                "snippet": ocr_data.get("snippet", "")
            }
        }
    }

    is_fully_aligned = venue_match and title_match and price_match
    
    return {
        "success": True,
        "isFullyAligned": is_fully_aligned,
        "dimensions": dimensions,
        "dimensionCount": 7,
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
        "provider": ocr_provider
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
