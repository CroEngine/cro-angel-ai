#!/usr/bin/env bun
// Claude Designer — API egress smoke test (run under Node with proxy env).
import Anthropic from "@anthropic-ai/sdk";

async function main() {
  const apiKey = process.env.Claude_API;
  if (!apiKey) throw new Error("Claude_API env var not set");
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 64,
    messages: [{ role: "user", content: "Reply with exactly: DESIGNER-ONLINE" }],
  });
  const text = resp.content.find((b) => b.type === "text");
  console.log("model:", resp.model, "| stop:", resp.stop_reason);
  console.log("reply:", text && "text" in text ? text.text : "(none)");
  console.log("usage:", JSON.stringify(resp.usage));
}

main().catch((e) => {
  console.error("smoke failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
