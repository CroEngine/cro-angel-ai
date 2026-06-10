// Auto-externalisera stora artefakter via lovable-assets CLI.
//
// Used by freeze.server.ts. Repo har 10 MB-tak per fil. När page.mhtml efter
// font-embed går över MHTML_INLINE_THRESHOLD_BYTES laddar vi upp den till CDN
// och skriver en .asset.json-pekare i stället. Harness läser pekaren och
// hämtar mhtml till tmp innan replay.
//
// FAS 1-härdning (säkerhetsmodell för externaliserade artefakter):
//   1. sha256 av uppladdade bytes committas i pekaren. Harness verifierar
//      vid replay → mismatch (trunkering, fel innehåll, 404-sida som body)
//      → throw, ingen tyst golden-drift.
//   2. Full resolverbar URL committas (`resolvedUrl`). LOVABLE_ASSETS_BASE_URL
//      är debug-override, inte primary path → hermeticitet bevarad.
//   3. Ett retry på upload — capturen som föregår är dyr (~50s Browserbase),
//      transient nät-blip ska inte tvinga ny capture.
//
// Asset-livscykel: `lovable-assets create` skapar ett nytt asset_id varje
// gång (bekräftat 2026-06-10 via probe). Det är immutable i den meningen
// att samma asset_id alltid pekar på samma bytes; re-freeze skapar ny URL
// och lämnar gammal som orphan tills den GC:as av asset-systemet. Det är
// säkert för historiska commits (URL pekar fortfarande på samma bytes) men
// betyder att repo-storleken på CDN-sidan ackumuleras vid re-freezes.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 9 MB — marginal under 10 MB repo-gränsen för att täcka ev. transformations.
export const MHTML_INLINE_THRESHOLD_BYTES = 9 * 1024 * 1024;

const UPLOAD_RETRY_DELAY_MS = 1000;
const UPLOAD_MAX_ATTEMPTS = 2;

// Härleds från project_id om LOVABLE_ASSETS_BASE_URL inte är satt.
function defaultBaseUrl(projectId: string): string {
  return `https://id-preview--${projectId}.lovable.app`;
}

// CLI-output (oförändrad form).
interface CliPointer {
  version: number;
  asset_id: string;
  project_id: string;
  url: string;
  r2_key: string;
  original_filename: string;
  size: number;
  content_type: string;
  created_at: string;
}

// Vad vi skriver till disk. Notera: extends CliPointer + ett par fält till.
// `resolvedUrl` är primary path för fetch; `url` (path-only) hålls för
// bakåtkompatibilitet och som referens.
export interface AssetPointer extends CliPointer {
  /** Full resolverbar URL. Committad så att repro inte beror på env. */
  resolvedUrl: string;
  /** sha256-hex av exakt de bytes som laddats upp. Verifieras vid fetch. */
  sha256: string;
  /** Schema-version för själva pekaren (separat från CLI:s `version`). */
  pointerVersion: 1;
}

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

function runCli(tmpFile: string, uploadFilename: string): CliPointer {
  const proc = spawnSync(
    "lovable-assets",
    ["create", "--file", tmpFile, "--filename", uploadFilename],
    { encoding: "utf8" },
  );
  if (proc.status !== 0) {
    throw new Error(
      `[externalize] lovable-assets create failade (exit ${proc.status}): ${proc.stderr || proc.stdout}`,
    );
  }
  let parsed: CliPointer;
  try {
    parsed = JSON.parse(proc.stdout);
  } catch {
    throw new Error(
      `[externalize] kunde inte parsa lovable-assets-output som JSON: ${proc.stdout}`,
    );
  }
  if (!parsed.url || !parsed.asset_id || !parsed.project_id) {
    throw new Error(
      `[externalize] lovable-assets-output saknar förväntade fält: ${proc.stdout}`,
    );
  }
  return parsed;
}

/**
 * Ladda upp innehåll via `lovable-assets create`. Returnerar pekare med
 * sha256 + full URL. Throwar med tydligt fel om CLI saknas eller failar.
 *
 * Obs: CLI:t har en allowlist av filändelser. .mhtml accepteras inte —
 * vi laddar därför upp med .txt-suffix (page.mhtml.txt). Harness vid replay
 * fetchar och skriver tillbaka som page.mhtml på disk, så Chromium hittar
 * rätt format via file://. Suffix-fixen påverkar bara CDN-URL:en, inte
 * innehållet eller hur replay tolkar det.
 */
export function uploadAsset(content: Buffer | string, filename: string): AssetPointer {
  const probe = spawnSync("command", ["-v", "lovable-assets"], { shell: true });
  if (probe.status !== 0) {
    throw new Error(
      "[externalize] lovable-assets CLI saknas i PATH. Kan inte externalisera stor artefakt. " +
        "Kör freeze i en miljö där assets-integrationen är aktiv.",
    );
  }

  const buf = typeof content === "string" ? Buffer.from(content, "utf8") : content;
  const hash = sha256Hex(buf);

  // CLI:t kräver tillåten filändelse — om filename slutar på .mhtml lägg .txt.
  const uploadFilename = filename.endsWith(".mhtml") ? `${filename}.txt` : filename;
  const ts = Date.now();
  const tmpFile = join(tmpdir(), `lovable-asset-upload-${ts}-${uploadFilename}`);
  writeFileSync(tmpFile, buf);

  // Retry: en transient nät-blip ska inte tvinga ny capture (~50s Browserbase).
  let lastErr: unknown = null;
  let cli: CliPointer | null = null;
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
    try {
      cli = runCli(tmpFile, uploadFilename);
      break;
    } catch (e) {
      lastErr = e;
      if (attempt < UPLOAD_MAX_ATTEMPTS) {
        // eslint-disable-next-line no-console
        console.warn(
          `[externalize] upload attempt ${attempt} failed, retrying in ${UPLOAD_RETRY_DELAY_MS}ms: ` +
            (e instanceof Error ? e.message : String(e)),
        );
        // Sync sleep ok — externalize körs bara från CLI-script, inte runtime.
        const end = Date.now() + UPLOAD_RETRY_DELAY_MS;
        while (Date.now() < end) {
          /* spin */
        }
      }
    }
  }
  if (!cli) {
    throw lastErr instanceof Error
      ? lastErr
      : new Error(`[externalize] upload failed: ${String(lastErr)}`);
  }

  // Sanity: CLI:t rapporterar storlek; bekräfta att den matchar våra bytes.
  if (cli.size !== buf.byteLength) {
    throw new Error(
      `[externalize] storleks-mismatch: lokal=${buf.byteLength}b cli.size=${cli.size}b — upload trunkerad?`,
    );
  }

  const baseUrl = process.env.LOVABLE_ASSETS_BASE_URL ?? defaultBaseUrl(cli.project_id);
  const resolvedUrl = baseUrl.replace(/\/$/, "") + cli.url;

  const pointer: AssetPointer = {
    ...cli,
    resolvedUrl,
    sha256: hash,
    pointerVersion: 1,
  };
  return pointer;
}

/**
 * Resolva URL för fetch. Föredrar pekarens committade `resolvedUrl` (hermetiskt).
 * Faller bara tillbaka till URL-konstruktion om pekaren saknar fältet (gamla
 * pekare före Fas 1) och tillåter env-override för debug.
 */
export function resolveAssetUrl(pointer: AssetPointer | { url: string; project_id: string; resolvedUrl?: string }): string {
  if ("resolvedUrl" in pointer && pointer.resolvedUrl) {
    // Env-override endast om explicit satt — annars är committad URL primär.
    if (process.env.LOVABLE_ASSETS_BASE_URL) {
      return process.env.LOVABLE_ASSETS_BASE_URL.replace(/\/$/, "") + pointer.url;
    }
    return pointer.resolvedUrl;
  }
  // Legacy / probe-fallback.
  if (pointer.url.startsWith("http")) return pointer.url;
  const base = process.env.LOVABLE_ASSETS_BASE_URL ?? defaultBaseUrl(pointer.project_id);
  return base.replace(/\/$/, "") + pointer.url;
}

/** Hjälp för harness — exponerar samma hash-funktion. */
export function sha256OfBuffer(buf: Buffer): string {
  return sha256Hex(buf);
}
