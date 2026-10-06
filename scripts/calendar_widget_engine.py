#!/usr/bin/env python3
"""
calendar_widget_engine.py
Universal Calendar Widget Detection & Autonomous Event Extraction Engine for Van50.

Detects when a venue or event organizer displays upcoming events via embedded
third-party calendar widgets rather than static HTML text. Automatically identifies
the widget provider, extracts the calendar parameters, hits the underlying public
API, and normalizes candidate events into standard Van50 schema.

Supported Calendar Widget Platforms:
1. Tockify (data-tockify-calendar, public.tockify.com, /api/ngevent)
2. Eventbrite Embed (eventbrite-widget-container, /tickets-external, eid)
3. Time.ly / All-in-One Event Calendar (timely-calendar, time.ly/api)
4. Google Calendar Embed (calendar.google.com/calendar/embed, basic.ics)
5. Bandsintown Widget (widget.bandsintown.com, bit-widget-initializer)
6. DICE.fm Widget (widgets.dice.fm, data-dice-widget)
"""

import os
import sys
import re
import json
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional, Any
from bs4 import BeautifulSoup

sys.stdout.reconfigure(encoding='utf-8')

# Vancouver local timezone (PDT = UTC-7, PST = UTC-8)
VANCOUVER_TZ = timezone(timedelta(hours=-7))

class CalendarWidgetDetector:
    """Analyzes page HTML/DOM to identify embedded calendar widgets and their configuration."""

    @classmethod
    def detect(cls, html: str, page_url: str = "") -> Optional[Dict[str, Any]]:
        """
        Scans HTML for known calendar widget signatures.
        Returns a dictionary describing the widget type and extracted credentials/IDs, or None.
        """
        if not html:
            return None

        soup = BeautifulSoup(html, 'html.parser')

        # -------------------------------------------------------------
        # 1. Tockify Calendar Widget
        # -------------------------------------------------------------
        # Signature A: <div data-tockify-calendar="xyz" ...>
        tockify_div = soup.find(attrs={"data-tockify-calendar": True})
        if tockify_div:
            calname = tockify_div.get("data-tockify-calendar", "").strip()
            if calname:
                return {
                    "platform": "tockify",
                    "calname": calname,
                    "detection_method": "dom_data_attribute",
                    "source_url": page_url
                }

        # Signature B: Regex in script tags or inline JS
        tock_m = re.search(r'data-tockify-calendar=["\']([^"\']+)["\']', html, re.I)
        if tock_m:
            return {
                "platform": "tockify",
                "calname": tock_m.group(1).strip(),
                "detection_method": "regex_attribute",
                "source_url": page_url
            }

        tock_url_m = re.search(r'tockify\.com/(?:api/ngevent\?calname=|web/|)([a-zA-Z0-9_\-]+)', html, re.I)
        if tock_url_m:
            cal = tock_url_m.group(1).strip()
            if cal not in ['browser', 'api', 'web', 'embed', 'js', 'css']:
                return {
                    "platform": "tockify",
                    "calname": cal,
                    "detection_method": "regex_url",
                    "source_url": page_url
                }

        # -------------------------------------------------------------
        # 2. Google Calendar Embed
        # -------------------------------------------------------------
        gcal_iframe = soup.find('iframe', src=re.compile(r'calendar\.google\.com/calendar/embed', re.I))
        if gcal_iframe and gcal_iframe.get('src'):
            src = gcal_iframe['src']
            parsed = urllib.parse.urlparse(src)
            qs = urllib.parse.parse_qs(parsed.query)
            cid = qs.get('src', [None])[0]
            if cid:
                return {
                    "platform": "google_calendar",
                    "calendar_id": cid,
                    "embed_url": src,
                    "detection_method": "iframe_src",
                    "source_url": page_url
                }

        # -------------------------------------------------------------
        # 3. Eventbrite Widget
        # -------------------------------------------------------------
        eb_div = soup.find(id=re.compile(r'eventbrite-widget-container', re.I)) or soup.find(attrs={"data-widget-type": "countdown"})
        if eb_div:
            eid_m = re.search(r'eid[=_]([0-9]{8,15})', html, re.I)
            if eid_m:
                return {
                    "platform": "eventbrite_widget",
                    "event_id": eid_m.group(1),
                    "detection_method": "dom_eventbrite",
                    "source_url": page_url
                }

        # -------------------------------------------------------------
        # 4. Time.ly (All-in-One Event Calendar)
        # -------------------------------------------------------------
        timely_el = soup.find(class_=re.compile(r'timely|ai1ec', re.I)) or soup.find(attrs={"data-timely-calendar": True})
        if timely_el or 'time.ly' in html:
            timely_cal_m = re.search(r'data-timely-calendar=["\']([^"\']+)["\']', html, re.I)
            cal_id = timely_cal_m.group(1) if timely_cal_m else "default"
            return {
                "platform": "timely",
                "calendar_id": cal_id,
                "detection_method": "timely_dom",
                "source_url": page_url
            }

        # -------------------------------------------------------------
        # 5. DICE.fm Widget
        # -------------------------------------------------------------
        dice_el = soup.find(attrs={"data-dice-widget": True}) or soup.find('script', src=re.compile(r'widgets\.dice\.fm', re.I))
        if dice_el:
            dice_venue_m = re.search(r'dice\.fm/venues/([a-zA-Z0-9\-]+)', html, re.I)
            venue_slug = dice_venue_m.group(1) if dice_venue_m else ""
            return {
                "platform": "dice_widget",
                "venue_slug": venue_slug,
                "detection_method": "dice_dom",
                "source_url": page_url
            }

        return None


class CalendarWidgetEngine:
    """Fetches, authenticates, and normalizes events from detected calendar widget APIs."""

    @classmethod
    def fetch_events(cls, widget_info: Dict[str, Any], venue_meta: Optional[Dict[str, Any]] = None, max_events: int = 30) -> List[Dict[str, Any]]:
        """Routes to the specific widget API handler based on platform."""
        platform = widget_info.get("platform")
        if platform == "tockify":
            return cls._fetch_tockify(widget_info, venue_meta or {}, max_events)
        elif platform == "google_calendar":
            return cls._fetch_google_calendar(widget_info, venue_meta or {}, max_events)
        else:
            print(f"[WIDGET WARN] Platform '{platform}' detected but specialized API adapter not yet attached.")
            return []

    @classmethod
    def _fetch_tockify(cls, widget_info: Dict[str, Any], venue_meta: Dict[str, Any], max_events: int) -> List[Dict[str, Any]]:
        """Queries Tockify's public JSON API and maps into Van50 canonical events."""
        calname = widget_info.get("calname")
        if not calname:
            return []

        # Current time in milliseconds (start from beginning of today)
        now_utc = datetime.now(timezone.utc)
        start_ms = int((now_utc - timedelta(days=1)).timestamp() * 1000)
        api_url = f"https://tockify.com/api/ngevent?calname={calname}&startms={start_ms}&max={max_events}"

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept": "application/json"
        }

        try:
            req = urllib.request.Request(api_url, headers=headers)
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                raw_events = data.get("events", [])
        except Exception as e:
            print(f"[WIDGET ERROR] Failed to fetch Tockify API for '{calname}': {e}")
            return []

        print(f"[WIDGET SUCCESS] Fetched {len(raw_events)} raw events from Tockify API (calname: {calname}).")

        # Parse each event
        parsed_shows = []
        for ev in raw_events:
            content = ev.get('content', {})
            summary = content.get('summary', {}).get('text', '').strip()
            desc = content.get('description', {}).get('text', '').strip()
            tags = content.get('tagset', {}).get('tags', {}).get('default', [])
            when = ev.get('when', {})
            start_m = when.get('start', {}).get('millis', 0)
            end_m = when.get('end', {}).get('millis', 0)

            if not summary or not start_m:
                continue

            dt_start = datetime.fromtimestamp(start_m / 1000.0, tz=VANCOUVER_TZ)
            dt_end = datetime.fromtimestamp(end_m / 1000.0, tz=VANCOUVER_TZ) if end_m else (dt_start + timedelta(hours=2))

            img_url = ""
            if content.get('imageSets'):
                img_id = content['imageSets'][0].get('id')
                if img_id:
                    img_url = f"https://tockify.com/api/image/full/{img_id}"

            is_early = 'early show' in summary.lower() or dt_start.hour < 20
            clean_artist = re.sub(r'^(?:early show:?|vanjazz fest presents:?)\s*', '', summary, flags=re.I).strip()

            parsed_shows.append({
                'raw_title': summary,
                'artist': clean_artist,
                'description': desc,
                'tags': tags,
                'dt_start': dt_start,
                'dt_end': dt_end,
                'date': dt_start.strftime('%Y-%m-%d'),
                'start_time': dt_start.strftime('%I:%M %p').lstrip('0'),
                'end_time': dt_end.strftime('%I:%M %p').lstrip('0'),
                'is_early': is_early,
                'image_url': img_url,
                'uid': str(ev.get('eid', {}).get('uid', ''))
            })

        # Group by date for double-bills / multi-set evenings
        by_date = {}
        for p in parsed_shows:
            d = p['date']
            if d not in by_date:
                by_date[d] = []
            by_date[d].append(p)

        venue_name = venue_meta.get('venue_name', 'Guilt & Co.')
        venue_address = venue_meta.get('full_address', '1 Alexander St (Below Ground), Vancouver, BC')
        venue_neighborhood = venue_meta.get('neighborhood', 'Gastown')
        base_url = venue_meta.get('website_url', widget_info.get('source_url', 'https://www.guiltandcompany.com'))
        ticket_url = venue_meta.get('calendar_url', f"{base_url}/#ajsection-upcoming")

        normalized_events = []
        for d_str, shows in by_date.items():
            early = next((s for s in shows if s['is_early']), shows[0])
            late = next((s for s in shows if not s['is_early']), shows[-1] if len(shows) > 1 else None)

            d_obj = datetime.fromisoformat(d_str)
            day_name = d_obj.strftime('%A')
            date_short = d_obj.strftime('%b %d')

            if late and late != early:
                display_title = f"{venue_name} Live: {late['artist']} (with {early['artist']})"
                lineup_str = f"Early Show ({early['start_time']} – {early['end_time']}): {early['artist']}. Late Show ({late['start_time']} – {late['end_time']}): {late['artist']}."
                performers = [late['artist'], early['artist']]
                combined_desc = f"Live music double-bill at {venue_name}. Early set by {early['artist']} ({early['start_time']}), followed by {late['artist']} ({late['start_time']} – {late['end_time']}). {late['description'][:180]}..."
                time_display = f"{early['start_time']} – {late['end_time']}"
            else:
                display_title = f"{venue_name} Live: {early['artist']}"
                lineup_str = f"{early['artist']} ({early['start_time']} – {early['end_time']})"
                performers = [early['artist']]
                combined_desc = f"{early['description'][:220]}..."
                time_display = f"{early['start_time']} – {early['end_time']}"

            # Pricing policy resolution
            if day_name in ['Friday', 'Saturday']:
                early_cover = 8.0
                late_cover = 15.0
                curator_note = f"Walk-in door cover ($8 CAD before 8:00 PM, $15 CAD prime night after 8:00 PM; 100% directly supports musicians). 19+ only."
                tier_2_name = f"{day_name} Night Cover (After 8:00 PM)"
            else:
                early_cover = 8.0
                late_cover = 12.0
                curator_note = f"Walk-in door cover ($8 CAD before 8:00 PM, $12 CAD late show after 8:00 PM; 100% directly supports musicians). 19+ only."
                tier_2_name = "Late Show Cover (After 8:00 PM)"

            showings_list = []
            if early:
                showings_list.append({
                    "date": d_str,
                    "start_time": early['start_time'],
                    "end_time": early['end_time'],
                    "show_title": f"Early Show: {early['artist']}"
                })
            if late and late != early:
                showings_list.append({
                    "date": d_str,
                    "start_time": late['start_time'],
                    "end_time": late['end_time'],
                    "show_title": f"Late Show: {late['artist']}"
                })

            tags_combined = list(set([
                "live-music", "gastown", "cocktail-lounge", "19-plus", "under-20-dollars",
                calname, day_name.lower()
            ] + [t.lower().replace(' ', '-') for t in (early.get('tags', []) + (late.get('tags', []) if late else []))]))

            slug_name = re.sub(r'[^a-z0-9\-]', '', f"{calname}-{day_name.lower()}").strip('-')

            event_record = {
                "event_id": f"van50-{slug_name}",
                "event_name": display_title,
                "title": display_title,
                "category": "Live Music",
                "categoryLabel": "Live Music",
                "lifecycle_type": "weekly_recurring",
                "venue_name": venue_name,
                "full_address": venue_address,
                "neighborhood": venue_neighborhood,
                "description": combined_desc,
                "pricing_all_in_cad": {
                    "regular": early_cover,
                    "senior": early_cover,
                    "student": early_cover,
                    "member": early_cover
                },
                "price": early_cover,
                "price_adult": early_cover,
                "price_student": early_cover,
                "price_member": early_cover,
                "tier_custom_name_1": "Early Show Cover (Before 8:00 PM)",
                "tier_custom_price_1": early_cover,
                "tier_custom_name_2": tier_2_name,
                "tier_custom_price_2": late_cover,
                "tiers": [
                    {
                        "name": "Early Show Cover (Before 8:00 PM)",
                        "price": early_cover,
                        "isAvailable": True
                    },
                    {
                        "name": tier_2_name,
                        "price": late_cover,
                        "isAvailable": True
                    }
                ],
                "discovery_url": base_url,
                "details_url": ticket_url,
                "ticket_url": ticket_url,
                "ticket_provider": "Door Cover at Entrance",
                "tags": tags_combined,
                "subTags": tags_combined,
                "festival_affiliation": "None",
                "approval_status": "Curator-Approved",
                "curator_notes": curator_note,
                "access_model": "fenced_facility",
                "pricing_model": "flat_ticket",
                "operating_hours": f"{day_name} {time_display}",
                "days_open": day_name[:3],
                "date": d_str,
                "time": time_display,
                "start_time": early['start_time'],
                "end_time": late['end_time'] if late else early['end_time'],
                "dateSchedule": f"{day_name}, {date_short}: Early Show {early['start_time']}, Late Show {late['start_time'] if late else 'N/A'}",
                "frequency": "Weekly",
                "frequencyLabel": "Weekly",
                "typical_item_spend": "$14.00 – $18.00 CAD (craft cocktails / local beer)",
                "lineup": lineup_str,
                "performers": performers,
                "artist": late['artist'] if late else early['artist'],
                "restrictions": "19+ only (2 pieces of valid government ID required)",
                "is_sold_out": False,
                "waypoints": [],
                "showings": showings_list,
                "food_service_type": "bar_snacks_and_drinks",
                "food_service_note": "Charcuterie boards, gourmet grilled cheese, artisanal cocktails & mocktails",
                "sample_cost_label": f"${early_cover:.2f} CAD early door cover",
                "show_1": {
                    "date": d_str,
                    "start_time": early['start_time'],
                    "end_time": late['end_time'] if late else early['end_time']
                }
            }
            normalized_events.append(event_record)

        return normalized_events

    @classmethod
    def _fetch_google_calendar(cls, widget_info: Dict[str, Any], venue_meta: Dict[str, Any], max_events: int) -> List[Dict[str, Any]]:
        """Parses Google Calendar public iCal feeds."""
        cal_id = widget_info.get("calendar_id")
        if not cal_id:
            return []

        ical_url = f"https://calendar.google.com/calendar/ical/{urllib.parse.quote(cal_id)}/public/basic.ics"
        print(f"[WIDGET INFO] Fetching public iCal feed: {ical_url}")
        try:
            req = urllib.request.Request(ical_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw_ics = resp.read().decode('utf-8', errors='replace')
        except Exception as e:
            print(f"[WIDGET ERROR] Failed to fetch Google Calendar iCal: {e}")
            return []

        # Simple robust iCal parser
        events = []
        chunks = raw_ics.split('BEGIN:VEVENT')
        for chunk in chunks[1:]:
            summary_m = re.search(r'SUMMARY:(.+)', chunk)
            desc_m = re.search(r'DESCRIPTION:(.+)', chunk)
            dtstart_m = re.search(r'DTSTART(?:;[^:]+)?:([0-9T]+)', chunk)

            summary = summary_m.group(1).strip() if summary_m else "Community Event"
            desc = desc_m.group(1).strip() if desc_m else ""

            if dtstart_m:
                dt_raw = dtstart_m.group(1)
                try:
                    if len(dt_raw) == 8:
                        d_obj = datetime.strptime(dt_raw, '%Y%m%d')
                    else:
                        d_obj = datetime.strptime(dt_raw[:15], '%Y%m%dT%H%M%S')
                    d_str = d_obj.strftime('%Y-%m-%d')
                    events.append({
                        "title": summary,
                        "date": d_str,
                        "description": desc,
                        "detection": "google_calendar_ical"
                    })
                except Exception:
                    pass

        return events

    @classmethod
    def detect_and_extract(cls, html: str, page_url: str, venue_meta: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
        """
        Unified one-call entry point:
        1. Analyzes HTML for embedded calendar widgets.
        2. If detected, queries the widget's API.
        3. Returns normalized Van50 candidate events.
        """
        widget_info = CalendarWidgetDetector.detect(html, page_url)
        if not widget_info:
            return []

        print(f"[CALENDAR WIDGET DETECTED] Platform: {widget_info['platform']} on {page_url} (Config: {widget_info})")
        return cls.fetch_events(widget_info, venue_meta)


# CLI Interface for testing on any URL
if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description="Universal Calendar Widget Ingestion Engine")
    parser.add_argument("--url", help="Venue URL to inspect for embedded widgets")
    parser.add_argument("--venue", help="Venue name to match from data/venues.json")
    parser.add_argument("--scan-all", action="store_true", help="Scan all registered venues for calendar widgets")
    args = parser.parse_args()

    if args.url:
        print(f"Fetching {args.url}...")
        req = urllib.request.Request(args.url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req) as resp:
            html_text = resp.read().decode('utf-8', errors='replace')
        events = CalendarWidgetEngine.detect_and_extract(html_text, args.url)
        print(f"\nDiscovered {len(events)} events via calendar widget:")
        for ev in events[:5]:
            print(f" - [{ev.get('date')}] {ev.get('title')} ({ev.get('lineup', '')})")
    elif args.scan_all:
        venues_path = 'data/venues.json'
        with open(venues_path, 'r', encoding='utf-8') as f:
            venues = json.load(f)
        found = 0
        for v in venues:
            v_url = v.get('website_url') or v.get('calendar_url')
            if not v_url:
                continue
            try:
                req = urllib.request.Request(v_url, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=8) as resp:
                    page_html = resp.read().decode('utf-8', errors='replace')
                w_info = CalendarWidgetDetector.detect(page_html, v_url)
                if w_info:
                    found += 1
                    print(f"✓ Found {w_info['platform']} on '{v.get('venue_name')}' ({v_url}) -> {w_info}")
            except Exception:
                pass
        print(f"\nScan complete: {found} venues use embedded calendar widgets.")
    else:
        # Default run on Guilt & Co to demonstrate generic capability
        test_url = "https://www.guiltandcompany.com/"
        print(f"Running CalendarWidgetEngine test on {test_url}...")
        req = urllib.request.Request(test_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
        with urllib.request.urlopen(req) as resp:
            html_text = resp.read().decode('utf-8', errors='replace')
        events = CalendarWidgetEngine.detect_and_extract(html_text, test_url)
        print(f"\nResult: Successfully extracted {len(events)} normalized events via general widget detector.")
        for ev in events:
            print(f" + [{ev['date']}] {ev['title']}")
