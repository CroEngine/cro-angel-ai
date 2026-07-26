import { describe, it, expect } from "vitest";

import { referrerHost } from "../context";

// "Other websites"-domänräknarens integritetsgräns (ägarbeslut 2026-07-26:
// samla nu, visa senare): BARA domänen lämnar funktionen — aldrig path, query
// eller besökarkoppling — och intern navigation blir null (ingen förvärvskälla).

describe("referrerHost — bara domänen, aldrig mer", () => {
  it("ger bare host utan www, path eller query", () => {
    expect(referrerHost("https://www.celiakiforbundet.se/artikel?id=7#x", "https://glutenforum.se/")).toBe(
      "celiakiforbundet.se",
    );
    expect(referrerHost("https://chat.openai.com/", "https://glutenforum.se/blogg/x")).toBe(
      "chat.openai.com",
    );
  });

  it("intern navigation är null — egen domän och subdomäner åt båda hållen", () => {
    const page = "https://glutenforum.se/blogg/x";
    expect(referrerHost("https://glutenforum.se/forum", page)).toBeNull();
    expect(referrerHost("https://www.glutenforum.se/", page)).toBeNull();
    expect(referrerHost("https://app.glutenforum.se/", page)).toBeNull();
    // sidan på subdomän, referrer på apex — fortfarande samma sajt
    expect(referrerHost("https://glutenforum.se/", "https://app.glutenforum.se/x")).toBeNull();
  });

  it("skräp och frånvaro är null — aldrig kast", () => {
    expect(referrerHost("", "https://glutenforum.se/")).toBeNull();
    expect(referrerHost(null, "https://glutenforum.se/")).toBeNull();
    expect(referrerHost("not a url", "https://glutenforum.se/")).toBeNull();
    expect(referrerHost("android-app://com.slack/", null)).toBe("com.slack"); // app-referrers är riktiga källor
  });

  it("klampar mot DNS-maxlängd (defensivt mot skräp)", () => {
    const long = "https://" + "a".repeat(300) + ".se/";
    const got = referrerHost(long, "https://glutenforum.se/");
    expect(got === null || got.length <= 253).toBe(true);
  });
});
