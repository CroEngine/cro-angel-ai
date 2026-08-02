// Bot-vägg-signaturer, vendor-attribuerade. Single source of truth för
// challenge-detektering: freeze.server.ts (assertCaptureValid hård grind +
// content-ready-waiten) och scripts/bot-probe.ts importerar HÄRIFRÅN, så en
// spärrsida aldrig kan frysas tyst som om den vore innehåll.
//
// PRECISIONSDELNING (medveten, asymmetrisk risk):
//   hard[]  — patognomona fraser. Träff = hård failure (assertCaptureValid).
//             En falsk positiv HÄR bryter en legitim sajt, så listan innehåller
//             BARA strängar som i praktiken aldrig finns i riktig marknadstext.
//   title[] — bredare interstitial-titlar. Används av content-ready-waiten för
//             att avgöra "fortfarande en challenge → vänta lite till". En falsk
//             positiv här kostar bara några sekunders väntan, aldrig ett fel,
//             så den får vara generös (t.ex. "just a moment", "attention
//             required" som skulle vara för trubbiga för hard[]).
//
// Allt lowercased — matchas mot lowercased body-text / title / HTML.

export interface WallVendor {
  vendor: string;
  /** Patognomona fraser — hård failure vid träff. */
  hard: string[];
  /** Bredare interstitial-titlar — bara för vänta-ut-heuristiken. */
  title: string[];
}

export const BOT_WALL_VENDORS: WallVendor[] = [
  {
    vendor: "cloudflare",
    hard: [
      "enable javascript and cookies to continue",
      "checking if the site connection is secure",
      "cf-browser-verification",
      "cf-challenge",
    ],
    title: [
      "just a moment",
      "checking your browser",
      "attention required",
      "performing a security check",
    ],
  },
  {
    vendor: "datadome",
    hard: [
      "slide right to secure your access",
      "automated (bot) activity on your network",
      "geo.captcha-delivery.com",
    ],
    title: ["verification required", "unusual activity from your"],
  },
  {
    vendor: "akamai",
    hard: ["you don't have permission to access", "errors.edgesuite.net"],
    title: ["access denied", "reference #"],
  },
  {
    vendor: "perimeterx/human",
    hard: ["px-captcha", "perimeterx", "pardon our interruption"],
    title: ["please verify you are a human", "press & hold"],
  },
  {
    vendor: "imperva/incapsula",
    hard: ["request unsuccessful. incapsula", "powered by incapsula", "_incapsula_"],
    title: ["incident id"],
  },
  {
    vendor: "kasada",
    hard: ["kpsdk", "kasada"],
    title: [],
  },
  {
    vendor: "generic-captcha",
    hard: ["unusual traffic from your computer network"],
    title: ["verify you are human", "are you a robot", "recaptcha", "hcaptcha"],
  },
];

/** Patognomona markörer, platt lista — för assertCaptureValids hårda grind. */
export const HARD_WALL_MARKERS: string[] = Array.from(
  new Set(BOT_WALL_VENDORS.flatMap((v) => v.hard)),
);

/** Interstitial-titlar (inkl. de patognomona) — för vänta-ut-heuristiken. */
export const CHALLENGE_TITLE_MARKERS: string[] = Array.from(
  new Set(BOT_WALL_VENDORS.flatMap((v) => [...v.hard, ...v.title])),
);

/** Vilka vendorer en text triggar (matchar både hard- och title-markörer).
 *  Används av bot-probe.ts för diagnostik. */
export function detectWallVendors(hay: string): string[] {
  const lower = hay.toLowerCase();
  const hits: string[] = [];
  for (const v of BOT_WALL_VENDORS) {
    if ([...v.hard, ...v.title].some((m) => lower.includes(m))) hits.push(v.vendor);
  }
  return hits;
}
