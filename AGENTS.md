# Van50 Agent Operating Rules

## Direct Antigravity AI Execution (Zero External Gemini API & Zero Script Surrogates)
1. **No External Gemini APIs**:
   - The Van50 project does NOT use external Gemini API keys or `generativelanguage.googleapis.com` endpoints.
   - All `gemini_*.py` scripts are permanently removed and forbidden.
   - Never run or create scripts that attempt to call Gemini API endpoints or read `GEMINI_API_KEY`.

2. **Antigravity AI QC & Ingestion Engine (Mandatory Single-Event Execution)**:
   - **Mandatory Single-Event (1-at-a-Time) Execution**: Whenever QC AI is requested, it MUST process events sequentially **one event at a time** (Batch Size = 1) across 100% of all events in `data/events.json`. Each event must be evaluated in an isolated execution scope to prevent context window bloat, attention dilution, or "batch fade".
   - **Single-Event Deep QC Runner**: Use `scripts/single_event_deep_qc.py` to isolate each card's evaluation, execute deterministic multi-hop link deepening to Tier 1 checkout carts (e.g. Ticketure, Eventbrite, Square, Showpass), verify out-of-pocket pricing $\le \$50$ CAD, and persist progress atomically after each event.
   - Scripts are strictly authorized for hosting the local server (`curator_server.py 8080`), isolating single-event evaluation harnesses (`scripts/single_event_deep_qc.py`), and reading/writing final JSON files to disk.

3. **Holiday Taxonomy & Discovery Mandate**:
   - Tag events with approved holidays from `data/approved_holidays.json`.
   - If an unapproved holiday is discovered, route it to `pendingHolidays` in `data/approved_holidays.json` and stage the card in `data/manual_review_queue.json` for Curator approval.
   - Include robust keywords/tags for user searching.

4. **AI Workflow Runtime Tracking & Estimation Protocol**:
   - Whenever asked to run **Scout AI**, **QC AI**, or **Quarantine AI**:
     1. **Pre-Run Estimate**: Read `data/ai_runtime_benchmarks.json` and provide an upfront runtime estimate to the user before commencing work (e.g., *"Starting Scout AI. Based on previous runs, this typically takes ~3–5 minutes."*).
     2. **Measure Duration**: Record start timestamp and completion timestamp to calculate exact elapsed duration.
     3. **Persist Benchmark**: Update `data/ai_runtime_benchmarks.json` with the measured duration, timestamp, items processed, and updated rolling average.
     4. **Post-Run Reporting**: Report the elapsed duration in the final summary (e.g., *"Completed in 4m 10s. Recorded duration to benchmark registry for future estimates."*).

5. **Universal Embedded Calendar Widget Extraction Mandate (Last-Resort Fallback)**:
   - When discovering or scraping events for any venue, **never write venue-specific one-off scrapers**.
   - Standard semantic and HTML extraction strategies must **always be attempted first**:
     1. Semantic Schema.org JSON-LD structured data.
     2. Standard CMS event collection lists (Squarespace, WordPress, Webflow).
     3. Standard DOM outbound ticketing links and event card elements.
   - **Last-Resort Fallback Only**: `scripts/calendar_widget_engine.py` (`CalendarWidgetEngine`) is invoked **strictly when Strategies 1–3 find 0 events AND a third-party calendar widget format** (Tockify, Google Calendar embed, Eventbrite embed, Time.ly, DICE.fm, Bandsintown) is explicitly detected in the DOM.
   - This prevents unnecessary external API calls on websites with standard HTML schedules while ensuring zero events are missed when venues embed their calendars via JavaScript widgets.

6. **Scout AI Single-Target (Batch Size = 1 Target) & Natural Yield Protocol**:
   - **Mandatory Single-Target Execution**: Whenever Scout AI is executed, it MUST process discovery targets sequentially **one discrete target at a time** (Batch Size = 1 Target, e.g. 1 Venue from `venues.json`, 1 BIA portal from `discovery_sources.json`, or 1 neighborhood ticketing query).
   - **The Natural Yield Mandate (Zero Quotas)**: NEVER assign arbitrary event quotas ("find 5 events"). Each target must be evaluated to natural exhaustion: ingest whatever genuinely qualifies under $50 CAD (whether 0, 1, 4, or 8 events). Reporting 0 events for a dark/duplicate/overbudget venue is an honest and valuable audit result; forcing filler to meet an arbitrary quota is strictly forbidden.
   - **Atomic Checkpoint & Ledger**: Progress, newly discovered venues, and verified events are committed atomically after each target to `data/scout_target_ledger.json` using `scripts/single_target_scout_runner.py`.
   - **Sequential Audit Ledger Table**: When reporting Scout AI results to the user, present a sequential, un-skipped Markdown Audit Table (`Target #`, `Target Name`, `Type`, `Inspected`, `Natural Yield (≤ $50)`, `Audit Status & Notes`). No numbers may be skipped.

7. **Universal Multi-Entity Quarantine AI Protocol (Events, Venues, Festivals, Sources, Holidays, Instructions)**:
   - **Comprehensive Entity Evaluation Mandate**: Whenever Quarantine AI is executed, or the AI is asked to "go through Quarantine", it MUST evaluate **all quarantined and pending entities across all 6 quarantine streams**:
     1. **Quarantined Events** (`data/manual_review_queue.json`): Mandatory single-event execution (Batch Size = 1 Event) across 100% of items, resolving all 20 dimensions. Valid cards are graduated to `data/events.json`, overbudget items ($> \$50$ CAD) are archived to `data/archived_events.json`, and cards awaiting human curator policy remain cleanly staged.
     2. **Candidate & Quarantined Venues** (`data/discovered_venues.json`): Evaluates all pending venue candidates one-by-one. Cross-references against `data/curator_instructions.json`, checks whether the venue is already cataloged in `data/venues.json` (or is an attraction within an existing civic park/venue), checks physical address, and validates live calendar URLs. Approves qualified venues to `data/venues.json` or dismisses redundant/ineligible candidates with explicit reasons (flipping `status: "approved"` or `"dismissed"`, never leaving them stranded in `"pending"`).
     3. **Candidate & Quarantined Sources** (`data/discovered_sources.json`): Evaluates pending event discovery portals, blogs, and BIAs against Vancouver geographic and $\le \$50$ CAD coverage criteria. Approves to `data/discovery_sources.json` or dismisses with notes.
     4. **Candidate & Quarantined Festivals** (`data/festivals.json`): Evaluates pending festival affiliations, verifying dates, organizer domains, and admission policies.
     5. **Pending Holidays** (`data/approved_holidays.json` `pendingHolidays`): Resolves unapproved holiday candidate tags, either moving them to approved holidays or reclassifying event tags.
     6. **Pending Curator Instructions** (`data/curator_instructions.json`): Audits all instructions with `status: "pending"`. Applies instructed actions to the target entity, distills algorithmic rules into `data/curator_learned_rules.json`, and marks the instruction as `status: "resolved"` (`applied: true`).
   - **Atomic Checkpoints & Multi-Entity Ledger**: Progress is saved atomically after each entity. Results are reported in a unified, multi-section Markdown Audit Table covering all processed queues (`Events`, `Venues`, `Sources`, `Festivals`, `Holidays`, `Instructions`). No numbers may be skipped.

8. **Civic & Municipal URL Anti-Bot Resolution Mandate (Option C - Non-Blocking Destination Guide Standard)**:
   - **Zero Cloudflare-Blocked Municipal Endpoints**: The City of Vancouver website (`vancouver.ca`) protects its ASP.NET pages (`*.aspx`) behind Cloudflare WAF anti-bot rules that issue HTTP 403 Forbidden / challenge screens when clicked cross-site from web applications.
   - **Strict Prohibition**: Never link event cards or venue records to `vancouver.ca/.../*.aspx` or other municipal server endpoints that trip bot challenges on click.
   - **Canonical Non-Blocking Destination Guides**: For all civic parks, beaches, public seawalls, gardens, pitch & putt courses, and municipal recreation facilities, Scout AI, QC AI, and Quarantine AI MUST link to verified, non-blocking official destination or dedicated visitor guides:
     - **Stanley Park & Seawall**: `https://www.destinationvancouver.com/things-to-do/listings/stanley-park` or `https://stanleyparkvan.com/`
     - **Queen Elizabeth Park & Quarry Gardens**: `https://www.destinationvancouver.com/things-to-do/listings/queen-elizabeth-park`
     - **Bloedel Conservatory**: `https://vandusengarden.org/plan-your-visit/bloedel-conservatory/`
     - **Stanley Park Pitch & Putt**: `https://stanleyparkvan.com/stanley-park-van-sport-facility-pitch-putt-golf-course.html`
     - **Queen Elizabeth Park Pitch & Putt**: `https://par3nearme.com/course/queen-elizabeth-park-pitch-and-putt/`
     - **Rupert Park Pitch & Putt**: `https://par3nearme.com/course/rupert-park-pitch-and-putt/`
     - **VanDusen Botanical Garden**: `https://vandusengarden.org/`
     - **Roundhouse Community Centre**: `https://www.roundhouse.ca/`
     - **The Annex (Civic Theatres)**: `https://vancouvercivictheatres.com/venues/annex/`
   - **Automated AI Remediation**:
     - **Scout AI**: When discovering municipal venues or public events, directly resolve ticket/details links to the clean destination guide URL.
     - **QC AI**: Whenever auditing active event cards, flag and auto-heal any legacy `vancouver.ca/*.aspx` links to the corresponding non-blocking destination URL.
     - **Quarantine AI**: Substitute any legacy `.aspx` links with their clean destination guide URLs before graduating cards to `data/events.json`.

9. **Admission Price Floor vs. Optional Add-On Protocol (Zero Deceptive Price Floors)**:
   - **Core Principle**: Optional equipment rentals, tasting tent tokens, caddies, shoe rentals, skate rentals, and coat check fees must NEVER define the minimum entry floor or headline price of an event.
   - **Deceptive Price Floor Prohibition**: If general admission is $18.27 and club rentals are $2.86, displaying `$2.86 – $18.27` is strictly forbidden because it misleads consumers into believing entry is $2.86.
   - **Mandatory Pricing Formula**:
     - **Minimum Floor**: Minimum Base Admission Price (`ev.price` or cheapest active base admission tier).
     - **Upper Ceiling**: Base Admission Price + Max Optional Add-On (`baseMax + maxAddon`).
     - **Example**: Queen Elizabeth Pitch & Putt with $18.27 Adult Green Fee + $2.86 Club Rental MUST display as `$18.27 – $21.13 all-in` (never `$2.86 – $18.27`).
     - **Example**: UBC Apple Festival with $15.00 General Admission + $12.00 Apple Tasting Tent Add-On MUST display as `$15.00 – $27.00 all-in`.
   - **Data Tagging**:
     - Any optional rental or add-on tier in `tiers` or `ticket_tiers` MUST be flagged with `"isAddon": true` and `"is_addon": true`.
     - In synthetic custom tiers: `tier_custom_is_addon_X: true`.
   - **AI Agent Execution Roles**:
     - **Scout AI**: When discovering events with optional add-ons, tag the add-on tiers with `is_addon: true`, ensure `price` represents the true base admission, and verify that `Base + Add-On` respects the ≤ $50 CAD ceiling.
     - **QC AI**: During single-event audits, verify that no add-on tier defines the event's minimum price floor or causes `effectiveMin` to fall below actual admission.
     - **Quarantine AI**: If a quarantined card has inverted add-on pricing, re-calculate the range using `Floor = Base Admission` and `Ceiling = Base Admission + Add-On` before graduating cards to `data/events.json`.

10. **Dimension-by-Dimension Audit & Timestamp Protocol (Complete 37-Dimension Architecture)**:
    - **Granular Scoping Mandate**: When QC AI audits an event, it MUST NOT issue a blanket or superficial pass. It must systematically inspect each of the 37 discrete dimensions (D1 Title through D37 Civic Provider Rules) sequentially.
    - **Dimension Audit Metadata Schema (`dimension_audit`)**:
      - Each event in `data/events.json` maintains a structured `dimension_audit` object with `last_full_qc_at`, `auditor`, `dimensions_score` (`37/37`), and a `dimensions` map.
      - For each dimension (D1..D37), QC AI records `confirmed_at` (ISO timestamp), `status` (`verified`, `calibrated`, `standardized`, `not_applicable`), and descriptive validation values or notes.
    - **Link Tier Hierarchy & Best Available Link Standard (D22–D26)**:
      - Every event maintains dedicated dimensional slots for each tier:
        - **D22**: Tier 1 Link (`tier1_checkout`) — Direct Ticketing Checkout Cart (Eventbrite, Showpass, Square, Ticketweb, Spektrix, Ticketmaster).
        - **D23**: Tier 2 Link (`tier2_event_page`) — Dedicated Individual Event Page on venue/promoter domain.
        - **D24**: Tier 3 Link (`tier3_calendar`) — Venue Master Calendar / Schedule Directory (`/events`, `/calendar`).
        - **D25**: Tier 4 Link (`tier4_civic_destination`) — Option C Non-Blocking Civic Destination Guide (Destination Vancouver, Stanley Park Van, etc.).
        - **D26**: Tier 5 Link (`tier5_venue_home`) — Venue Master Homepage.
      - **Best Available Link Rule**: The app UI automatically links to the highest tier present (`T1 > T2 > T3 > T4 > T5`) via `best_available_link` and `best_link_tier`. Whenever Scout AI or QC AI discovers a superior tier link, it populates that tier slot and dynamically elevates `best_available_link`.
    - **Granular Pricing Invariants & The $50 Hard Ceiling Anchor (D27–D32)**:
      - Pricing is tracked across 6 discrete dimensions:
        - **D27**: `price_base` — Minimum base admission floor.
        - **D28**: `price_tax` — Estimated or explicit tax component.
        - **D29**: `price_fees` — Platform / facility / service fees.
        - **D30**: `price_all_in` — **The Primary Van50 Budget Anchor ($\le \$50.00$ CAD)**. Sum of base + tax + mandatory fees.
        - **D31**: `other_cost_label` — Name of optional ancillary add-on (e.g. Club Rental, Skate Rental, Tasting Tokens, Coat Check).
        - **D32**: `other_cost_price` — Numeric price of optional add-on.
      - **AI Clarity Directive**: The sub-components (`base`, `tax`, `fees`, `other`) provide rich display transparency to consumers, but `price_all_in` is the absolute qualifying gate. The AI must never allow component breakdowns to distract it from verifying that `price_all_in \le \$50.00 CAD`.
    - **Pricing Models & Consumption Hybrid Standard (D10)**:
      - Events with food, drink, or entertainment hybrids must be classified with accurate operational models:
        - `cover_plus_consumption`: Flat cover/door charge for entertainment; food and drink purchases are optional inside (e.g. Guilt & Co., jazz lounges, board game cafes). `price_all_in` represents entry cover; drink/food benchmarks are recorded under D13.
        - `ticket_plus_mandatory_minimum`: Ticket price plus a required minimum beverage or food purchase (e.g. comedy clubs with 2-drink minimums). The AI **MUST** sum the ticket + mandatory minimum into `price_all_in` to verify the $\le \$50$ CAD ceiling.
        - `admission_plus_tokens`: Gate admission plus optional tasting tokens or food packages (e.g. food & beer festivals, night markets). Gate entry is `price_base`; tasting packages are tagged as add-ons in D31/D32.
        - Standard models: `flat_ticket`, `free_access`, `tiered_admission`, `pay_what_you_can`, `donation`, `paid_drop_in`.
    - **Granular Named Pricing Tier Slots & Anti-Laziness Guard (D12)**:
      - To prevent LLM batch laziness, tiers are not evaluated as a generic list, but as **explicit, named dimensional slots**:
        - `adult`: General admission / standard adult ticket floor.
        - `student`: Dedicated student / youth discount tier.
        - `senior`: Dedicated senior / elder (65+) discount tier.
        - `member`: Museum, society, or patron member admission.
        - `non_member`: General public non-member tier.
        - `family`: Family or group admission bundle.
        - `other_1_name` / `other_1_cost`: e.g. "Online Advance", "Early Bird", "Rush Seating".
        - `other_2_name` / `other_2_cost`: e.g. "Door Admission", "Balcony Seating".
        - `tier_count_verified`: Total count of distinct tiers detected on checkout page.
      - **Tier-Fee-Addon Interaction Rule**: Tier prices represent base ticket costs. Mandatory ticketing fees and taxes apply on top. Optional rentals/add-ons remain strictly in D31/D32 and must never be conflated with entry tiers. Any active tier displayed must independently satisfy `all_in \le \$50.00 CAD`.
    - **Showing-Level Lifecycle, Auto-Archiving & Rollover Standard (D21 & D20)**:
      - Individual showings in `showings: [...]` maintain per-showing statuses: `active`, `sold_out`, `concluded`, `cancelled`.
      - **Concluded Showings Archival**: Past showings (where date/end-time < Vancouver local time) are automatically excised from `showings` and preserved in `archived_showings`. They are completely hidden from the consumer app UI.
      - **Dynamic Rollover**: The event's headline `date`, `time`, and `best_available_link` automatically advance to the earliest active showing in `showings`.
      - **New Showing Ingestion**: When Scout AI or QC AI audits a venue and identifies newly published upcoming screening/performance dates, it appends them to `showings` with `status: "active"`.
      - **Event-Level Lifecycle**: An event card is marked `concluded` strictly when 100% of showings have concluded; it is marked `sold_out` strictly when 100% of future showings are sold out.
    - **Data Provenance, Curator Lock & Rich-Evidence AI Appeal Channel (D33)**:
      - `curator_locked`: When true, autonomous scrapers must preserve curator-crafted copy and manual pricing overrides.
      - **Mandatory AI Appeal Protocol**: If an AI discovers live empirical truth that conflicts with a Curator Lock or Curator Instruction (e.g. ticket price raised to $58 CAD, event cancelled/postponed, venue closed, link dead 404), the AI MUST NOT silently fail or overwrite the lock.
      - It records an **AI Appeal** into `manual_review_queue.json` (`aiCuratorAppeals`) containing **explicit empirical evidence**:
        - `evidence_source_type`: `direct_ticket_link`, `email_newsletter`, `social_post`, `venue_calendar`.
        - `source_url`: Direct clickable link to the page where the issue was detected.
        - `image_url` / `screenshot_path`: Visual capture (email graphic, screenshot) proving the change.
        - `raw_snippet_quote`: Exact verbatim quote or pricing line from the source DOM or email.
        - `detailed_rationale`: Clear explanation of the conflict between Curator directive and live reality.
        - `ai_recommendation`: Specific actionable fix (e.g. "Archive event: checkout price $58 exceeds $50 ceiling").
      - Staged in Curator Studio for one-click curator resolution: `Uphold Lock`, `Revise Guidance`, or `Accept AI Recommendation`.
    - **Zero Caching Wiggle Room Mandate**:
      - AIs are strictly forbidden from skipping link checks, using synthetic hash caches, or assuming past states. Every scheduled audit must actively inspect target URLs and live DOM payloads.
    - **Multi-City Federation Readiness (City50 Standard, D34–D37)**:
      - **D34**: `geo_jurisdiction` (`city_id: "yvr"`, `metro_name: "Metro Vancouver"`, `municipality`, `province_state: "BC"`, `country: "CA"`).
      - **D35**: `currency_standard` (`currency: "CAD"`, `currency_symbol: "$"`, `budget_ceiling: 50.00`).
      - **D36**: `iana_timezone` (`America/Vancouver`).
      - **D37**: `civic_provider_rules` (`Destination Vancouver / Civic Official Guide`, `blocks_cloudflared_aspx: true`).


