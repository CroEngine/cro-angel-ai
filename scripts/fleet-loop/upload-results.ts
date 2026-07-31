#!/usr/bin/env bun
// Flottresultatens uppladdare: skjuter results.json till angel-evidence under
// preview/_diag/fleet-rerun/ så aggregatet kan byggas utan Actions-artefakt-
// nedladdning — 14-dagars-retentionen är skälet till att yield-talen aldrig
// aggregerats (fynd 2026-07-29). Tre försök med backoff (sinch-klassen:
// lagringsytan svarar ibland transient Gateway Timeout).
//
//   bun run scripts/fleet-loop/upload-results.ts --file=fleet-preview/results.json --name=results-0.json

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const FILE = arg("file");
const NAME = (arg("name") ?? "results.json").replace(/[^a-zA-Z0-9._-]/g, "-");
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY || !FILE) {
  console.error("kräver SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY + --file");
  process.exit(2);
}

const db = createClient(URL_, KEY);
const key = `preview/_diag/fleet-rerun/${NAME}`;
const bytes = readFileSync(FILE);
let lastError = "";
let uploaded = false;
for (const delayMs of [0, 2_000, 5_000]) {
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  const { error } = await db.storage
    .from("angel-evidence")
    .upload(key, new Blob([new Uint8Array(bytes)], { type: "application/json" }), {
      contentType: "application/json",
      upsert: true,
    });
  if (!error) {
    uploaded = true;
    break;
  }
  lastError = error.message;
  console.warn(`[fleet-upload] uppladdningsförsök föll (${key}): ${lastError} — försöker igen`);
}
if (!uploaded) {
  console.error(`[fleet-upload] föll efter 3 försök (${key}): ${lastError}`);
  process.exit(1);
}
console.log(`[fleet-upload] ${db.storage.from("angel-evidence").getPublicUrl(key).data.publicUrl}`);
