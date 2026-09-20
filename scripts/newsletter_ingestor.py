#!/usr/bin/env python3
"""
Van50 Automated Newsletter Ingestor
Connects securely to a designated Gmail inbox (or any IMAP provider) using an App Password,
or scans dropped newsletter files (.eml, .html) in data/inbound_newsletters/.

Extracts candidate events (Title, Venue, Date, Price, Ticket Link), enforces the strict
Van50 <= $50.00 CAD budget cap, and stages candidates into data/manual_review_queue.json
for 1-click review and promotion inside Curator Studio.

Zero third-party dependencies required (built with standard library imaplib, email, re, json).
"""

import os
import sys
import re
import json
import imaplib
import email
from email.header import decode_header
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple
from html.parser import HTMLParser

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data")
QUEUE_PATH = os.path.join(DATA_DIR, "manual_review_queue.json")
EVENTS_PATH = os.path.join(DATA_DIR, "events.json")
ARCHIVE_PATH = os.path.join(DATA_DIR, "archived_events.json")
DISCOVERED_VENUES_PATH = os.path.join(DATA_DIR, "discovered_venues.json")
INBOUND_FOLDER = os.path.join(DATA_DIR, "inbound_newsletters")


# ==============================================================================
# 1. ENVIRONMENT & CONFIGURATION LOADER
# ==============================================================================

def load_dotenv():
    """Lightweight .env parser loading variables into os.environ without third-party deps."""
    env_path = os.path.join(BASE_DIR, ".env")
    if not os.path.exists(env_path):
        return
    try:
        with open(env_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
    except Exception as e:
        print(f"[WARN] Failed to read .env: {e}")


def get_gmail_credentials() -> Tuple[Optional[str], Optional[str], str, int, str]:
    """Retrieves Gmail IMAP credentials from environment or fallback config."""
    load_dotenv()

    # Check primary newsletter envs, then fallback to general SMTP/Gmail envs
    user = os.environ.get("NEWSLETTER_GMAIL_USER") or os.environ.get("GMAIL_USER") or os.environ.get("SMTP_USERNAME")
    password = os.environ.get("NEWSLETTER_GMAIL_PASSWORD") or os.environ.get("GMAIL_APP_PASSWORD") or os.environ.get("SMTP_PASSWORD")
    server = os.environ.get("NEWSLETTER_IMAP_SERVER", "imap.gmail.com")
    port = int(os.environ.get("NEWSLETTER_IMAP_PORT", 993))
    folder = os.environ.get("NEWSLETTER_IMAP_FOLDER", "INBOX")

    # Clean password if user pasted spaces from Google's 4x4 app password display format: "abcd efgh ijkl mnop"
    if password:
        password = password.replace(" ", "")

    return user, password, server, port, folder


# ==============================================================================
# 2. VANCOUVER VENUE DIRECTORY & HELPERS
# ==============================================================================

VANCOUVER_VENUES: Dict[str, Dict[str, str]] = {
    "the fox cabaret": {"venue": "The Fox Cabaret", "address": "2321 Main St, Vancouver, BC", "neighborhood": "Mount Pleasant & South Vancouver", "category": "music"},
    "fox cabaret": {"venue": "The Fox Cabaret", "address": "2321 Main St, Vancouver, BC", "neighborhood": "Mount Pleasant & South Vancouver", "category": "music"},
    "the biltmore cabaret": {"venue": "The Biltmore Cabaret", "address": "2755 Prince Edward St, Vancouver, BC", "neighborhood": "Mount Pleasant & South Vancouver", "category": "music"},
    "biltmore cabaret": {"venue": "The Biltmore Cabaret", "address": "2755 Prince Edward St, Vancouver, BC", "neighborhood": "Mount Pleasant & South Vancouver", "category": "music"},
    "hollywood theatre": {"venue": "Hollywood Theatre", "address": "3123 W Broadway, Vancouver, BC", "neighborhood": "Kitsilano, Point Grey & UBC", "category": "music"},
    "rickshaw theatre": {"venue": "Rickshaw Theatre", "address": "254 E Hastings St, Vancouver, BC", "neighborhood": "East Van & Commercial Dr", "category": "music"},
    "rio theatre": {"venue": "The Rio Theatre", "address": "1660 E Broadway, Vancouver, BC", "neighborhood": "East Van & Commercial Dr", "category": "cinema"},
    "the rio": {"venue": "The Rio Theatre", "address": "1660 E Broadway, Vancouver, BC", "neighborhood": "East Van & Commercial Dr", "category": "cinema"},
    "commodore ballroom": {"venue": "Commodore Ballroom", "address": "868 Granville St, Vancouver, BC", "neighborhood": "Downtown, Gastown & Yaletown", "category": "music"},
    "vogue theatre": {"venue": "Vogue Theatre", "address": "918 Granville St, Vancouver, BC", "neighborhood": "Downtown, Gastown & Yaletown", "category": "music"},
    "orpheum": {"venue": "The Orpheum", "address": "601 Smithe St, Vancouver, BC", "neighborhood": "Downtown, Gastown & Yaletown", "category": "music"},
    "queen elizabeth theatre": {"venue": "Queen Elizabeth Theatre", "address": "630 Hamilton St, Vancouver, BC", "neighborhood": "Downtown, Gastown & Yaletown", "category": "shows"},
    "fortune sound club": {"venue": "Fortune Sound Club", "address": "147 E Pender St, Vancouver, BC", "neighborhood": "Chinatown & Strathcona", "category": "nightlife"},
    "little mountain gallery": {"venue": "Little Mountain Gallery", "address": "110 Water St, Vancouver, BC", "neighborhood": "Downtown, Gastown & Yaletown", "category": "shows"},
    "the cultch": {"venue": "The Cultch", "address": "1895 Venables St, Vancouver, BC", "neighborhood": "East Van & Commercial Dr", "category": "shows"},
    "cultch": {"venue": "The Cultch", "address": "1895 Venables St, Vancouver, BC", "neighborhood": "East Van & Commercial Dr", "category": "shows"},
    "historic theatre": {"venue": "The Cultch (Historic Theatre)", "address": "1895 Venables St, Vancouver, BC", "neighborhood": "East Van & Commercial Dr", "category": "shows"},
    "firehall arts centre": {"venue": "Firehall Arts Centre", "address": "280 E Cordova St, Vancouver, BC", "neighborhood": "Chinatown & Strathcona", "category": "shows"},
    "waterfront theatre": {"venue": "Waterfront Theatre", "address": "1412 Cartwright St, Vancouver, BC", "neighborhood": "Granville Island", "category": "shows"},
    "the nest": {"venue": "The Nest (Granville Island)", "address": "1398 Cartwright St, Vancouver, BC", "neighborhood": "Granville Island", "category": "shows"},
    "performance works": {"venue": "Performance Works", "address": "1218 Cartwright St, Vancouver, BC", "neighborhood": "Granville Island", "category": "shows"},
    "the improv centre": {"venue": "The Improv Centre", "address": "1502 Duranleau St, Vancouver, BC", "neighborhood": "Granville Island", "category": "shows"},
    "improv centre": {"venue": "The Improv Centre", "address": "1502 Duranleau St, Vancouver, BC", "neighborhood": "Granville Island", "category": "shows"},
    "wise hall": {"venue": "The WISE Hall", "address": "1882 Adanac St, Vancouver, BC", "neighborhood": "East Van & Commercial Dr", "category": "music"},
    "red gate": {"venue": "Red Gate Arts Society", "address": "1965 Main St, Vancouver, BC", "neighborhood": "Mount Pleasant & South Vancouver", "category": "music"},
    "guilt & co": {"venue": "Guilt & Company", "address": "1 Alexander St, Vancouver, BC", "neighborhood": "Downtown, Gastown & Yaletown", "category": "music"},
    "anza club": {"venue": "The ANZA Club", "address": "3 W 8th Ave, Vancouver, BC", "neighborhood": "Mount Pleasant & South Vancouver", "category": "music"},
    "the birdhouse": {"venue": "The Birdhouse", "address": "44 W 4th Ave, Vancouver, BC", "neighborhood": "Mount Pleasant & South Vancouver", "category": "music"},
    "33 acres": {"venue": "33 Acres Brewing Company", "address": "15 W 8th Ave, Vancouver, BC", "neighborhood": "Mount Pleasant & South Vancouver", "category": "social"},
    "vancouver art gallery": {"venue": "Vancouver Art Gallery", "address": "750 Hornby St, Vancouver, BC", "neighborhood": "Downtown, Gastown & Yaletown", "category": "social"},
    "stanley park": {"venue": "Stanley Park", "address": "Georgia St & Park Dr, Vancouver, BC", "neighborhood": "Downtown, Gastown & Yaletown", "category": "outdoors"},
    "science world": {"venue": "Science World", "address": "1455 Quebec St, Vancouver, BC", "neighborhood": "Mount Pleasant & South Vancouver", "category": "social"}
}


def slugify(text: str) -> str:
    """Creates a clean URL-friendly alphanumeric slug."""
    text = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[-\s]+", "-", text).strip("-")


def decode_mime_header(header_val: Optional[str]) -> str:
    """Decodes MIME encoded-word headers into unicode string."""
    if not header_val:
        return ""
    parts = decode_header(header_val)
    decoded = []
    for part, enc in parts:
        if isinstance(part, bytes):
            enc = enc or "utf-8"
            try:
                decoded.append(part.decode(enc, errors="replace"))
            except Exception:
                decoded.append(part.decode("latin1", errors="replace"))
        else:
            decoded.append(str(part))
    return "".join(decoded).strip()


class SimpleHTMLTextExtractor(HTMLParser):
    """Extracts raw text and hyperlinks from HTML content."""
    def __init__(self):
        super().__init__()
        self.text_chunks = []
        self.links = []
        self.current_tag = ""

    def handle_starttag(self, tag, attrs):
        self.current_tag = tag
        if tag == "a":
            for k, v in attrs:
                if k == "href" and v and v.startswith("http"):
                    self.links.append(v)
        elif tag in {"br", "p", "div", "h1", "h2", "h3", "h4", "li", "hr"}:
            self.text_chunks.append("\n")

    def handle_data(self, data):
        self.text_chunks.append(data)

    def get_text(self) -> str:
        return "".join(self.text_chunks)


def extract_price(text: str) -> Tuple[Optional[float], Optional[str]]:
    """
    Extracts price in CAD. Handles 'Free', '$X', '$X - $Y', '$X adv / $Y door'.
    Returns (price_float, price_label).
    """
    clean = text.lower()
    if any(k in clean for k in ["free", "no cover", "admission free", "$0", "pwyc", "pay-what-you-can", "pay what you can"]):
        return 0.0, "Free ($0)"

    # Look for dollar amounts: $18.50, $25, etc.
    matches = re.findall(r"\$\s*(\d+(?:\.\d{2})?)", text)
    if matches:
        prices = [float(m) for m in matches]
        # In pricing ranges (e.g. $18 adv / $22 door), take the max price to be fee-inclusive and budget-safe
        max_p = max(prices)
        return max_p, f"${max_p:.2f} CAD"

    return None, None


def extract_venue_and_neighborhood(text: str) -> Tuple[str, str, str, str]:
    """
    Identifies known Vancouver venue from block text.
    Returns (venue_name, address, neighborhood, category).
    """
    clean = text.lower()
    for alias, info in VANCOUVER_VENUES.items():
        if alias in clean:
            return info["venue"], info["address"], info["neighborhood"], info["category"]

    # Check discovered_venues.json
    if os.path.exists(DISCOVERED_VENUES_PATH):
        try:
            with open(DISCOVERED_VENUES_PATH, "r", encoding="utf-8") as f:
                d_data = json.load(f)
            for v in d_data.get("discoveredVenues", []):
                v_name = v.get("name", "")
                if v_name and v_name.lower() in clean:
                    return v_name, v.get("address", "Vancouver, BC"), v.get("neighborhood", "Vancouver"), v.get("category", "shows")
        except Exception:
            pass

    # Generic regex fallback: "@ Venue" or "at Venue"
    m = re.search(r"(?:@|at\s+|venue:\s*)([A-Z][A-Za-z0-9'\s&]{2,35})(?:,|\.|\(|\n)", text)
    if m:
        candidate_venue = m.group(1).strip()
        if len(candidate_venue) > 3 and not candidate_venue.lower().startswith("http"):
            return candidate_venue, f"{candidate_venue}, Vancouver, BC", "Vancouver", "shows"

    return "Vancouver Event Space", "Vancouver, BC", "Vancouver", "shows"


def extract_date_schedule(text: str) -> Tuple[str, Optional[str]]:
    """
    Extracts date representation and produces ISO timestamp if possible.
    Returns (dateSchedule_display, startIso).
    """
    # Regex for common date mentions: 'Friday, September 25, 2026', 'Sept 26 at 8:00 PM', 'Oct 3', etc.
    months = r"(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)"
    date_regex = re.compile(rf"(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?({months}\s+\d{{1,2}}(?:,\s+\d{{4}})?)(?:\s+(?:at|from|@)\s+(\d{{1,2}}(?::\d{{2}})?\s*(?:am|pm)?))?", re.IGNORECASE)

    m = date_regex.search(text)
    if m:
        date_str = m.group(1)
        time_str = m.group(2) or "8:00 PM"
        display = f"{date_str} • {time_str}"

        # Attempt ISO parsing
        try:
            full_str = f"{date_str} {time_str}".strip()
            # If year omitted, default to current year
            if not re.search(r"\d{4}", full_str):
                full_str += f" {datetime.now().year}"
            dt = datetime.strptime(full_str, "%B %d %Y %I:%M %p")
            iso = dt.strftime("%Y-%m-%dT%H:%M:%S-07:00")
            return display, iso
        except Exception:
            return display, None

    return "Upcoming Date (Check Listing)", None


# ==============================================================================
# 3. NEWSLETTER EVENT EXTRACTION ENGINE
# ==============================================================================

def extract_candidates_from_content(
    content: str,
    sender: str = "",
    subject: str = "",
    source_type: str = "newsletter"
) -> List[Dict[str, Any]]:
    """
    Parses HTML or plain text newsletter body and extracts structured event candidates.
    Applies strict budget filtering (<= $50 CAD) and extracts block-specific links.
    """
    is_html = "<html" in content.lower() or "<div" in content.lower() or "<p" in content.lower() or "<h2" in content.lower()

    if is_html:
        # Split on common HTML block boundaries: <hr>, <div class="event...", or <h2> / <h3>
        raw_blocks = re.split(r"(?:<hr\b[^>]*>|(?=<div\s+class=[\"'][^\"']*event)|(?=<h[23]\b))", content, flags=re.IGNORECASE)
    else:
        # Plain text: split on horizontal rules or numbered lists
        raw_blocks = re.split(r"(?:\n\s*[-–—_]{3,}\s*\n|\n\s*(?=\d+\.\s+[A-Z])|\n{3,})", content)

    candidates = []

    for raw_block in raw_blocks:
        if not raw_block or len(raw_block.strip()) < 40:
            continue

        # Extract text and block-specific links
        if is_html:
            parser = SimpleHTMLTextExtractor()
            parser.feed(raw_block)
            block_text = parser.get_text().strip()
            block_links = parser.links
        else:
            block_text = raw_block.strip()
            block_links = re.findall(r"https?://[^\s<>\"']+", raw_block)

        if len(block_text) < 40:
            continue

        # Extract Venue, Address & Neighborhood
        venue, address, neighborhood, category = extract_venue_and_neighborhood(block_text)

        # Extract Price & Enforce Strict $50 Budget Cap
        price, price_label = extract_price(block_text)

        # Extract Schedule
        date_schedule, start_iso = extract_date_schedule(block_text)

        # Quality Gate: Block must look like an actual event
        # It must have either:
        # a) a recognized venue, OR
        # b) a recognized date/time AND a recognized price/ticket link
        has_recognized_venue = (venue != "Vancouver Event Space")
        has_recognized_date = (date_schedule != "Upcoming Date (Check Listing)")
        has_price_or_ticket = (price is not None) or any("ticket" in l.lower() or "event" in l.lower() for l in block_links)

        if not (has_recognized_venue or (has_recognized_date and has_price_or_ticket)):
            # This is an intro paragraph, table of contents, or footer
            continue

        lines = [l.strip() for l in block_text.split("\n") if l.strip()]
        if not lines:
            continue

        # Extract title (first line with substance)
        raw_title = lines[0]
        title = re.sub(r"^\d+[\.\)]\s*", "", raw_title)
        title = re.sub(r"^[\W_]+", "", title).strip()

        # If line 0 is an intro line, try line 1
        if any(skip in title.lower() for skip in ["this weekend", "table of contents", "upcoming events", "newsletter", "top recommendations", "subscribe", "view in browser"]):
            if len(lines) > 1:
                title = re.sub(r"^\d+[\.\)]\s*", "", lines[1]).strip()
            else:
                continue

        if len(title) < 5 or len(title) > 120:
            continue

        # If price still None, assign default door estimate for review
        if price is None:
            price = 20.0
            price_label = "$20.00 Door (Verify)"
        elif price > 50.0:
            print(f"[NEWSLETTER FILTER] Skipped '{title}': ${price:.2f} CAD exceeds strict $50 budget limit.")
            continue

        # Block-specific link selection (prefer ticket/event links over general homepage)
        website_url = "https://vancouver.ca/"
        for l in block_links:
            # Skip tracking, social, or unsubscribe links
            if any(bad in l.lower() for bad in ["unsubscribe", "instagram.com", "facebook.com", "twitter.com", "manage-preferences", "view-online"]):
                continue
            website_url = l
            if any(good in l.lower() for good in ["ticket", "event", "show", "buy", "rsvp", "foxcabaret", "cultch", "littlemountain"]):
                website_url = l
                break

        # Clean tracking query parameters
        website_url = re.sub(r"(\?|&)(?:utm_[^&]+|mc_eid=[^&]+|ref=[^&]+)", "", website_url).rstrip("?&")

        event_id = f"newsletter-{slugify(title[:30])}-{slugify(venue[:18])}"

        candidate = {
            "id": event_id,
            "title": title,
            "venue": venue,
            "address": address,
            "neighborhood": neighborhood,
            "attemptedPrice": price,
            "attemptedPriceLabel": price_label,
            "price": price,
            "priceLabel": price_label,
            "websiteUrl": website_url,
            "category": category,
            "dateSchedule": date_schedule,
            "startIso": start_iso,
            "provider": f"Newsletter ({sender.split('@')[0] if '@' in sender else 'Inbox'})",
            "semanticProvider": "Newsletter Ingested",
            "source": "newsletter",
            "newsletterSender": sender,
            "newsletterSubject": subject,
            "flaggedAt": datetime.now(timezone.utc).isoformat(),
            "flagReason": f"📧 Ingested from newsletter: {subject[:70] if subject else 'Inbox Digest'}",
            "reviewStatus": "pending_manual_review",
            "notes": "Ingested from newsletter. Verify ticket link and price before publishing."
        }

        candidates.append(candidate)

    return candidates


# ==============================================================================
# 4. GMAIL IMAP CONNECTION & INBOX FETCH
# ==============================================================================

def connect_gmail_imap(user: str, password: str, host: str = "imap.gmail.com", port: int = 993) -> imaplib.IMAP4_SSL:
    """Establishes SSL IMAP connection to Gmail with descriptive error messaging."""
    try:
        mail = imaplib.IMAP4_SSL(host, port)
        mail.login(user, password)
        return mail
    except imaplib.IMAP4.error as e:
        err_msg = str(e)
        if "AUTHENTICATIONFAILED" in err_msg.upper() or "INVALIDCREDENTIALS" in err_msg.upper():
            raise RuntimeError(
                "Gmail authentication failed. Note: Gmail requires a 16-character Google 'App Password' "
                "(created under Google Account -> Security -> 2-Step Verification -> App Passwords). "
                "Standard account passwords will be rejected by Google IMAP."
            )
        raise RuntimeError(f"IMAP connection failed: {e}")


def fetch_emails_from_gmail(
    user: str,
    password: str,
    server: str = "imap.gmail.com",
    port: int = 993,
    folder: str = "INBOX",
    unread_only: bool = True,
    limit: int = 20,
    mark_as_read: bool = True
) -> List[Tuple[str, str, str, str]]:
    """
    Connects to Gmail, fetches matching emails, and returns:
    List of (sender, subject, date_header, body_content)
    """
    mail = connect_gmail_imap(user, password, server, port)
    results = []

    try:
        status, _ = mail.select(folder)
        if status != "OK":
            raise RuntimeError(f"Could not open mail folder '{folder}'")

        # Search for unseen or all
        search_criterion = "UNSEEN" if unread_only else "ALL"
        status, message_numbers = mail.search(None, search_criterion)
        if status != "OK" or not message_numbers[0]:
            print(f"[NEWSLETTER] No new {search_criterion} messages found in '{folder}'.")
            return []

        msg_ids = message_numbers[0].split()
        # Process latest first
        msg_ids = msg_ids[-limit:]

        print(f"[NEWSLETTER] Found {len(msg_ids)} emails to inspect.")

        for msg_id in msg_ids:
            try:
                res, data = mail.fetch(msg_id, "(RFC822)")
                if res != "OK" or not data:
                    continue

                raw_email = data[0][1]
                msg = email.message_from_bytes(raw_email)

                subject = decode_mime_header(msg.get("Subject"))
                sender = decode_mime_header(msg.get("From"))
                date_hdr = decode_mime_header(msg.get("Date"))

                # Extract body
                body_content = ""
                if msg.is_multipart():
                    for part in msg.walk():
                        content_type = part.get_content_type()
                        content_disp = str(part.get("Content-Disposition", ""))
                        if "attachment" in content_disp:
                            continue

                        if content_type == "text/html":
                            payload = part.get_payload(decode=True)
                            if payload:
                                body_content = payload.decode("utf-8", errors="replace")
                                break
                        elif content_type == "text/plain" and not body_content:
                            payload = part.get_payload(decode=True)
                            if payload:
                                body_content = payload.decode("utf-8", errors="replace")
                else:
                    payload = msg.get_payload(decode=True)
                    if payload:
                        body_content = payload.decode("utf-8", errors="replace")

                if body_content:
                    results.append((sender, subject, date_hdr, body_content))

                # Mark as seen
                if mark_as_read:
                    mail.store(msg_id, "+FLAGS", "\\Seen")

            except Exception as ex:
                print(f"[WARN] Error parsing email ID {msg_id}: {ex}")

    finally:
        try:
            mail.close()
            mail.logout()
        except Exception:
            pass

    return results


# ==============================================================================
# 5. DEDUPLICATION & QUEUE MANAGEMENT
# ==============================================================================

def get_existing_event_ids_and_titles() -> Tuple[set, set]:
    """Loads existing event IDs and titles from live events, review queue, and archive."""
    ids = set()
    titles = set()

    for path, key in [(EVENTS_PATH, "events"), (QUEUE_PATH, "quarantinedEvents"), (ARCHIVE_PATH, "archivedEvents")]:
        if os.path.exists(path):
            try:
                with open(path, "r", encoding="utf-8") as f:
                    db = json.load(f)
                for ev in db.get(key, []):
                    if ev.get("id"):
                        ids.add(ev["id"])
                    if ev.get("title"):
                        titles.add(slugify(ev["title"]))
            except Exception:
                pass

    return ids, titles


def stage_candidates_to_review_queue(candidates: List[Dict[str, Any]], dry_run: bool = False) -> Dict[str, Any]:
    """
    Deduplicates and appends candidates to data/manual_review_queue.json.
    Returns status summary.
    """
    existing_ids, existing_titles = get_existing_event_ids_and_titles()
    new_items = []
    skipped_count = 0

    for cand in candidates:
        slug_title = slugify(cand.get("title", ""))
        if cand.get("id") in existing_ids or slug_title in existing_titles:
            skipped_count += 1
            continue

        new_items.append(cand)
        existing_ids.add(cand["id"])
        existing_titles.add(slug_title)

    if dry_run:
        print(f"[DRY RUN] {len(new_items)} candidates would be queued, {skipped_count} skipped as duplicates.")
        return {
            "queued": len(new_items),
            "skipped": skipped_count,
            "dryRun": True,
            "items": new_items
        }

    if not new_items:
        print(f"[NEWSLETTER] No new unique candidates to queue (all {skipped_count} were existing duplicates).")
        return {"queued": 0, "skipped": skipped_count, "dryRun": False}

    # Load and update manual_review_queue.json
    queue_data = {"metadata": {}, "quarantinedEvents": []}
    if os.path.exists(QUEUE_PATH):
        try:
            with open(QUEUE_PATH, "r", encoding="utf-8") as f:
                queue_data = json.load(f)
        except Exception:
            pass

    q_list = queue_data.get("quarantinedEvents", [])
    q_list.extend(new_items)
    queue_data["quarantinedEvents"] = q_list
    queue_data.setdefault("metadata", {})["pendingCount"] = len(q_list)
    queue_data["metadata"]["updatedAt"] = datetime.now(timezone.utc).isoformat()
    queue_data["metadata"]["lastNewsletterIngestion"] = datetime.now(timezone.utc).isoformat()

    os.makedirs(os.path.dirname(QUEUE_PATH), exist_ok=True)
    with open(QUEUE_PATH, "w", encoding="utf-8") as f:
        json.dump(queue_data, f, indent=2, ensure_ascii=False)

    print(f"[NEWSLETTER OK] Staged {len(new_items)} new candidates into manual review queue ({skipped_count} duplicates skipped).")

    return {
        "queued": len(new_items),
        "skipped": skipped_count,
        "totalPending": len(q_list),
        "dryRun": False,
        "items": new_items
    }


# ==============================================================================
# 6. INBOUND FOLDER & FILE PROCESSING (OFFLINE / DROP-IN)
# ==============================================================================

def process_local_file(file_path: str, dry_run: bool = False) -> Dict[str, Any]:
    """Parses a local .html, .eml, or .txt file containing a newsletter."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    filename = os.path.basename(file_path)
    print(f"[NEWSLETTER] Processing local file: {filename}")

    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        content = f.read()

    sender = "local-import@van50.ca"
    subject = filename.replace(".html", "").replace(".eml", "").replace("_", " ").title()

    # If .eml format, parse headers
    if file_path.endswith(".eml"):
        try:
            msg = email.message_from_string(content)
            sender = decode_mime_header(msg.get("From")) or sender
            subject = decode_mime_header(msg.get("Subject")) or subject
            content = msg.get_payload()
        except Exception:
            pass

    candidates = extract_candidates_from_content(content, sender, subject, source_type="local_file")
    print(f"[NEWSLETTER] Extracted {len(candidates)} candidate events from {filename}.")
    return stage_candidates_to_review_queue(candidates, dry_run=dry_run)


def process_inbound_folder(folder_path: str = INBOUND_FOLDER, dry_run: bool = False) -> Dict[str, Any]:
    """Scans and processes all dropped files in data/inbound_newsletters/."""
    if not os.path.exists(folder_path):
        os.makedirs(folder_path, exist_ok=True)
        return {"files_processed": 0, "queued": 0}

    files = [f for f in os.listdir(folder_path) if f.endswith((".html", ".htm", ".eml", ".txt")) and not f.startswith(".")]
    if not files:
        print(f"[NEWSLETTER] No dropped newsletter files found in {folder_path}.")
        return {"files_processed": 0, "queued": 0}

    total_queued = 0
    total_skipped = 0

    for fname in files:
        fpath = os.path.join(folder_path, fname)
        try:
            res = process_local_file(fpath, dry_run=dry_run)
            total_queued += res.get("queued", 0)
            total_skipped += res.get("skipped", 0)
        except Exception as e:
            print(f"[ERROR] Failed to process {fname}: {e}")

    return {
        "files_processed": len(files),
        "queued": total_queued,
        "skipped": total_skipped
    }


# ==============================================================================
# 7. MAIN ENTRYPOINT & PROGRAMMATIC API
# ==============================================================================

def run_newsletter_ingestion(unread_only: bool = True, limit: int = 20, dry_run: bool = False) -> Dict[str, Any]:
    """Programmatic entrypoint used by Curator Server API and automation pipelines."""
    user, password, server, port, folder = get_gmail_credentials()

    if not user or not password:
        return {
            "success": False,
            "requiresSetup": True,
            "message": (
                "Gmail credentials not configured. Please set NEWSLETTER_GMAIL_USER and "
                "NEWSLETTER_GMAIL_PASSWORD in .env or system environment."
            )
        }

    try:
        emails = fetch_emails_from_gmail(
            user=user,
            password=password,
            server=server,
            port=port,
            folder=folder,
            unread_only=unread_only,
            limit=limit
        )

        all_candidates = []
        for sender, subject, date_hdr, body in emails:
            cands = extract_candidates_from_content(body, sender, subject, source_type="gmail")
            all_candidates.extend(cands)

        queue_res = stage_candidates_to_review_queue(all_candidates, dry_run=dry_run)

        return {
            "success": True,
            "emailsChecked": len(emails),
            "candidatesFound": len(all_candidates),
            "queued": queue_res.get("queued", 0),
            "skipped": queue_res.get("skipped", 0),
            "message": f"Successfully parsed {len(emails)} emails. Staged {queue_res.get('queued', 0)} new event cards."
        }
    except Exception as e:
        print(f"[NEWSLETTER ERROR] Ingestion failed: {e}")
        return {
            "success": False,
            "error": str(e),
            "message": f"Newsletter ingestion failed: {e}"
        }


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="Van50 Automated Newsletter Ingestor")
    parser.add_argument("--dry-run", action="store_true", help="Preview extraction without writing to disk")
    parser.add_argument("--file", type=str, help="Path to local .eml or .html file to ingest")
    parser.add_argument("--scan-folder", action="store_true", help="Process all files in data/inbound_newsletters/")
    parser.add_argument("--status", action="store_true", help="Check IMAP mailbox status and credential validity")
    parser.add_argument("--all-emails", action="store_true", help="Fetch all emails rather than just UNSEEN unread")
    parser.add_argument("--limit", type=int, default=20, help="Maximum emails to inspect (default 20)")

    args = parser.parse_args()

    if args.status:
        u, p, s, prt, fld = get_gmail_credentials()
        if not u or not p:
            print("[STATUS] Gmail credentials NOT set. Copy .env.example to .env to configure.")
            sys.exit(1)
        print(f"[STATUS] Connecting to {s}:{prt} as {u}...")
        try:
            m = connect_gmail_imap(u, p, s, prt)
            m.select(fld)
            _, unseen = m.search(None, "UNSEEN")
            count = len(unseen[0].split()) if unseen[0] else 0
            print(f"[STATUS OK] Connected successfully! Found {count} unread emails in '{fld}'.")
            m.logout()
        except Exception as err:
            print(f"[STATUS ERROR] Connection failed: {err}")
            sys.exit(1)

    elif args.file:
        res = process_local_file(args.file, dry_run=args.dry_run)
        print(json.dumps(res, indent=2))

    elif args.scan_folder:
        res = process_inbound_folder(INBOUND_FOLDER, dry_run=args.dry_run)
        print(json.dumps(res, indent=2))

    else:
        # Live Gmail Ingestion
        res = run_newsletter_ingestion(unread_only=not args.all_emails, limit=args.limit, dry_run=args.dry_run)
        print(json.dumps(res, indent=2))
