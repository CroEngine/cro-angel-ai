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
  // LEAD-arketypen (mäklare/hemlarm) ännu ofrusen: Verisure (OneTrust) gick
  // över externalize-tröskeln utan lovable-assets-CLI i miljön, och
  // Svensk Fast/Cookiebot renderade ingen banner mot Browserbase-IP. tel:/
  // callback-lead-klassningen täcks av enhetstesterna i goal-taxonomy.test.ts
  // tills en lead-sajt fryser rent — bokadirekt (booking) ligger närmast.
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
  // SUBSCRIBE-arketypen (di.se) ännu ofrusen: Dagens Industris egna fonter
  // (BentonSans/BrunelDeck) gick över inline-tröskeln och render-canary-
  // gaten failade utan lovable-assets-CLI. subscribe-klassningen täcks av
  // enhetstesterna tills en lättare paywall-sajt fryser rent.
  {
    // BOOKING — bokningsmarknadsplats ("Boka tid"). Ingen CMP-vendor synlig i
    // server-HTML — kör --dry-run --screenshot-before-dismiss först och lägg
    // till selektor ENDAST om en banner faktiskt rendras i capture-miljön
    // (samma disciplin som hibob/microsoft).
    name: "bokadirekt",
    url: "https://www.bokadirekt.se",
    notes: "Arketyp: booking (bokningsmarknadsplats). CMP okänd — verifiera med dry-run.",
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
