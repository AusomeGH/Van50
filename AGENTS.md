# Van50 Agent Operating Rules

## Direct Antigravity AI Execution (Zero External Gemini API & Zero Script Surrogates)
1. **No External Gemini APIs**:
   - The Van50 project does NOT use external Gemini API keys or `generativelanguage.googleapis.com` endpoints.
   - All `gemini_*.py` scripts are permanently removed and forbidden.
   - Never run or create scripts that attempt to call Gemini API endpoints or read `GEMINI_API_KEY`.

2. **Antigravity AI QC & Ingestion Engine (Mandatory 100% Full-Sweep Starting at Event #1)**:
   - **Mandatory 100% Full-Sweep Starting at Event #1**: Whenever QC AI is requested, it MUST start at Event #1 and evaluate 100% of all events in `data/events.json` sequentially **one event at a time** (Batch Size = 1 Event) through to the very last event in the catalog. Partially executed runs, stopping after a few events, or spot-checking are strictly prohibited. Every QC AI invocation sweeps the complete active catalog from beginning to end.
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

6. **Scout AI Single-Target (Batch Size = 1 Target) & Mandatory Full-Sweep Protocol**:
   - **Mandatory 100% Full-Sweep Starting at Target #1**: Every time Scout AI is invoked, it MUST start at Target #1 and evaluate 100% of all registered targets (Target 1 through Target N, across both `venues.json` and `discovery_sources.json`) sequentially **one discrete target at a time** (Batch Size = 1 Target). Partially executed runs, stopping after a few targets, or skipping targets are strictly prohibited.
   - **The Natural Yield Mandate (Zero Quotas)**: NEVER assign arbitrary event quotas ("find 5 events"). Each target must be evaluated to natural exhaustion: ingest whatever genuinely qualifies under $50 CAD (whether 0, 1, 4, or 8 events). Reporting 0 events for a dark/duplicate/overbudget venue is an honest and valuable audit result; forcing filler to meet an arbitrary quota is strictly forbidden.
   - **Atomic Checkpoint & Ledger**: Progress, newly discovered venues, and verified events are committed atomically after each target to `data/events.json`, `data/scout_target_ledger.json`, and stamped directly on the venue/source using `scripts/single_target_scout_runner.py`.
   - **Sequential Audit Ledger Table**: When reporting Scout AI results to the user, present a sequential, un-skipped Markdown Audit Table (`Target #`, `Target Name`, `Type`, `Inspected`, `Natural Yield (≤ $50)`, `Audit Status & Notes`). Target numbering MUST start at #1 and proceed continuously without gaps to the end of the registry.

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

10. **Dimension-by-Dimension Audit & Timestamp Protocol (The 50 Dimensions of Van50 / City50)**:
    - **Granular Scoping Mandate**: When QC AI audits an event, it MUST NOT issue a blanket or superficial pass. It must systematically inspect each of the 50 discrete dimensions (D1 Title through D50 Civic Provider Rules) sequentially.
    - **Dimension Audit Metadata Schema (`dimension_audit`)**:
      - Each event in `data/events.json` maintains a structured `dimension_audit` object with `last_full_qc_at`, `auditor`, `dimensions_score` (`50/50`), and a `dimensions` map.
      - For each dimension (D1..D50), QC AI records `confirmed_at` (ISO timestamp), `status` (`verified`, `calibrated`, `standardized`, `not_applicable`, `none_available`), and descriptive validation values or notes.
    - **Schedule & Identity Standard (D1–D6)**:
      - **D1**: `title` — Curated title of the outing or event.
      - **D2**: `date` — Headline active date (`YYYY-MM-DD`). Automatically advances to next showing on rollover.
      - **D3**: `time` — Headline active start time (`HH:MM` 24h or 12h formatted).
      - **D4**: `weekly_hours` — Day-by-day structured operating hours map (`mon` through `sun`).
      - **D5**: `schedule_string` — Human-readable date/time synopsis (e.g. "Thu & Fri 7:00 PM, Sat 2:00 PM").
      - **D6**: `frequency` — Cadence classification (`one-off`, `limited-run`, `weekly`, `monthly`, `daily`, `perennial_drop_in`).
    - **Taxonomy, Space & Multi-Category Standard (D7–D10)**:
      - **D7**: `category` & `categories` — **Multi-Category Architecture**:
        - **Invariant**: Every event belongs to **at least 1 category ($\ge 1$)**, with **NO UPPER LIMIT** on the maximum number of applicable categories.
        - **Public Curated Tabs (`primary_category`)**: Users are presented with strictly 8 curated, clutter-free top-level filter tabs: `shows` (Comedy & Stage), `music`, `cinema`, `festivals`, `markets`, `outdoors`, `social` (Social & Arts), and `free-public-access`.
        - **Backend Semantic Categories (`categories`)**: To power deep search discovery without cluttering public UI buttons, AIs index the event across all applicable granular categories:
          - `films_screenings`, `theatre_performing_arts`, `comedy_standup_improv`, `live_music_concerts`, `dance_parties_club_nights`, `visual_arts_galleries`, `workshops_classes_crafts`, `trivia_games_boardgames`, `food_drink_tastings`, `markets_popups_bazaars`, `tours_walks_heritage`, `sports_fitness_recreation`, `nature_parks_gardens`, `wellness_movement_yoga`, `literary_spoken_word_poetry`, `community_civic_social`, `festivals_celebrations`, `family_youth_activities`, `free_public_access`.
        - **Search & Discovery Guarantee**: Keyword queries (e.g. "trivia", "pottery", "crafts", "improv", "walking tour") match instantly against `ev.categories` without exposing dozens of tiny micro-buttons.
      - **D8**: `location` — Venue name, validated street address, and geographic coordinate pair.
      - **D9**: `access_model` — Physical boundary type (`fenced_facility`, `open_public_space`, `public_realm`, `registered_ticketed_venue`).
      - **D10**: `pricing_model` — Economic entry model (`free_access`, `flat_ticket`, `sliding_scale`, `tiered_admission`, `pay_what_you_can`, `donation_entry`).
    - **Unique Sequential Tier Numbers & Anti-Laziness Guard (D11–D21)**:
      - To prevent LLM batch laziness, each specific price tier occupies its own independent sequential dimension slot:
        - **D11**: `tier_adult` — General admission / standard adult base ticket floor.
        - **D12**: `tier_student` — Dedicated student / youth discount tier (`none_available` if none).
        - **D13**: `tier_senior` — Dedicated senior / elder (65+) discount tier (`none_available` if none).
        - **D14**: `tier_member` — Museum, gallery, or patron member admission (`none_available` if none).
        - **D15**: `tier_non_member` — General public non-member tier (`none_available` if none).
        - **D16**: `tier_family` — Family or group admission bundle (`none_available` if none).
        - **D17**: `tier_other_1_name` — Ancillary ticket name (e.g. "Online Advance", "Early Bird", "Rush Seating").
        - **D18**: `tier_other_1_cost` — Ancillary ticket price.
        - **D19**: `tier_other_2_name` — Secondary ancillary ticket name (e.g. "Door Admission", "Balcony").
        - **D20**: `tier_other_2_cost` — Secondary ancillary ticket price.
        - **D21**: `tier_count_verified` — Verified integer count of all distinct ticket types seen on the live checkout page.
      - **Tier Invariant Rule**: Tier prices represent base ticket costs. Taxes and platform fees apply on top. Optional equipment rentals/tokens remain strictly in D26/D27. Every active tier displayed must independently satisfy `all_in \le \$50.00 CAD`.
    - **Granular Pricing Invariants & The Benchmark Adult GA Anchor (D22–D28)**:
      - **D22**: `price_base` — Minimum base admission floor (Standard Adult GA).
      - **D23**: `price_tax` — Estimated or explicit tax component.
      - **D24**: `price_fees` — Platform / facility / service ticketing fees.
      - **D25**: `price_all_in` — **The Primary Van50 Budget Anchor ($\le \$50.00$ CAD)**. Sum of base + tax + mandatory fees for Standard Adult Admission.
      - **D26**: `other_cost_label` — Optional add-on label (Club Rental, Skate Rental, Tasting Tokens, Coat Check).
      - **D27**: `other_cost_price` — Numeric price of optional add-on.
      - **D28**: `spend_benchmarks` — Out-of-pocket concession, bar, and meal price benchmarks for the venue.
      - **AI Clarity & Sibling Tier Adjustment Directive**:
        - **The Adult Anchor**: Standard Adult GA admission is the universal baseline benchmark (`D11` and `D22–D25`).
        - **Simultaneous Sibling Tier Audits**: When the AI inspects a ticketing checkout cart, it does NOT discard or freeze discount tiers. It inspects all live tiers in parallel, updating `D12` (Student), `D13` (Senior), `D14` (Member), `D15` (Non-Member), and `D16` (Family) alongside the Adult GA benchmark.
        - **Zero Confusion Mandate**: Because each tier has its own dedicated numbered dimension slot (D11–D20), the AI never conflates discounts with the adult floor. Sibling tiers adjust dynamically whenever checkout prices or ticketing fees shift.
    - **Real-Time Lifecycle, Live "Happening Now" Display & Auto-Archiving Standard (D29–D31)**:
      - **D29**: `operational_status` — Event lifecycle state (`scheduled`, `concluded`, `sold_out`, `rescheduled`, `postponed`, `cancelled`).
      - **D30**: `active_showings` — Array of active and upcoming showings (`date`, `start_time`, `end_time`, `ticket_url`, `status`).
      - **D31**: `archived_showings` — Past concluded showings, automatically excised from active view and stored historically.
      - **Real-Time "Happening Now" Detection**:
        - When current local time is within an event's active window (`startTime <= now < endTime` today), the app renders an animated `"Happening Now"` live badge with a glowing green pulse dot (`.live-pulse-dot`).
      - **Minute-by-Minute Automatic Removal**:
        - The frontend runs a continuous 60-second background lifecycle loop (`setInterval(applyFiltersAndRender, 60000)`).
        - The exact minute an event reaches its closing time (`now >= closingTime`), `getEventClosingTimeToday` signals completion, `isEventInPast` returns `true`, and the card is automatically removed from user display without requiring a page refresh.
      - **Multi-Showing Dynamic Rollover**:
        - For multi-showing events, as each individual showing ends, `scripts/hourly_status_monitor.py` archives that showing to `archived_showings` and seamlessly rolls the headline date, time, and ticket link forward to the next scheduled showing.
        - An event card is marked `concluded` strictly when 100% of showings have concluded; it is marked `sold_out` strictly when 100% of future showings are sold out.
      - **New Showing Ingestion**: When Scout AI or QC AI audits a venue and identifies newly published upcoming screening/performance dates, it appends them to `showings` with `status: "active"`.
    - **Link Tier Hierarchy & Best Available Link Standard (D32–D37)**:
      - **D32**: Tier 1 Link (`tier1_checkout`) — Direct Ticketing Checkout Cart (Eventbrite, Showpass, Square, Ticketweb, Spektrix, Ticketmaster).
      - **D33**: Tier 2 Link (`tier2_event_page`) — Dedicated Individual Event Page on venue/promoter domain.
      - **D34**: Tier 3 Link (`tier3_calendar`) — Venue Master Calendar / Schedule Directory (`/events`, `/calendar`).
      - **D35**: Tier 4 Link (`tier4_civic_destination`) — Option C Non-Blocking Civic Destination Guide (Destination Vancouver, Stanley Park Van, etc.).
      - **D36**: Tier 5 Link (`tier5_venue_home`) — Venue Master Homepage.
      - **D37**: `best_available_link` — Automatically resolves to the highest tier present (`T1 > T2 > T3 > T4 > T5`).
    - **Editorial, Audience & Weather Resilience (D38–D43)**:
      - **D38**: `ticket_provider` — Platform or access provider name.
      - **D39**: `description` — Curated editorial synopsis.
      - **D40**: `lineup` — Confirmed performers, comics, or speakers.
      - **D41**: `restrictions` — Age & entry restrictions (e.g. 19+ with 2 pieces of ID, All Ages).
      - **D42**: `booking_protocol` — Entry & reservation protocol (`walk_in_only`, `advance_ticket_required`, `advance_rsvp_recommended`, `table_reservation_seated`, `first_come_first_served`).
      - **D43**: `environment_type` — Weather & shelter resilience (`indoor`, `covered_patio`, `outdoor_rain_or_shine`, `outdoor_weather_dependent`).
    - **Governance, Provenance & Rich-Evidence AI Appeal Channel (D44–D46)**:
      - **D44**: `data_provenance` — Ingestion origin (`verified_scout`, `newsletter_feed`, `curator_studio`).
      - **D45**: `curator_lock` — Curator Lock state (`true`/`false`). Preserves human editorial copy.
      - **D46**: `ai_curator_appeal` — Mandatory AI Appeal Channel. When live reality conflicts with a Curator Lock, the AI stages an appeal in `manual_review_queue.json` (`aiCuratorAppeals`) with explicit empirical evidence (`source_type`, direct clickable link, screenshot / email image, verbatim quote snippet, and AI recommendation).
    - **Multi-City Federation Readiness (City50 Standard, D47–D50)**:
      - **D47**: `geo_jurisdiction` (`city_id: "yvr"`, `metro_name: "Metro Vancouver"`, `municipality`, `province_state: "BC"`, `country: "CA"`).
      - **D48**: `currency_standard` (`currency: "CAD"`, `currency_symbol: "$"`, `budget_ceiling: 50.00`).
      - **D49**: `iana_timezone` (`America/Vancouver`).
      - **D50**: `civic_provider_rules` (`Destination Vancouver / Civic Official Guide`, `blocks_cloudflared_aspx: true`).
    - **Zero Caching Wiggle Room Mandate**:
      - AIs are strictly forbidden from skipping link checks, using synthetic hash caches, or assuming past states. Every scheduled audit must actively inspect target URLs and live DOM payloads.

11. **Autonomous Newsletter Auto-Subscription Protocol (Batch Size = 1 Venue & Mandatory Full-Sweep)**:
    - **Mandatory 100% Full-Sweep Starting at Venue #1**: Whenever newsletter auto-subscription is invoked, it MUST start at Venue #1 and sweep 100% of all pending signups in `data/manual_review_queue.json` sequentially one venue at a time (Batch Size = 1 Venue) through to the very last venue in the queue. Zero partial runs or early halting.
    - **Multi-Platform Form Handlers**: Submits payloads across supported formats (OpenDate API, Mailchimp hosted & embedded endpoints, Divi modules, WPForms, WordPress, Keela, Zeffy, etc.) with `Van50.Submit@gmail.com`.
    - **Automated Double Opt-In Handshake**: Connects to `Van50.Submit@gmail.com` via IMAP, detects confirmation emails, extracts activation URLs, and issues HTTP verification GET requests to complete the subscription handshake.
    - **Atomic Checkpoint & Registry Persistence**: Commits state atomically after every single venue to `data/subscribed_venues.json` and `data/manual_review_queue.json` (`pendingNewsletterSignups`).
    - **Sequential Audit Ledger Report**: Produces a sequential Markdown audit table (`newsletter_autosignup_report.md`) detailing venue name, platform method, status, and diagnostic outcome.

12. **Production Release & Environment Isolation Protocol (`main` vs `production`)**:
    - **Development vs. Production Separation**:
      - `main`: Active development, local experimenting, and daily pipeline updates.
      - `production`: Dedicated stable branch powering the live online GitHub Pages web application (`https://ausomegh.github.io/Van50/`).
    - **Automated Pre-Flight Smoke Test Gate**:
      - Deployments to `production` are strictly executed via `python scripts/deploy_to_production.py [-m "release message"]`.
      - Spawns an ephemeral test environment and runs headless Chrome against the live DOM.
      - Verifies:
        1. 0 JavaScript console syntax or runtime errors (`SyntaxError`, `TypeError`, `ReferenceError`).
        2. Category pills populated ($\ge 8$).
        3. Event cards rendered ($\ge 50$).
      - If ANY check fails, deployment is immediately aborted. The live online production app is protected from broken builds.
      - When all checks pass, merges `main` into `production`, pushes to `origin/production`, and returns the local environment to `main`.




