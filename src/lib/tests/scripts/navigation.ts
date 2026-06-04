// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export const NAVIGATION_SCRIPT = `(() => {
  function linksIn(scope) {
    if (!scope) return [];
    return Array.from(scope.querySelectorAll('a[href]'))
      .map((a) => ((a.innerText || a.textContent || '').trim().replace(/\\s+/g, ' ')))
      .filter((t) => t && t.length < 60);
  }
  const header = document.querySelector('header, [role="banner"], nav');
  const footer = document.querySelector('footer, [role="contentinfo"]');
  const topNavLinks = linksIn(header);
  const footerNavLinks = linksIn(footer);
  const all = (topNavLinks.join(' | ') + ' | ' + footerNavLinks.join(' | ')).toLowerCase();
  const langSwitcher = !!document.querySelector('[class*="lang" i], [aria-label*="language" i], [aria-label*="spr[åa]k" i]');
  return {
    topNavCount: topNavLinks.length,
    footerNavCount: footerNavLinks.length,
    topNavLinks: topNavLinks.slice(0, 30),
    footerNavLinks: footerNavLinks.slice(0, 60),
    loginPresent: /\\blog[ -]?in\\b|\\bsign[ -]?in\\b|logga in|mina sidor/.test(all),
    signupPresent: /sign[ -]?up|register|skapa konto|registrera/.test(all),
    pricingPresent: /pricing|prices|priser|kostnad|plans|priss[äa]ttning|abonnemang/.test(all),
    contactPresent: /contact|kontakt/.test(all),
    blogPresent: /\\bblog\\b|nyheter/.test(all),
    docsPresent: /\\bdocs?\\b|documentation|dokumentation/.test(all),
    languageSwitcherPresent: langSwitcher,
    cartPresent: /\\bcart\\b|varukorg|kund?korg|checkout|kassa/.test(all),
  };
})()`;


