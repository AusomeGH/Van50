import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Resolves the local Antigravity CLI binary (`agy.exe` on Windows or `agy` on POSIX).
 */
export function resolveAgyBinary() {
  if (process.env.AGY_BIN_PATH && fs.existsSync(process.env.AGY_BIN_PATH)) {
    return process.env.AGY_BIN_PATH;
  }
  const home = os.homedir();
  const candidates = [
    path.join(home, ".gemini", "bin", process.platform === "win32" ? "agy.exe" : "agy"),
    path.join(home, ".gemini", "antigravity", "bin", process.platform === "win32" ? "agy.exe" : "agy"),
    "C:\\Users\\Micro\\.gemini\\bin\\agy.exe",
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return process.platform === "win32" ? "agy.exe" : "agy";
}

/**
 * Checks whether the pipeline is running in Antigravity Engine mode.
 */
export function isAntigravityEngine() {
  return (
    process.env.VAN50_ENGINE === "antigravity" ||
    process.argv.some((a) => a === "--engine=antigravity" || a === "--agy" || a.includes("@agy"))
  );
}

/**
 * Returns a formatted local timestamp `[HH:MM:SS AM/PM]` for live terminal logs.
 */
export function formatLogTime(date = new Date()) {
  try {
    return `[${date.toLocaleTimeString("en-US", {
      hour12: true,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })}]`;
  } catch (_) {
    return `[${date.toISOString().slice(11, 19)}]`;
  }
}

/**
 * Returns the configured Antigravity model (defaults to fast gemini-3.8-flash-low for 1-event workers).
 */
export function getAntigravityModel() {
  return process.env.VAN50_AGY_MODEL || "gemini-3.8-flash-low";
}

/**
 * Extracts a JSON object from an LLM text response (handling optional markdown code fences).
 */
export function parseJsonFromText(rawText) {
  if (!rawText || typeof rawText !== "string") return null;
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {}

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch (_) {}
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch (_) {}
  }
  return null;
}

const MODEL_TIMEOUT_MS = {
  "gemini-3.8-flash-low": 80000,
  "gemini-3.8-flash-medium": 95000,
  "gemini-3.8-flash-high": 120000,
  "gemini-4-argon-low": 95000,
  "gemini-4-argon-medium": 120000,
  "gemini-4-argon-high": 150000,
  "claude-sonnet-5-5-medium": 120000,
  "claude-sonnet-5-5-high": 150000,
};

// In-memory registry of AI timeouts and errors during the current pipeline run
const AGY_TIMEOUT_EVENTS = [];

export function getAntigravityTimeoutEvents() {
  return [...AGY_TIMEOUT_EVENTS];
}

export function clearAntigravityTimeoutEvents() {
  AGY_TIMEOUT_EVENTS.length = 0;
}

export function recordPipelineTimeoutEvent({
  eventId = "unknown_event",
  eventTitle = "Unknown Event",
  stage = "Pipeline Stage",
  model = getAntigravityModel(),
  elapsedSec = 0,
  timeoutLimitSec = 60,
  isTimeout = true,
  cause = "Operation timed out",
} = {}) {
  console.warn(
    `🚨 [AI TIMEOUT/ERROR] Event: "${eventTitle}" [${eventId}] | Stage: ${stage} | Model: ${model} | Elapsed: ${elapsedSec}s/${timeoutLimitSec}s | Cause: ${cause}`
  );
  AGY_TIMEOUT_EVENTS.push({
    eventId,
    eventTitle,
    stage,
    model,
    elapsedSec: Number(elapsedSec),
    timeoutLimitSec: Number(timeoutLimitSec),
    isTimeout: Boolean(isTimeout),
    cause,
    timestamp: new Date().toISOString(),
  });
}

export function printAntigravityTimeoutSummary(stageLabel = "Pipeline Stage") {
  if (AGY_TIMEOUT_EVENTS.length === 0) return;
  console.log(`\n🚨 ================================================================`);
  console.log(`🚨 AI WORKER TIMEOUT / FAILURE REPORT (${stageLabel}): ${AGY_TIMEOUT_EVENTS.length} Event(s) Affected`);
  console.log(`🚨 ================================================================`);
  AGY_TIMEOUT_EVENTS.forEach((t, idx) => {
    console.log(
      `🚨 [${idx + 1}] Event: "${t.eventTitle || t.eventId}" [${t.eventId}] | Stage: ${t.stage} | Model: ${t.model} | Elapsed: ${t.elapsedSec}s/${t.timeoutLimitSec}s | Cause: ${t.cause}`
    );
  });
  console.log(`🚨 ================================================================\n`);
}

/**
 * Spawns a fresh, disposable 1-task Antigravity CLI agent (`agy.exe -p`)
 * so each event gets 100% fresh attention with zero context accumulation or AI laziness.
 */
export async function runAntigravityOnce(prompt, options = {}) {
  const agyBin = resolveAgyBinary();
  const model = options.model || getAntigravityModel();
  const modelDefaultTimeout = MODEL_TIMEOUT_MS[model] || 75000;
  const timeoutMs = Math.max(options.timeoutMs || 60000, modelDefaultTimeout);
  const timeoutLimitSec = Math.round(timeoutMs / 1000);
  const taskLabel = options.label || "1-Event Cognitive Task";
  const eventId = options.eventId || "unknown_event";
  const eventTitle = options.eventTitle || taskLabel;
  const stage = options.stage || "AI Worker";

  const startMs = Date.now();
  console.log(`   🚀 [Antigravity Worker] Spawning fresh 1-shot agent (${model}, timeout ${timeoutLimitSec}s) → ${taskLabel}...`);

  try {
    const args = [
      "--model",
      model,
      "--disable-slash-commands",
      "--dangerously-skip-permissions",
      "-p",
      prompt,
    ];

    const { stdout, stderr } = await execFileAsync(agyBin, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });

    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    const parsed = parseJsonFromText(stdout);
    if (parsed) {
      console.log(`   ✅ [Antigravity Worker] Completed in ${elapsedSec}s (fresh context terminated).`);
      return parsed;
    }
    const rawSnippet = String(stdout || stderr || "").replace(/\s+/g, " ").trim().slice(0, 140);
    const cause = `Model (${model}) returned non-JSON text instead of structured schema${rawSnippet ? `: "${rawSnippet}"` : ""}`;
    console.warn(`   🚨 [AI TIMEOUT/ERROR] Event: "${eventTitle}" [${eventId}] | Stage: ${stage} | Model: ${model} | Elapsed: ${elapsedSec}s/${timeoutLimitSec}s | Cause: ${cause}`);
    AGY_TIMEOUT_EVENTS.push({
      eventId,
      eventTitle,
      stage,
      model,
      elapsedSec: Number(elapsedSec),
      timeoutLimitSec,
      isTimeout: false,
      cause,
      timestamp: new Date().toISOString(),
    });
    return null;
  } catch (err) {
    const elapsedSec = ((Date.now() - startMs) / 1000).toFixed(1);
    const isKilledTimeout = Boolean(err.killed || err.signal === "SIGTERM" || /timed?\s*out|ETIMEDOUT/i.test(err.message || ""));
    const stderrText = String(err.stderr || "").replace(/\s+/g, " ").trim().slice(0, 160);
    let cause = "";
    if (isKilledTimeout) {
      cause = `AI Worker exceeded ${timeoutLimitSec}s deadline on ${model} (${stage} prompt size ${prompt.length} chars${stderrText ? ` — ${stderrText}` : ""})`;
    } else {
      cause = `CLI process error (${err.code || "ERR"}): ${stderrText || err.message}`;
    }
    console.warn(`   🚨 [AI TIMEOUT/ERROR] Event: "${eventTitle}" [${eventId}] | Stage: ${stage} | Model: ${model} | Elapsed: ${elapsedSec}s/${timeoutLimitSec}s | Cause: ${cause}`);
    AGY_TIMEOUT_EVENTS.push({
      eventId,
      eventTitle,
      stage,
      model,
      elapsedSec: Number(elapsedSec),
      timeoutLimitSec,
      isTimeout: isKilledTimeout,
      cause,
      timestamp: new Date().toISOString(),
    });
    return null;
  }
}

/**
 * Specialist Worker 1: Antigravity Box Office Cart & Tier Extractor (Step 2)
 * Inspects rendered DOM text from the live checkout cart and extracts structured Tier 1/2/3 pricing.
 */
export async function callAntigravityBoxOfficeExtractor(domSnapshotText, targetUrl, existingCard = {}) {
  const truncatedDom = String(domSnapshotText || "").slice(0, 14000);
  const curatorHint = existingCard?.curator_notes
    ? `\nMANDATORY CURATOR NOTE: "${existingCard.curator_notes}"\n`
    : "";

  const prompt = `You are a fresh 1-Event Van50 Box Office Auditor inspecting a live rendered checkout page in Metro Vancouver (<= $50.00 CAD ceiling).
Target URL: ${targetUrl}
Seed Title Hint: "${existingCard?.title || existingCard?.seed_title || ""}"
Seed Venue Hint: "${existingCard?.venue || existingCard?.venue_name || existingCard?.seed_venue || ""}"${curatorHint}

Rendered Page & Cart Modal Text:
"""
${truncatedDom}
"""

Instructions:
1. Extract the exact show/event title (never a generic button like "Buy Tickets" or "General Admission" if a real title is present), venue_name, calendar date (YYYY-MM-DD if possible), start_time (12-hour AM/PM e.g. "8:00 PM"), doors_time (12-hour AM/PM e.g. "7:00 PM"), end_time, and age_restriction.
2. Extract ticket pricing tiers in CAD strictly from the rendered page/cart text above (never guess or fabricate prices if none are present in the text):
   - Tier 1 MUST be the primary single-visit Adult / General Admission / lowest-priced reserved section tier <= $50.00 CAD (never an optional add-on like club rental, and never $0 Child/Member if a paid Adult tier exists).
   - VSO / Tessitura Section Price Ranges: If the page displays section price ranges such as "Front Orchestra $32.00 to $110.00", "Back Orchestra $32.00 to $110.00", or "Back Balcony $32.00 to $70.00", extract the starting floor price of each section (e.g. $32.00, $40.50, $45.00) as a valid tier (e.g. name: "Back Balcony", price_base: 32.0, price_all_in: 32.0, quote: "Back Balcony $32.00 to $70.00").
   - VSO / Chan Centre Fee Breakdown & STX Buttons: If buttons display "$46.67 ticket + $3.33 fees $50.00" or "STX-Adult $45.00 / STX-Senior $43.00 / STX-Studnt $40.50", extract the exact base, fee, and all-in total for Adult (Tier 1), Senior (Tier 2), and Student/Child (Tier 3).
   - Museum/Gallery Admission & Starting Floors: If an exhibition/tour states "included with Gallery admission" alongside an official General Admission rate (e.g. "General Admission – Adult (19+): $29.00"), or a theatre show page states "Tickets from $39", extract that Adult / Starting Floor rate as Tier 1.
   - Extract tier1_name, tier1_price_base, tier1_price_fee, tier1_price_tax, tier1_price_all_in, tier1_price_read, and verbatim tier1_quote. If no price is stated in the text, return null for the numeric price fields!
   - Also populate tier2_* and tier3_* if secondary/student/senior/early-bird/section tiers exist, and list all visible single-visit tiers in all_tiers.
3. Gate 4 Sold-Out Rule: Set is_sold_out to true ONLY if every eligible single-visit admission tier (<= $50 CAD) is sold out.

Return ONLY a valid JSON object matching this exact structure (no markdown commentary):
{
  "venue_name": "string",
  "title": "string",
  "date": "YYYY-MM-DD or natural date",
  "doors_time": "7:00 PM or none_available",
  "start_time": "8:00 PM or none_available",
  "end_time": "10:30 PM or none_available",
  "age_restriction": "19+ or All Ages",
  "ticket_provider": "Showpass | Eventbrite | Universe | Spektrix | Ticketmaster | Direct Box Office",
  "ticket_url": "${targetUrl}",
  "is_sold_out": false,
  "pricing_model": "standard | free_access | sliding_scale | door_cover",
  "tier1_name": "General Admission",
  "tier1_price_base": 20.0,
  "tier1_price_fee": 2.5,
  "tier1_price_tax": 1.13,
  "tier1_price_all_in": 23.63,
  "tier1_price_read": 23.63,
  "tier1_quote": "$23.63 CAD",
  "tier2_name": "none_available",
  "tier2_price_base": null,
  "tier2_price_fee": null,
  "tier2_price_tax": null,
  "tier2_price_all_in": null,
  "tier2_price_read": null,
  "tier3_name": "none_available",
  "tier3_price_base": null,
  "tier3_price_fee": null,
  "tier3_price_tax": null,
  "tier3_price_all_in": null,
  "tier3_price_read": null,
  "all_tiers": [
    {
      "name": "General Admission",
      "price_base": 20.0,
      "price_fee": 2.5,
      "price_tax": 1.13,
      "price_all_in": 23.63,
      "price_read": 23.63,
      "quote": "$23.63 CAD",
      "is_available": true
    }
  ],
  "showings": [
    {
      "slot": 1,
      "date": "YYYY-MM-DD",
      "start_time": "8:00 PM",
      "doors_time": "7:00 PM",
      "end_time": "none_available",
      "status": "upcoming"
    }
  ]
}`;

  const evId = existingCard?.id || existingCard?.event_id || targetUrl;
  const evTitle = existingCard?.title || existingCard?.seed_title || existingCard?.event_name || targetUrl;
  return await runAntigravityOnce(prompt, {
    label: `Box Office Cart Extraction (${evId})`,
    eventId: evId,
    eventTitle: evTitle,
    stage: "Stage 2: Box Office Cart Extractor",
    timeoutMs: 75000,
  });
}

/**
 * Specialist Worker 2: Antigravity Semantic Enricher (Step 3A)
 * Spawns a fresh 1-event Antigravity agent to clean title, extract lineup, and write a 2-sentence patron synopsis.
 */
export async function callAntigravityEnricher(eventCard) {
  const curatorPrompt = eventCard.curator_instruction
    ? `\n- MANDATORY CURATOR GUIDANCE TO CONSIDER: "${eventCard.curator_instruction}" (You MUST honor this in title, artist, category, or description!)\n`
    : "";

  const prompt = `You are a fresh 1-Event Van50 Cultural AI Enricher for Metro Vancouver cultural events under $50 CAD.
Clean and enrich this single event record according to our high-fidelity publishing standards.
IMPORTANT ANTI-LAZINESS RULE: Derive your classification, archetype, lifecycle, restrictions, and 2-sentence description strictly from the primary event title, venue, and live scraped page text below. Never echo generic placeholder categories or canned boilerplate.

Input Event:
- Title: "${eventCard.title || eventCard.event_name || ""}"
- Venue: "${eventCard.venue || eventCard.venue_name || ""}"
- Primary Event Page Text: "${(eventCard.description || "").slice(0, 2800)}"${curatorPrompt}

Requirements:
1. "clean_title": Strip out all promotional artifacts, dates, times, buttons ("Tickets On Sale", "Apr 4", "MoreInfo->"), and ALL-CAPS shouting.
2. "artist": Extract the lead artist, band, performer, or speaker name (or null if general/recreation).
3. "lineup": Array of performer names if present (or []).
4. "category": Strictly one of ["shows", "comedy", "arts", "outdoors", "culture", "free-public-access"].
5. "event_archetype": Strictly one of ["cinema", "live_stage", "workshop", "social_gaming", "civic_park", "museum_gallery", "active_rec", "roving_series", "festival"] based on true semantic comprehension of what the event actually is (e.g. a stand-up comedy show is "live_stage" even if its title has a joke word like "Class").
6. "lifecycle_type": Strictly one of ["time_bound_event", "weekly_recurring_residency", "perennial_drop_in"]. Use "weekly_recurring_residency" ONLY if the event itself is an ongoing weekly residency/series (not just a one-off show whose description mentions a weekday in passing).
7. "weekly_recurring_day": If lifecycle_type is "weekly_recurring_residency", return the day name ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", or "Sunday"); otherwise null.
8. "description": Exactly 2 evocative sentences written for patrons based strictly on the real facts provided. CRITICAL MANDATE: When the event is a specific show/event (comedy, concert, play, screening, performance, etc.), the description MUST be about the show itself (comedic style, music genre, plot, themes, performance) and NOT generic boilerplate about the venue or room. Only describe the venue/grounds when the event is an outdoor park, beach, garden, or perennial drop-in visit. If there are no real facts about the show, return null.
9. "restrictions": "All Ages", "19+ w/ ID", "16+", or "All Ages / Family Friendly".
10. "holiday_affiliation": Generously infer if the event fits the theme, genre, vibe, or celebration of an upcoming holiday within its seasonal window (e.g. horror/thriller/murder-mystery/costume in October -> "halloween"; festive/winter market/solstice/carol in Nov-Dec -> "christmas"). Strictly one of ["halloween", "dia-de-los-muertos", "diwali", "thanksgiving", "christmas", "new-years", "lunar-new-year", "valentines-day", "st-patricks-day", "easter", "canada-day", "pride"] or null.
11. "is_religious": Boolean. Set true ONLY if the event's actual activity involves prayer, worship, liturgy, mass, devotional chanting, scripture, or a faith service. Never set true simply because a secular show is hosted in a church/temple hall or celebrates a secular holiday like Christmas or Diwali.

Respond ONLY with a valid JSON object matching these exact keys (no markdown commentary):
{
  "clean_title": "string",
  "artist": "string or null",
  "lineup": ["string"],
  "category": "shows",
  "event_archetype": "live_stage",
  "lifecycle_type": "time_bound_event",
  "weekly_recurring_day": null,
  "description": "Two evocative sentences about the event.",
  "restrictions": "All Ages",
  "holiday_affiliation": null,
  "is_religious": false
}`;

  const evId = eventCard.id || eventCard.event_id || "unknown_event";
  const evTitle = eventCard.title || eventCard.event_name || evId;
  return await runAntigravityOnce(prompt, {
    label: `Semantic Enricher ("${evTitle.slice(0, 38)}")`,
    eventId: evId,
    eventTitle: evTitle,
    stage: "Stage 3A: Semantic Enricher",
    timeoutMs: 55000,
  });
}

/**
 * Specialist Worker 3: Antigravity Compiler Conflict Arbitrator (Step 4)
 * Spawns a fresh 1-event Antigravity agent when cross-layer conflicts are detected during compilation.
 */
export async function callAntigravityCompilerArbitrator(eventId, context) {
  const { seed, sched, box, edit, existing, venue, curatorNote, conflicts } = context;

  const prompt = `You are a fresh 1-Event Van50 Compiler AI Arbitrator for Metro Vancouver cultural events (<= $50.00 CAD).
Multiple specialist pipeline layers (Seed, Schedule Harvester, Stagehand Box Office, Editorial Enricher, and Venue Registry) have reported data for event "${eventId}", and the following cross-layer conflicts were detected:
${conflicts.map((c) => `- ${c}`).join("\n")}

${curatorNote ? `MANDATORY CURATOR INSTRUCTION (Tier 1 Supreme Authority): "${curatorNote}"\n` : ""}
Multi-Layer Evidence:
- Seed: ${JSON.stringify({ title: seed.seed_title || seed.title, venue: seed.seed_venue || seed.venue, date: seed.date, url: seed.seed_url || seed.ticket_url })}
- Schedule Layer: ${JSON.stringify({ title: sched.title, date: sched.date, start_time: sched.start_time, doors_time: sched.doors_time, is_sold_out: sched.is_sold_out, category: sched.category })}
- Box Office Layer: ${JSON.stringify({ title: box.title, date: box.date, start_time: box.start_time, is_sold_out: box.is_sold_out, tier1_name: box.tier1_name, tier1_price_all_in: box.tier1_price_all_in, tier2_name: box.tier2_name, tier2_price_all_in: box.tier2_price_all_in, all_tiers: (box.all_tiers || []).slice(0, 5) })}
- Editorial Layer: ${JSON.stringify({ clean_title: edit.clean_title, artist: edit.artist, lineup: edit.lineup, category: edit.category, description: edit.description })}
- Existing Published Card: ${JSON.stringify({ title: existing.title, date: existing.date, price: existing.price, category: existing.category })}
- Grounded Venue: ${JSON.stringify({ venue_name: venue.venue_name, access_model: venue.access_model })}

Arbitration Rules:
1. NEVER pick a generic button/pass label ("Season Pass", "Buy Tickets", "General Admission", "Exhibits and experiences") as clean_title when a real show or venue title exists in Seed, Schedule, or Existing.
2. If any single-visit ticket tier (<= $50 CAD) in all_tiers is available, is_sold_out MUST be false.
3. For paid shows, select the true Adult / General Admission single-visit price (never $0 donation/child/member if a paid adult tier exists).
4. Format start_time and doors_time in 12-hour AM/PM format (e.g. "7:30 PM", "8:00 PM").

Return ONLY a valid JSON object (no markdown commentary):
{
  "clean_title": "Resolved authoritative event title",
  "artist": "Resolved lead artist/performer or null",
  "lineup": ["Performer 1"],
  "date": "YYYY-MM-DD or null",
  "start_time": "8:00 PM or null",
  "doors_time": "7:00 PM or null",
  "is_sold_out": false,
  "category": "shows | comedy | arts | outdoors | culture | free-public-access",
  "arbitration_reasoning": "1-sentence explanation of how the conflict was resolved"
}`;

  const evTitle = seed?.seed_title || seed?.title || sched?.title || existing?.title || eventId;
  return await runAntigravityOnce(prompt, {
    label: `Compiler Conflict Arbitrator (${eventId})`,
    eventId,
    eventTitle: evTitle,
    stage: "Stage 4: Compiler Conflict Arbitrator",
    timeoutMs: 55000,
  });
}

/**
 * Specialist Worker 4: Generic / Venue Detailer 1-Shot Antigravity Worker (Step 3B / Stage 4)
 * Used by ripper/venue_detailer.js to ground physical venue constants and amenities.
 */
export function callAntigravityWorker(prompt, meta = {}) {
  const evId = meta.id || meta.eventId || meta.venue || "venue_grounding";
  const evTitle = meta.title || meta.eventTitle || meta.venue || evId;
  return runAntigravityOnce(prompt, {
    label: `Venue Detailer Grounder ("${String(evTitle).slice(0, 38)}")`,
    eventId: String(evId),
    eventTitle: String(evTitle),
    stage: meta.stage || "Stage 4: Venue Detailer",
    timeoutMs: meta.timeoutMs || 55000,
  });
}

/**
 * Specialist Worker 5: Antigravity 1-Event Link Auditor & Tier Hunter (Step 1B)
 * Spawns a fresh 1-event Antigravity CLI agent instance (`agy.exe -p`) per event
 * to audit all 5 link tiers, detect dead/404/redirected links or false Tier 1 claims,
 * and verify the authoritative link hierarchy.
 */
export async function callAntigravityLinkAuditor(eventCard, linkDiagnostics = {}) {
  const evId = eventCard?.id || eventCard?.event_id || "unknown_event";
  const evTitle = eventCard?.title || eventCard?.event_name || evId;
  const evVenue = eventCard?.venue || eventCard?.venue_name || "";
  const lifecycle = eventCard?.lifecycle_type || "time_bound_event";
  const priceLabel = eventCard?.priceLabel || (eventCard?.price === 0 ? "Free ($0)" : String(eventCard?.price || ""));

  const prompt = `You are a fresh, isolated 1-Event Van50 Link Auditor (Step 1B) auditing the 5-Tier Link Hierarchy for a single Metro Vancouver event.
Event ID: "${evId}"
Title: "${evTitle}"
Venue: "${evVenue}"
Lifecycle: "${lifecycle}"
Price: "${priceLabel}"

Current Event Links:
${JSON.stringify({
  ticket_url: eventCard?.ticket_url || null,
  details_url: eventCard?.details_url || null,
  candidate_tier1_url: eventCard?.candidate_tier1_url || null,
  links: eventCard?.links || null,
}, null, 2)}

Live HTTP Probe & Candidate Link Diagnostics:
${JSON.stringify(linkDiagnostics, null, 2)}

5-Tier Link Hierarchy Rules:
- "tier1_checkout": Strictly a direct online ticket checkout/cart URL (Showpass, Eventbrite, Ticketweb, Ticketmaster, Zeffy, Ticket Tailor / tickets.tightropetheatre.com, Agile / tickets.thecinematheque.ca, Spektrix / purchase.theimprovcentre.ca, Blackbaud / tickets.vanartgallery.bc.ca, Tock / exploretock.com, or /tickets-checkout/). MUST BE null for free public parks, drop-in pitch-and-putts, free community festivals, or informational pages with no online checkout cart!
- "tier2_event_page": Specific event/exhibition/facility details page.
- "tier3_calendar": Venue events calendar or exhibitions listing page (must be HTTP 200 and not redirect to past archives or 404).
- "tier4_civic_destination": Non-WAF destination or visitor guide for perennial drop-ins (never vancouver.ca/*.aspx; must not duplicate tier5_venue_home).
- "tier5_venue_home": Live root homepage of the physical venue (must not be a dead domain).
- Never allow a perennial drop-in venue (e.g. pinball bar) to use a one-off concert Eventbrite link with ?fbclid= as its candidate_tier1_url.

Return ONLY a valid JSON object matching this exact schema (no markdown commentary):
{
  "ticket_url": "string or null",
  "details_url": "string or null",
  "tier1_checkout": "string or null",
  "tier2_event_page": "string or null",
  "tier3_calendar": "string or null",
  "tier4_civic_destination": "string or null",
  "tier5_venue_home": "string or null",
  "best_tier": "tier1 | tier2 | tier3 | tier4 | tier5",
  "changed": true,
  "audit_reason": "Concise 1-sentence explanation of link verification or changes made"
}`;

  return await runAntigravityOnce(prompt, {
    label: `Link Auditor ("${String(evTitle).slice(0, 38)}") [${evId}]`,
    eventId: String(evId),
    eventTitle: String(evTitle),
    stage: "Stage 1B: 1-Event Link Auditor",
    timeoutMs: 65000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ATOMIC FILE I/O, IN-PROCESS MUTEX LOCKING & BOUNDED CONCURRENCY UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

const FILE_MUTEX_MAP = new Map();

/**
 * Serializes async operations targeting the same file path within this Node.js process.
 */
export async function withFileLock(filePath, asyncFn) {
  const key = path.resolve(String(filePath));
  const prev = FILE_MUTEX_MAP.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => {
    release = resolve;
  });
  FILE_MUTEX_MAP.set(
    key,
    prev.then(() => next, () => next)
  );
  await prev.catch(() => {});
  try {
    return await asyncFn();
  } finally {
    release();
    if (FILE_MUTEX_MAP.get(key) === next) {
      FILE_MUTEX_MAP.delete(key);
    }
  }
}

/**
 * Safely reads and parses a JSON file with retry protection against transient concurrent writes.
 * Throws if an existing non-empty file cannot be parsed after retries (preventing accidental data wipes).
 */
export function safeReadJsonSync(filePath, defaultValue = []) {
  if (!fs.existsSync(filePath)) {
    return typeof structuredClone === "function"
      ? structuredClone(defaultValue)
      : JSON.parse(JSON.stringify(defaultValue));
  }

  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      if (!raw || !raw.trim()) {
        return typeof structuredClone === "function"
          ? structuredClone(defaultValue)
          : JSON.parse(JSON.stringify(defaultValue));
      }
      return JSON.parse(raw);
    } catch (err) {
      lastErr = err;
      // Brief synchronous spin (15ms) in case another process is finishing a rename/write
      const waitUntil = Date.now() + 15;
      while (Date.now() < waitUntil) {
        // spin
      }
    }
  }

  throw new Error(`Refusing to overwrite non-empty corrupted/locked JSON file ${path.basename(filePath)}: ${lastErr?.message}`);
}

/**
 * Atomically writes JSON data to a temp file in the same directory and renames it over targetPath.
 */
export function atomicWriteJsonSync(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const serialized = JSON.stringify(data, null, 2);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}.tmp`;

  try {
    fs.writeFileSync(tmpPath, serialized, "utf-8");
    try {
      fs.renameSync(tmpPath, filePath);
    } catch (renameErr) {
      // Fallback for Windows NTFS transient handle lock (EPERM / EBUSY)
      fs.writeFileSync(filePath, serialized, "utf-8");
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch (_) {}
    }
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {}
    throw err;
  }
}

/**
 * Serialized Read-Modify-Write helper for shared JSON files.
 * Guarantees in-process mutex isolation, anti-wipe read validation, and atomic temp-file replacement.
 */
export async function safeUpdateJsonFile(filePath, defaultValue, mutatorFn) {
  return withFileLock(filePath, async () => {
    const current = safeReadJsonSync(filePath, defaultValue);
    const updated = await mutatorFn(current);
    const toWrite = updated !== undefined ? updated : current;
    atomicWriteJsonSync(filePath, toWrite);
    return toWrite;
  });
}

/**
 * Creates a counting semaphore to cap simultaneous heavy resources (e.g. headless Chromium browsers).
 */
export function createSemaphore(maxConcurrent = 2) {
  const max = Math.max(1, Number(maxConcurrent) || 1);
  let active = 0;
  const queue = [];

  const acquire = () =>
    new Promise((resolve) => {
      const tryEnter = () => {
        if (active < max) {
          active++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            active--;
            if (queue.length > 0) {
              const next = queue.shift();
              next();
            }
          });
        } else {
          queue.push(tryEnter);
        }
      };
      tryEnter();
    });

  return {
    acquire,
    async run(fn) {
      const release = await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}

/**
 * Executes an async worker function across an array of items with bounded concurrency.
 * Supports optional staggerMs between worker launches and shouldStop() early termination.
 */
export async function runWithConcurrency(items, concurrency, workerFn, options = {}) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const limit = Math.max(1, Math.min(Number(concurrency) || 1, list.length));
  const staggerMs = options.staggerMs ?? 350;
  const shouldStop = typeof options.shouldStop === "function" ? options.shouldStop : () => false;

  const results = new Array(list.length);
  let nextIndex = 0;

  const workers = Array.from({ length: limit }, async (_, workerId) => {
    if (workerId > 0 && staggerMs > 0) {
      await new Promise((r) => setTimeout(r, workerId * staggerMs));
    }
    while (true) {
      if (shouldStop()) break;
      const currentIndex = nextIndex++;
      if (currentIndex >= list.length) break;
      if (shouldStop()) break;
      results[currentIndex] = await workerFn(list[currentIndex], currentIndex, workerId);
    }
  });

  await Promise.all(workers);
  return results.filter((r) => r !== undefined);
}



