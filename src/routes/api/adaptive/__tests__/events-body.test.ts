// Handler-nivåtest för events-rutten (granskningsfynd 2026-08-13):
//  1) request.text() låg utanför try:et — en avbruten beacon kastade 500
//     utan CORS i stället för det 204 rutten lovar.
//  2) payload-taket mätte UTF-16-kodenheter, inte bytes — en multibyte-batch
//     (emoji/CJK) passerade på "tecken" men lagrades 3–4× över taket.
// Rutten svarar ALLTID 204 med CORS och rör ALDRIG DB:n på dessa vägar.
import { describe, expect, it, vi } from "vitest";

// Persistensen mockas: om någon av dessa anropas på en väg som borde bail:a
// tyst fångar spionen det (och testet skulle dessutom slå mot nätet annars).
const logEvents = vi.fn((..._a: unknown[]) => Promise.resolve());
const siteWriteAllowed = vi.fn((..._a: unknown[]) => Promise.resolve(false));
vi.mock("@/adaptive/persistence.server", () => ({
  logEvents: (...a: unknown[]) => logEvents(...a),
  siteWriteAllowed: (...a: unknown[]) => siteWriteAllowed(...a),
}));

import { Route } from "../events";

const POST = () => {
  // Runtime-formen är stabil (bevisat av testerna); TanStack-typerna
  // exponerar den inte strukturellt, så vi når hanteraren via unknown.
  const h = (
    Route as unknown as {
      options?: {
        server?: { handlers?: { POST?: (ctx: { request: Request }) => Promise<Response> } };
      };
    }
  ).options?.server?.handlers?.POST;
  if (!h) throw new Error("events-rutten saknar POST-hanterare");
  return h;
};

const URL_ = "https://x.test/api/adaptive/events";

describe("events POST — svarar alltid 204, rör aldrig DB på bail-vägarna", () => {
  it("avbruten body-ström ⇒ 204 med CORS (inte 500) — beacon-kontraktet", async () => {
    // En ström som felar mitt i läsningen = en beacon avbruten vid unload.
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('{"site":"x","events":['));
      },
      pull(c) {
        c.error(new Error("stream avbruten (sidan stängdes)"));
      },
    });
    const req = new Request(URL_, {
      method: "POST",
      body,
      // @ts-expect-error duplex krävs för ström-kropp i undici/Node
      duplex: "half",
    });
    const res = await POST()({ request: req });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBeTruthy();
    expect(logEvents).not.toHaveBeenCalled();
  });

  it("multibyte-overflow (UTF-16-längd under taket, bytes över) ⇒ 204, ingen skrivning", async () => {
    // 40 000 emoji: 80 000 UTF-16-kodenheter (under gamla tecken-taket 131072)
    // men 160 000 UTF-8-byte (över byte-taket). Kroppen skickas som en ström
    // UTAN Content-Length, så det är KROPPENS byteLength-koll som måste fånga
    // den — inte header-kollen.
    const payload = "😀".repeat(40_000);
    expect(payload.length).toBeLessThan(128 * 1024); // gamla kollen: passerar
    expect(Buffer.byteLength(payload, "utf8")).toBeGreaterThan(128 * 1024); // ny: fångar
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(payload));
        c.close();
      },
    });
    const req = new Request(URL_, {
      method: "POST",
      body,
      // @ts-expect-error duplex krävs för ström-kropp
      duplex: "half",
    });
    expect(req.headers.get("content-length")).toBeNull(); // ström ⇒ okänd längd
    const res = await POST()({ request: req });
    expect(res.status).toBe(204);
    expect(logEvents).not.toHaveBeenCalled();
  });

  it("oversized med Content-Length ⇒ 204 utan att buffra kroppen", async () => {
    const big = "a".repeat(200 * 1024);
    const req = new Request(URL_, {
      method: "POST",
      body: big,
      headers: { "content-length": String(Buffer.byteLength(big)) },
    });
    const res = await POST()({ request: req });
    expect(res.status).toBe(204);
    expect(logEvents).not.toHaveBeenCalled();
  });

  it("icke-JSON men liten kropp ⇒ 204 (sendBeacon-text), ingen skrivning", async () => {
    const req = new Request(URL_, { method: "POST", body: "inte json" });
    const res = await POST()({ request: req });
    expect(res.status).toBe(204);
    expect(logEvents).not.toHaveBeenCalled();
  });
});
