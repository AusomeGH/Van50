# Van50 Agent Operating Rules (Canonical 0XX–8XX Architecture)

## 1. Authorized Pipeline & Direct Cognitive AI Execution
1. **The Official Multi-Layer Ripper & Compiler Pipeline (`ripper/*.js`)**:
   - Van50 operates on a specialized, multi-layer Node.js + AI pipeline in `ripper/`:
     - **Step 1A — Schedule Harvester (`ripper/calendar_harvester.js`)**: Harvests upcoming dates, times, and showings from venue calendars into `data/layers/layer_schedules.json`.
     - **Step 1B — Dedicated Link Tier Upgrader & Hunter (`ripper/tier1_hunter.js` & `ripper/link_upgrader.js`)**: Follows ticket buttons, iframes, and redirects to upgrade candidate leads to verified Tier 1 checkout carts (`candidate_tier1_url`).
     - **Step 2 — Stagehand Live Box Office QC (`ripper/event_batch_qc.js`)**: Runs **exclusively on paid / ticketed events**. Launches an isolated Chromium browser instance per event, penetrates the live checkout modal, increments ticket quantities across tiers (`Tier 1`, `Tier 2`, `Tier 3`), verifies platform fees and taxes (`Dual-Entry Ledger: price_read vs price_calculated`), captures `_cart.png` visual keyframes, and writes to `data/layers/layer_box_office.json`.
     - **Step 3A — AI Semantic Enricher (`ripper/enricher.js`)**: Cleans event titles, extracts performer lineups, assigns categories/archetypes, and writes editorial synopses to `data/layers/layer_editorial.json`.
     - **Step 3B — Venue Detailer & Google Maps Grounding (`ripper/venue_detailer.js`)**: Grounds physical venue constants, GPS coordinates, operating hours, accessibility (`5XX`), and drink/food spend benchmarks (`6XX`)—including drop-in parks, beaches, seawalls, and pitch-and-putts—directly into `data/venues.json`.
     - **Step 4 — Compiler (`ripper/compile_catalog.js`)**: Sole authorized publisher that reconciles `seeds.json`, `layer_schedules.json`, `layer_box_office.json`, `layer_editorial.json`, and `venues.json` into the uniform ~107-dimension (`D001`–`D809`) master catalog (`data/events.json`) and syncs `js/data.js`.
2. **Authorized Infrastructure Python Utilities (`scripts/*.py`)**:
   - Local Python scripts are strictly limited to the 3 core utilities:
     1. `C:\Users\Micro\AppData\Local\Python\bin\python.exe scripts/curator_server.py 8080`: Local web app & Curator Studio API server (always use `C:\Users\Micro\AppData\Local\Python\bin\python.exe`, never bare `python`).
     2. `scripts/sync_data_js.py`: Serializes `data/events.json` and `data/venues.json` into `js/data.js`.
     3. `scripts/deploy_to_production.py`: Runs pre-flight smoke tests and deploys `main` to `production`.
3. **Strict Ban on Ad-Hoc Scratch Scripts & Fake Linters**:
   - The AI is strictly prohibited from creating or running temporary Python/shell scripts (`temp_*.py`, `heal_*.py`, `audit_batch_*.py`, `curl -I` loops) to bulk-stamp, regex-guess, or fake dimension audits.
   - Any Python modification or execution is gated by `.agents/hooks/gate_python_activity.ps1`.

---

## 2. The 4 Anti-Laziness & Data Hygiene Gates
1. **Gate 1 — Anti-SPA Blindness Gate**:
   - Ticketing platforms (Showpass, Eventbrite, Universe, Spektrix, Ticketmaster, TicketWeb) are client-side SPAs. Never evaluate unhydrated HTML shells as empty or dead; always use rendered browser DOM (`Stagehand` / `browser_subagent`) or grounded search.
2. **Gate 2 — Burden-of-Proof Quarantine Gate**:
   - Quarantining an event requires positive proof of disqualification: (a) Verified HTTP 404/410 dead link after self-healing, (b) Verified all-in price > $50.00 CAD, (c) Verified past/cancelled event with no upcoming showings, or (d) Verified multi-week course or private buyout.
3. **Gate 3 — Ingestion Hygiene & Entity Invariants**:
   - **Metro Vancouver Boundary**: Strictly Metro Vancouver municipalities. Out-of-market cities (Victoria, Whistler, Seattle, Toronto, Montreal) are blacklisted.
   - **Physical Venue Invariant**: `venue_name` must be a real physical venue, never a ticketing portal or aggregator (`Eventbrite`, `Showpass`, `Do604`, `Songkick`).
   - **Civic `.aspx` WAF Evasion Policy**: Never use `vancouver.ca/.../*.aspx` links (which trigger Cloudflare WAF HTTP 403 blocks). Always use non-blocking destination guides (`destinationvancouver.com`, `stanleyparkvan.com`, `vandusengarden.org`, `roundhouse.ca`).
4. **Gate 4 — Tier-Grounded Sold-Out & Price Floor Integrity**:
   - **Tier-Grounded Sold-Out Rule**: An event must NEVER be marked `is_sold_out: true` if at least one eligible single-visit admission tier (`<= $50.00 CAD`) is available in the live cart, or if it is an `open_public_space` / `free_public_access` perennial.
   - **Deceptive Price Floor Ban**: Optional add-ons (club rentals, skate rentals, tasting tokens) must never define the headline minimum entry price floor. Annual memberships and season passes are excluded from single-visit ticket tiers.

---

## 3. The Canonical 0XX–8XX Clustered Dimension Architecture (`D001`–`D809`, ~107 Dimensions)
Every compiled card in `data/events.json` maintains a uniform `dimension_audit` object across all **9 Specialist Clusters (`0XX`–`8XX`)**:

- **Cluster `0XX` (`D001`–`D008`) — Event Identity, Archetype & Taxonomy**:
  - `D001_title`, `D002_event_archetype` (`cinema`, `live_stage`, `workshop`, `social_gaming`, `civic_park`, `museum_gallery`, `active_rec`, `roving_series`, `festival`), `D003_lifecycle_type` (`time_bound_event`, `weekly_recurring_residency`, `perennial_drop_in`), `D004_primary_category`, `D005_tags`, `D006_sub_tags`, `D007_restrictions`, `D008_holiday_affiliation`.
- **Cluster `1XX` (`D101`–`D110`) — Access, 5-Tier Link Hierarchy & Jurisdictional Boundaries**:
  - `D101_tier1_checkout`, `D102_tier2_event_page`, `D103_tier3_calendar`, `D104_tier4_civic_destination`, `D105_tier5_venue_home`, `D106_best_available_link`, `D107_operational_status` (`available` vs `sold_out`), `D108_geo_jurisdiction` (`Metro Vancouver`), `D109_currency_standard` (`CAD`), `D110_iana_timezone` (`America/Vancouver`).
- **Cluster `2XX` (`D201`–`D222`) — Interactive Compound Box Office & Dual-Entry Ledger**:
  - **Tier 1 (Primary Adult / GA)**: `D201_tier1_name`, `D202_tier1_price_base`, `D203_tier1_price_fee`, `D204_tier1_price_tax`, `D205_tier1_price_read`, `D205_tier1_price_calculated`, `D205_tier1_discrepancy_delta`, `D205_tier1_price_all_in`.
  - **Tier 2 (Secondary / Concession / Student)**: `D206_tier2_name` through `D210_tier2_price_all_in`.
  - **Tier 3 (Tertiary / Youth / Door / VIP <= $50)**: `D211_tier3_name` through `D215_tier3_price_all_in`.
  - **Box Office Logistics**: `D216_tier_count_verified`, `D217_pricing_model`, `D218_budget_qualified_under_50`, `D219_other_cost_label`, `D220_other_cost_price`, `D221_ticket_provider`, `D222_booking_protocol`.
- **Cluster `3XX` (`D301`–`D311`) — Performance, Schedule & Content Reality**:
  - `D301_lineup`, `D302_artist`, `D303_date`, `D304_showings_slots`, `D305_doors_time`, `D306_start_time`, `D307_end_time`, `D308_dateSchedule`, `D309_frequencyLabel`, `D310_synopsis`, `D311_festival_affiliation`.
- **Cluster `4XX` (`D401`–`D408`) — Physical Venue Geography & Constants**:
  - `D401_venue_name`, `D402_full_address`, `D403_coordinates`, `D404_neighborhood`, `D405_access_model`, `D406_environment_type`, `D407_weekly_hours`, `D408_transit_waypoints`.
- **Cluster `5XX` (`D501`–`D506`) — Accessibility Standards**:
  - `D501_step_free_entrance`, `D502_elevator_lift`, `D503_accessible_washrooms`, `D504_sensory_calibrations`, `D505_hearing_loop`, `D506_service_animals`.
- **Cluster `6XX` (`D601`–`D608`) — On-Site Spend & Amenity Benchmarks**:
  - `D601_on_site_fnb`, `D602_coffee_benchmark`, `D603_beer_benchmark`, `D604_meal_benchmark`, `D605_outside_food_policy`, `D606_coat_check`, `D607_payment_methods`, `D608_water_refill_station` (synthesized into `drink_benchmark` and `typical_item_spend` on every card).
- **Cluster `7XX` (`D711`–`D795`) — Cultural Archetype Profiles**:
  - Uniformly present across all cards; active for the matching archetype (`71X` Cinema, `72X` Live Stage, `73X` Workshop, `74X` Social Gaming, `75X` Civic Park, `76X` Museum/Gallery, `77X` Active Rec, `78X` Roving Series, `79X` Festival) and `not_applicable` for non-matching archetypes.
- **Cluster `8XX` (`D801`–`D809`) — Governance & Multi-Layer Provenance**:
  - `D801_srsa_compliance`, `D802_multi_layer_provenance`, `D803_spa_hydration_provenance`, `D804_active_showings`, `D805_archived_showings`, `D806_curator_lock`, `D807_proof_keyframes`, `D808_timestamp_lockstep`, `D809_civic_provider_rules`.

### The Honest Absence Protocol
When a dimension is not stated on the live source, never guess; assign one of:
1. `none_available`: Confirmed not offered by venue/event.
2. `not_applicable`: Does not apply to this archetype or lifecycle type.
3. `search_exhausted_null`: Unstated on venue/event pages after active inspection.
4. `quarantine_fatal`: Missing mandatory attendance data (e.g. missing price or date on a ticketed show).

---

## 4. Epistemic Precedence Hierarchy (Curator vs. Live Web)
1. **Tier 1 — Boundary & Identity (Curator Rules Supreme)**:
   - Curator instructions (`data/curator_instructions.json`, `curator_notes`, `data/curator_learned_rules.json`) govern physical facility boundaries, branch disambiguation, instructed destination URLs, and lifecycle classification.
2. **Tier 2 — Volatile Factual Dimensions (Live Cart & Calendar Rules Supreme)**:
   - Real-time checkout ticket pricing, platform service fees, taxes, active dates, showtimes, and inventory status (`available` vs `sold_out`) are governed by live inspection.
3. **Tier 3 — Empirical Divergence Protocol**:
   - If live cart pricing differs from historical curator notes but remains `<= $50.00 CAD`, update to the live verified price and note the delta in `curator_notes`. If `> $50.00 CAD`, route to `data/manual_review_queue.json` with `ai_curator_appeal: true`.

---

## 5. Runtime Benchmarking & Production Deployment
1. **Runtime Benchmarks (`data/ai_runtime_benchmarks.json`)**:
   - Provide pre-run estimates from `data/ai_runtime_benchmarks.json` and log elapsed runtimes upon completion.
2. **Production Releases (`scripts/deploy_to_production.py`)**:
   - `main` is the active development branch; `production` powers GitHub Pages (`https://ausomegh.github.io/Van50/`).
   - Deployments run via `python scripts/deploy_to_production.py`, which enforces mechanical invariant gates and headless Chrome smoke testing before merging to `production`.
