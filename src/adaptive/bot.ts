// Bot-exkludering (ren, delad).
//
// Botar får aldrig in i datan: de förorenar segmenten (kanal/enhet/land blir
// skräp), sänker konverteringsgraden artificiellt och skulle skeva A/B-armarna
// när servering slås på. Googlebot RENDERAR JavaScript, så "kör snippeten" är
// inget filter i sig — vi filtrerar i två lager:
//   1. Klienten (public/adaptive.js) vägrar boota för navigator.webdriver eller
//      bot-UA (vårt eget harness sätter __ANGEL_HARNESS__ explicit).
//   2. Servern (auktoritativt) släpper events från bot-UA:er tyst och hoppar
//      över exponeringsloggning i decide — även om klientkollen missats.
//
// Mönstret är avsiktligt BRETT hellre än smart: en missad bot är dyrare än en
// borttappad exotisk besökare, och riktiga webbläsar-UA:er matchar inte orden.
// Enda kända kollisionen är telefonmärket CUBOT ("bot" som substräng) — den
// undantas uttryckligen.

const BOT_RE =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|pingdom|uptimerobot|statuscake|site24x7|newrelic|prerender|phantomjs|puppeteer|playwright|selenium|python-requests|python-urllib|curl\/|wget\/|axios\/|node-fetch|go-http-client|okhttp|java\/|libwww|scrapy|httpclient|facebookexternalhit|whatsapp|telegram|discordapp|slackbot|linkedinbot|twitterbot|pinterestbot|bingpreview|semrush|ahrefs|mj12|dotbot|petalbot|bytespider|gptbot|ccbot|claudebot|amazonbot|applebot|duckduckbot|yandex|baiduspider|sogou|exabot|ia_archiver/i;

/** Telefonmärket CUBOT är den kända legitima "bot"-substrängen. */
const NOT_BOT_RE = /cubot/i;

/** Är denna User-Agent en bot/crawler/automationsklient? null/tomt ⇒ false —
 *  en saknad UA ensam är inte bevis nog att kasta en besökare. */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  if (NOT_BOT_RE.test(ua)) return false;
  return BOT_RE.test(ua);
}
