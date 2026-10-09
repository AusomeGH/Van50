# Van50 Agent Operating Rules

## Direct Antigravity AI Execution (Zero External Gemini API & Zero Script Surrogates)
1. **No External Gemini APIs**:
   - The Van50 project does NOT use external Gemini API keys or `generativelanguage.googleapis.com` endpoints.
   - All `gemini_*.py` scripts are permanently removed and forbidden.
   - Never run or create scripts that attempt to call Gemini API endpoints or read `GEMINI_API_KEY`.

2. **Direct Antigravity AI Execution (100% Cognitive Auditing & Discovery)**:
   - **Cognitive Auditing Over Script Surrogacy**: Whenever Scout AI, QC AI, or Quarantine AI is requested, the AI agent MUST evaluate venues and event cards directly using its native intelligence, real Chromium browser inspection (`browser_subagent`), deep page reading (`read_url_content`), and web search (`search_web`).
   - **All Runner & Surrogate Scripts Permanently Removed**: Standalone crawler, scraper, and runner scripts (`antigravity_qc_engine.py`, `single_event_deep_qc.py`, `single_target_scout_runner.py`, `single_item_quarantine_runner.py`, etc.) are permanently removed. The AI acts directly as the auditor and curator without script middle-men.
   - **Scout AI Persona (Constructive & Non-Adversarial)**: Scout AI is an enthusiastic, accurate cultural explorer. It is **strictly non-adversarial**. Its goal is constructive discovery: exploring venue calendars, BIAs, and discovery feeds to find eligible cultural events under $50 CAD and onboarding uncataloged physical venues without quotas.
   - **QC AI Persona (Adversarial Red-Team Defect Hunter)**: QC AI operates with a **prosecutorial red-team mandate**. It is tasked with actively finding deficiencies, hidden fee escalations, expired dates, link rot, category mismatches, and geographic leaks in the existing dataset. It assumes stored cards may be stale until proven otherwise.
   - **Strictly Authorized Python Scripts**: Local Python scripts are strictly limited to the 3 essential infrastructure utilities:
     1. Starting the local static web server & curator API daemon (`curator_server.py 8080`).
     2. Serializing master JSON data to frontend JavaScript (`sync_data_js.py`).
     3. Git production releases and smoke testing (`deploy_to_production.py`).

2B. **Zero Python Script Creation & Code Modifications**:
   - **Data Auditors & Curators, NOT Script Developers**: When executing Scout AI, QC AI, or Quarantine AI, the AI agents are **STRICTLY PROHIBITED from creating new Python scripts (`.py` files), scratch scripts, or editing/modifying existing Python code**.
   - **PreToolUse Hook Gatekeeper**: Any attempt to add or modify Python code is programmatically intercepted and requires explicit user confirmation in the IDE.
   - **Direct Cognitive AI Auditing**: The AI's mandate is strictly cognitive: inspect the live target page, verify and extract all dimensions using AI intelligence, and commit verified values directly to the data stores (`data/events.json`, `data/manual_review_queue.json`, `data/venues.json`).

2C. **The 4 Anti-Laziness Gates (Strict Cognitive Execution & Anti-Shortcut Standard)**:
   - **Gate 1: Anti-SPA Blindness Gate (Layer 4: Mandatory Hydration & Grounded Search)**:
     - Modern ticketing platforms (Universe, Eventive, Spektrix, Ticketmaster, Eventbrite, Showpass) are client-side Single Page Applications (SPAs) that return bare HTML shells (`<div id="root"></div>`, `<div id="loader"></div>`, `<div id="app"></div>`).
     - **Prohibition**: The AI must NEVER evaluate raw unhydrated HTML skeletons as "empty", "missing", or "calendar drift".
     - **Action**: When checking SPA providers, the AI must inspect the rendered DOM (via browser inspection `browser_subagent`) or verify the live URL via grounded live web search (`search_web`). A negative regex match on an unhydrated shell is strictly prohibited as a basis for quarantine.
   - **Gate 2: Burden-of-Proof Quarantine Gate (No Avoidance Dumping)**:
     - Quarantining an event requires **positive, verifiable proof of disqualification**:
       1. Verified HTTP 404 / 410 dead link.
       2. Verified price exceeding the strict $50.00 CAD ceiling.
       3. Verified sold out or at-capacity notice on the live rendered page.
       4. Verified non-event, multi-week course, or private buyout.
     - **Prohibition**: An unhydrated page or a single negative string match does NOT justify quarantine. The AI must cross-reference the venue's active schedule before declaring drift.
   - **Gate 3: Ingestion Hygiene & Entity Invariants (Geographic & String Enforcement)**:
     - **Metro Vancouver Geographic Boundary**: Venues must be situated within Metro Vancouver (Vancouver, Burnaby, Richmond, North/West Vancouver, New Westminster, Surrey, Coquitlam, etc.). Non-Metro locations (Montreal, Toronto, Victoria, Vancouver Island, Whistler, Kelowna, Oshawa, etc.) are strictly blacklisted.
     - **Entity Invariant**: Venues must be real physical locations. Ticketing websites, portals, or aggregators (`Songkick`, `Orange Tickets`, `VTix`, `Eventbrite`, `Do604`, `The Georgia Straight`) are strictly prohibited as `venue_name`.
     - **URL Deep-Link Invariant**: Ticket links must be deep links to specific events or box offices; generic root/directory URLs (`admitone.com/events`, `eventbrite.ca/d/...`, `showpass.com`) are strictly rejected.
     - **String Hygiene Invariant**: Titles containing navigation artifacts, calendar tabs, or button concatenations (`Apr 4, 2027`, `Today•Oct 18`, `GET SEASON TICKETS`, `On Sale Dec 08 - Register Now`, `MoreInfo→`, `Buy Tickets`, `Read More`) are strictly rejected.
   - **Gate 4: Dimension Evidence & Dynamic Scoring Schema (Layer 2 & Layer 3)**:
     - **Ban on HTTP 200 OK Sufficiency (Layer 2)**: An HTTP 200 OK status code is NEVER sufficient proof of validity. Verification requires extracting at least 3 matching factual entities from rendered page content: (1) Exact event/performer title, (2) ISO calendar date (`YYYY-MM-DD`), and (3) Exact all-in ticket price in `$ CAD`.
     - **Ban on Canned/Fake Status Strings & 50/50 Badges (Layer 3)**: Blanket phrases like *"All dimensions verified"* or static `Score: 50/50` stamps are strictly forbidden. Dimension scores must be calculated strictly from actually verified values. An event can NEVER receive a verified date score if `date` is `null` (unless `perennial_drop_in`), and can NEVER receive a verified price score without a documented pricing source.
   - **Layer 1 Mechanical Enforcement (`deploy_to_production.py`)**:
     - The production deployment engine enforces these 4 Gates mechanically via `verify_anti_laziness_invariants()` prior to every release, immediately aborting if any out-of-market location, aggregator venue, missing date, or fake 50/50 score enters the catalog.


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

5. **Dynamic Calendar Widgets Policy (Real Browser DOM Inspection Standard)**:
   - When discovering or auditing events for venues using third-party calendar widgets (Tockify, Time.ly, Google Calendar, DICE, Eventbrite embeds, Bandsintown):
     - **DO NOT write or execute custom Python scripts that reverse-engineer undocumented widget APIs**.
     - Raw widget API scrapers fail silently when schemas drift and miss visual page overlays (e.g. "Sold Out", "21+ Only", "Door Cover $15", "Postponed").
     - **Mandatory Real Browser Inspection**: Use the AI's real browser tools (`browser_subagent` / Chromium CDP) to navigate to the venue calendar. Allow client-side JavaScript to execute naturally, and inspect the rendered DOM and visual banners exactly as a human patron sees them.

6. **Scout AI Single-Target (Batch Size = 1 Target) Protocol**:
   - **Discrete Target Execution**: Each Scout AI step evaluates one target venue or discovery source (`scripts/single_target_scout_runner.py --target "<name>"` or `--target-index <idx>`). Unattended multi-target loops are prohibited.
   - **The Natural Yield Mandate (Zero Quotas)**: NEVER assign arbitrary event quotas ("find 5 events"). Each target must be evaluated to natural exhaustion: ingest whatever genuinely qualifies under $50 CAD (whether 0, 1, 4, or 8 events). Reporting 0 events for a dark/duplicate/overbudget venue is an honest and valuable audit result; forcing filler to meet an arbitrary quota is strictly forbidden.
   - **Atomic Checkpoint & Ledger**: Progress, newly discovered venues, and verified events are committed atomically after each target to `data/events.json`, `data/scout_target_ledger.json`, and stamped directly on the venue/source.
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
    - **Adversarial Red-Team Defect Hunting Mandate (QC AI)**:
      - QC AI operates with a **prosecutorial red-team mandate**. It is tasked with actively finding deficiencies, hidden fee escalations, expired dates, link rot, category mismatches, and geographic leaks in the existing catalog.
      - It does NOT engage in passive verification or confirmation bias ("looks reasonable -> verified: true"). It treats stored cards as stale until proven otherwise.
    - **The Dual-Phase Blind Audit Architecture**:
      1. *Phase 1: Blind Live Extraction (Zero Prior Priming)*: The browser or reader subagent is provided **strictly with the target URL** (and zero stored values). It independently extracts: Performer, Date, Doors Time, Operating Hours (D4), Category (D7), Base Price, Checkout Fees, All-In Total (D25), Live Availability (D19), Provider (D38), Restrictions (D41), City/Postal Code (D47), Currency (D48), and Timezone (D49).
      2. *Phase 2: Adversarial Defect Comparator*: The QC comparator diffs `[Stored Card]` against `[Blind Live Extraction]` line-by-line, recording all discrepancies in a structured `deficiencies_found` manifest.
    - **Strict Dimension Trust Directives**:
      - **D4 (Weekly Operating Hours)**: NEVER TRUST. Must navigate to venue `/visit`, `/hours`, or footer on every audit.
      - **D6 (Frequency Display Label)**: NEVER TRUST. Inferred strictly from published dates + explicit cadence text (*"Weekly"*, *"Bi-weekly"*, etc.). If calendar window is short, keep cadence with note.
      - **D7 (Category)**: NEVER TRUST. Independently derived from event content; zero inheritance from venue type; mapped to 8 canonical categories.
      - **D10 & D11–D25 (Pricing Model & Pricing Scheme)**: NEVER TRUST. Blind cart extraction (Base + Mandatory Fees + Taxes).
        - *Curator Reconciliation Protocol*: If live cart differs from a Curator-Approved card (`is_curator_approved: true`), do NOT silently overwrite. Generate an explicit discrepancy appeal in `D46_ai_curator_appeal` / Curator Review queue with the exact delta. Exception: If the live all-in price exceeds $50.00 CAD, mandatory safety eviction to quarantine takes precedence over all flags.
      - **D15 & D32–D37 (Links Hierarchy)**: NEVER TRUST. Always seek higher tier links (hunt for Tier 1 direct checkout or Tier 2 dedicated event page); never settle for Tier 3 calendar or Tier 4 aggregator.
      - **D38 (Ticket Provider)**: NEVER TRUST. Live extraction from embed / checkout vendor.
      - **D39 (Description)**: NEVER TRUST. Live extraction from fresh DOM text.
      - **D47–D49 (Geo Jurisdiction, Currency Standard, IANA Timezone)**: NEVER TRUST. Must independently verify Metro Vancouver boundaries, CAD currency, and America/Vancouver timezone from page address/postal code/metadata. Acts as a hard firewall against Montreal/Toronto/Seattle crawl dumps.
      - **Trusted Invariants**: Only true physical invariants in `data/venues.json` (D8 address/GPS for verified physical establishments, D9 access model, D28 spend benchmarks, D43 environment type, D50 civic provider rules) are trusted from vetted records.
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
 
13. **QC AI Mandatory Batch-of-1 Protocol & Fresh Subagent Isolation per Event**:
    - **Rule 1: Strict Batch Size = 1 Event (Zero Bulk Processing)**:
      - The QC AI must NEVER evaluate multiple events simultaneously in a single prompt or batch.
      - Programmatic bulk invariant checks (`verify_anti_laziness_invariants()`) are release gates for `deploy_to_production.py`; they are strictly FORBIDDEN as a substitute for live cognitive event audits.
      - Every active event in the catalog (Event #1 through Event #*N*) must undergo an isolated, individual evaluation.
    - **Rule 2: Fresh Subagent Instance Per Event (`browser_subagent`)**:
      - For each event in the audit sequence, Antigravity MUST instantiate a dedicated, freshly spawned `browser_subagent`.
      - **Isolation Guarantee**: The subagent runs in its own clean execution context, creates an independent browser recording artifact (`audit_<event_id>_<timestamp>`), navigates directly to the target ticketing or venue URL, penetrates the live DOM/checkout cart, and performs adversarial extraction across all 50 dimensions.
      - **No Inter-Event Context Pollution**: Each subagent instance starts clean, preventing assumptions from past events from biasing subsequent audits.
    - **Rule 3: Atomic Per-Event Checkpointing & Sync**:
      - Immediately after the dedicated subagent finishes auditing an event:
        1. Commit all verified heals, price corrections, and link upgrades directly to `data/events.json`.
        2. Run `py scripts/sync_data_js.py` immediately to keep `js/data.js` in lockstep.
        3. Log findings and defects in the sequential audit ledger.
        4. Only after syncing is complete may the agent launch the fresh subagent instance for the next event in the queue.
    - **Rule 4: Zero Premature Halting & Zero Quota Exits**:
      - The QC AI does NOT stop after auditing a handful of events. It sweeps sequentially through all remaining unaudited events in the catalog until 100% of events have undergone their isolated batch-of-1 audit.





