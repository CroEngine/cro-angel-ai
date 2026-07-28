#!/usr/bin/env bun
// Freeze-testets uppladdare: skjuter upp skärmdumparna (+ frysta kopian) till
// angel-evidence under preview/_diag/freeze-test/<name>/ och skriver de
// PUBLIKA URL:erna till loggen — JPEG/HTML-bytes granskas sedan utanför
// runnern (JPEG serveras korrekt av publika ytan; HTML neutraliseras till
// text/plain, vilket är oskadligt här: filen läses som källkod, inte sida).
//
//   bun run scripts/diag/freeze-test-upload.ts --name=<slug> --dir=<shotdir> --frozen=<html>

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1];
const NAME = (arg("name") ?? "site").replace(/[^a-z0-9-]/gi, "-");
const DIR = arg("dir")!;
const FROZEN = arg("frozen")!;
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY || !DIR || !FROZEN) {
  console.error("kräver SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY + --name --dir --frozen");
  process.exit(2);
}
const db = createClient(URL_, KEY);
const BUCKET = "angel-evidence";

const files: Array<{ key: string; path: string; type: string }> = [
  { key: `preview/_diag/freeze-test/${NAME}/viewport.jpg`, path: join(DIR, "viewport.jpg"), type: "image/jpeg" },
  { key: `preview/_diag/freeze-test/${NAME}/fullpage.jpg`, path: join(DIR, "fullpage.jpg"), type: "image/jpeg" },
  { key: `preview/_diag/freeze-test/${NAME}/frozen.html`, path: FROZEN, type: "text/html; charset=utf-8" },
];
// Fidelitetsmåttets artefakter (2026-07-28) — med när de finns i katalogen.
const { existsSync } = await import("node:fs");
for (const [file, type] of [
  ["ref.png", "image/png"],
  ["diff.png", "image/png"],
  ["fidelity.json", "application/json"],
] as const) {
  if (existsSync(join(DIR, file))) {
    files.push({ key: `preview/_diag/freeze-test/${NAME}/${file}`, path: join(DIR, file), type });
  }
}
for (const f of files) {
  const bytes = readFileSync(f.path);
  const { error } = await db.storage
    .from(BUCKET)
    .upload(f.key, new Blob([new Uint8Array(bytes)], { type: f.type }), {
      contentType: f.type,
      upsert: true,
    });
  if (error) {
    console.error(`[freeze-test] uppladdning föll (${f.key}): ${error.message}`);
    process.exit(1);
  }
  console.log(`[freeze-test] ${db.storage.from(BUCKET).getPublicUrl(f.key).data.publicUrl}`);
}
