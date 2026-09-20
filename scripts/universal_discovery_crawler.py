#!/usr/bin/env python3
"""
Van50 Universal Discovery Crawler
Top-of-funnel radar that monitors editorial RSS feeds, weekly listings, and community calendars
(Daily Hive, Do604, Georgia Straight, Miss604, Vancouver Is Awesome).
Discovers candidate events, flags new venues for Curator review, and detects upcoming festivals.
"""

import os
import sys
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Dict, List, Any, Optional
from urllib.parse import urlparse

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    requests = None
    BeautifulSoup = None

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
DISCOVERY_SOURCES_PATH = os.path.join(DATA_DIR, "discovery_sources.json")
VENUE_DIR_PATH = os.path.join(DATA_DIR, "venue_directory.json")
DISCOVERED_VENUES_PATH = os.path.join(DATA_DIR, "discovered_venues.json")
FESTIVAL_REGISTRY_PATH = os.path.join(DATA_DIR, "festival_registry.json")


class UniversalDiscoveryCrawler:
    """Ingests discovery feeds and funnels candidate events, venues, and festivals."""

    EVENT_KEYWORDS = [
        "festival", "concert", "show", "tickets", "theatre", "theater", "comedy",
        "cinema", "screening", "exhibition", "market", "live music", "gig", "party",
        "things to do", "weekend", "free", "craft", "trivia"
    ]

    @classmethod
    def load_sources(cls) -> List[Dict[str, Any]]:
        """Loads all active discovery sources from data/discovery_sources.json."""
        if not os.path.exists(DISCOVERY_SOURCES_PATH):
            return []
        try:
            with open(DISCOVERY_SOURCES_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                return [s for s in data.get("sources", []) if s.get("status") == "active"]
        except Exception as e:
            print(f"[DISCOVERY CRAWLER] Failed to load sources: {e}")
            return []

    @classmethod
    def parse_rss_feed_content(cls, xml_text: str) -> List[Dict[str, Any]]:
        """Parses an RSS or Atom feed XML string and extracts raw article items."""
        items = []
        try:
            root = ET.fromstring(xml_text)
            # Standard RSS 2.0 channel -> item
            channel = root.find("channel")
            if channel is not None:
                for it in channel.findall("item"):
                    title = it.findtext("title", "").strip()
                    link = it.findtext("link", "").strip()
                    desc = it.findtext("description", "").strip()
                    pub_date = it.findtext("pubDate", "").strip()
                    if title and link:
                        items.append({
                            "title": title,
                            "link": link,
                            "description": desc,
                            "pubDate": pub_date
                        })
            else:
                # Atom feed entry -> title, link, summary
                for entry in root.findall("{http://www.w3.org/2005/Atom}entry"):
                    title = entry.findtext("{http://www.w3.org/2005/Atom}title", "").strip()
                    link_elem = entry.find("{http://www.w3.org/2005/Atom}link")
                    link = link_elem.get("href", "").strip() if link_elem is not None else ""
                    summary = entry.findtext("{http://www.w3.org/2005/Atom}summary", "").strip()
                    if title and link:
                        items.append({
                            "title": title,
                            "link": link,
                            "description": summary,
                            "pubDate": ""
                        })
        except Exception as e:
            print(f"[DISCOVERY CRAWLER] RSS parsing error: {e}")
        return items

    @classmethod
    def extract_price_mention(cls, text: str) -> Optional[float]:
        """Extracts candidate dollar price or free indicator from text."""
        t_lower = text.lower()
        if any(k in t_lower for k in ["free admission", "free entry", "100% free", "free ($0)", "free event"]):
            return 0.0

        # Match $XX or $XX.XX
        matches = re.findall(r"\$(\d{1,3}(?:\.\d{2})?)", text)
        if matches:
            try:
                prices = [float(p) for p in matches]
                valid_prices = [p for p in prices if 0 <= p <= 150]
                if valid_prices:
                    return min(valid_prices)
            except Exception:
                pass
        return None

    @classmethod
    def extract_venue_candidate(cls, title: str, text: str) -> Optional[Dict[str, str]]:
        """Detects physical venue mentions in titles or descriptions (e.g. 'at Waterfront Theatre')."""
        combined = f"{title}. {text}"
        
        # Regex patterns for venue indicators
        patterns = [
            r"(?:at|inside|hosted at|taking place at)\s+([A-Z][a-zA-Z0-9'\s&]{2,30}(?:Theatre|Theater|Hall|Centre|Center|Lounge|Stage|Park|Gallery|Plaza|Basement|Cinema|Auditorium|Studios|Rooms))",
            r"([A-Z][a-zA-Z0-9'\s&]{2,25}(?:Theatre|Theater|Music Hall|Cinema|Comedy Club))",
        ]

        for pat in patterns:
            match = re.search(pat, combined)
            if match:
                cand = match.group(1).strip()
                # Exclude false positives
                if cand not in ["The Event", "This Weekend", "Things To Do", "Vancouver", "British Columbia"]:
                    return {
                        "name": cand,
                        "rawMatch": match.group(0)
                    }
        return None

    @classmethod
    def process_article_item(
        cls, source_meta: Dict[str, Any], item: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Analyzes a single article or event item from a discovery source.
        Returns a structured candidate if relevant to events/venues under $50.
        """
        title = item.get("title", "")
        desc = item.get("description", "")
        link = item.get("link", "")
        combined = f"{title} {desc}".lower()

        # Check if event-relevant
        if not any(k in combined for k in cls.EVENT_KEYWORDS):
            return None

        price = cls.extract_price_mention(f"{title} {desc}")
        venue_cand = cls.extract_venue_candidate(title, desc)

        category = "shows"
        if any(k in combined for k in ["music", "concert", "band", "dj", "gig"]):
            category = "music"
        elif any(k in combined for k in ["film", "movie", "cinema", "screening"]):
            category = "cinema"
        elif any(k in combined for k in ["comedy", "improv", "standup", "theatre", "theater"]):
            category = "shows"
        elif any(k in combined for k in ["walk", "park", "garden", "outdoor"]):
            category = "outdoors"
        elif any(k in combined for k in ["trivia", "beer", "drink", "pub"]):
            category = "trivia"

        candidate = {
            "sourceId": source_meta.get("id"),
            "sourceName": source_meta.get("name"),
            "title": title,
            "articleUrl": link,
            "detectedPrice": price,
            "category": category,
            "discoveredVenue": venue_cand["name"] if venue_cand else None,
            "isFestivalCandidate": any(k in combined for k in ["festival", "fest", "car free", "parade", "fringe"]),
            "discoveredAt": datetime.now(timezone.utc).isoformat()
        }

        # If a new venue candidate is spotted, cross-reference and register
        if venue_cand:
            cls._check_and_flag_discovered_venue(venue_cand["name"], source_meta, title, link)

        return candidate

    @classmethod
    def _check_and_flag_discovered_venue(
        cls, venue_name: str, source_meta: Dict[str, Any], sample_event: str, sample_url: str
    ):
        """Cross-references discovered venue against directory and flags new candidate if absent."""
        known = {}
        if os.path.exists(VENUE_DIR_PATH):
            try:
                with open(VENUE_DIR_PATH, "r", encoding="utf-8") as f:
                    known = json.load(f).get("venues", {})
            except Exception:
                pass

        known_lower = set(k.lower() for k in known.keys())
        for v in known.values():
            for a in v.get("aliases", []):
                known_lower.add(a.lower())

        v_lower = venue_name.strip().lower()
        if v_lower in known_lower:
            return

        existing_disc = []
        if os.path.exists(DISCOVERED_VENUES_PATH):
            try:
                with open(DISCOVERED_VENUES_PATH, "r", encoding="utf-8") as f:
                    existing_disc = json.load(f).get("discoveredVenues", [])
            except Exception:
                pass

        if any(d.get("name", "").lower() == v_lower for d in existing_disc):
            return

        slug = re.sub(r"[^\w\s-]", "", v_lower)
        clean_slug = re.sub(r'[-\s]+', '-', slug).strip('-')
        venue_id = f"discovered-{clean_slug}"

        new_entry = {
            "id": venue_id,
            "name": venue_name.strip(),
            "address": f"{venue_name.strip()}, Vancouver, BC",
            "neighborhood": "Vancouver (General)",
            "category": "shows",
            "websiteUrl": sample_url,
            "calendarUrl": sample_url,
            "discoveredVia": source_meta.get("name", "Discovery Feed"),
            "discoverySourceId": source_meta.get("id", "discovery-feed"),
            "sampleEvent": sample_event,
            "status": "pending",
            "discoveredAt": datetime.now(timezone.utc).isoformat(),
            "curatorNote": ""
        }

        existing_disc.append(new_entry)
        try:
            with open(DISCOVERED_VENUES_PATH, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "metadata": {
                            "version": "1.0.0",
                            "description": "Candidate venues detected via discovery feeds and festival programs.",
                            "updatedAt": datetime.now(timezone.utc).isoformat(),
                            "totalDiscovered": len(existing_disc)
                        },
                        "discoveredVenues": existing_disc
                    },
                    f,
                    indent=2,
                    ensure_ascii=False
                )
            print(f"[DISCOVERY CRAWLER] Flagged new venue: {venue_name} (via {source_meta.get('name')})")
        except Exception as e:
            print(f"[DISCOVERY CRAWLER ERROR] Failed to record discovered venue: {e}")

    @classmethod
    def fetch_source_feed(cls, source_meta: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Fetches and parses a single discovery source's RSS feed."""
        rss_url = source_meta.get("rssUrl")
        if not rss_url or requests is None:
            return []

        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Van50-Discovery-Radar/1.2"
            }
            resp = requests.get(rss_url, headers=headers, timeout=10)
            if resp.status_code == 200:
                raw_items = cls.parse_rss_feed_content(resp.text)
                results = []
                for it in raw_items:
                    cand = cls.process_article_item(source_meta, it)
                    if cand:
                        results.append(cand)
                return results
        except Exception as e:
            print(f"[DISCOVERY CRAWLER] Error fetching feed {rss_url}: {e}")
        return []

    @classmethod
    def harvest_all_sources(cls) -> Dict[str, Any]:
        """Runs discovery scan across all registered discovery sources."""
        sources = cls.load_sources()
        all_candidates = []
        source_summaries = {}

        for src in sources:
            src_id = src.get("id")
            if src.get("rssUrl"):
                candidates = cls.fetch_source_feed(src)
                all_candidates.extend(candidates)
                source_summaries[src_id] = len(candidates)

        return {
            "totalSources": len(sources),
            "totalCandidatesFound": len(all_candidates),
            "bySource": source_summaries,
            "candidates": all_candidates,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


if __name__ == "__main__":
    summary = UniversalDiscoveryCrawler.harvest_all_sources()
    print(json.dumps(summary, indent=2))
