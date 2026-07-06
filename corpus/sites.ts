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
    notes: "HubSpot's hs-eu-cookie-confirmation (eget system, inte OneTrust). Bannern göms, tas inte bort.",
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
    notes: "Ingen consent-banner i Browserbase-region (geo-gate). Store Assistant-chatt-widget i egen iframe (bra test av huvuddokument-font-scoping). Capture körs utan consent-klick.",
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
    consentSelector: "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
    // Verifierat 2026-07-06: Cookiebot göms (detachas inte), som HubSpot.
    consentDismissCheck: "hidden",
    notes: "Cookiebot-CMP. Arketyp: start_flow (jämförelseportal).",
  },
  {
    // DONATE — insamlingsorganisation ("Ge en gåva", "Bli månadsgivare").
    name: "cancerfonden",
    url: "https://www.cancerfonden.se",
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
    // Verifierat 2026-07-06 via --dry-run --screenshot-before-dismiss:
    // Cookiebot finns i server-HTML:en men ingen banner rendras mot
    // Browserbase-IP (geo-gate, samma som hibob/microsoft) — sidan rendrar
    // fullt med "Prova gratis nu"-hero. Lägg INTE tillbaka selektorn utan att
    // först verifiera att bannern faktiskt rendras i capture-miljön.
    notes: "Ingen consent-banner i Browserbase-region (geo-gate; Cookiebot enbart i server-HTML). Arketyp: subscribe/trial (abonnemang).",
  },
  {
    // BOOKING — bokningsmarknadsplats ("Boka tid"). Ingen CMP-vendor synlig i
    // server-HTML — kör --dry-run --screenshot-before-dismiss först och lägg
    // till selektor ENDAST om en banner faktiskt rendras i capture-miljön
    // (samma disciplin som hibob/microsoft).
    name: "bokadirekt",
    url: "https://www.bokadirekt.se",
    notes: "Arketyp: booking (bokningsmarknadsplats). CMP okänd — verifiera med dry-run.",
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
    notes: "Egen consent-dialog (React-modal, data-cy-krok). Arketyp: booking strikt (tjänstesida med Boka-CTA:er).",
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
