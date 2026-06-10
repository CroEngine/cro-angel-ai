// Auto-externalisera stora artefakter via lovable-assets CLI.
//
// Used by freeze.server.ts. Repo har 10 MB-tak per fil. När page.mhtml efter
// font-embed går över MHTML_INLINE_THRESHOLD_BYTES laddar vi upp den till CDN
// och skriver en .asset.json-pekare i stället. Harness läser pekaren och
// hämtar mhtml till tmp innan replay.

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 9 MB — marginal under 10 MB repo-gränsen för att täcka ev. transformations.
export const MHTML_INLINE_THRESHOLD_BYTES = 9 * 1024 * 1024;

export interface AssetPointer {
  version: number;
  asset_id: string;
  project_id: string;
  url: string; // path-only, t.ex. /__l5e/assets-v1/{id}/page.mhtml
  r2_key: string;
  original_filename: string;
  size: number;
  content_type: string;
  created_at: string;
}

/**
 * Ladda upp innehåll via `lovable-assets create`. Returnerar parsed pointer.
 * Throwar med ett tydligt fel om CLI saknas eller failar.
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

  // CLI:t kräver tillåten filändelse — om filename slutar på .mhtml lägg .txt.
  const uploadFilename = filename.endsWith(".mhtml") ? `${filename}.txt` : filename;

  // Skriv till tmp så CLI:t har en filsökväg att läsa. Använd .txt-suffix
  // även på diskpathen så CLI:t inte avvisar via extension-check.
  const ts = Date.now();
  const tmpFile = join(tmpdir(), `lovable-asset-upload-${ts}-${uploadFilename}`);
  writeFileSync(tmpFile, content as Buffer);

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
  let pointer: AssetPointer;
  try {
    pointer = JSON.parse(proc.stdout);
  } catch (e) {
    throw new Error(
      `[externalize] kunde inte parsa lovable-assets-output som JSON: ${proc.stdout}`,
    );
  }
  if (!pointer.url || !pointer.asset_id || !pointer.project_id) {
    throw new Error(
      `[externalize] lovable-assets-output saknar förväntade fält: ${proc.stdout}`,
    );
  }
  return pointer;
}

/**
 * Bygg en fullständig URL från en pointer. Använd LOVABLE_ASSETS_BASE_URL om satt,
 * annars härleda från project_id (preview-host).
 */
export function resolveAssetUrl(pointer: { url: string; project_id: string }): string {
  if (pointer.url.startsWith("http")) return pointer.url;
  const base =
    process.env.LOVABLE_ASSETS_BASE_URL ??
    `https://id-preview--${pointer.project_id}.lovable.app`;
  return base.replace(/\/$/, "") + pointer.url;
}
