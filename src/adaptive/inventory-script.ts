// String form of the inventory crawl, for tools that run it via
// `page.evaluate(INVENTORY_SCRIPT)` — notably against frozen MHTML captures,
// which disable in-page <script> execution but still run page.evaluate via CDP.
//
// The SNIPPET does NOT use this (it calls the eval-free collectInventory() in
// inventory.ts). Keeping the string path in its own module means the detector
// sources are never bundled into adaptive.js as both code AND a string.

import { PAGE_AUDIT_SCRIPT } from "@/lib/tests/scripts/pageAudit";
import { SECTIONS_SCRIPT } from "@/lib/tests/scripts/sections";
import { TRUST_SIGNALS_SCRIPT } from "@/lib/tests/scripts/trustSignals";
import { CTAS_SCRIPT } from "@/lib/tests/scripts/ctas";
import { FORMS_SCRIPT } from "@/lib/tests/scripts/forms";
import { NAVIGATION_SCRIPT } from "@/lib/tests/scripts/navigation";
import { assembleInventory } from "./inventory";

/**
 * Self-contained browser script: runs every detector against the current
 * document and returns a ContentInventory. Each `${...}` interpolates a
 * detector's compiled IIFE `(() => …)()` as a `var` initializer.
 */
export const INVENTORY_SCRIPT = `(() => {
  var audit = ${PAGE_AUDIT_SCRIPT};
  var sections = ${SECTIONS_SCRIPT};
  var trust = ${TRUST_SIGNALS_SCRIPT};
  var ctas = ${CTAS_SCRIPT};
  var forms = ${FORMS_SCRIPT};
  var navigation = ${NAVIGATION_SCRIPT};
  var assemble = ${assembleInventory.toString()};
  return assemble({ audit: audit, sections: sections, trust: trust, ctas: ctas, forms: forms, navigation: navigation });
})()`;
