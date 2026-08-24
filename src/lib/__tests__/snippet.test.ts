// Install-taggen delas nu mellan dashboarden och /welcome — testet låser att
// byggaren ger exakt samma tagg som dashboardens gamla lokala version, att
// nyckeln följer med (utan data-key 403:ar events-ingesten) och att
// deploy-preview-origins aldrig delas ut.
import { describe, expect, it } from "vitest";

import { buildSnippet, normalizeSnippetOrigin } from "../snippet";

describe("buildSnippet — den enda hållbara install-taggen", () => {
  it("med nyckel ⇒ data-site + data-key", () => {
    expect(buildSnippet("kund.se", "ak_abc", "https://croengine.netlify.app")).toBe(
      '<script async src="https://croengine.netlify.app/adaptive.js" data-site="kund.se" data-key="ak_abc"></script>',
    );
  });

  it("utan nyckel ⇒ ingen data-key-attribut alls", () => {
    expect(buildSnippet("kund.se", null, "https://croengine.netlify.app")).not.toContain(
      "data-key",
    );
  });

  it("deploy-preview-origin skalas till produktions-origin", () => {
    expect(normalizeSnippetOrigin("https://deploy-preview-229--croengine.netlify.app")).toBe(
      "https://croengine.netlify.app",
    );
    expect(
      buildSnippet("kund.se", null, "https://deploy-preview-42--croengine.netlify.app"),
    ).toContain('src="https://croengine.netlify.app/adaptive.js"');
  });
});
