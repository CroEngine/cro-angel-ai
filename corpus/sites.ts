// Single source of truth för vilka siter vi fryser och hur consent dismissas.
//
// Två felvägar som denna fil + freeze.server.ts assertion stänger tillsammans:
//   (a) glömd selektor       → SITES tvingar dig ta ställning per site
//   (b) selektor tar inte    → freeze.server.ts assert:ar post-klick att
//                              bannern är detached/hidden, annars throw
//
// Policy: Accept All på alla siter. Inte för att det är "realistiskt", utan
// för att blanda Accept/Decline över corpusen inför en icke-jämförbar axel
// i goldens. Konsistens > realism.

export interface SiteSpec {
  name: string;
  url: string;
  /** CSS-selector för accept-knappen. Deterministisk, försök först. */
  consentSelector?: string;
  /**
   * Hur vi verifierar att klicket faktiskt tog bort bannern.
   *   "detached" — element borttaget ur DOM (OneTrust, default)
   *   "hidden"   — element finns kvar men display:none / visibility:hidden
   * Saknas → default "detached".
   */
  consentDismissCheck?: "detached" | "hidden";
  /** Intermittent CMP (nextory-klassen: Cookiebot rendrerade i juni-frysningen
   *  men inte i juli/augusti-proberna, samma IP): klicka när selektorn syns,
   *  fäll inte frysningen när den uteblir. Utfallet bokförs i receiptets
   *  consent.skippedNotVisible; postDismissDomHits + vision-triagen vaktar. */
  consentOptional?: boolean;
  /** Stagehand-fallback om CSS inte räcker. Samma assertion-krav. */
  consentInstruction?: string;
  /** iframe-baserad CMP (t.ex. Sourcepoint sp_message_iframe): accept-knappen
   *  ligger inuti denna iframe. consentSelector blir då en XPath till knappen
   *  INUTI framen (Stagehands frame-locator resolvar xpath, inte CSS) — t.ex.
   *  `//button[contains(normalize-space(.),"Godkänn alla")]`. Dismissal verifieras
   *  genom att iframen detachar/döljs (consentDismissCheck). */
  consentFrame?: string;
  /**
   * CSS-selektorer för element som tas bort FÖRE captureSnapshot.
   * Determinism: tredjeparts-overlays (chat/feedback/web-interactives/bot-tarpit)
   * injiceras inkonsekvent mellan captures — närvarande i en, frånvarande i en
   * annan — vilket ger strukturell drift som positions-diffen kaskaderar. De är
   * score-neutrala (ej huvudinnehåll; bevisat av round6 #4 = identiska goldens),
   * så borttagning gör MHTML:en deterministisk utan att röra scoren. Samma
   * capture-time-normaliseringsmönster som prefers-reduced-motion.
   */
  removeSelectors?: string[];
  /**
   * Proxy-exit-land (ISO 3166-1 alpha-2, t.ex. "SE"). Svenska siter fryses via
   * svensk residential-IP så capturen ser det svenska besökare ser — CMP:er,
   * geo-gates och i18n-routning skiljer per land, och Browserbase default är
   * best-effort USA (verifierat i browserbase-usage-review 2026-07-29; SE-geo
   * gav svensk exit-IP). Region följer geo automatiskt (EU → eu-central-1).
   *
   * OBS: att sätta/ändra geo ändrar VILKEN consent som rendras. Verifiera
   * selektorn med --dry-run före nästa write-freeze och räkna med
   * golden-ompromovering första gången bannern dyker upp under ny IP.
   * Osatt → dagens beteende (USA-routning).
   */
  geo?: string;
  /**
   * Realistisk desktop-fingerprint på Browserbase-sessionen. Opt-in per site,
   * eskaleringssteg för sajter med fingerprint-baserat bot-skydd (DataDome
   * m.fl.). Icke-Enterprise-lever: devices/OS/locale är tillåtna på vår plan
   * (verifierat 2026-08-02), till skillnad från advancedStealth/verified mode.
   * Löser INTE hårda pre-emptiva väggar (g2/DataDome ger 403 slide-CAPTCHA
   * ändå — se browserbase-usage-review). Default av: vanliga captures kör på
   * Browserbases default-fingerprint (bevisat tillräckligt för nike/Akamai,
   * zalando/DataDome-med-SE-IP). Sätt bara om en site faktiskt blockeras utan.
   */
  fingerprint?: boolean;
  notes?: string;
}

export const SITES: SiteSpec[] = [
  {
    name: "hibob",
    url: "https://www.hibob.com",
    // Verifierat 2026-06-09 via --dry-run --screenshot-before-dismiss:
    // OneTrust serveras inte mot Browserbase-IP (geo-gate). Ingen banner
    // syns alls → ingen consent att dismissa. Lägg INTE tillbaka selektorn
    // utan att först verifiera att bannern faktiskt rendras i capture-miljön.
    notes: "Ingen consent-banner i Browserbase-region (geo-gate). Capture körs utan consent-klick.",
  },
  {
    name: "hubspot",
    url: "https://www.hubspot.com/",
    consentSelector: "#hs-eu-confirmation-button",
    // Verifierat 2026-06-07 via freeze-report: detached gav "consent kvar
    // efter klick" trots matchCountBeforeClick=1 + visibleBeforeClick=true.
    // HubSpot döljer bannern istället för att ta bort den ur DOM.
    consentDismissCheck: "hidden",
    // Determinism (round6): inkonsekvent injicerade overlays som annars ger
    // strukturell capture-drift. Score-neutrala per #4. Se WHITELIST.md round6.
    removeSelectors: [
      "#hubspot-messages-iframe-container", // chat-widget (iframe-container)
      "#hs-feedback-fetcher", // feedback-widget
      '[id^="hs-web-interactives"]', // web-interactives push-anchors/containers
      'body > a[tabindex="-1"][aria-hidden="true"][rel="nofollow"]', // bot-tarpit-ankaret
    ],
    notes:
      "HubSpot's hs-eu-cookie-confirmation (eget system, inte OneTrust). Bannern göms, tas inte bort.",
  },
  {
    name: "microsoft",
    url: "https://www.microsoft.com",
    // Verifierat 2026-06-20 via --dry-run --screenshot-before-dismiss: ingen
    // cookie-consent serveras mot Browserbase-IP (geo-gate, samma som HiBob).
    // Sidan visar bara en marknadsförings-promo-bar (överst) + en "Store
    // Assistant"-chatt-widget (nere höger) — ingen consent att dismissa. Lägg
    // INTE till en selektor utan att först verifiera att en banner faktiskt
    // rendras i capture-miljön.
    notes:
      "Ingen consent-banner i Browserbase-region (geo-gate). Store Assistant-chatt-widget i egen iframe (bra test av huvuddokument-font-scoping). Capture körs utan consent-klick.",
  },
  {
    name: "linear",
    url: "https://linear.app",
    // Dark-theme SaaS landing — ger corpusen inverted-contrast/salience-täckning
    // som README:n efterfrågar (komplement till HubSpots ljusa tema). Captured
    // valid utan consent-klick i breadth-körningen (ingen blockerande banner mot
    // Browserbase-IP). Promotion gated på #4 score-determinism (promote-corpus.ts).
    notes:
      "Dark-theme SaaS-landing (inverterad kontrast/salience). Ingen blockerande consent-banner mot Browserbase-IP i breadth-capture.",
  },
  // ---- Arketyp-korpusen: en frusen sajt per konverteringsmåltyp -------------
  // Poängen (contradictions-audit "target architecture"): hela kedjan
  // skörd → måldom → mönster regressionstestas PER MÅLTYP, inte bara för
  // SaaS-signup. CMP-vendor per sajt identifierad 2026-07-06 ur server-
  // renderad HTML (vocab-harvesten); selektorerna är vendorernas standard-id:n.
  {
    // PURCHASE — svensk marketplace/webshop ("Köp", varukorg, till kassan).
    name: "cdon",
    url: "https://cdon.se",
    // GEO GATED AV (ägarens ord 2026-07-29: "Lets only go on English sites
    // until we know it works!"): aktivera genom att avkommentera raden nedan
    // när valideringen på engelska siter är i hamn. Tills dess fryser siten
    // som idag (default USA-routning) — inga golden-ändringar.
    // geo: "SE",
    consentSelector: "#didomi-notice-agree-button",
    notes: "Didomi-CMP. Arketyp: purchase (webshop).",
  },
  {
    // LEAD — hemlarm med "bli uppringd"/kostnadsfritt hembesök som primär
    // konvertering. Tidigare lead-försök föll: Verisure (OneTrust) över
    // externalize-tröskeln, Svensk Fast (Cookiebot) renderade ingen banner
    // mot Browserbase-IP. sector-alarm.se → www.sectoralarm.se (redirect),
    // vi fryser slut-URL:en direkt.
    name: "sector-alarm",
    url: "https://www.sectoralarm.se/",
    // GEO GATED AV (ägarens ord 2026-07-29: "Lets only go on English sites
    // until we know it works!"): aktivera genom att avkommentera raden nedan
    // när valideringen på engelska siter är i hamn. Tills dess fryser siten
    // som idag (default USA-routning) — inga golden-ändringar.
    // geo: "SE",
    // Cookie Information-CMP (policy.app.cookieinformation.com/uc.js) med
    // CUSTOM-mall: accept-knappen är klasslös (".coi-banner__accept" finns
    // inte) — identifierad 2026-07-06 via scripts/probe-consent-dom.ts:
    // <button class="button ... button--gossamer"
    //   onclick="CookieInformation.submitAllCategories();resolveLeadSourceId();">
    // Attribut-selektorn är den enda stabila kroken och matchar exakt 1 element
    // (coiPage-2:s "välj alla"-knapp kör setCheckboxes, inte submitAllCategories).
    consentSelector: '#coiPage-1 button[onclick*="submitAllCategories"]',
    // CoI göms (overlay display:none) — knappen detachar inte.
    consentDismissCheck: "hidden",
    notes: "Cookie Information-CMP (custom-mall). Arketyp: lead (hemlarm, callback/hembesök).",
  },
  {
    // START_FLOW — jämförelseportal för elavtal ("Jämför och byt elavtal").
    name: "elskling",
    url: "https://elskling.se",
    // GEO GATED AV (ägarens ord 2026-07-29: "Lets only go on English sites
    // until we know it works!"): aktivera genom att avkommentera raden nedan
    // när valideringen på engelska siter är i hamn. Tills dess fryser siten
    // som idag (default USA-routning) — inga golden-ändringar.
    // geo: "SE",
    consentSelector: "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    // Verifierat 2026-07-06: Cookiebot göms (detachas inte), som HubSpot.
    consentDismissCheck: "hidden",
    notes: "Cookiebot-CMP. Arketyp: start_flow (jämförelseportal).",
  },
  {
    // DONATE — insamlingsorganisation ("Ge en gåva", "Bli månadsgivare").
    name: "cancerfonden",
    url: "https://www.cancerfonden.se",
    // GEO GATED AV (ägarens ord 2026-07-29: "Lets only go on English sites
    // until we know it works!"): aktivera genom att avkommentera raden nedan
    // när valideringen på engelska siter är i hamn. Tills dess fryser siten
    // som idag (default USA-routning) — inga golden-ändringar.
    // geo: "SE",
    consentSelector: "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    // Verifierat 2026-07-06: Cookiebot göms (detachas inte), som HubSpot.
    consentDismissCheck: "hidden",
    notes: "Cookiebot-CMP. Arketyp: donate (nonprofit).",
  },
  {
    // SUBSCRIBE/TRIAL — ljudboks-abonnemang ("Prova gratis" → prenumeration).
    // di.se (första subscribe-försöket) föll på egna fonter över inline-
    // tröskeln + render-canary; Nextory är en lättare abonnemangssajt.
    // nextory.se → nextory.com/se (redirect), vi fryser slut-URL:en direkt.
    name: "nextory",
    url: "https://nextory.com/se",
    // OBS geo-skifte: noten nedan ("ingen banner, Cookiebot enbart i server-HTML")
    // gällde USA-IP. Under svensk IP rendrar Cookiebot sannolikt — kör --dry-run
    // och sätt consentSelector innan nästa write-freeze.
    // GEO GATED AV (ägarens ord 2026-07-29: "Lets only go on English sites
    // until we know it works!"): aktivera genom att avkommentera raden nedan
    // när valideringen på engelska siter är i hamn. Tills dess fryser siten
    // som idag (default USA-routning) — inga golden-ändringar.
    // geo: "SE",
    // INTERMITTENT Cookiebot (bevisläge 2026-08-02): juni-frysningens
    // committade screenshot bär en FULLT RENDRERAD Cookiebot-dialog ("Allow
    // all cookies") över heron — men proberna 2026-07-06 och 2026-08-02 såg
    // ingen banner alls mot samma default-IP. CMP:n är alltså probabilistisk,
    // inte rent geo-gated som noten tidigare sa. Därför consentOptional:
    // klicka när dialogen finns (standard-Cookiebot-id + hidden, som
    // elskling), fäll inte frysningen när den uteblir. Receiptets
    // skippedNotVisible säger vilketdera som hände per capture.
    consentSelector: "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    consentDismissCheck: "hidden",
    consentOptional: true,
    notes:
      "Intermittent Cookiebot (rendrerade i juni-frysningen, ej i proberna) — consentOptional. Arketyp: subscribe/trial (abonnemang).",
  },
  {
    // BOOKING — bokningsmarknadsplats ("Boka tid"). Ingen CMP-vendor synlig i
    // server-HTML — kör --dry-run --screenshot-before-dismiss först och lägg
    // till selektor ENDAST om en banner faktiskt rendras i capture-miljön
    // (samma disciplin som hibob/microsoft).
    name: "bokadirekt",
    url: "https://www.bokadirekt.se",
    // GEO GATED AV (ägarens ord 2026-07-29: "Lets only go on English sites
    // until we know it works!"): aktivera genom att avkommentera raden nedan
    // när valideringen på engelska siter är i hamn. Tills dess fryser siten
    // som idag (default USA-routning) — inga golden-ändringar.
    // geo: "SE",
    // CMP identifierad 2026-08-02 via probe-consent-dom (vision-triagens fynd
    // 2026-07-30: committade skärmbilden bär en odismissad dialog över ~40 %
    // av sidan): SAMMA egna React-modal som tjänstesidan ("Vi värdesätter
    // dina val") — klasserna är hashade, data-cy är den stabila kroken.
    // Modalen unmountas vid accept → detached (default), som tjänstesidan.
    consentSelector: 'button[data-cy="allowCookiesButton"]',
    notes:
      "Egen consent-dialog (React-modal, data-cy-krok — samma som tjänstesidan). Arketyp: booking (bokningsmarknadsplats).",
  },
  {
    // BOOKING (strikt) — TJÄNSTESIDA på bokadirekt, där de riktiga "Boka"-
    // CTA:erna bor (SSR:ade; homepagens kategorityler är JS-hydrerade och
    // href-lösa, se archetype-goals.test.ts). Sidan vald ur sitemap-details
    // (lågt id = etablerad salong, stabil URL).
    // OBS: till skillnad från homepagen visar TJÄNSTESIDAN bokadirekts EGEN
    // consent-dialog ("Vi värdesätter dina val" — React-modal, inga vendor-
    // namn i id/class). Hittad 2026-07-06 via probe-consent-dom.ts pass 3
    // (textbaserat): accept-knappen bär data-cy="allowCookiesButton".
    // Modalen unmountas vid accept → detached (default).
    name: "bokadirekt-service",
    url: "https://www.bokadirekt.se/places/citymassage-457",
    // GEO GATED AV (ägarens ord 2026-07-29: "Lets only go on English sites
    // until we know it works!"): aktivera genom att avkommentera raden nedan
    // när valideringen på engelska siter är i hamn. Tills dess fryser siten
    // som idag (default USA-routning) — inga golden-ändringar.
    // geo: "SE",
    consentSelector: '[data-cy="allowCookiesButton"]',
    // Determinism: headerns KOLLAPSADE mega-menypaneler (`absolute inset-0
    // h-0 -z-10` — osynliga för besökare, men barnen mäter fulla rects) får
    // sin absoluta Y-position att flippa ±200px mellan replays (CI 2026-07-06:
    // grön+röd+röd på samma sha; ±200 = exakt en yBand-bucket, och eftersom
    // yBand ingår i normalize-sorteringsnyckeln kaskaderar flippen till
    // ~700 diffrader). Panelerna är score-neutrala (dolt nav-innehåll, inte
    // huvudinnehåll) — samma capture-time-normalisering som hubspots overlays.
    // Homepage-capturen har samma paneler men historiskt stabila goldens —
    // rör den inte i efterhand; flippar den någon gång är detta boten.
    // Systemisk fix (clip-medveten synlighet i collectorn) är våg 7-arbete.
    // #mega-menu-manager-container: syskonstrippen med "X nära mig"-undernav
    // ("Huvudnavigation underkategorier" — dropdown-innehåll, inte den synliga
    // kategoriraden) flippade likadant (±200px, "Deals"/"För företag") när
    // panelerna väl var borta — samma dolda-header-klass, samma bot.
    removeSelectors: [".mega-menu-categories-category", "#mega-menu-manager-container"],
    notes:
      "Egen consent-dialog (React-modal, data-cy-krok). Arketyp: booking strikt (tjänstesida med Boka-CTA:er).",
  },
  // Salesforce, Slack, Kry, Monday: ej tillagda än.
  // Salesforce testad 2026-06-10: ingen consent-banner mot Browserbase-IP
  // (samma geo-gate som HiBob) men page.mhtml blev 60 MB efter font-embed.
  // Externalize-pathen finns men är under härdning (Fas 1: sha256 + flagga-
  // som-source-of-truth + stale-städning). Subsetting (Fas 2) ska köras före
  // re-freeze, eftersom font-embed över-embeddar by design och troligen
  // återför Salesforce till in-repo-storlek. Lägg INTE tillbaka som SiteSpec
  // förrän Fas 1+2 är klara.
];

export function getSite(name: string): SiteSpec | undefined {
  return SITES.find((s) => s.name === name);
}
