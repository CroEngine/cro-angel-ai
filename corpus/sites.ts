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
  notes?: string;
}

export const SITES: SiteSpec[] = [
  {
    name: "hibob",
    url: "https://www.hibob.com",
    consentSelector: "#onetrust-accept-btn-handler",
    consentDismissCheck: "detached",
  },
  {
    name: "hubspot",
    url: "https://www.hubspot.com/",
    consentSelector: "#hs-eu-confirmation-button",
    // Verifierat 2026-06-07 via freeze-report: detached gav "consent kvar
    // efter klick" trots matchCountBeforeClick=1 + visibleBeforeClick=true.
    // HubSpot döljer bannern istället för att ta bort den ur DOM.
    consentDismissCheck: "hidden",
    notes: "HubSpot's hs-eu-cookie-confirmation (eget system, inte OneTrust). Bannern göms, tas inte bort.",
  },
  // De 6 övriga siterna läggs till i separat runda — varje site kan ha
  // egen consent-quirk som vi inte vill upptäcka efter commit.
];

export function getSite(name: string): SiteSpec | undefined {
  return SITES.find((s) => s.name === name);
}
