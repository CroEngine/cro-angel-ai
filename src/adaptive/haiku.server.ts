// Delad rå-Haiku-anropare. Fyra ställen (section-llm, proof-rank, labeler,
// goal-judge) bar samma scaffolding ordagrant: AbortController+timeout → POST
// api.anthropic.com/v1/messages med samma headers → kolla res.ok → plocka
// content[type==="text"].text → warn+null vid fel → clearTimeout i finally. Här
// bor den EN gång. Varje anropare äger fortfarande sin egen prompt (system +
// userContent), sina params (max_tokens, ev. temperature, timeout) och sin egen
// svarsvalidering. Fail-open: ingen nyckel / API-fel / timeout / undantag →
// null (kastar aldrig). Anropare som vill ha en fallback mappar null själv.

const MODEL = "claude-haiku-4-5";
const ENDPOINT = "https://api.anthropic.com/v1/messages";
const DEFAULT_TIMEOUT_MS = 8000;

export interface HaikuCall {
  /** System-prompten. */
  system: string;
  /** User-meddelandets innehåll — redan serialiserat (oftast JSON.stringify(...)). */
  userContent: string;
  max_tokens: number;
  /** Sätt bara när anroparen kräver determinism (goal-judge: 0). Utelämnas annars. */
  temperature?: number;
  timeoutMs?: number;
  /** Kort etikett för [angel] <tag>-varningen (t.ex. "section-typer"). */
  tag: string;
}

/** Anropa Haiku och returnera det första text-blocket, eller null vid
 *  saknad nyckel / API-fel / timeout / undantag. Kastar aldrig. */
export async function callHaikuText(call: HaikuCall): Promise<string | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), call.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const body: Record<string, unknown> = {
      model: MODEL,
      max_tokens: call.max_tokens,
      system: call.system,
      messages: [{ role: "user", content: call.userContent }],
    };
    if (call.temperature !== undefined) body.temperature = call.temperature;
    const res = await fetch(ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[angel] ${call.tag}: API ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { content?: { type: string; text?: string }[] };
    return json.content?.find((c) => c.type === "text")?.text ?? "";
  } catch (err) {
    console.warn(`[angel] ${call.tag} unavailable:`, err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
