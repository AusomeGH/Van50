import "dotenv/config";
import { Stagehand, localBrowser } from "@browserbasehq/stagehand";
import { z } from "zod";

// Define flexible schema so dynamic web representations don't get dropped by strict type checks
const TicketTierSchema = z.object({
  name: z.string().optional().describe("Name of tier, e.g. GA, Early Bird, Door, Student"),
  price_base: z.union([z.number(), z.string()]).optional().describe("Base face value in CAD"),
  price_fee: z.union([z.number(), z.string()]).optional().describe("Platform / service fee in CAD"),
  price_all_in: z.union([z.number(), z.string()]).optional().describe("Total checkout price in CAD"),
});

const EventCardSchema = z.object({
  title: z.string().describe("The name of the event or show"),
  artist: z.string().optional().describe("Headliner, band, or performer"),
  date: z.string().optional().describe("Event date"),
  doors_time: z.string().optional().describe("Doors open time"),
  start_time: z.string().optional().describe("Show / curtain start time"),
  ticket_tiers: z.array(TicketTierSchema).optional().describe("Ticket pricing tiers"),
  age_restriction: z.string().optional().describe("Age policy, e.g. 19+, All Ages"),
  ticket_url: z.string().optional().describe("Full absolute HTTP or HTTPS URL (e.g. https://purchase.theimprovcentre.ca/...) for tickets. NEVER return element IDs, node numbers, or relative refs."),
  is_sold_out: z.boolean().optional().describe("True if marked Sold Out"),
});

const EventsPageSchema = z.object({
  venue_name: z.string().optional().describe("Name of the venue"),
  events: z.array(EventCardSchema).describe("List of upcoming events and shows found on this calendar"),
});

async function runRipper(targetUrl) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "" || apiKey === "YOUR_GEMINI_API_KEY_HERE") {
    console.error("\n❌ Error: GEMINI_API_KEY is not set.");
    console.error("Please add your Google Gemini API key to ripper/.env:\n");
    process.exit(1);
  }

  console.log(`\n🚀 Initializing Stagehand AI Browser...`);
  console.log(`🎯 Target URL: ${targetUrl}`);
  console.log(`🧠 AI Engine: Google Gemini 3.8 Flash\n`);

  let stagehand;
  try {
    const browser = await localBrowser.launch();

    stagehand = await Stagehand.create({
      browser,
      model: {
        modelName: "google/gemini-3.8-flash",
        apiKey: apiKey.trim(),
      },
    });

    console.log(`🌐 Navigating to ${targetUrl}...`);
    const page = await stagehand.browser.context.newPage(targetUrl);
    await new Promise((r) => setTimeout(r, 3500));

    console.log(`🔍 AI is analyzing the page and extracting multi-tier event data...`);
    const extraction = await stagehand.extract(
      "Extract all upcoming cultural and entertainment events on this page. For each event, capture the exact title, date, doors time, start time, age restrictions, the complete absolute HTTP/HTTPS ticket purchase URL (e.g. https://... - never return button or node IDs like 1-768), sold out state, and all ticket pricing tiers with base price, fees, and all-in total in CAD.",
      EventsPageSchema
    );

    const result = extraction.data || extraction;
    console.log(`\n✅ Extraction Complete!`);
    console.log(`🏛️ Venue: ${result.venue_name || "Unknown Venue"}`);
    console.log(`📅 Found ${result.events?.length || 0} events:\n`);

    if (result.events && result.events.length > 0) {
      result.events.forEach((event, i) => {
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`[#${i + 1}] ${event.title}`);
        console.log(`    Artist: ${event.artist || "N/A"}`);
        console.log(`    Date: ${event.date || "TBA"} | Show: ${event.start_time || "TBA"} | Doors: ${event.doors_time || "TBA"}`);
        console.log(`    Age: ${event.age_restriction || "All Ages / Unspecified"} | Sold Out: ${event.is_sold_out ? "YES" : "No"}`);
        console.log(`    Ticket Link: ${event.ticket_url || "None"}`);
        console.log(`    Ticket Tiers:`);
        if (event.ticket_tiers && event.ticket_tiers.length > 0) {
          event.ticket_tiers.forEach((tier) => {
            const price = typeof tier.price_all_in === "number" ? `$${tier.price_all_in.toFixed(2)} CAD` : (tier.price_all_in || "Free/Drop-in");
            console.log(`      • ${tier.name || "General"}: ${price} (Base: ${tier.price_base ?? "N/A"}, Fee: ${tier.price_fee ?? "N/A"})`);
          });
        } else {
          console.log(`      • General Admission (check cart for detailed tier breakdown)`);
        }
      });
      console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    } else {
      console.log(`⚠️ No upcoming events found matching the criteria on this page.`);
      console.log(`🔍 Raw extraction result:`, JSON.stringify(extraction, null, 2));
    }

    return result;
  } catch (err) {
    console.error(`\n❌ Error during Stagehand execution:`, err);
    throw err;
  } finally {
    if (stagehand) {
      console.log(`🧹 Closing browser...`);
      await stagehand.close();
    }
  }
}

// Default test URL if none passed on command line
const testUrl = process.argv[2] || "https://littlemountaingallery.ca/schedule/";

runRipper(testUrl).catch(() => process.exit(1));
