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

10. **Dimension-by-Dimension Audit & Timestamp Protocol (Zero Rubber-Stamping)**:
    - **Granular Scoping Mandate**: When QC AI audits an event, it MUST NOT issue a blanket or superficial pass. It must systematically inspect each of the 20 discrete dimensions (D1 Title through D20 Showings/Waypoints) sequentially.
    - **Dimension Audit Metadata Schema (`dimension_audit`)**:
      - Each event in `data/events.json` maintains a structured `dimension_audit` object with `last_full_qc_at`, `auditor`, `dimensions_score`, and a `dimensions` map.
      - For each dimension (D1..D20), QC AI records `confirmed_at` (ISO timestamp), `status` (`verified`, `calibrated`, `standardized`), and a descriptive validation `note` or value.
    - **Audit Notes & Anomaly Logging**: Any adjustments made during QC (e.g. link upgrades, price adjustments, tier cleaning) must be documented in `actions_taken` and written to `audit_notes`.
    - **Differential Decay & Freshness**:
      - *High Velocity (Daily/Weekly)*: D2 (Date), D11 (Price), D12 (Tiers), D14 (Link), D19 (Sold-Out) must be audited frequently.
      - *Medium Velocity (Monthly)*: D3 (Time), D4 (Weekly Hours), D13 (Benchmarks), D18 (Restrictions).
      - *Low Velocity (Semi-Annual)*: D1 (Title), D7 (Category), D8 (Location), D9 (Access), D10 (Pricing Model), D16 (Description).

