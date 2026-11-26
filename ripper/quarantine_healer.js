#!/usr/bin/env node
/**
 * ripper/quarantine_healer.js
 * Parallel Antigravity AI Quarantine Healer, Searcher & QC Engine
 *
 * Replaces running the entire 6-step pipeline on quarantined items.
 * Dispatches isolated 1-event Antigravity CLI agents in parallel (default concurrency: 4)
 * to inspect each quarantined event's exact blocker, read curator notes/screenshots,
 * search for live ticket links / all-in CAD pricing / upcoming dates, and either:
 *   1. HEAL_AND_PROMOTE  -> updates layers, promotes into data/events.json, evicts from quarantine
 *   2. ARCHIVE_DISQUALIFIED -> moves to data/archived_events.json with positive proof
 *   3. KEEP_QUARANTINED  -> records healer findings & timestamp on the quarantine card
 */

import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import {
  runAntigravityOnce,
  getAntigravityModel,
  formatLogTime,
  printAntigravityTimeoutSummary,
} from "./agy_engine.js";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const LAYERS_DIR = path.join(DATA_DIR, "layers");

const MANUAL_QUEUE_PATH = path.join(DATA_DIR, "manual_review_queue.json");
const EVENTS_PATH = path.join(DATA_DIR, "events.json");
const ARCHIVE_PATH = path.join(DATA_DIR, "archived_events.json");
const INSTRUCTIONS_PATH = path.join(DATA_DIR, "curator_instructions.json");
const BOX_OFFICE_LAYER_PATH = path.join(LAYERS_DIR, "layer_box_office.json");

function parseArgs(argv) {
  const args = {
    ids: [],
    limit: 0,
    concurrency: 4,
    model: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--ids" && argv[i + 1]) {
      args.ids = argv[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (a === "--id" && argv[i + 1]) {
      args.ids.push(argv[++i].trim());
    } else if (a === "--limit" && argv[i + 1]) {
      args.limit = Math.max(0, parseInt(argv[++i], 10) || 0);
    } else if (a === "--concurrency" && argv[i + 1]) {
      args.concurrency = Math.min(8, Math.max(1, parseInt(argv[++i], 10) || 4));
    } else if (a === "--model" && argv[i + 1]) {
      args.model = argv[++i].trim();
    }
  }
  return args;
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

function writeJsonAtomic(filePath, obj) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), "utf8");
  fs.renameSync(tmp, filePath);
}

function getEventId(ev) {
  return String(ev?.id || ev?.event_id || "").trim();
}

function hasCuratorGuidance(ev, instMap) {
  const eid = getEventId(ev);
  return Boolean(
    ev?.dealtWith ||
      ev?.queuedInstruction ||
      ev?.curatorAnnotation?.note ||
      (Array.isArray(ev?.curatorAnnotation?.screenshotPaths) &&
        ev.curatorAnnotation.screenshotPaths.length > 0) ||
      (instMap.has(eid) && instMap.get(eid).length > 0)
  );
}

function buildHealerPrompt(ev, matchedInstructions) {
  const eid = getEventId(ev);
  const title = ev.clean_title || ev.title || ev.event_name || eid;
  const venue = ev.venue_name || ev.venue || "Unknown Venue";
  const city = ev.city || ev.region || "Metro Vancouver";
  const address = ev.full_address || ev.address || "";
  const dateStr = ev.date || ev.dateSchedule || ev.showings?.[0]?.date || "";
  const ticketUrl = ev.candidate_tier1_url || ev.ticket_url || ev.url || "";
  const discoveryUrl = ev.discovery_url || ev.details_url || "";
  const flagReason = ev.flagReason || ev.quarantine_reason || "Flagged for quarantine review";
  const currentPrice = ev.price_all_in ?? ev.attemptedPrice ?? ev.price ?? null;

  const notesList = [];
  if (ev.curatorAnnotation?.note) notesList.push(`Card Note: ${ev.curatorAnnotation.note}`);
  if (ev.curator_notes) notesList.push(`Curator Notes: ${ev.curator_notes}`);
  for (const inst of matchedInstructions || []) {
    if (inst.instruction || inst.note) {
      notesList.push(`Curator Instruction (${inst.status || "pending"}): ${inst.instruction || inst.note}`);
    }
  }
  const screenshotPaths = [
    ...(Array.isArray(ev.curatorAnnotation?.screenshotPaths) ? ev.curatorAnnotation.screenshotPaths : []),
    ...(Array.isArray(ev.screenshotPaths) ? ev.screenshotPaths : []),
  ].filter(Boolean);

  const todayIso = new Date().toISOString().slice(0, 10);

  return `You are a Van50 Antigravity Quarantine Healer & Live Box Office QC Specialist.
Today's date is ${todayIso}.

TARGET QUARANTINED EVENT:
- Event ID: ${eid}
- Title: ${title}
- Venue: ${venue}${address ? ` (${address})` : ""}
- City / Region: ${city}
- Current Date / Schedule: ${dateStr || "Unconfirmed"}
- Current Price Listed: ${currentPrice !== null ? `$${currentPrice} CAD` : "Unconfirmed"}
- Ticket URL: ${ticketUrl || "None"}
- Discovery URL: ${discoveryUrl || "None"}
- Quarantine Reason: ${flagReason}
${notesList.length > 0 ? `- CURATOR GUIDANCE (HIGHEST PRIORITY):\n  ${notesList.join("\n  ")}` : "- Curator Guidance: None"}
${screenshotPaths.length > 0 ? `- Attached Screenshots: ${screenshotPaths.join(", ")}` : ""}

VAN50 MANDATORY PUBLICATION GATES:
1. Metro Vancouver ONLY (Vancouver, Burnaby, Richmond, Surrey, New Westminster, North/West Vancouver, Coquitlam, Port Moody, Langley, Delta, White Rock). Out-of-market cities (Victoria, Whistler, Seattle, Toronto, etc.) MUST be archived.
2. Physical Venue Invariant: venue_name must be a real physical venue (never Eventbrite, Showpass, Ticketmaster, Do604, Songkick).
3. Budget Ceiling: Minimum single-visit Adult/GA all-in price (base + service fees + taxes) MUST be <= $50.00 CAD (or $0.00 Free). Never use optional add-ons or annual memberships.
4. Temporal Reality: Must have an upcoming date >= ${todayIso} or be an active weekly residency / perennial drop-in. Past or cancelled events MUST be archived.
5. Inventory Reality: If ALL eligible single-visit tiers <= $50 CAD are sold out, archive with is_sold_out: true. If at least one eligible tier <= $50 CAD is available, it is NOT sold out.
6. Multi-week courses, private buyouts, or dead/phantom events with no live replacement MUST be archived.

YOUR TASK:
Search the web and/or inspect the live event & ticketing page to HEAL the quarantine issue:
- Find the best working direct ticket checkout URL (Tier 1) or live event page (Tier 2) — never vancouver.ca .aspx links.
- Verify the real all-in single-visit price in CAD (base + fees + tax).
- Confirm the next upcoming date (YYYY-MM-DD), start time, and physical venue details.
- Choose ONE verdict:
  * "HEAL_AND_PROMOTE" — ONLY if you verified a live working URL, upcoming date (or active residency/drop-in), real Metro Vancouver venue, AND all-in price <= $50.00 CAD.
  * "ARCHIVE_DISQUALIFIED" — If you have positive proof the event is > $50.00 CAD all-in, past/cancelled, completely sold out, a multi-week course, out-of-market, or dead/phantom with no active listing.
  * "KEEP_QUARANTINED" — If you still cannot verify mandatory price/date/link after active search and need human curator input.

Return ONLY a single valid JSON object (no markdown fences or commentary outside JSON):
{
  "verdict": "HEAL_AND_PROMOTE" | "ARCHIVE_DISQUALIFIED" | "KEEP_QUARANTINED",
  "confidence": "high" | "medium" | "low",
  "reason": "Concise 1-2 sentence explanation of exact live findings and evidence",
  "healed_title": "Clean event title or null",
  "healed_venue_name": "Real physical venue name or null",
  "healed_address": "Street address in Metro Vancouver or null",
  "healed_city": "Municipality name or null",
  "healed_date": "YYYY-MM-DD or null",
  "healed_start_time": "e.g. 7:30 PM or null",
  "healed_ticket_url": "Direct working https:// URL or null",
  "healed_price_base": 0.0,
  "healed_price_fee": 0.0,
  "healed_price_tax": 0.0,
  "healed_price_all_in": 0.0,
  "is_free": false,
  "is_sold_out": false,
  "ticket_provider": "Showpass | Eventbrite | Ticketmaster | Venue Box Office | Free | etc.",
  "synopsis": "Concise 1-2 sentence editorial description if promoting, else null"
}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const model = args.model || getAntigravityModel();
  const startTime = Date.now();

  console.log(`${formatLogTime()} 🩹 [Quarantine Healer] Starting Parallel Antigravity AI Healing & QC Run`);
  console.log(`${formatLogTime()} ⚙️  Config: Model=${model} | Concurrency=${args.concurrency}x parallel workers | Limit=${args.limit || "All selected"}`);

  const queueDoc = readJsonSafe(MANUAL_QUEUE_PATH, { metadata: {}, quarantinedEvents: [] });
  const rawQueue = Array.isArray(queueDoc.quarantinedEvents) ? queueDoc.quarantinedEvents : [];
  if (rawQueue.length === 0) {
    console.log(`${formatLogTime()} ✅ Quarantine queue is empty — nothing to heal.`);
    return;
  }

  const instDoc = readJsonSafe(INSTRUCTIONS_PATH, { metadata: {}, instructions: [] });
  const instMap = new Map();
  for (const inst of Array.isArray(instDoc.instructions) ? instDoc.instructions : []) {
    const eid = String(inst.eventId || inst.event_id || "").trim();
    if (!eid) continue;
    if (!instMap.has(eid)) instMap.set(eid, []);
    instMap.get(eid).push(inst);
  }

  let targets = rawQueue;
  if (args.ids.length > 0) {
    const idSet = new Set(args.ids);
    targets = rawQueue.filter((e) => idSet.has(getEventId(e)));
  }

  // Prioritize events with saved Curator Notes / screenshots first
  targets = [
    ...targets.filter((e) => hasCuratorGuidance(e, instMap)),
    ...targets.filter((e) => !hasCuratorGuidance(e, instMap)),
  ];

  if (args.limit > 0) {
    targets = targets.slice(0, args.limit);
  }

  if (targets.length === 0) {
    console.log(`${formatLogTime()} ⚠️ No matching quarantined events found for the requested selection.`);
    return;
  }

  console.log(`${formatLogTime()} 📋 Queue loaded: ${targets.length} quarantined event(s) queued across ${Math.min(args.concurrency, targets.length)} parallel Antigravity workers.`);

  // Serialized disk-write lock so parallel workers never corrupt JSON files
  let writeChain = Promise.resolve();
  const enqueueWrite = (fn) => {
    writeChain = writeChain.then(fn, fn);
    return writeChain;
  };

  let promotedCount = 0;
  let archivedCount = 0;
  let keptCount = 0;
  let errorCount = 0;
  let completedCount = 0;

  let nextIdx = 0;

  async function persistOutcome(ev, result) {
    const eid = getEventId(ev);
    const title = ev.clean_title || ev.title || ev.event_name || eid;
    const nowIso = new Date().toISOString();

    await enqueueWrite(async () => {
      const qDoc = readJsonSafe(MANUAL_QUEUE_PATH, { metadata: {}, quarantinedEvents: [] });
      const qList = Array.isArray(qDoc.quarantinedEvents) ? qDoc.quarantinedEvents : [];
      const verdict = String(result?.verdict || "KEEP_QUARANTINED").toUpperCase();

      // Safety double-check: never promote if all-in price > 50 or missing URL
      const allInPrice =
        typeof result?.healed_price_all_in === "number" && !Number.isNaN(result.healed_price_all_in)
          ? Number(result.healed_price_all_in)
          : result?.is_free
          ? 0
          : null;
      const healedUrl = String(result?.healed_ticket_url || ev.candidate_tier1_url || ev.ticket_url || ev.url || "").trim();
      const canPromote =
        verdict === "HEAL_AND_PROMOTE" &&
        allInPrice !== null &&
        allInPrice <= 50.0 &&
        Boolean(healedUrl) &&
        !healedUrl.toLowerCase().includes(".aspx") &&
        !result?.is_sold_out;

      if (canPromote) {
        // 1. Remove from quarantine queue
        qDoc.quarantinedEvents = qList.filter((x) => getEventId(x) !== eid);
        qDoc.metadata = {
          ...(qDoc.metadata || {}),
          updatedAt: nowIso,
          pendingCount: qDoc.quarantinedEvents.length,
          quarantinedCount: qDoc.quarantinedEvents.length,
          totalQuarantined: qDoc.quarantinedEvents.length,
        };
        writeJsonAtomic(MANUAL_QUEUE_PATH, qDoc);

        // 2. Promote/merge into data/events.json
        const eventsRaw = readJsonSafe(EVENTS_PATH, []);
        const isArrayFormat = Array.isArray(eventsRaw);
        const eventsArr = isArrayFormat ? eventsRaw : Array.isArray(eventsRaw.events) ? eventsRaw.events : [];

        const promotedCard = {
          ...ev,
          id: eid,
          event_id: eid,
          title: result.healed_title || ev.clean_title || ev.title || title,
          clean_title: result.healed_title || ev.clean_title || ev.title || title,
          venue: result.healed_venue_name || ev.venue_name || ev.venue || "Vancouver",
          venue_name: result.healed_venue_name || ev.venue_name || ev.venue || "Vancouver",
          address: result.healed_address || ev.full_address || ev.address || "",
          full_address: result.healed_address || ev.full_address || ev.address || "",
          city: result.healed_city || ev.city || "Vancouver",
          date: result.healed_date || ev.date || null,
          start_time: result.healed_start_time || ev.start_time || ev.time || null,
          ticket_url: healedUrl,
          candidate_tier1_url: healedUrl,
          url: healedUrl,
          price: allInPrice,
          price_all_in: allInPrice,
          price_base: typeof result.healed_price_base === "number" ? result.healed_price_base : allInPrice,
          price_fee: typeof result.healed_price_fee === "number" ? result.healed_price_fee : 0,
          price_tax: typeof result.healed_price_tax === "number" ? result.healed_price_tax : 0,
          is_free: Boolean(result.is_free || allInPrice === 0),
          is_sold_out: false,
          ticket_provider: result.ticket_provider || ev.ticket_provider || "Verified Box Office",
          description: result.synopsis || ev.description || ev.synopsis || "",
          synopsis: result.synopsis || ev.synopsis || ev.description || "",
          healed_by_agy: true,
          healed_at: nowIso,
          healer_reason: result.reason || "Healed by Parallel Antigravity AI Quarantine Healer",
          last_verified_at: nowIso,
        };
        delete promotedCard.flagReason;
        delete promotedCard.quarantine_reason;

        const existingIdx = eventsArr.findIndex((x) => getEventId(x) === eid);
        if (existingIdx >= 0) {
          eventsArr[existingIdx] = { ...eventsArr[existingIdx], ...promotedCard };
        } else {
          eventsArr.push(promotedCard);
        }
        if (isArrayFormat) {
          writeJsonAtomic(EVENTS_PATH, eventsArr);
        } else {
          eventsRaw.events = eventsArr;
          writeJsonAtomic(EVENTS_PATH, eventsRaw);
        }

        // 3. Record verified pricing into layer_box_office.json
        const boxLayer = readJsonSafe(BOX_OFFICE_LAYER_PATH, {});
        boxLayer[eid] = {
          ...(boxLayer[eid] || {}),
          event_id: eid,
          ticket_url: healedUrl,
          price_all_in: allInPrice,
          price_base: promotedCard.price_base,
          price_fee: promotedCard.price_fee,
          price_tax: promotedCard.price_tax,
          is_sold_out: false,
          verified_at: nowIso,
          verified_by: `quarantine_healer (${model})`,
        };
        writeJsonAtomic(BOX_OFFICE_LAYER_PATH, boxLayer);

        // 4. Mark matching curator instructions resolved
        resolveInstructionsForEvent(eid, `Healed & promoted ($${allInPrice.toFixed(2)} CAD): ${result.reason || ""}`, nowIso);
        promotedCount++;
        console.log(`${formatLogTime()} ✅ [HEALED & PROMOTED] "${promotedCard.title}" [${eid}] → $${allInPrice.toFixed(2)} CAD | ${healedUrl} | ${result.reason}`);
        console.log(`🩹 [HEALER_EVENT_JSON] ${JSON.stringify({
          id: eid,
          verdict: "HEAL_AND_PROMOTE",
          title: promotedCard.title,
          venue: promotedCard.venue_name,
          address: promotedCard.full_address,
          date: promotedCard.date,
          start_time: promotedCard.start_time,
          ticket_url: healedUrl,
          price_all_in: allInPrice,
          price_base: promotedCard.price_base,
          price_fee: promotedCard.price_fee,
          price_tax: promotedCard.price_tax,
          ticket_provider: promotedCard.ticket_provider,
          is_sold_out: false,
          synopsis: promotedCard.synopsis,
          reason: result.reason || "Healed & promoted to live catalog",
        })}`);
      } else if (verdict === "ARCHIVE_DISQUALIFIED" || (verdict === "HEAL_AND_PROMOTE" && allInPrice !== null && allInPrice > 50.0)) {
        // Move to archived_events.json
        qDoc.quarantinedEvents = qList.filter((x) => getEventId(x) !== eid);
        qDoc.metadata = {
          ...(qDoc.metadata || {}),
          updatedAt: nowIso,
          pendingCount: qDoc.quarantinedEvents.length,
          quarantinedCount: qDoc.quarantinedEvents.length,
          totalQuarantined: qDoc.quarantinedEvents.length,
        };
        writeJsonAtomic(MANUAL_QUEUE_PATH, qDoc);

        const archDoc = readJsonSafe(ARCHIVE_PATH, { metadata: {}, archivedEvents: [] });
        const archList = Array.isArray(archDoc) ? archDoc : Array.isArray(archDoc.archivedEvents) ? archDoc.archivedEvents : [];
        const archiveEntry = {
          ...ev,
          archivedAt: nowIso,
          archivedBy: `Antigravity Quarantine Healer (${model})`,
          archiveReason: result?.reason || "Disqualified during parallel AI quarantine healing",
          isSoldOut: Boolean(result?.is_sold_out),
          verifiedPriceAllIn: allInPrice,
        };
        const filteredArch = archList.filter((x) => getEventId(x) !== eid);
        filteredArch.unshift(archiveEntry);
        if (Array.isArray(archDoc)) {
          writeJsonAtomic(ARCHIVE_PATH, filteredArch);
        } else {
          archDoc.archivedEvents = filteredArch;
          archDoc.metadata = { ...(archDoc.metadata || {}), updatedAt: nowIso, totalArchived: filteredArch.length };
          writeJsonAtomic(ARCHIVE_PATH, archDoc);
        }

        resolveInstructionsForEvent(eid, `Archived by Quarantine Healer: ${result?.reason || ""}`, nowIso);
        archivedCount++;
        console.log(`${formatLogTime()} 🗄️  [ARCHIVED] "${title}" [${eid}] → ${result?.reason || "Disqualified"}`);
        console.log(`🩹 [HEALER_EVENT_JSON] ${JSON.stringify({
          id: eid,
          verdict: "ARCHIVE_DISQUALIFIED",
          title: result?.healed_title || title,
          venue: result?.healed_venue_name || ev.venue_name || ev.venue || "",
          date: result?.healed_date || ev.date || null,
          start_time: result?.healed_start_time || ev.start_time || ev.time || null,
          ticket_url: healedUrl || null,
          price_all_in: allInPrice,
          price_base: typeof result?.healed_price_base === "number" ? result.healed_price_base : null,
          price_fee: typeof result?.healed_price_fee === "number" ? result.healed_price_fee : null,
          price_tax: typeof result?.healed_price_tax === "number" ? result.healed_price_tax : null,
          ticket_provider: result?.ticket_provider || ev.ticket_provider || null,
          is_sold_out: Boolean(result?.is_sold_out),
          reason: result?.reason || "Disqualified during parallel AI quarantine healing",
        })}`);
      } else {
        // Keep in quarantine, update notes so curator knows what AI checked
        const idx = qList.findIndex((x) => getEventId(x) === eid);
        if (idx >= 0) {
          qList[idx] = {
            ...qList[idx],
            last_healed_at: nowIso,
            healer_model: model,
            healer_notes: result?.reason || "No verifiable live checkout link/price found yet.",
            candidate_tier1_url: result?.healed_ticket_url || qList[idx].candidate_tier1_url || "",
          };
          qDoc.quarantinedEvents = qList;
          qDoc.metadata = { ...(qDoc.metadata || {}), updatedAt: nowIso };
          writeJsonAtomic(MANUAL_QUEUE_PATH, qDoc);
        }
        keptCount++;
        console.log(`${formatLogTime()} ⏸️  [STILL QUARANTINED] "${title}" [${eid}] → ${result?.reason || "Needs manual curator guidance"}`);
        console.log(`🩹 [HEALER_EVENT_JSON] ${JSON.stringify({
          id: eid,
          verdict: "KEEP_QUARANTINED",
          title: result?.healed_title || title,
          venue: result?.healed_venue_name || ev.venue_name || ev.venue || "",
          date: result?.healed_date || ev.date || null,
          start_time: result?.healed_start_time || ev.start_time || ev.time || null,
          ticket_url: healedUrl || null,
          price_all_in: allInPrice,
          price_base: typeof result?.healed_price_base === "number" ? result.healed_price_base : null,
          price_fee: typeof result?.healed_price_fee === "number" ? result.healed_price_fee : null,
          price_tax: typeof result?.healed_price_tax === "number" ? result.healed_price_tax : null,
          ticket_provider: result?.ticket_provider || ev.ticket_provider || null,
          is_sold_out: Boolean(result?.is_sold_out),
          reason: result?.reason || "Needs manual curator guidance",
        })}`);
      }
    });
  }

  function resolveInstructionsForEvent(eid, summary, nowIso) {
    try {
      if (!fs.existsSync(INSTRUCTIONS_PATH)) return;
      const doc = readJsonSafe(INSTRUCTIONS_PATH, { metadata: {}, instructions: [] });
      if (!Array.isArray(doc.instructions)) return;
      let changed = false;
      for (const inst of doc.instructions) {
        if (String(inst.eventId || inst.event_id || "").trim() === eid && inst.status !== "resolved") {
          inst.status = "resolved";
          inst.resolvedAt = nowIso;
          inst.resolutionSummary = summary;
          changed = true;
        }
      }
      if (changed) {
        doc.metadata = {
          ...(doc.metadata || {}),
          updatedAt: nowIso,
          pendingCount: doc.instructions.filter((i) => i.status === "pending").length,
        };
        writeJsonAtomic(INSTRUCTIONS_PATH, doc);
      }
    } catch (_) { }
  }

  async function workerLoop(workerNum) {
    while (true) {
      const myIdx = nextIdx++;
      if (myIdx >= targets.length) break;
      const ev = targets[myIdx];
      const eid = getEventId(ev);
      const title = ev.clean_title || ev.title || ev.event_name || eid;
      const matchedInst = instMap.get(eid) || [];

      console.log(`${formatLogTime()} 🔎 [Worker ${workerNum}/${Math.min(args.concurrency, targets.length)}] (${myIdx + 1}/${targets.length}) Healing "${title}" [${eid}]...`);
      try {
        const prompt = buildHealerPrompt(ev, matchedInst);
        const result = await runAntigravityOnce(prompt, {
          model,
          timeoutMs: 110000,
          label: `Quarantine Heal: ${title}`,
          eventId: eid,
          eventTitle: title,
          stage: "AI Quarantine Healer",
        });
        if (!result) {
          errorCount++;
          console.warn(`${formatLogTime()} ⚠️  [Worker ${workerNum}] No structured verdict returned for "${title}" [${eid}] — leaving in quarantine.`);
        } else {
          await persistOutcome(ev, result);
        }
      } catch (err) {
        errorCount++;
        console.error(`${formatLogTime()} ❌ [Worker ${workerNum}] Error healing "${title}" [${eid}]: ${err.message || err}`);
      } finally {
        completedCount++;
        console.log(`${formatLogTime()} 📊 Progress: ${completedCount}/${targets.length} processed (✅ ${promotedCount} promoted | 🗄️ ${archivedCount} archived | ⏸️ ${keptCount} kept | ❌ ${errorCount} errors)`);
      }
    }
  }

  const workerCount = Math.min(args.concurrency, targets.length);
  await Promise.all(Array.from({ length: workerCount }, (_, idx) => workerLoop(idx + 1)));

  // Sync js/data.js if any events were promoted
  if (promotedCount > 0) {
    console.log(`${formatLogTime()} 🔄 Syncing js/data.js after promoting ${promotedCount} healed event(s)...`);
    try {
      const pyBin = "C:\\Users\\Micro\\AppData\\Local\\Python\\bin\\python.exe";
      await execFileAsync(pyBin, [path.join(ROOT_DIR, "scripts", "sync_data_js.py")], {
        cwd: ROOT_DIR,
        timeout: 30000,
        windowsHide: true,
      });
      console.log(`${formatLogTime()} ✅ js/data.js synced successfully.`);
    } catch (syncErr) {
      console.warn(`${formatLogTime()} ⚠️ Failed to sync js/data.js: ${syncErr.message}`);
    }
  }

  printAntigravityTimeoutSummary("Parallel AI Quarantine Healer");
  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n================================================================`);
  console.log(`🩹 PARALLEL AI QUARANTINE HEALER COMPLETE in ${totalSec}s`);
  console.log(`   Processed: ${completedCount}/${targets.length} (${workerCount}x parallel Antigravity workers)`);
  console.log(`   ✅ Healed & Promoted: ${promotedCount}`);
  console.log(`   🗄️  Archived (Disqualified): ${archivedCount}`);
  console.log(`   ⏸️  Kept in Quarantine: ${keptCount}`);
  console.log(`   ❌ Errors / Timeouts: ${errorCount}`);
  console.log(`================================================================\n`);
}

main().catch((err) => {
  console.error("Fatal Quarantine Healer error:", err);
  process.exit(1);
});
