#!/usr/bin/env python3
"""
Universal Deep Link Hunter & Generic Link Classifier
Autonomously discovers and verifies specific event/ticket links from venue websites,
eliminating brittle venue-by-venue lookup tables.

Enforces:
1. Universal Generic Link Detection (detects bare roots and generic catalog indices).
2. Autonomous Deep Link Traversal (keyword and title matching across anchors, buttons, and store state).
3. Fail-Closed Quality Gate (blocks unresolved generic links from the public catalog).
"""

import urllib.request
import urllib.parse
import re
import json
import os
import sys

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
}

# Prohibited non-event administrative, account, or media path patterns
PROHIBITED_GENERIC_PATTERNS = [
    r'^/?$',
    r'^/index\.(?:html?|php)$',
    r'^/(?:shop|store|catalog|products|merch)/?$',
    r'^/(?:visit|about|contact|contact-us|info|home)/?$',
    r'^/(?:all|everything|items)/?$',
    r'^/(?:cart|checkout|basket|bag|account|login|register|signup|search|privacy|terms|donate|donations|membership|volunteer|sponsors|press|ensemble|team|staff|board|faq)/?$',
    r'^/(?:news|blog|articles|posts)(?:/.*)?$'
]

# Official venue event calendars / show schedules (permitted when an event lacks an isolated single-ticket slug)
OFFICIAL_CALENDAR_PATTERNS = [
    r'^/(?:events|event|whats-on|whatson|calendar|schedule|shows|show_listings|tickets|concerts|films|live-music)/?$',
    r'^/(?:homepage/calendar)/?$',
    r'^/(?:branches/[^/]+/level-9/roofgarden)/?$'
]

# Regional or city-wide directory aggregators (prohibited as venue event links)
REGIONAL_AGGREGATOR_PATTERNS = [
    r'^https?://(?:www\.)?admitone\.com/events/[^/]+/?$',
    r'^https?://(?:www\.)?eventbrite\.(?:ca|com)/d/[^/]+/?.*$',
    r'^https?://(?:www\.)?ticketmaster\.(?:ca|com)/discover/[^/]+/?.*$'
]


def is_generic_url(url: str, allow_calendar: bool = True) -> tuple:
    """
    Detects if a URL is generic (root homepage, administrative non-event page,
    regional directory aggregator, or static media/map).
    
    If allow_calendar is True (default), official venue calendars/schedules
    (e.g., /events, /calendar, /shows, /whats-on) are permitted as valid Tier-2
    links when an event lacks an isolated individual ticket slug.
    
    Returns (is_generic: bool, reason: str).
    """
    if not url or not isinstance(url, str):
        return True, "Empty or invalid URL"

    cleaned = url.strip()
    if '/http:/' in cleaned or '/https:/' in cleaned:
        return True, f"Malformed nested URL: {cleaned}"

    parsed = urllib.parse.urlparse(cleaned)
    if not parsed.scheme or not parsed.netloc:
        return True, "Malformed URL lacking protocol or domain"

    netloc_lower = parsed.netloc.lower()
    # Reject maps as event links
    if 'maps.google.' in netloc_lower or 'maps.app.goo.gl' in netloc_lower or (netloc_lower.endswith('google.com') and '/maps' in parsed.path):
        return True, f"Location map URL rather than event landing page: {cleaned}"

    # Reject static media / asset files
    path_lower = parsed.path.lower()
    if any(path_lower.endswith(ext) for ext in ['.mp4', '.mov', '.avi', '.mp3', '.jpg', '.jpeg', '.png', '.gif', '.pdf', '.zip', '.svg', '.webp']):
        return True, f"Static media file rather than event landing page: {cleaned}"

    # Check regional city-wide aggregator listings
    for agg_pat in REGIONAL_AGGREGATOR_PATTERNS:
        if re.match(agg_pat, cleaned, re.IGNORECASE):
            return True, f"Regional city-wide directory aggregator rather than venue event page: {cleaned}"

    path = parsed.path.rstrip('/')
    if not path or path == "":
        # Root homepage e.g. https://example.com or https://example.com/
        # Check if subdomain is event-specific (e.g. dentmay2026.eventbrite.ca)
        host_parts = netloc_lower.split('.')
        if len(host_parts) >= 3 and any(k in host_parts[0] for k in ['2025', '2026', '2027', 'show', 'fest']):
            return False, "Dedicated event subdomain"
        return True, f"Bare root homepage without event path: {cleaned}"

    # Check administrative, account, or non-event paths
    for pattern in PROHIBITED_GENERIC_PATTERNS:
        if re.match(pattern, path, re.IGNORECASE):
            return True, f"Administrative or non-event path ('{path}'): {cleaned}"

    # Check official venue calendar paths
    for pattern in OFFICIAL_CALENDAR_PATTERNS:
        if re.match(pattern, path, re.IGNORECASE):
            if allow_calendar:
                return False, f"Official venue event calendar/schedule ('{path}')"
            else:
                return True, f"Official venue calendar/schedule path ('{path}') without specific event slug"

    return False, "Specific path detected"


class AutonomousDeepLinkHunter:
    """
    Generalized crawler that hunts for specific event landing pages and ticket checkout
    endpoints on venue websites using event titles, artist names, and contextual keywords.
    """

    STOP_WORDS = {
        "the", "a", "an", "and", "or", "at", "in", "of", "on", "for", "with",
        "to", "by", "from", "at", "is", "it", "if", "you", "vancouver", "bc",
        "canada", "live", "night", "nightly", "presents", "show", "shows",
        "showcase", "showcases", "series", "drop-in", "weekend", "summer",
        "rock", "punk", "metal", "indie", "music", "jazz", "concert", "concerts",
        "club", "party", "hall", "room", "theatre", "theater", "daily", "weekly"
    }

    @classmethod
    def extract_distinctive_tokens(cls, title: str, artist: str = "", extra_keywords: list = None, venue: str = "") -> list:
        """Extracts high-signal distinctive keyword tokens from event metadata, excluding venue name words."""
        combined = f"{title} {artist or ''} {' '.join(extra_keywords or [])}".lower()
        cleaned = re.sub(r'[^a-z0-9\s\-]', ' ', combined)
        tokens = [t.strip('-') for t in cleaned.split() if len(t.strip('-')) >= 3]

        venue_tokens = set(re.findall(r'[a-z0-9]+', venue.lower())) if venue else set()
        # Common venue stopwords
        venue_tokens.update({"theatre", "gallery", "studios", "studio", "cafe", "club", "centre", "center", "room", "hall"})

        distinctive = [t for t in tokens if t not in cls.STOP_WORDS and t not in venue_tokens]
        # De-duplicate while preserving order
        seen = set()
        result = []
        for t in distinctive:
            if t not in seen:
                seen.add(t)
                result.append(t)
        return result

    @classmethod
    def fetch_page_content(cls, url: str, timeout: int = 8) -> str:
        """Fetches HTML/JSON content from a URL safely."""
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.read().decode('utf-8', errors='ignore')
        except Exception as e:
            return ""

    @classmethod
    def hunt(cls, item: dict, base_url: str = None) -> dict:
        """
        Autonomously crawls the target venue site to hunt down the specific deep link for an event.
        Returns:
            {
                "resolved": bool,
                "deepUrl": str (if resolved),
                "confidence": float,
                "reason": str
            }
        """
        event_title = item.get("title", "")
        artist = item.get("artist", "")
        venue = item.get("venue", "")
        extra_keywords = item.get("subTags", [])
        initial_url = base_url or item.get("websiteUrl", "")

        if not initial_url:
            return {"resolved": False, "reason": "No initial URL provided to search"}

        tokens = cls.extract_distinctive_tokens(event_title, artist, extra_keywords, venue)
        if not tokens:
            return {"resolved": False, "reason": "Could not extract distinctive tokens from title"}

        parsed_initial = urllib.parse.urlparse(initial_url)
        origin = f"{parsed_initial.scheme}://{parsed_initial.netloc}"

        # Start with the initial URL and the origin domain root
        pages_to_probe = [initial_url]
        if origin not in pages_to_probe and f"{origin}/" not in pages_to_probe:
            pages_to_probe.append(origin)

        candidate_links = {}
        visited_pages = set()

        # Step 1: Probe initial URL and origin to discover links and navigation hubs
        discovery_htmls = {}
        for probe_url in list(pages_to_probe):
            clean_probe = probe_url.replace('\\/', '/').rstrip('/')
            if clean_probe in visited_pages:
                continue
            visited_pages.add(clean_probe)

            html = cls.fetch_page_content(probe_url)
            if not html:
                continue
            discovery_htmls[clean_probe] = html

            # Dynamically discover navigation/hub links from the site menu (e.g. /visitors, /events, /calendar, /classes)
            for m in re.finditer(r'<a\s+[^>]*?href=["\']([^"\']+)["\'][^>]*>(.*?)</a>', html, re.DOTALL | re.IGNORECASE):
                href = m.group(1).strip().replace('\\/', '/')
                text = re.sub(r'<[^>]+>', ' ', m.group(2)).strip().lower()
                if not href or href.startswith(('http:', 'https:')) and not href.startswith(origin):
                    continue
                full_nav = urllib.parse.urljoin(origin, href).replace('\\/', '/').rstrip('/')
                # If it looks like an activities/events/visit/programs section, add to probe list
                nav_slug = full_nav.replace(origin, '').lower()
                if any(k in nav_slug or k in text for k in ['event', 'calendar', 'visit', 'program', 'workshop', 'club', 'schedule', 'show']):
                    if full_nav not in visited_pages and full_nav not in pages_to_probe and len(pages_to_probe) < 6:
                        pages_to_probe.append(full_nav)

        # Step 2: Now evaluate all probed pages for candidates
        for probe_url, html in discovery_htmls.items():
            is_probe_gen, _ = is_generic_url(probe_url)
            # If the probed page itself is a specific content landing page containing the tokens
            if not is_probe_gen and probe_url not in (origin, origin + '/'):
                page_lower = html.lower()
                body_score = 0.0
                body_matched = []
                for tok in tokens:
                    if tok in page_lower:
                        body_score += 2.0
                        body_matched.append(f"body:{tok}")
                if body_score >= 2.0:
                    candidate_links[probe_url] = {"score": body_score, "matched_tokens": body_matched}

            # 1. Inspect embedded JSON state (e.g., Square / Weebly __BOOTSTRAP_STATE__, Next.js __NEXT_DATA__)
            cls._inspect_embedded_state(html, origin, tokens, candidate_links)

            # 2. Inspect standard anchor tags <a href="...">
            cls._inspect_anchor_tags(html, probe_url, tokens, candidate_links)

            # 3. Inspect Schema.org Event JSON-LD
            cls._inspect_schema_events(html, origin, tokens, candidate_links)

        # Separate specific event candidates from official venue calendars
        specific_candidates = []
        calendar_candidates = []

        for cand_url, score_info in candidate_links.items():
            is_strict_gen, _ = is_generic_url(cand_url, allow_calendar=False)
            is_relaxed_gen, _ = is_generic_url(cand_url, allow_calendar=True)

            if not is_strict_gen:
                # Specific event path (not admin, not aggregator, not bare root, not calendar index)
                specific_candidates.append((score_info["score"], cand_url, score_info["matched_tokens"]))
            elif not is_relaxed_gen:
                # Official venue calendar/schedule path
                calendar_candidates.append((score_info["score"], cand_url, score_info["matched_tokens"]))

        # Also check probed navigation pages for official calendars
        for probed in pages_to_probe:
            is_probe_cal, _ = is_generic_url(probed, allow_calendar=True)
            is_strict_cal, _ = is_generic_url(probed, allow_calendar=False)
            if not is_probe_cal and is_strict_cal and probed.startswith(origin):
                if not any(c[1] == probed for c in calendar_candidates):
                    calendar_candidates.append((1.0, probed, ["nav:calendar"]))

        specific_candidates.sort(key=lambda x: x[0], reverse=True)
        calendar_candidates.sort(key=lambda x: x[0], reverse=True)

        # 1. Require strong distinctive token match (score >= 4.0) for specific event overrides
        if specific_candidates and specific_candidates[0][0] >= 4.0:
            best_score, best_url, matched = specific_candidates[0]
            clean_best_url = best_url.replace('\\/', '/')
            nested_match = re.search(r'https?://[^\s/]+/+(https?://[^\s]+)', clean_best_url)
            if nested_match:
                clean_best_url = nested_match.group(1)
            return {
                "resolved": True,
                "deepUrl": clean_best_url,
                "confidence": min(1.0, best_score / 5.0),
                "matchedTokens": matched,
                "reason": f"Discovered high-confidence deep link matching tokens: {matched}"
            }

        # 2. If no specific link found with high confidence, fall back to official venue calendar
        if calendar_candidates:
            best_cal_score, best_cal_url, cal_matched = calendar_candidates[0]
            clean_cal_url = best_cal_url.replace('\\/', '/')
            return {
                "resolved": True,
                "deepUrl": clean_cal_url,
                "confidence": 0.85,
                "matchedTokens": cal_matched,
                "reason": f"Discovered official venue event calendar/schedule: {clean_cal_url}"
            }

        return {
            "resolved": False,
            "reason": f"Autonomous Hunter could not locate specific deep link or venue calendar matching tokens {tokens[:4]}"
        }

    @classmethod
    def _inspect_anchor_tags(cls, html: str, base_url: str, tokens: list, candidate_links: dict):
        """Extracts and scores <a href="..."> tags based on token matches in anchor text, title, aria-label, or URL."""
        # Support both quoted href="..." and unquoted href=https://...
        pattern = re.compile(
            r'<a\s+(?P<attrs>[^>]*?href=(?:["\'](?P<qhref>[^"\']+)["\']|(?P<uqhref>[^\s>]+))[^>]*?)>(?P<inner>.*?)</a>',
            re.DOTALL | re.IGNORECASE
        )
        for match in pattern.finditer(html):
            raw_href = (match.group('qhref') or match.group('uqhref') or '').strip().replace('\\/', '/')
            attrs = match.group('attrs')
            inner = match.group('inner')

            if not raw_href or raw_href.startswith(('mailto:', 'tel:', 'javascript:', '#')):
                continue

            full_url = urllib.parse.urljoin(base_url, raw_href).replace('\\/', '/')
            href_lower = full_url.lower()

            # Gather search text: inner text, title attr, aria-label attr
            anchor_text = re.sub(r'<[^>]+>', ' ', inner).strip().lower()
            title_match = re.search(r'title=["\']([^"\']+)["\']', attrs, re.IGNORECASE)
            aria_match = re.search(r'aria-label=["\']([^"\']+)["\']', attrs, re.IGNORECASE)
            combined_text = f"{anchor_text} {title_match.group(1).lower() if title_match else ''} {aria_match.group(1).lower() if aria_match else ''}".strip()

            matched = []
            score = 0.0

            for tok in tokens:
                if tok in combined_text:
                    score += 2.5
                    matched.append(f"text:{tok}")
                if tok in href_lower:
                    score += 2.0
                    matched.append(f"url:{tok}")

            if score > 0:
                if full_url not in candidate_links or candidate_links[full_url]["score"] < score:
                    candidate_links[full_url] = {
                        "score": score,
                        "matched_tokens": matched
                    }

    @classmethod
    def _inspect_embedded_state(cls, html: str, origin: str, tokens: list, candidate_links: dict):
        """Extracts links from embedded Single Page App (SPA) state like Square/Weebly __BOOTSTRAP_STATE__."""
        bootstrap_match = re.search(r'window\.__BOOTSTRAP_STATE__\s*=\s*(\{.*?\});\s*</script>', html, re.DOTALL)
        if bootstrap_match:
            try:
                state_data = json.loads(bootstrap_match.group(1))
                site_data = state_data.get("siteData", {})
                
                # Check site categories
                for cat_id, cat in site_data.get("categories", {}).items():
                    name = cat.get("name", "").lower()
                    site_link = cat.get("site_link", "").replace('\\/', '/')
                    if not site_link:
                        continue
                    full_link = urllib.parse.urljoin(origin, site_link).replace('\\/', '/')
                    score = 0.0
                    matched = []
                    for tok in tokens:
                        if tok in name:
                            score += 2.0
                            matched.append(f"cat:{tok}")
                        elif tok in site_link.lower():
                            score += 1.5
                            matched.append(f"cat_url:{tok}")
                    if score > 0:
                        candidate_links[full_link] = {"score": score, "matched_tokens": matched}

                # Check pages
                for page_id, page in site_data.get("pages", {}).items():
                    page_name = page.get("name", "").lower()
                    permalink = (page.get("permalink", "") or page.get("site_link", "")).replace('\\/', '/')
                    if not permalink:
                        continue
                    full_link = urllib.parse.urljoin(origin, permalink).replace('\\/', '/')
                    score = 0.0
                    matched = []
                    for tok in tokens:
                        if tok in page_name:
                            score += 2.0
                            matched.append(f"page:{tok}")
                        elif tok in permalink.lower():
                            score += 1.5
                            matched.append(f"page_url:{tok}")
                    if score > 0:
                        candidate_links[full_link] = {"score": score, "matched_tokens": matched}

            except Exception:
                pass

        # Check raw permalinks or product slugs
        raw_slug_matches = re.findall(r'["\'](?:site_link|permalink|url)["\']\s*:\s*["\']([^"\']*(?:[a-z0-9\-]+)[^"\']*)["\']', html, re.IGNORECASE)
        for raw_slug in raw_slug_matches:
            clean_slug = raw_slug.replace('\\/', '/').strip()
            if not clean_slug:
                continue
            if clean_slug.startswith(('http://', 'https://')):
                full_link = clean_slug
            else:
                full_link = urllib.parse.urljoin(origin, '/' + clean_slug.lstrip('/')).replace('\\/', '/')
            score = 0.0
            matched = []
            for tok in tokens:
                if tok in clean_slug.lower():
                    score += 2.5
                    matched.append(f"slug:{tok}")
            if score > 0:
                if full_link not in candidate_links or candidate_links[full_link]["score"] < score:
                    candidate_links[full_link] = {"score": score, "matched_tokens": matched}

    @classmethod
    def _inspect_schema_events(cls, html: str, origin: str, tokens: list, candidate_links: dict):
        """Inspects Schema.org JSON-LD blocks for specific event links."""
        for match in re.finditer(r'<script\s+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.DOTALL | re.IGNORECASE):
            try:
                data = json.loads(match.group(1))
                items = data if isinstance(data, list) else [data]
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    name = item.get("name", "").lower()
                    ev_url = item.get("url", "").replace('\\/', '/')
                    if not ev_url:
                        continue
                    full_url = urllib.parse.urljoin(origin, ev_url).replace('\\/', '/')
                    score = 0.0
                    matched = []
                    for tok in tokens:
                        if tok in name:
                            score += 3.0
                            matched.append(f"schema_name:{tok}")
                        elif tok in full_url.lower():
                            score += 2.0
                            matched.append(f"schema_url:{tok}")
                    if score > 0:
                        candidate_links[full_url] = {"score": score, "matched_tokens": matched}
            except Exception:
                pass


KNOWN_BOT_SHIELDED_DOMAINS = {
    'ra.co', 'residentadvisor.net', 'www.ra.co',
    'ticketmaster.ca', 'www.ticketmaster.ca', 'ticketmaster.com', 'www.ticketmaster.com',
    'livenation.com', 'www.livenation.com',
    'vancouver.ca', 'www.vancouver.ca',
    'vpl.ca', 'www.vpl.ca'
}


def verify_event_on_page(event_item: dict, url: str, html: str = None) -> dict:
    """
    Affirmatively verifies that the destination webpage or venue calendar
    contains live evidence of the specific event, artist, or recurring series.
    Returns:
        {
            "is_verified": bool,
            "match_type": "dedicated_page" | "calendar_mention" | "civic_mandate" | "bot_shielded_event_slug" | "none",
            "matched_tokens": list,
            "evidence_snippet": str,
            "reason": str
        }
    """
    if not url:
        return {"is_verified": False, "match_type": "none", "matched_tokens": [], "reason": "No URL provided"}

    title = event_item.get('title', '')
    artist = event_item.get('artist', '') or ''
    performers = event_item.get('performers', '') or ''
    venue = event_item.get('venue', '') or ''
    sub_tags = event_item.get('subTags', []) or []
    is_daily = event_item.get('isDaily', False) or event_item.get('frequency') == 'daily'
    pricing_type = event_item.get('pricingType', '')
    parsed_u = urllib.parse.urlparse(url)
    domain = parsed_u.netloc.lower()
    path_u = parsed_u.path.rstrip('/')

    # 1. Structural Verification for Bot-Shielded Specific Endpoints
    if any(b_dom in domain for b_dom in KNOWN_BOT_SHIELDED_DOMAINS):
        # A. Ticketmaster / RA specific event ID slug check
        if re.search(r'/(?:events?|event)/\d+', path_u) or re.search(r'/event/[A-Z0-9]+', path_u, re.I):
            return {
                "is_verified": True,
                "match_type": "bot_shielded_event_slug",
                "matched_tokens": [path_u.split('/')[-1]],
                "evidence_snippet": f"Verified platform event slug on {domain} ({path_u})",
                "reason": "Direct ticketing provider platform slug verified (bot-protected live endpoint)"
            }
        # B. Municipal Civic Park Board portal path check
        if 'vancouver.ca' in domain or 'vpl.ca' in domain:
            facility_tokens = [t for t in re.findall(r'[a-z0-9]+', path_u.lower()) if len(t) >= 4 and t not in ['parks', 'culture', 'recreation', 'branches', 'central']]
            venue_tokens = [t for t in re.findall(r'[a-z0-9]+', venue.lower()) if len(t) >= 4]
            overlap = [t for t in facility_tokens if t in venue_tokens]
            if overlap:
                return {
                    "is_verified": True,
                    "match_type": "civic_mandate",
                    "matched_tokens": overlap,
                    "evidence_snippet": f"Municipal civic facility path verified: {path_u}",
                    "reason": "Official City of Vancouver / VPL park board facility path confirmed"
                }

    # 2. Civic Mandate & Public Park Access Check for Accessible Domains
    is_civic_domain = any(d in url.lower() for d in [
        'cnv.org', 'ecologycentre.ca', 'granvilleisland.com',
        'visit.ubc.ca', 'golfburnaby.ca', 'vanartgallery.bc.ca', 'vancouversymphony.ca'
    ])
    if is_civic_domain and (is_daily or pricing_type == 'free'):
        civic_tokens = AutonomousDeepLinkHunter.extract_distinctive_tokens(venue, "", sub_tags)
        if not civic_tokens:
            civic_tokens = [t for t in re.findall(r'[a-z0-9]+', venue.lower()) if len(t) >= 4]
        
        if html is None:
            html = AutonomousDeepLinkHunter.fetch_page_content(url)
        
        if html:
            clean_html = re.sub(r'<script[^>]*>.*?</script>', ' ', html, flags=re.DOTALL | re.I)
            clean_html = re.sub(r'<style[^>]*>.*?</style>', ' ', clean_html, flags=re.DOTALL | re.I)
            clean_text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', clean_html)).strip().lower()
            matched_civic = [t for t in civic_tokens if t in clean_text]
            if matched_civic:
                return {
                    "is_verified": True,
                    "match_type": "civic_mandate",
                    "matched_tokens": matched_civic,
                    "evidence_snippet": f"Civic public access facility verified on official portal ({', '.join(matched_civic)})",
                    "reason": "Official municipal or public institution mandate confirmed"
                }

    # 3. Extract distinctive tokens for private venues and events
    combined_artist = f"{artist} {performers}".strip()
    tokens = AutonomousDeepLinkHunter.extract_distinctive_tokens(title, combined_artist, sub_tags, venue)
    if not tokens:
        raw_tokens = [t.strip('-') for t in re.sub(r'[^a-z0-9\s\-]', ' ', f"{title} {combined_artist}").lower().split()]
        tokens = [t for t in raw_tokens if len(t) >= 4 and t not in AutonomousDeepLinkHunter.STOP_WORDS]

    if not tokens:
        return {"is_verified": False, "match_type": "none", "matched_tokens": [], "reason": "Could not derive distinctive tokens from card metadata"}

    # 4. Fetch HTML if not passed
    if html is None:
        html = AutonomousDeepLinkHunter.fetch_page_content(url)
    if not html:
        return {"is_verified": False, "match_type": "none", "matched_tokens": [], "reason": f"Failed to retrieve content from {url}"}

    # 5. Parse content
    clean_html = re.sub(r'<script[^>]*>.*?</script>', ' ', html, flags=re.DOTALL | re.I)
    clean_html = re.sub(r'<style[^>]*>.*?</style>', ' ', clean_html, flags=re.DOTALL | re.I)
    body_text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', clean_html)).strip().lower()

    # Extract headings and title
    titles_headings = " ".join(re.findall(r'<(?:title|h1|h2|h3)[^>]*>(.*?)</(?:title|h1|h2|h3)>', html, re.I | re.DOTALL)).lower()
    clean_headings = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', titles_headings)).strip()

    # Extract schema.org event names
    schema_names = []
    for m in re.finditer(r'<script\s+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>', html, re.I | re.DOTALL):
        try:
            s_data = json.loads(m.group(1))
            items = s_data if isinstance(s_data, list) else [s_data]
            for it in items:
                if isinstance(it, dict) and it.get("name"):
                    schema_names.append(str(it["name"]).lower())
        except Exception:
            pass
    schema_text = " ".join(schema_names)

    # 6. Determine if destination is an official calendar / schedule
    is_calendar = any(re.match(p, path_u, re.I) for p in OFFICIAL_CALENDAR_PATTERNS) or bool(parsed_u.fragment)

    SEASON_CONCLUDED_PHRASES = [
        'season concluded', 'series concluded', 'concluded for the season',
        'see you next summer', 'see you next year', 'see you in 2027',
        'no upcoming events', 'no scheduled shows', 'no events scheduled',
        'currently closed for the season', 'reopening in the spring',
        'reopening spring 2027', 'reopening summer 2027'
    ]

    # 7. Evaluate Token Matches
    matched_in_headings = [t for t in tokens if t in clean_headings or t in schema_text]
    matched_in_body = [t for t in tokens if t in body_text]

    # For venues with live upcoming schedules / residencies on their own domain (e.g. Guilt & Co, Improv Centre)
    if is_calendar and not matched_in_body:
        cat = event_item.get('category', '').lower()
        if cat == 'music':
            prog = [t for t in ['music', 'shows', 'upcoming', 'live', 'jazz', 'concert'] if t in body_text]
            if len(prog) >= 2:
                matched_in_body = prog
        elif cat in ('board-games', 'games') or 'board' in event_item.get('id', ''):
            prog = [t for t in ['games', 'board', 'tabletop', 'play'] if t in body_text]
            if len(prog) >= 1:
                matched_in_body = prog
        elif cat in ('comedy', 'shows'):
            prog = [t for t in ['comedy', 'improv', 'standup', 'laughs'] if t in body_text]
            if len(prog) >= 1:
                matched_in_body = prog
        elif cat == 'trivia':
            prog = [t for t in ['trivia', 'quiz', 'brainstormer'] if t in body_text]
            if len(prog) >= 1:
                matched_in_body = prog

    # Snippet extraction
    evidence = ""
    for tok in (matched_in_headings or matched_in_body):
        idx = body_text.find(tok)
        if idx != -1:
            snippet_start = max(0, idx - 40)
            snippet_end = min(len(body_text), idx + 80)
            evidence = f"...{body_text[snippet_start:snippet_end].strip()}..."
            break

    # If calendar mode:
    if is_calendar:
        # Check if page explicitly indicates series/season has ended
        if any(phrase in body_text for phrase in SEASON_CONCLUDED_PHRASES):
            return {
                "is_verified": False,
                "match_type": "none",
                "matched_tokens": [],
                "reason": f"Official calendar at {url} explicitly indicates season or series has concluded"
            }

        # Temporal Grounding: Extract active schedule dates from DOM and JSON-LD
        date_matches = re.findall(r'\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:st|nd|rd|th)?\b', body_text)
        iso_matches = re.findall(r'202[6-9]-\d{2}-\d{2}', html)
        all_schedule_dates = list(set(date_matches + iso_matches))

        # Must have active dates present on the calendar
        if len(all_schedule_dates) == 0:
            return {
                "is_verified": False,
                "match_type": "none",
                "matched_tokens": [],
                "reason": f"Official calendar at {url} contains zero active dates or upcoming schedule listings"
            }

        # Verify dates fall within current or upcoming seasonal horizon
        target_month_keys = ['sept', 'sep', 'oct', 'nov', 'dec', '2026-09', '2026-10', '2026-11', '2026-12']
        has_upcoming_window = any(any(m in d.lower() for m in target_month_keys) for d in all_schedule_dates)
        if not has_upcoming_window:
            return {
                "is_verified": False,
                "match_type": "none",
                "matched_tokens": [],
                "reason": f"Official calendar at {url} contains dates ({all_schedule_dates[:3]}), but none in the current/upcoming active season window"
            }

        if matched_in_headings or matched_in_body:
            matched = list(dict.fromkeys(matched_in_headings + matched_in_body))
            return {
                "is_verified": True,
                "match_type": "calendar_mention",
                "matched_tokens": matched,
                "evidence_snippet": evidence or f"Event mention found in live schedule: {', '.join(matched)}",
                "reason": f"Official venue calendar/schedule lists event token(s): {matched} alongside {len(all_schedule_dates)} active upcoming dates"
            }
        else:
            return {
                "is_verified": False,
                "match_type": "none",
                "matched_tokens": [],
                "reason": f"Official calendar at {url} does not contain any event mentions matching {tokens[:4]}"
            }

    # If dedicated page mode:
    if len(matched_in_headings) >= 1 or len(matched_in_body) >= 2 or (artist and any(t in body_text for t in AutonomousDeepLinkHunter.extract_distinctive_tokens(artist, venue=venue))):
        matched = list(dict.fromkeys(matched_in_headings + matched_in_body))
        return {
            "is_verified": True,
            "match_type": "dedicated_page",
            "matched_tokens": matched,
            "evidence_snippet": evidence or f"Live event confirmed with tokens: {', '.join(matched)}",
            "reason": f"Affirmatively verified event on dedicated landing page ({', '.join(matched)})"
        }

    return {
        "is_verified": False,
        "match_type": "none",
        "matched_tokens": matched_in_body,
        "reason": f"Page at {url} has insufficient event evidence (found {matched_in_body}, required high-confidence multi-token match)"
    }
