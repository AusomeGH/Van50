#!/usr/bin/env node
/**
 * ripper/venue_radar.js
 * Parallel 4x Antigravity AI Venue Finder Radar
 *
 * Scans the 4 low-pass-rate aggregator sources (Do604, ShowHub Vancouver,
 * The Georgia Straight, Vancouver's Best Places) strictly as VENUE FINDERS
 * rather than event scrapers:
 *   Phase 1 (Parallel 4x Workers): Sweep selected radar sources to extract unique
 *            physical Metro Vancouver venues hosting upcoming <=$50 events.
 *   Phase 2 (Deduplication): Diff against data/venues.json, data/discovery_sources.json,
 *            and previously approved/ignored radar entries to isolate net-new venues.
 *   Phase 3 (Parallel 4x Workers): Resolve each net-new venue's official /events
 *            calendar URL, street address, municipality, and ticketing platform.
 *   Output: Persists per-source last_scanned_at telemetry and proposed venues to
 *           data/venue_radar_state.json for 1-click approval in Curator Studio.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  runAntigravityOnce,
  getAntigravityModel,
  formatLogTime,
  printAntigravityTimeoutSummary,
} from "./agy_engine.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");

const DISCOVERY_SOURCES_PATH = path.join(DATA_DIR, "discovery_sources.json");
const VENUES_PATH = path.join(DATA_DIR, "venues.json");
const SURREY_REF_PATH = path.join(DATA_DIR, "surrey_reference_sources.json");
const RADAR_STATE_PATH = path.join(DATA_DIR, "venue_radar_state.json");

const DEFAULT_RADAR_SOURCES = [
  {
    id: "do604",
    name: "Do604",
    url: "https://do604.com/events",
    focus: "Broad Metro Vancouver bars, indie rooms, pop-ups & comedy nights",
  },
  {
    id: "showhub-vancouver",
    name: "ShowHub Vancouver",
    url: "https://showhub.ca/",
    focus: "East Van indie, punk & DIY music spaces, legions & small galleries",
  },
  {
    id: "georgia-straight",
    name: "The Georgia Straight",
    url: "https://www.straight.com/listings",
    focus: "Community halls, indie theatres, arts spaces & neighbourhood festivals",
  },
  {
    id: "vancouver-s-best-places-calendar",
    name: "Vancouver's Best Places",
    url: "https://vancouversbestplaces.com/events-calendar",
    focus: "Seasonal festivals, night markets & suburban civic event venues",
  },
];

function parseArgs(argv) {
  const args = {
    sources: [],
    concurrency: 4,
    maxNew: 16,
    model: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if ((a === "--sources" || a === "--ids") && argv[i + 1]) {
      args.sources = argv[++i]
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if ((a === "--source" || a === "--id") && argv[i + 1]) {
      args.sources.push(argv[++i].trim());
    } else if (a === "--concurrency" && argv[i + 1]) {
      args.concurrency = Math.min(8, Math.max(1, parseInt(argv[++i], 10) || 4));
    } else if ((a === "--max-new" || a === "--limit") && argv[i + 1]) {
      args.maxNew = Math.min(40, Math.max(1, parseInt(argv[++i], 10) || 16));
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

function normVenueName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/^the\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function loadExistingVenueSignatures() {
  const names = new Set();
  const hosts = new Set();

  const addName = (n) => {
    const norm = normVenueName(n);
    if (norm.length >= 3) names.add(norm);
  };
  const addHost = (u) => {
    try {
      const h = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
      if (h && !/eventbrite|showpass|ticketmaster|ticketweb|admitone|tixr|do604|straight|showhub|vancouversbestplaces/i.test(h)) {
        hosts.add(h);
      }
    } catch (_) {}
  };

  const venues = readJsonSafe(VENUES_PATH, []);
  const vArr = Array.isArray(venues) ? venues : Object.values(venues || {});
  for (const v of vArr) {
    addName(v?.venue_name || v?.name);
    addHost(v?.calendar_url || v?.website_url || v?.url);
  }

  const discDoc = readJsonSafe(DISCOVERY_SOURCES_PATH, { sources: [] });
  const discArr = Array.isArray(discDoc) ? discDoc : discDoc.sources || [];
  for (const s of discArr) {
    if (s?.role === "venue_radar") continue;
    addName(s?.name || s?.venue_name);
    addHost(s?.eventsUrl || s?.calendarUrl || s?.url);
  }

  const surreyRef = readJsonSafe(SURREY_REF_PATH, []);
  const srArr = Array.isArray(surreyRef) ? surreyRef : surreyRef.sources || [];
  for (const s of srArr) {
    addName(s?.name || s?.venue_name);
    addHost(s?.eventsUrl || s?.url);
  }

  return { names, hosts };
}

function isVenueKnown(venueName, existingNames, stateDoc) {
  const norm = normVenueName(venueName);
  if (!norm || norm.length < 3) return true;
  if (existingNames.has(norm)) return true;
  for (const ex of existingNames) {
    if (ex.length >= 6 && (norm.includes(ex) || ex.includes(norm))) return true;
  }
  const existingProposed = Array.isArray(stateDoc?.proposedVenues) ? stateDoc.proposedVenues : [];
  for (const p of existingProposed) {
    const pNorm = normVenueName(p.venue_name);
    if (pNorm === norm) return true;
  }
  return false;
}

function loadRadarSourcesFromConfig(requestedIds) {
  const discDoc = readJsonSafe(DISCOVERY_SOURCES_PATH, { sources: [] });
  const discArr = Array.isArray(discDoc) ? discDoc : discDoc.sources || [];
  const configured = discArr
    .filter((s) => s && (s.role === "venue_radar" || s.type === "venue_radar"))
    .map((s) => ({
      id: s.id,
      name: s.name || s.id,
      url: s.eventsUrl || s.calendarUrl || s.url || "",
      focus: s.description || s.focus || "Metro Vancouver event aggregator",
    }));

  const pool = configured.length > 0 ? configured : DEFAULT_RADAR_SOURCES;
  if (requestedIds && requestedIds.length > 0) {
    const reqSet = new Set(requestedIds.map((x) => x.toLowerCase()));
    const filtered = pool.filter((s) => reqSet.has(String(s.id).toLowerCase()));
    if (filtered.length > 0) return filtered;
  }
  return pool;
}

function loadOrInitRadarState(radarSources) {
  const doc = readJsonSafe(RADAR_STATE_PATH, {
    metadata: { version: "1.0.0", updatedAt: null, lastRunAt: null },
    sources: {},
    proposedVenues: [],
  });
  if (!doc.sources || typeof doc.sources !== "object") doc.sources = {};
  if (!Array.isArray(doc.proposedVenues)) doc.proposedVenues = [];

  for (const s of radarSources) {
    if (!doc.sources[s.id]) {
      doc.sources[s.id] = {
        id: s.id,
        name: s.name,
        url: s.url,
        focus: s.focus,
        last_scanned_at: null,
        last_duration_sec: null,
        venues_extracted: 0,
        new_venues_found: 0,
        status: "never_scanned",
      };
    } else {
      doc.sources[s.id].name = s.name;
      doc.sources[s.id].url = s.url;
      if (s.focus) doc.sources[s.id].focus = s.focus;
    }
  }
  return doc;
}

function buildRadarSweepPrompt(src, todayIso) {
  return `You are a Van50 Venue Radar Specialist. Today's date is ${todayIso}.

TASK: Inspect the Metro Vancouver event aggregator "${src.name}" (${src.url}) to discover REAL PHYSICAL VENUES hosting upcoming local events (concerts, comedy, theatre, arts, trivia, markets, workshops, festivals) that are typically <= $50 CAD.

STRICT RULES:
1. Extract PHYSICAL VENUES ONLY — never ticketing platforms (Eventbrite, Showpass, Ticketmaster), never "TBA", "Online", "Virtual", "Private Location", or "Various Locations".
2. Metro Vancouver ONLY (Vancouver, Burnaby, Richmond, Surrey, New Westminster, North Vancouver, West Vancouver, Coquitlam, Port Coquitlam, Port Moody, Langley, Delta, White Rock, Maple Ridge, Bowen Island). Reject Victoria, Whistler, Abbotsford, Kelowna, Seattle, etc.
3. Prefer independent music rooms, comedy clubs, breweries, cafes, galleries, community theatres, civic centres, and recurring pop-up spaces rather than giant stadiums (Rogers Arena, BC Place) whose shows are mostly > $50 CAD.
4. Return up to 15 distinct active venues currently hosting upcoming events on ${src.name}.

Return ONLY a single valid JSON object (no markdown fences or commentary):
{
  "source_id": "${src.id}",
  "venues": [
    {
      "venue_name": "Exact physical venue name",
      "city": "Municipality in Metro Vancouver (e.g. Vancouver, Burnaby, Surrey, New Westminster, Richmond, Langley, North Vancouver, Port Moody)",
      "category_hint": "music | shows | cinema | arts | social | markets | festivals | outdoors | sports",
      "sample_events": ["Sample upcoming event title 1", "Sample upcoming event title 2"]
    }
  ]
}`;
}

function buildVenueResolvePrompt(cand, todayIso) {
  return `You are a Van50 Venue Calendar Resolver. Today's date is ${todayIso}.

We discovered a candidate Metro Vancouver physical venue via ${cand.discovered_via.join(", ")}:
- Venue Name: ${cand.venue_name}
- City: ${cand.city || "Metro Vancouver"}
- Sample Upcoming Events: ${(cand.sample_events || []).slice(0, 3).join(" | ") || "Unknown"}

TASK: Find this venue's OFFICIAL events/calendar URL so Van50 can harvest it directly in Step 1A (never vancouver.ca .aspx links, never Do604/Songkick/aggregator links).
Verify:
1. Is this a real physical venue in Metro Vancouver?
2. What is its direct official events/calendar page URL (or its primary Showpass/Eventbrite/TicketWeb/Tixr organizer page if it has no website calendar)?
3. What is its street address, municipality, and primary ticketing platform?
4. Are its events typically <= $50 CAD?

Return ONLY a single valid JSON object (no markdown fences or commentary):
{
  "is_valid_metro_van_venue": true,
  "venue_name": "Clean canonical physical venue name",
  "city": "Municipality name",
  "address": "Street address or null",
  "official_events_url": "https://... direct venue calendar or organizer page URL, or null",
  "ticketing_platform": "Direct Box Office | Eventbrite | Showpass | TicketWeb | AdmitONE | Tixr | Zeffy | Free Drop-In | Other",
  "typical_under_50": true,
  "notes": "1 concise sentence explaining what this venue hosts and why it fits (or doesn't fit) Van50"
}`;
}

async function main() {
  const args = parseArgs(process.argv);
  const model = args.model || getAntigravityModel();
  const startTime = Date.now();
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const radarSources = loadRadarSourcesFromConfig(args.sources);
  const stateDoc = loadOrInitRadarState(radarSources);
  const { names: existingVenueNames, hosts: existingHosts } = loadExistingVenueSignatures();

  console.log(`${formatLogTime()} 📡 [Venue Finder Radar] Starting Parallel ${Math.min(args.concurrency, radarSources.length)}x Antigravity AI Radar Scan`);
  console.log(`${formatLogTime()} ⚙️  Config: Model=${model} | Concurrency=${args.concurrency}x workers | Radar Sources=${radarSources.length} | Max New Venues=${args.maxNew}`);
  console.log(`${formatLogTime()} 📋 Radar Queue: ${radarSources.length} aggregator source(s) queued across ${Math.min(args.concurrency, radarSources.length)} parallel Antigravity workers.`);

  // Serialized disk-write lock
  let writeChain = Promise.resolve();
  const enqueueWrite = (fn) => {
    writeChain = writeChain.then(fn, fn);
    return writeChain;
  };

  // === PHASE 1: PARALLEL RADAR SWEEP (4x WORKERS) ===
  const rawDiscoveredMap = new Map();
  let sourcesCompleted = 0;
  let totalExtracted = 0;
  let nextSrcIdx = 0;

  async function sweepWorker(workerNum) {
    while (true) {
      const idx = nextSrcIdx++;
      if (idx >= radarSources.length) break;
      const src = radarSources[idx];
      const sStart = Date.now();
      console.log(`${formatLogTime()} 🔎 [Worker ${workerNum}/${Math.min(args.concurrency, radarSources.length)}] (${idx + 1}/${radarSources.length}) Scanning Radar Source "${src.name}" [${src.id}]...`);

      try {
        const result = await runAntigravityOnce(buildRadarSweepPrompt(src, todayIso), {
          model,
          timeoutMs: 110000,
          label: `Venue Radar Sweep: ${src.name}`,
          eventId: src.id,
          eventTitle: src.name,
          stage: "Venue Finder Radar",
        });

        const venuesList = Array.isArray(result?.venues) ? result.venues : [];
        let newForThisSource = 0;
        for (const v of venuesList) {
          const vName = String(v?.venue_name || "").trim();
          if (!vName) continue;
          const norm = normVenueName(vName);
          if (!norm || /tba|unknown|online|virtual|various|private/i.test(norm)) continue;
          totalExtracted++;
          if (!isVenueKnown(vName, existingVenueNames, stateDoc)) {
            if (!rawDiscoveredMap.has(norm)) {
              rawDiscoveredMap.set(norm, {
                venue_name: vName,
                city: String(v?.city || "Vancouver").trim(),
                category_hint: String(v?.category_hint || "shows").trim(),
                sample_events: Array.isArray(v?.sample_events) ? v.sample_events.slice(0, 3) : [],
                discovered_via: [src.name],
              });
              newForThisSource++;
            } else {
              const ex = rawDiscoveredMap.get(norm);
              if (!ex.discovered_via.includes(src.name)) ex.discovered_via.push(src.name);
            }
          }
        }

        const durSec = Number(((Date.now() - sStart) / 1000).toFixed(1));
        const nowIso = new Date().toISOString();
        await enqueueWrite(() => {
          stateDoc.sources[src.id] = {
            ...(stateDoc.sources[src.id] || {}),
            id: src.id,
            name: src.name,
            url: src.url,
            focus: src.focus,
            last_scanned_at: nowIso,
            last_duration_sec: durSec,
            venues_extracted: venuesList.length,
            new_venues_found: newForThisSource,
            status: "ok",
          };
          stateDoc.metadata = {
            ...(stateDoc.metadata || {}),
            updatedAt: nowIso,
            lastRunAt: nowIso,
          };
          writeJsonAtomic(RADAR_STATE_PATH, stateDoc);
        });

        console.log(`${formatLogTime()} ✅ [RADAR SWEPT] "${src.name}" [${src.id}] → ${venuesList.length} venue(s) extracted, ${newForThisSource} net-new candidate(s) (${durSec}s)`);
        console.log(`📡 [VENUE_RADAR_SOURCE_JSON] ${JSON.stringify(stateDoc.sources[src.id])}`);
      } catch (err) {
        const durSec = Number(((Date.now() - sStart) / 1000).toFixed(1));
        const nowIso = new Date().toISOString();
        await enqueueWrite(() => {
          stateDoc.sources[src.id] = {
            ...(stateDoc.sources[src.id] || {}),
            id: src.id,
            name: src.name,
            url: src.url,
            last_scanned_at: nowIso,
            last_duration_sec: durSec,
            status: "error",
            last_error: String(err.message || err).slice(0, 200),
          };
          writeJsonAtomic(RADAR_STATE_PATH, stateDoc);
        });
        console.error(`${formatLogTime()} ❌ [Worker ${workerNum}] Error scanning "${src.name}" [${src.id}]: ${err.message || err}`);
      } finally {
        sourcesCompleted++;
        console.log(`${formatLogTime()} 📊 Radar Sweep Progress: ${sourcesCompleted}/${radarSources.length} sources scanned (${rawDiscoveredMap.size} net-new venue candidates found)`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(args.concurrency, radarSources.length) }, (_, i) => sweepWorker(i + 1))
  );

  // === PHASE 2: PARALLEL OFFICIAL CALENDAR RESOLUTION (4x WORKERS) ===
  const candidates = Array.from(rawDiscoveredMap.values()).slice(0, args.maxNew);
  let resolvedCount = 0;
  let addedProposedCount = 0;
  let rejectedCount = 0;

  if (candidates.length === 0) {
    console.log(`${formatLogTime()} ✅ All venues spotted on radar sources are already tracked in Van50 — 0 net-new venues to resolve.`);
  } else {
    console.log(`${formatLogTime()} 🏛️  Phase 2: Resolving official event calendars for ${candidates.length} net-new venue(s) across ${Math.min(args.concurrency, candidates.length)} parallel workers...`);
    let nextCandIdx = 0;

    async function resolveWorker(workerNum) {
      while (true) {
        const idx = nextCandIdx++;
        if (idx >= candidates.length) break;
        const cand = candidates[idx];
        console.log(`${formatLogTime()} 🔎 [Worker ${workerNum}/${Math.min(args.concurrency, candidates.length)}] (${idx + 1}/${candidates.length}) Resolving Venue Calendar "${cand.venue_name}" (${cand.city})...`);

        try {
          const res = await runAntigravityOnce(buildVenueResolvePrompt(cand, todayIso), {
            model,
            timeoutMs: 95000,
            label: `Resolve Venue: ${cand.venue_name}`,
            eventId: slugify(cand.venue_name),
            eventTitle: cand.venue_name,
            stage: "Venue Calendar Resolver",
          });

          const url = String(res?.official_events_url || "").trim();
          let hostAlreadyKnown = false;
          if (url) {
            try {
              const h = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
              if (existingHosts.has(h)) hostAlreadyKnown = true;
            } catch (_) {}
          }

          if (res && res.is_valid_metro_van_venue && url && !/\.aspx$/i.test(url) && !hostAlreadyKnown) {
            const nowIso = new Date().toISOString();
            const entry = {
              id: `radar-${slugify(res.venue_name || cand.venue_name)}`,
              venue_name: res.venue_name || cand.venue_name,
              city: res.city || cand.city || "Vancouver",
              address: res.address || "",
              official_events_url: url,
              ticketing_platform: res.ticketing_platform || "Direct Box Office",
              typical_under_50: res.typical_under_50 !== false,
              category_hint: cand.category_hint || "shows",
              sample_events: cand.sample_events || [],
              discovered_via: cand.discovered_via || [],
              notes: res.notes || "",
              discovered_at: nowIso,
              status: "pending",
            };

            await enqueueWrite(() => {
              const exists = stateDoc.proposedVenues.some(
                (p) => normVenueName(p.venue_name) === normVenueName(entry.venue_name)
              );
              if (!exists) {
                stateDoc.proposedVenues.unshift(entry);
                stateDoc.metadata = {
                  ...(stateDoc.metadata || {}),
                  updatedAt: nowIso,
                  pendingCount: stateDoc.proposedVenues.filter((p) => p.status === "pending").length,
                };
                writeJsonAtomic(RADAR_STATE_PATH, stateDoc);
                addedProposedCount++;
              }
            });

            console.log(`${formatLogTime()} ✨ [NEW VENUE DISCOVERED] "${entry.venue_name}" (${entry.city}) → ${entry.official_events_url} [${entry.ticketing_platform}]`);
            console.log(`📡 [VENUE_RADAR_CANDIDATE_JSON] ${JSON.stringify(entry)}`);
          } else {
            rejectedCount++;
            console.log(`${formatLogTime()} ⏭️  [SKIPPED CANDIDATE] "${cand.venue_name}" → ${hostAlreadyKnown ? "Already tracked by domain" : (res?.notes || "Not a valid <=$50 Metro Van venue calendar")}`);
          }
        } catch (err) {
          rejectedCount++;
          console.error(`${formatLogTime()} ❌ [Worker ${workerNum}] Error resolving "${cand.venue_name}": ${err.message || err}`);
        } finally {
          resolvedCount++;
          console.log(`${formatLogTime()} 📊 Progress: ${resolvedCount}/${candidates.length} venues resolved (✨ ${addedProposedCount} new proposed | ⏭️ ${rejectedCount} skipped)`);
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(args.concurrency, candidates.length) }, (_, i) => resolveWorker(i + 1))
    );
  }

  printAntigravityTimeoutSummary("Parallel AI Venue Finder Radar");
  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  const pendingTotal = stateDoc.proposedVenues.filter((p) => p.status === "pending").length;
  console.log(`\n================================================================`);
  console.log(`📡 PARALLEL AI VENUE FINDER RADAR COMPLETE in ${totalSec}s`);
  console.log(`   Sources Swept: ${sourcesCompleted}/${radarSources.length} (${Math.min(args.concurrency, radarSources.length)}x parallel workers)`);
  console.log(`   Venues Extracted: ${totalExtracted} | Net-New Candidates Resolved: ${resolvedCount}`);
  console.log(`   ✨ New Venues Proposed: ${addedProposedCount} (Total Pending Review: ${pendingTotal})`);
  console.log(`================================================================\n`);
}

main().catch((err) => {
  console.error("Fatal Venue Radar error:", err);
  process.exit(1);
});
