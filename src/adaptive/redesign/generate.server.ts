// Fas 3 (slice 2) — Anthropic adapter for redesign generation.
//
// The `complete` implementation injected into generateRedesign(): sends the
// assembled brief PLUS the page screenshot (vision) to Claude and returns the
// raw text. Mirrors the goal-judge pattern (direct Messages API, graceful
// fallback): no ANTHROPIC_API_KEY / any failure → null, and generateRedesign
// degrades to an empty plan. Server-only (reads the screenshot from disk, uses
// the API key).

import { readFile } from "node:fs/promises";
import { extname } from "node:path";

// Vision + structured reasoning for the rearrangement — the redesign is a harder
// task than goal-judging, so a more capable model than the judge's Haiku.
const MODEL = "claude-sonnet-5";
const TIMEOUT_MS = 30_000;
const MAX_SCREENSHOT_BYTES = 4_000_000; // keep the vision payload bounded

const SYSTEM =
  "You are a conversion-focused web designer. You improve ONE page for ONE " +
  "visitor segment by REARRANGING, REVEALING or RE-TIGHTENING content that is " +
  "ALREADY on the page — never by inventing content, copy, numbers or claims, " +
  "and never by changing colors, adding motion, or altering the brand's look. " +
  "You output ONLY a JSON array of reversible ops as instructed in the brief.";

const MEDIA: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** Read the screenshot as a base64 image block, or null when missing/too big. */
async function imageBlock(
  screenshotPath: string,
): Promise<{ type: "image"; source: { type: "base64"; media_type: string; data: string } } | null> {
  const media = MEDIA[extname(screenshotPath).toLowerCase()];
  if (!media) return null;
  try {
    const buf = await readFile(screenshotPath);
    if (buf.byteLength === 0 || buf.byteLength > MAX_SCREENSHOT_BYTES) return null;
    return {
      type: "image",
      source: { type: "base64", media_type: media, data: buf.toString("base64") },
    };
  } catch {
    return null;
  }
}

/** Injectable `complete` for generateRedesign: brief (+ screenshot) → raw text.
 *  Returns null on no key / any failure, consistent with the repo's LLM ethos. */
export async function completeWithClaude(
  prompt: string,
  screenshotPath: string,
): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  const img = await imageBlock(screenshotPath);
  const content: unknown[] = [{ type: "text", text: prompt }];
  if (img) content.push(img); // vision is best-effort — the brief already describes the page

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1200,
        temperature: 0,
        system: SYSTEM,
        messages: [{ role: "user", content }],
      }),
    });
    if (!res.ok) {
      console.warn(`[angel] redesign-generate: API ${res.status}`);
      return null;
    }
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    return body.content?.find((c) => c.type === "text")?.text ?? null;
  } catch (err) {
    console.warn(`[angel] redesign-generate unavailable:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
