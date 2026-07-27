// Diagnos: vilken uppladdningsväg får Supabase storage att LAGRA rätt
// mimetype? (Pilotfynd 2026-07-27: preview-rapporter serverades text/plain +
// nosniff → webbläsaren visar källkod. Både rå Buffer + contentType-option
// och Blob-med-typ har misslyckats i drift, trots att lokal tråd-avlyssning
// visar korrekta request-headers. Bun:s FormData sätter dessutom filename=""
// i stället för spec:ens "blob" — servern kan då inte läsa ändelsen.)
//
// Kör i preview-arbetarens miljö (samma bun, samma secrets, riktiga servern):
//   bun run scripts/diag/storage-content-type.ts [--heal=<jobb-uuid>]
//
// Matrisen laddar upp små HTML-objekt under preview/_diag/, HEAD:ar den
// publika URL:en för varje och skriver en resultattabell. Med --heal laddas
// jobbets befintliga report.html upp på nytt (identiskt innehåll, endast
// mimetype) med första vinnande metoden. Städar alltid bort _diag-objekten.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log("[diag] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas — loggad no-op.");
  process.exit(0);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = "angel-evidence";
const HTML_TYPE = "text/html; charset=utf-8";
const html = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>diag</title></head><body>hällö ångel — content-type-diagnos</body></html>`;

const publicUrl = (key: string) =>
  `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${key}`;

async function servedType(key: string): Promise<string> {
  const res = await fetch(publicUrl(key), { method: "HEAD" });
  return `${res.status} ${res.headers.get("content-type") ?? "(ingen)"}`;
}

/** Direkt REST-PUT utan storage-js: rå kropp + explicit Content-Type-header —
 *  inga bibliotekslager som kan tappa typen på vägen. */
async function restUpload(key: string, body: string | Uint8Array, type: string): Promise<string | null> {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": type,
      "x-upsert": "true",
      "cache-control": "max-age=3600",
    },
    body,
  });
  return res.ok ? null : `${res.status} ${(await res.text()).slice(0, 200)}`;
}

type Variant = {
  name: string;
  key: string;
  run: (key: string) => Promise<string | null>;
};

const variants: Variant[] = [
  {
    name: "A rå Buffer + contentType-option (storage-js)",
    key: "preview/_diag/a.html",
    run: async (key) => {
      const { error } = await db.storage
        .from(BUCKET)
        .upload(key, Buffer.from(html, "utf-8"), { contentType: HTML_TYPE, upsert: true });
      return error?.message ?? null;
    },
  },
  {
    name: "B Blob(type) + contentType-option (storage-js, dagens kod)",
    key: "preview/_diag/b.html",
    run: async (key) => {
      const { error } = await db.storage
        .from(BUCKET)
        .upload(key, new Blob([html], { type: HTML_TYPE }), { contentType: HTML_TYPE, upsert: true });
      return error?.message ?? null;
    },
  },
  {
    name: "C File med filnamn + typ (storage-js)",
    key: "preview/_diag/c.html",
    run: async (key) => {
      const { error } = await db.storage
        .from(BUCKET)
        .upload(key, new File([html], "report.html", { type: HTML_TYPE }), { upsert: true });
      return error?.message ?? null;
    },
  },
  {
    name: "D direkt REST-POST, rå kropp + header (utan storage-js)",
    key: "preview/_diag/d.html",
    run: (key) => restUpload(key, html, HTML_TYPE),
  },
  {
    name: "E rå Buffer UTAN contentType-option (kontroll)",
    key: "preview/_diag/e.html",
    run: async (key) => {
      const { error } = await db.storage
        .from(BUCKET)
        .upload(key, Buffer.from(html, "utf-8"), { upsert: true });
      return error?.message ?? null;
    },
  },
];

console.log(`[diag] bun ${Bun.version} · storage-js via supabase-js\n`);

const winners: Variant[] = [];
for (const v of variants) {
  const err = await v.run(v.key);
  const served = err ? `(uppladdning föll: ${err})` : await servedType(v.key);
  const ok = !err && /text\/html/.test(served);
  if (ok) winners.push(v);
  console.log(`  ${ok ? "✅" : "❌"} ${v.name}\n     → serveras: ${served}`);
}

// Läk ett befintligt jobb: hämta rapporten från den publika URL:en (identiskt
// innehåll) och ladda upp igen med första vinnande metoden — bara mimetype
// ändras. Ingen åtgärd om ingen variant vann.
const healArg = process.argv.find((a) => a.startsWith("--heal="))?.slice(7);
if (healArg && /^[0-9a-f-]{36}$/i.test(healArg)) {
  const key = `preview/${healArg}/report.html`;
  if (winners.length === 0) {
    console.log(`\n[diag] --heal=${healArg}: ingen vinnande metod — rör inte objektet.`);
  } else {
    const res = await fetch(publicUrl(key));
    if (!res.ok) {
      console.log(`\n[diag] --heal=${healArg}: kunde inte hämta rapporten (${res.status}).`);
    } else {
      const bytes = new Uint8Array(await res.arrayBuffer());
      const w = winners[0];
      const err =
        w.key === "preview/_diag/d.html"
          ? await restUpload(key, bytes, HTML_TYPE)
          : w.key === "preview/_diag/c.html"
            ? (
                await db.storage
                  .from(BUCKET)
                  .upload(key, new File([bytes], "report.html", { type: HTML_TYPE }), { upsert: true })
              ).error?.message ?? null
            : (
                await db.storage
                  .from(BUCKET)
                  .upload(
                    key,
                    w.key === "preview/_diag/b.html" ? new Blob([bytes], { type: HTML_TYPE }) : Buffer.from(bytes),
                    { contentType: HTML_TYPE, upsert: true },
                  )
              ).error?.message ?? null;
      console.log(
        `\n[diag] --heal=${healArg} via "${w.name}": ${err ?? "ok"} → serveras nu: ${await servedType(key)}`,
      );
    }
  }
}

// Städning: _diag-objekten bort — beviskorgen ska inte samla testskräp.
const { error: rmErr } = await db.storage.from(BUCKET).remove(variants.map((v) => v.key));
console.log(`\n[diag] städning: ${rmErr ? rmErr.message : "ok"}`);
