#!/usr/bin/env bun
// Fryser en BRED, mångsidig sajtkorpus (bortom flottans SaaS-landningssidor —
// e-handel, media, dev, fintech, konsument) för capture-eval:s skala-test
// (kapacitet steg 1). Statisk frysning (curl-vägen fungerar lokalt); sajter som
// bot-blockar/timear hoppas (freeze_failed). Återupptagbart: redan frysta hoppas.
//
//   bun run scripts/capture-eval/freeze-corpus.ts [--conc=6]

import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const CONC = Math.max(1, Number(arg("conc") ?? 6));
const OUT = "capture-corpus";
mkdirSync(OUT, { recursive: true });

// ~160 riktiga, upplösbara domäner tvärs sidtyper. Overlap med flottan är ok —
// separat korpus. Vikten ligger på ICKE-SaaS (e-handel/media/konsument) där
// capture-robusthet aldrig testats.
const DOMAINS = [
  // e-commerce / DTC
  "nike.com","allbirds.com","gymshark.com","warbyparker.com","casper.com","glossier.com",
  "patagonia.com","rei.com","everlane.com","bombas.com","brooklinen.com","mejuri.com",
  "away.com","ruggable.com","chewy.com","wayfair.com","etsy.com","ikea.com","target.com",
  "lululemon.com","aritzia.com","zara.com","hm.com","uniqlo.com","asos.com","sephora.com",
  "ulta.com","kyliecosmetics.com","fentybeauty.com","drsquatch.com","liquiddeath.com",
  // media / content / news
  "theverge.com","techcrunch.com","wired.com","arstechnica.com","engadget.com","vox.com",
  "theatlantic.com","newyorker.com","economist.com","bloomberg.com","bbc.com","npr.org",
  "medium.com","substack.com","ghost.org","wordpress.com","vimeo.com","imdb.com",
  // dev tools / infra
  "github.com","gitlab.com","cloudflare.com","mongodb.com","docker.com","digitalocean.com",
  "heroku.com","vercel.com","supabase.com","fly.io","render.com","railway.app","postman.com",
  "jetbrains.com","gradle.org","kotlinlang.org","rust-lang.org","go.dev","python.org",
  "nodejs.org","reactjs.org","vuejs.org","svelte.dev","astro.build","tailwindcss.com",
  // fintech / money
  "stripe.com","wise.com","revolut.com","brex.com","plaid.com","robinhood.com","coinbase.com",
  "kraken.com","chime.com","sofi.com","affirm.com","klarna.com","squareup.com","paypal.com",
  // consumer / marketplace / travel
  "airbnb.com","doordash.com","instacart.com","uber.com","lyft.com","booking.com","expedia.com",
  "tripadvisor.com","opentable.com","zillow.com","redfin.com","carvana.com","turo.com",
  "spotify.com","netflix.com","hulu.com","audible.com","masterclass.com","duolingo.com",
  "coursera.org","udemy.com","khanacademy.org","brilliant.org",
  // productivity / design / SaaS not in fleet
  "notion.so","figma.com","loom.com","zoom.us","squarespace.com","wix.com","shopify.com",
  "gumroad.com","patreon.com","kickstarter.com","eventbrite.com","typeform.com","airtable.com",
  "clickup.com","linear.app","height.app","cron.com","superhuman.com","hey.com",
  // health / food / lifestyle
  "headspace.com","calm.com","noom.com","hims.com","ro.co","oura.com","whoop.com","peloton.com",
  "hellofresh.com","blueapron.com","doordash.com","sweetgreen.com","chipotle.com",
  // b2b / enterprise landing
  "salesforce.com","workday.com","servicenow.com","atlassian.com","asana.com","monday.com",
  "zendesk.com","intercom.com","twilio.com","okta.com","datadoghq.com","snowflake.com",
  "databricks.com","confluent.io","hashicorp.com","gitpod.io","replit.com","huggingface.co",
];

const names = [...new Set(DOMAINS)].map((d) => ({ name: d.replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]/gi, "-"), url: `https://${d}/` }));
console.log(`[freeze-corpus] ${names.length} domäner`);

let idx = 0;
let ok = 0;
let fail = 0;
async function worker(): Promise<void> {
  while (idx < names.length) {
    const site = names[idx++];
    const out = join(OUT, site.name, "frozen.html");
    if (existsSync(out)) {
      ok++;
      continue;
    }
    mkdirSync(join(OUT, site.name), { recursive: true });
    const proc = Bun.spawn(
      ["bun", "run", "scripts/redesign/freeze-page.ts", `--url=${site.url}`, `--out=${out}`],
      { stdout: "ignore", stderr: "ignore" },
    );
    const timer = setTimeout(() => proc.kill(), 60_000);
    const code = await proc.exited;
    clearTimeout(timer);
    if (code === 0 && existsSync(out)) {
      ok++;
    } else {
      fail++;
    }
    if ((ok + fail) % 20 === 0) console.log(`  … ${ok} frozen, ${fail} failed`);
  }
}
await Promise.all(Array.from({ length: CONC }, () => worker()));
console.log(`[freeze-corpus] klart: ${ok} frozen, ${fail} failed`);
