#!/usr/bin/env bun
// Promote a registered site into the committed corpus/ — gated on the
// load-bearing score-determinism criterion (#4, corpus/README.md): N
// independent Browserbase freezes must produce byte-identical NORMALIZED
// goldens (replayCorpus + normalize). Capture/transport noise is allowed
// (normalize collapses selectors, sub-pixel rects, order, per-session hosts);
// what must converge is the scored structure. #4 is the oracle — if scores
// agree across independent captures, the frozen DOM is deterministic on every
// axis the score reads.
//
//   BROWSERBASE_API_KEY=… bun run scripts/promote-corpus.ts --name=linear
//     --n=3        number of independent freezes (default 3)
//     --dry-run    run the gate, write nothing to corpus/
//
// GREEN → stages corpus/<name>/{page.mhtml, screenshot.jpg, freeze-report.json,
//         meta.json (promoted:true), golden.json} from run 0 — review + commit.
// DRIFT → prints the per-field golden diff and writes nothing (exit 1). A fresh
//         site that drifts needs capture-time normalization (reduced-motion is
//         global; add SiteSpec.removeSelectors for inconsistently-injected
//         overlays) — same path hubspot took — before it can be promoted.
//
// Requires the site in corpus/sites.ts.

import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { freezeSite } from "../src/lib/tests/snapshot/freeze.server";
import { replayCorpus } from "../src/lib/tests/snapshot/harness.server";
import {
  normalizeCollect,
  normalizePageAudit,
  diffNormalized,
} from "../src/lib/tests/snapshot/normalize";
import { EXTRACTOR_VERSION } from "../src/lib/tests/extractor-version";
import { getSite } from "../corpus/sites";

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const name = arg("name");
const N = Number(arg("n") ?? "3");
const dryRun = flag("dry-run");
// --from=<dir>: resume the gate from existing freezes (dir/run0/<name>/…,
// run1/…) instead of capturing fresh — recovers an interrupted run without
// spending more Browserbase sessions.
const fromDir = arg("from");

if (!name) {
  console.error("Usage: bun run scripts/promote-corpus.ts --name=<name> [--n=3] [--dry-run]");
  process.exit(1);
}
const spec = getSite(name);
if (!spec) {
  console.error(`[promote] '${name}' is not in corpus/sites.ts — add a SiteSpec first.`);
  process.exit(1);
}

const scratch = mkdtempSync(join(tmpdir(), `promote-${name}-`));

async function freezeOnce(i: number): Promise<string> {
  const root = join(scratch, `run${i}`);
  const dir = join(root, name!);
  mkdirSync(dir, { recursive: true });
  await freezeSite({
    url: spec!.url,
    name: name!,
    consentSelector: spec!.consentSelector,
    consentFrame: spec!.consentFrame,
    consentDismissCheck: spec!.consentDismissCheck,
    removeSelectors: spec!.removeSelectors,
    outDir: dir,
    notes: `promote ${name} run${i} ${new Date().toISOString()}`,
  });
  const fr = JSON.parse(readFileSync(join(dir, "freeze-report.json"), "utf8"));
  if (fr.captureValidity?.ok === false) {
    throw new Error(`run${i} capture invalid: ${fr.captureValidity.reason ?? "?"}`);
  }
  if (!existsSync(join(dir, "page.mhtml"))) {
    throw new Error(
      `run${i} produced no local page.mhtml (externalized?) — promotion needs in-repo MHTML`,
    );
  }
  return root;
}

async function goldenOf(root: string) {
  const fresh = await replayCorpus(name!, root);
  return {
    collect: normalizeCollect(fresh.collect),
    pageAudit: normalizePageAudit(fresh.pageAudit),
  };
}

async function main(): Promise<number> {
  console.log(`[promote] ${name} — #4 score-determinism gate, N=${N} independent freezes\n`);

  const roots: string[] = [];
  if (fromDir) {
    for (let i = 0; existsSync(join(fromDir, `run${i}`, name!, "page.mhtml")); i++) {
      roots.push(join(fromDir, `run${i}`));
    }
    if (roots.length < 2) {
      throw new Error(
        `--from=${fromDir}: need >=2 run<N>/${name}/page.mhtml captures, found ${roots.length}`,
      );
    }
    console.log(`[promote] resuming from ${roots.length} existing freeze(s) in ${fromDir}`);
  } else {
    for (let i = 0; i < N; i++) {
      console.log(`[promote] freeze ${i + 1}/${N} …`);
      roots.push(await freezeOnce(i));
    }
  }

  const M = roots.length;
  const goldens: Array<Awaited<ReturnType<typeof goldenOf>>> = [];
  for (let i = 0; i < M; i++) {
    console.log(`[promote] replay + normalize ${i + 1}/${M} …`);
    goldens.push(await goldenOf(roots[i]));
  }

  let drift = 0;
  for (let i = 1; i < M; i++) {
    const d = diffNormalized(goldens[0], goldens[i]);
    if (d.length) {
      drift += d.length;
      console.log(`\n[promote] DRIFT run0 vs run${i} (${d.length} fields):`);
      for (const line of d.slice(0, 40)) console.log(`    ${line}`);
      if (d.length > 40) console.log(`    … and ${d.length - 40} more`);
    }
  }

  if (drift > 0) {
    console.error(
      `\n✗ NOT PROMOTED — #4 failed: ${drift} field diff(s) across ${M} freezes. ` +
        `The scored DOM isn't deterministic yet; see drift above and add capture-time ` +
        `normalization (SiteSpec.removeSelectors) before retrying.`,
    );
    return 1;
  }

  console.log(`\n✓ #4 GREEN — byte-identical normalized goldens across ${M} independent freezes.`);
  if (dryRun) {
    console.log("[promote] --dry-run: writing nothing to corpus/.");
    return 0;
  }

  // Stage corpus/<name>/ from run 0.
  const src = join(roots[0], name!);
  const dest = join("corpus", name!);
  mkdirSync(dest, { recursive: true });
  for (const f of ["page.mhtml", "screenshot.jpg", "freeze-report.json"]) {
    if (existsSync(join(src, f))) copyFileSync(join(src, f), join(dest, f));
  }
  writeFileSync(join(dest, "golden.json"), JSON.stringify(goldens[0], null, 2));

  // Augment run 0's meta.json with promotion provenance.
  const meta = JSON.parse(readFileSync(join(src, "meta.json"), "utf8"));
  meta.name = name;
  meta.consentSelector = spec!.consentSelector ?? null;
  meta.notes = spec!.notes ?? meta.notes ?? null;
  meta.promoted = true;
  meta["promotion-basis"] =
    `promote-corpus.ts N=${M} — #4 score-determinism GREEN (byte-identical normalized ` +
    `goldens across ${M} independent Browserbase captures), extractor v${EXTRACTOR_VERSION}, ` +
    `${new Date().toISOString().slice(0, 10)}.`;
  writeFileSync(join(dest, "meta.json"), JSON.stringify(meta, null, 2));

  console.log(
    `✓ staged corpus/${name}/ (page.mhtml, screenshot.jpg, freeze-report.json, meta.json, golden.json)`,
  );
  console.log(
    `  review the diff and commit. \`bun run angel --name=${name}\` should print determinism GREEN.`,
  );
  return 0;
}

main()
  .then((code) => {
    rmSync(scratch, { recursive: true, force: true });
    process.exit(code);
  })
  .catch((err) => {
    console.error(`\n✗ promote failed: ${err instanceof Error ? err.message : String(err)}`);
    rmSync(scratch, { recursive: true, force: true });
    process.exit(1);
  });
