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

# Generic index directory patterns that lack a specific event slug or product ID
GENERIC_PATH_PATTERNS = [
    r'^/?$',
    r'^/(?:shop|store|catalog|products)/?$',
    r'^/(?:events|event|whats-on|whatson|calendar|schedule|shows|tickets|concerts)/?$',
    r'^/(?:classes|workshops|sessions)/?$',
    r'^/(?:visit|about|contact|info|home|index\.html?)/?$',
    r'^/(?:all|everything|items)/?$',
    r'^/(?:cart|checkout|basket|bag|account|login|register|signup|search|privacy|terms|donate|donations|membership|volunteer|sponsors|press)/?$'
]


def is_generic_url(url: str) -> tuple:
    """
    Universally detects if a URL is generic (root homepage or index catalog),
    non-event media/map link, or malformed URL rather than a specific event,
    ticket checkout, or dedicated landing page.
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

    path = parsed.path.rstrip('/')
    if not path or path == "":
        # Root homepage e.g. https://example.com or https://example.com/
        # Check if subdomain is event-specific (e.g. dentmay2026.eventbrite.ca)
        host_parts = netloc_lower.split('.')
        if len(host_parts) >= 3 and any(k in host_parts[0] for k in ['2025', '2026', '2027', 'show', 'fest']):
            return False, "Dedicated event subdomain"
        return True, f"Bare root homepage without event path: {cleaned}"

    for pattern in GENERIC_PATH_PATTERNS:
        if re.match(pattern, path, re.IGNORECASE):
            return True, f"Generic catalog index path ('{path}') without specific event slug: {cleaned}"

    return False, "Specific path detected"


class AutonomousDeepLinkHunter:
    """
    Generalized crawler that hunts for specific event landing pages and ticket checkout
    endpoints on venue websites using event titles, artist names, and contextual keywords.
    """

    STOP_WORDS = {
        "the", "a", "an", "and", "or", "at", "in", "of", "on", "for", "with",
        "to", "by", "from", "at", "is", "it", "if", "you", "vancouver", "bc",
        "canada", "live", "night", "presents", "show", "series", "drop-in"
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

        # Filter out any candidate that is itself generic
        viable_candidates = []
        for cand_url, score_info in candidate_links.items():
            is_gen, _ = is_generic_url(cand_url)
            if is_gen:
                continue
            viable_candidates.append((score_info["score"], cand_url, score_info["matched_tokens"]))

        viable_candidates.sort(key=lambda x: x[0], reverse=True)

        if viable_candidates and viable_candidates[0][0] >= 1.5:
            best_score, best_url, matched = viable_candidates[0]
            clean_best_url = best_url.replace('\\/', '/')
            nested_match = re.search(r'https?://[^\s/]+/+(https?://[^\s]+)', clean_best_url)
            if nested_match:
                clean_best_url = nested_match.group(1)
            return {
                "resolved": True,
                "deepUrl": clean_best_url,
                "confidence": min(1.0, best_score / 3.0),
                "matchedTokens": matched,
                "reason": f"Discovered deep link matching tokens: {matched}"
            }

        return {
            "resolved": False,
            "reason": f"Autonomous Hunter could not locate specific deep link matching tokens {tokens[:4]}"
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
