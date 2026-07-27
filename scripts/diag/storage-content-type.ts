// Diagnos: varför serveras preview-rapporterna som text/plain + nosniff?
//
// Runda 1 (2026-07-27, run 30272171626): ALLA uppladdningsvägar genom
// storage-js — rå Buffer + contentType-option, Blob med typ, File med
// .html-filnamn — lagras/serveras som text/plain, trots att tråd-avlyssning
// visar korrekta request-headers. Direkt REST med enbart Bearer föll på
// "Invalid Compact JWS" (nyckeln är nya sb_secret-formatet — kräver
// apikey-headern, inte rå JWT-Bearer).
//
// Runda 2 (denna): hypotesen är att Supabase MEDVETET neutraliserar HTML på
// den publika ytan (nätfiske-skydd på supabase.co-domänen) — då hjälper ingen
// uppladdningsvariant och fixen är att servera rapporten via VÅR egen origin.
// Bevisföring: kontrollfiler (PNG/JSON/HTML) via samma väg + .info()-läsning
// av LAGRAD mimetype (skiljer lagring från servering) + REST med apikey.
//
// Kör i preview-arbetarens miljö: bun run scripts/diag/storage-content-type.ts
// Städar alltid bort _diag-objekten efteråt.

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.log("[diag] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas — loggad no-op.");
  process.exit(0);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
const BUCKET = "angel-evidence";

// Minimal äkta PNG (1×1 röd pixel) — innehållssniffning ska känna igen den.
const PNG_1PX = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  ),
  (c) => c.charCodeAt(0),
);
const HTML = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><title>diag</title></head><body>hällö ångel</body></html>`;
const JSON_BODY = JSON.stringify({ diag: true, ts: "statisk" });

const publicUrl = (key: string) => `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${key}`;

async function servedType(key: string): Promise<string> {
  const res = await fetch(publicUrl(key), { method: "HEAD" });
  return `${res.status} ${res.headers.get("content-type") ?? "(ingen)"} · nosniff=${res.headers.get("x-content-type-options") ?? "-"}`;
}

async function storedType(key: string): Promise<string> {
  const { data, error } = await db.storage.from(BUCKET).info(key);
  if (error) return `(info föll: ${error.message})`;
  return (data as { contentType?: string } | null)?.contentType ?? "(okänd)";
}

type Probe = { name: string; key: string; body: Uint8Array | string; type: string };
const probes: Probe[] = [
  { name: "PNG (äkta bildbytes)", key: "preview/_diag/probe.png", body: PNG_1PX, type: "image/png" },
  { name: "JSON", key: "preview/_diag/probe.json", body: JSON_BODY, type: "application/json" },
  { name: "HTML", key: "preview/_diag/probe.html", body: HTML, type: "text/html; charset=utf-8" },
  { name: "HTML med .txt-nyckel", key: "preview/_diag/probe-html.txt", body: HTML, type: "text/html; charset=utf-8" },
];

console.log(`[diag] bun ${Bun.version} · runda 2: lagrad vs serverad mimetype per innehållstyp\n`);

for (const p of probes) {
  const { error } = await db.storage
    .from(BUCKET)
    .upload(p.key, new Blob([p.body], { type: p.type }), { contentType: p.type, upsert: true });
  if (error) {
    console.log(`  ⚠️ ${p.name}: uppladdning föll: ${error.message}`);
    continue;
  }
  console.log(`  ${p.name} (begärd: ${p.type})`);
  console.log(`     lagrad:   ${await storedType(p.key)}`);
  console.log(`     serverad: ${await servedType(p.key)}`);
}

// REST-vägen med korrekt auth för nya nyckelformatet (apikey-headern) —
// bekräftar om en handbyggd request kan lagra text/html när storage-js inte kan.
{
  const key = "preview/_diag/probe-rest.html";
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${key}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "text/html; charset=utf-8",
      "x-upsert": "true",
    },
    body: HTML,
  });
  if (!res.ok) {
    console.log(`  REST + apikey: uppladdning föll: ${res.status} ${(await res.text()).slice(0, 160)}`);
  } else {
    console.log(`  REST + apikey (begärd: text/html; charset=utf-8)`);
    console.log(`     lagrad:   ${await storedType(key)}`);
    console.log(`     serverad: ${await servedType(key)}`);
  }
}

// Städning: _diag-objekten bort — beviskorgen ska inte samla testskräp.
const { error: rmErr } = await db.storage
  .from(BUCKET)
  .remove([...probes.map((p) => p.key), "preview/_diag/probe-rest.html"]);
console.log(`\n[diag] städning: ${rmErr ? rmErr.message : "ok"}`);
