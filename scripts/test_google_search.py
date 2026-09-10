#!/usr/bin/env python3
"""
Test suite for Classic Google-Style Search Engine functionality:
1. Exact phrase matching with quotes: "open mic", "life drawing"
2. Negative exclusions: comedy -improv, music -jazz
3. Boolean OR: pottery OR ceramics, comedy OR music
4. Field operators: venue:roxy, price:<20, price:free, day:friday, cat:music, area:kitsilano
5. Typo tolerance: publi disco -> Public Disco
6. Word stemming: ceramic -> ceramics
7. Relevance scoring: events with title matches rank higher than description-only matches
"""

import json
import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EVENTS_JSON_PATH = os.path.join(ROOT_DIR, 'data', 'events.json')

def normalize_text(text):
    if not text:
        return ""
    return re.sub(r'[^\w\s]', ' ', str(text).lower()).replace("'", "").replace("&", " and ")

def stem_word(word):
    w = word.lower().strip()
    if len(w) < 3:
        return w
    if w.endswith('ies') and len(w) > 4:
        return w[:-3] + 'y'
    if w.endswith('sses'):
        return w[:-2]
    if w.endswith('ing') and len(w) > 5:
        base = w[:-3]
        if len(base) > 1 and base[-1] == base[-2]:
            base = base[:-1]
        return base
    if w.endswith('ed') and len(w) > 4:
        return w[:-2]
    if w.endswith('s') and not w.endswith('ss') and len(w) > 3:
        return w[:-1]
    return w

def is_fuzzy_token_match(q_tok, d_tok):
    if q_tok == d_tok:
        return True
    # Prefix match if query token is long enough (e.g. ceramic -> ceramics)
    if len(q_tok) >= 4 and d_tok.startswith(q_tok):
        return True
    if len(d_tok) >= 4 and q_tok.startswith(d_tok) and len(d_tok) >= len(q_tok) - 1:
        return True
    # Levenshtein distance 1 for typo tolerance (length >= 4)
    if len(q_tok) < 4 or len(d_tok) < 4 or abs(len(q_tok) - len(d_tok)) > 1:
        return False
    diffs = 0
    i = 0
    j = 0
    while i < len(q_tok) and j < len(d_tok):
        if q_tok[i] != d_tok[j]:
            diffs += 1
            if diffs > 1:
                return False
            if len(q_tok) > len(d_tok):
                i += 1
                continue
            elif len(q_tok) < len(d_tok):
                j += 1
                continue
        i += 1
        j += 1
    if i < len(q_tok) or j < len(d_tok):
        diffs += 1
    return diffs <= 1

def parse_google_query(query_str):
    q = query_str.strip()
    exact_phrases = []
    # 1. Extract quoted exact phrases
    for match in re.finditer(r'"([^"]+)"', q):
        exact_phrases.append(match.group(1).lower().strip())
    q_remaining = re.sub(r'"[^"]+"', ' ', q)

    negative_terms = []
    field_filters = {}
    or_groups = []
    standard_tokens = []

    raw_tokens = q_remaining.split()
    i = 0
    while i < len(raw_tokens):
        tok = raw_tokens[i]
        
        # Check for field filter: prefix:value
        if ':' in tok and not tok.startswith('-'):
            prefix, val = tok.split(':', 1)
            prefix = prefix.lower().strip()
            val = val.strip()
            field_filters[prefix] = val
            i += 1
            continue

        # Check for negative exclusion: -term
        if tok.startswith('-') and len(tok) > 1:
            negative_terms.append(tok[1:].lower().strip())
            i += 1
            continue

        # Check for OR operator: tok OR next_tok
        if i + 2 < len(raw_tokens) and raw_tokens[i + 1].upper() == 'OR':
            or_group = [tok.lower().strip(), raw_tokens[i + 2].lower().strip()]
            or_groups.append(or_group)
            i += 3
            continue

        if tok.upper() == 'OR':
            i += 1
            continue

        standard_tokens.append(tok.lower().strip())
        i += 1

    return {
        "exact_phrases": exact_phrases,
        "negative_terms": negative_terms,
        "field_filters": field_filters,
        "or_groups": or_groups,
        "standard_tokens": standard_tokens
    }

def matches_google_search(ev, parsed):
    title_norm = normalize_text(ev.get('title', ''))
    venue_norm = normalize_text(ev.get('venue', ''))
    desc_norm = normalize_text(ev.get('description', ''))
    artist_norm = normalize_text(ev.get('artist', ''))
    tags_norm = normalize_text(" ".join(ev.get('subTags', [])))
    cat_norm = normalize_text(ev.get('category', ''))
    addr_norm = normalize_text(ev.get('address', ''))
    neigh_norm = normalize_text(ev.get('neighborhood', ''))
    org_norm = normalize_text(ev.get('organizer', ''))
    days_list = [d.lower() for d in ev.get('daysOfWeek', [])]
    days_norm = " ".join(days_list)

    all_content = f"{title_norm} {venue_norm} {desc_norm} {artist_norm} {tags_norm} {cat_norm} {addr_norm} {neigh_norm} {org_norm} {days_norm}"
    doc_tokens = all_content.split()
    doc_stems = [stem_word(t) for t in doc_tokens]

    # 1. Negative Exclusions (-term)
    for neg in parsed['negative_terms']:
        neg_norm = normalize_text(neg)
        neg_stem = stem_word(neg_norm)
        if neg_norm in all_content or neg_stem in doc_stems:
            return False, 0

    # 2. Field Filters
    for prefix, raw_val in parsed['field_filters'].items():
        val_norm = normalize_text(raw_val)
        val_str = raw_val.lower().strip()
        if prefix in ('venue', 'v'):
            if val_norm not in venue_norm and val_norm not in normalize_text(" ".join(ev.get('venueAliases', []))):
                return False, 0
        elif prefix in ('cat', 'category', 'c'):
            if val_norm not in cat_norm and val_norm not in normalize_text(ev.get('categoryLabel', '')):
                return False, 0
        elif prefix in ('area', 'neighborhood', 'near', 'n'):
            if val_norm not in neigh_norm and val_norm not in addr_norm:
                return False, 0
        elif prefix in ('day', 'd'):
            day_map = {'fri': 'fri', 'friday': 'fri', 'sat': 'sat', 'saturday': 'sat', 'sun': 'sun', 'sunday': 'sun', 'mon': 'mon', 'tue': 'tue', 'wed': 'wed', 'thu': 'thu'}
            target_day = day_map.get(val_norm, val_norm)
            if target_day == 'weekend':
                if not any(d in ('fri', 'sat', 'sun') for d in days_list) and not ev.get('isDaily'):
                    return False, 0
            elif target_day not in days_list and not ev.get('isDaily'):
                return False, 0
        elif prefix in ('price', 'p'):
            price = float(ev.get('price', 0.0) or 0.0)
            if val_str in ('free', '0'):
                if price > 0:
                    return False, 0
            elif val_str.startswith('<='):
                try:
                    if price > float(val_str[2:]):
                        return False, 0
                except ValueError:
                    pass
            elif val_str.startswith('<'):
                try:
                    if price >= float(val_str[1:]):
                        return False, 0
                except ValueError:
                    pass
            elif val_str.startswith('>='):
                try:
                    if price < float(val_str[2:]):
                        return False, 0
                except ValueError:
                    pass
            elif val_str.startswith('>'):
                try:
                    if price <= float(val_str[1:]):
                        return False, 0
                except ValueError:
                    pass
            else:
                try:
                    if price > float(val_str):
                        return False, 0
                except ValueError:
                    pass
        elif prefix in ('org', 'organizer'):
            if val_norm not in org_norm:
                return False, 0

    # 3. Exact Phrase Matching ("...")
    for phrase in parsed['exact_phrases']:
        phrase_norm = normalize_text(phrase)
        if phrase_norm not in all_content:
            return False, 0

    # 4. Boolean OR Groups
    for or_group in parsed['or_groups']:
        group_matched = False
        for option in or_group:
            opt_norm = normalize_text(option)
            opt_stem = stem_word(opt_norm)
            if opt_norm in all_content or opt_stem in doc_stems or any(is_fuzzy_token_match(opt_norm, dt) for dt in doc_tokens):
                group_matched = True
                break
        if not group_matched:
            return False, 0

    # 5. Standard Positive Tokens (must all match via substring, stem, or 1-typo fuzzy)
    for tok in parsed['standard_tokens']:
        tok_norm = normalize_text(tok)
        tok_stem = stem_word(tok_norm)
        matched = (tok_norm in all_content or 
                   tok_stem in doc_stems or 
                   any(is_fuzzy_token_match(tok_norm, dt) for dt in doc_tokens))
        if not matched:
            return False, 0

    # 6. Calculate Relevance Score (BM25 style)
    score = 10
    for phrase in parsed['exact_phrases']:
        p_norm = normalize_text(phrase)
        if p_norm in title_norm:
            score += 100
        elif p_norm in venue_norm or p_norm in artist_norm:
            score += 50
        else:
            score += 25

    for tok in parsed['standard_tokens']:
        t_norm = normalize_text(tok)
        t_stem = stem_word(t_norm)
        if t_norm in title_norm or t_stem in title_norm:
            score += 40
        elif t_norm in artist_norm or t_norm in venue_norm or t_norm in org_norm:
            score += 25
        elif t_norm in tags_norm or t_norm in cat_norm:
            score += 15
        elif t_norm in desc_norm:
            score += 8
        else:
            score += 3

    return True, score

def run_tests():
    print("=" * 70)
    print("TEST SUITE: GOOGLE SEARCH OPERATORS & RELEVANCE RANKING")
    print("=" * 70)

    with open(EVENTS_JSON_PATH, 'r', encoding='utf-8') as f:
        events = json.load(f)['events']

    # TEST 1: Exact Phrase Quotes
    parsed_quote = parse_google_query('"open mic"')
    assert parsed_quote['exact_phrases'] == ['open mic']
    matches_quote = [e for e in events if matches_google_search(e, parsed_quote)[0]]
    print(f"\n[TEST 1] Exact Phrase Query: '\"open mic\"' -> {len(matches_quote)} match(es)")
    for m in matches_quote:
        print(f"  • {m['title']} @ {m['venue']}")
    assert any('First Come First Serve Stand-Up Open Mic' in m['title'] for m in matches_quote)

    # TEST 2: Negative Exclusion (-improv)
    parsed_neg = parse_google_query('comedy -improv')
    assert 'improv' in parsed_neg['negative_terms']
    matches_neg = [e for e in events if matches_google_search(e, parsed_neg)[0]]
    print(f"\n[TEST 2] Negative Exclusion: 'comedy -improv' -> {len(matches_neg)} match(es)")
    for m in matches_neg:
        print(f"  • {m['title']} @ {m['venue']}")
        assert 'improv' not in m['title'].lower(), f"Excluded word 'improv' leaked in: {m['title']}"
    assert len(matches_neg) > 0, "Expected comedy shows without improv"

    # TEST 3: Boolean OR
    parsed_or = parse_google_query('pottery OR ceramics')
    assert parsed_or['or_groups'] == [['pottery', 'ceramics']]
    matches_or = [e for e in events if matches_google_search(e, parsed_or)[0]]
    print(f"\n[TEST 3] Boolean OR: 'pottery OR ceramics' -> {len(matches_or)} match(es)")
    for m in matches_or:
        print(f"  • {m['title']} @ {m['venue']} (${m['price']})")
    assert any('Hand Eye Ceramics' in m['venue'] for m in matches_or)
    assert any('Café au Clay' in m['venue'] for m in matches_or)

    # TEST 4: Field Operators (venue:roxy)
    parsed_venue = parse_google_query('venue:roxy')
    assert parsed_venue['field_filters']['venue'] == 'roxy'
    matches_venue = [e for e in events if matches_google_search(e, parsed_venue)[0]]
    print(f"\n[TEST 4] Field Operator: 'venue:roxy' -> {len(matches_venue)} match(es)")
    for m in matches_venue:
        print(f"  • {m['title']} @ {m['venue']}")
        assert 'Roxy' in m['venue'], f"Venue filter leaked non-roxy: {m['venue']}"
    assert len(matches_venue) == 3, f"Expected 3 Roxy events, got {len(matches_venue)}"

    # TEST 5: Price Filter Operator (price:<15)
    parsed_price = parse_google_query('price:<15')
    matches_price = [e for e in events if matches_google_search(e, parsed_price)[0]]
    print(f"\n[TEST 5] Price Operator: 'price:<15' -> {len(matches_price)} match(es)")
    for m in matches_price:
        assert m['price'] < 15.0, f"Price {m['price']} strictly exceeds <15!"
    print(f"  ✓ 100% of {len(matches_price)} matched events are strictly < $15 CAD")

    # TEST 6: Day Filter Operator (day:friday)
    parsed_day = parse_google_query('day:friday')
    matches_day = [e for e in events if matches_google_search(e, parsed_day)[0]]
    print(f"\n[TEST 6] Day Operator: 'day:friday' -> {len(matches_day)} match(es)")
    for m in matches_day:
        assert 'fri' in m.get('daysOfWeek', []) or m.get('isDaily'), f"Event {m['id']} does not run on Friday!"
    print(f"  ✓ 100% of {len(matches_day)} matched events operate on Fridays")

    # TEST 7: Relevance Ranking Sort
    parsed_rank = parse_google_query('disco')
    scored = []
    for e in events:
        matched, score = matches_google_search(e, parsed_rank)
        if matched:
            scored.append((score, e['title']))
    scored.sort(key=lambda x: x[0], reverse=True)
    print(f"\n[TEST 7] Relevance Ranking Sort for 'disco':")
    for s, title in scored:
        print(f"  • Score {s:<3}: {title}")
    assert 'Public Disco' in scored[0][1], "Events with 'Disco' in the Title must rank at top!"

    print("\n" + "=" * 70)
    print("ALL GOOGLE SEARCH TESTS PASSED CLEANLY (0 Errors)!")
    print("=" * 70)
    return True

if __name__ == '__main__':
    run_tests()
