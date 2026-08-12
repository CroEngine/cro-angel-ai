// Bred sajtkorpus (~160 domäner tvärs sidtyper — e-handel, media, dev,
// fintech, konsument) — DELAD data utan sidoeffekter: freeze-corpus (skala-
// testet) och preview-fleetens våg 2 (200-sajtsmålet 2026-07-27) läser samma
// lista. Overlap med day0-flottan är ok — konsumenter dedupar på hostname.
export const CORPUS_DOMAINS: string[] = [
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

/** Katalognamnet för en domän — den DELADE härledningen (granskningsfynd
 *  2026-08-12: tre inline-kopior av uttrycket kunde drifta var för sig, och
 *  freeze-corpus katalog-först-vinner mot link-corpus Map-sist-vinner kunde
 *  då para en fryst sida med fel URL — tyst). */
export const nameForDomain = (d: string): string =>
  d.replace(/\.[a-z.]+$/, "").replace(/[^a-z0-9]/gi, "-");
