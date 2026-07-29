#!/usr/bin/env bun
// Browserbase-ops: synliggör vad som kör och städa strays efter kraschade runs.
//
//   bun run scripts/bb-sweep.ts                              # lista RUNNING + usage
//   bun run scripts/bb-sweep.ts --pipeline=freeze --release  # släpp en pipelines sessioner
//   bun run scripts/bb-sweep.ts --older-than=10 --release    # släpp allt äldre än 10 min
//   bun run scripts/bb-sweep.ts --all --release              # släpp ALLT som kör
//
// Släpp kräver ett filter (--pipeline/--older-than) eller explicit --all —
// annars är det för lätt att döda appens levande session av misstag.
// Sessioner självdör via timeout (16 min); sweepens värde är att döda dem
// TIDIGARE när en batch-körning kraschat (kostnad: browser-minuter + proxy-GB)
// och att GÖRA SYNLIGT vad som kör (createSession stämplar userMetadata
// {pipeline, site, runId} sedan browserbase-usage-review 2026-07-29).

import { getBrowserbaseClient } from "../src/lib/tests/browserbase.server";

function arg(name: string): string | undefined {
  const p = `--${name}=`;
  return process.argv.find((a) => a.startsWith(p))?.slice(p.length);
}
const flag = (n: string) => process.argv.includes(`--${n}`);

const pipeline = arg("pipeline");
const olderThanRaw = arg("older-than");
const olderThanMin = olderThanRaw !== undefined ? Number(olderThanRaw) : undefined;
if (olderThanMin !== undefined && !Number.isFinite(olderThanMin)) {
  console.error(`[bb] ogiltig --older-than=${olderThanRaw}`);
  process.exit(1);
}
const release = flag("release");
const all = flag("all");

const { client, projectId } = getBrowserbaseClient();

const [project, usage, running] = await Promise.all([
  client.projects.retrieve(projectId),
  client.projects.usage(projectId),
  client.sessions.list({ status: "RUNNING" }),
]);

console.log(
  `[bb] plan concurrency ${project.concurrency} · förbrukat ${usage.browserMinutes} browser-min · ` +
    `${(usage.proxyBytes / 1e9).toFixed(2)} GB proxy`,
);

const now = Date.now();
const rows = running
  .map((s) => ({
    id: s.id,
    ageMin: (now - new Date(s.createdAt).getTime()) / 60_000,
    region: s.region,
    keepAlive: s.keepAlive,
    meta: (s.userMetadata ?? {}) as Record<string, unknown>,
  }))
  .filter((r) => (pipeline ? r.meta.pipeline === pipeline : true))
  .filter((r) => (olderThanMin !== undefined ? r.ageMin >= olderThanMin : true));

if (rows.length === 0) {
  console.log(
    `[bb] inga RUNNING sessioner` +
      `${pipeline ? ` med pipeline=${pipeline}` : ""}` +
      `${olderThanMin !== undefined ? ` äldre än ${olderThanMin} min` : ""}.`,
  );
  process.exit(0);
}

for (const r of rows) {
  console.log(
    `  ${r.id} · ${r.ageMin.toFixed(1)} min · ${r.region}${r.keepAlive ? " · keepAlive" : ""} · ` +
      `${JSON.stringify(r.meta)} · https://www.browserbase.com/sessions/${r.id}`,
  );
}

if (!release) {
  console.log(
    `[bb] ${rows.length} RUNNING. Lägg till --release (+ --pipeline=/--older-than= eller --all) för att släppa.`,
  );
  process.exit(0);
}
if (!pipeline && olderThanMin === undefined && !all) {
  console.error("[bb] --release utan filter: ange --pipeline=/--older-than= eller --all.");
  process.exit(1);
}
for (const r of rows) {
  await client.sessions.update(r.id, { projectId, status: "REQUEST_RELEASE" });
  console.log(`  released ${r.id}`);
}
console.log(`[bb] släppte ${rows.length} session(er).`);
