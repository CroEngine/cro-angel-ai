// Auto-extracted from engine.server.ts — runs inside the browser via page.evaluate.
// Keep self-contained: no imports, no closures over server state.

export function OVERLAY_FN(pairs: Array<[string, string]>) {
  const OVERLAY_ID = "__lovable_collect_overlay__";
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();

  const COLORS: Record<string, string> = {
    cta_primary: "#10b981",
    cta_secondary: "#22d3ee",
    form_submit: "#f59e0b",
    icon_button: "#a78bfa",
    nav_item: "#64748b",
    link: "#60a5fa",
    other: "#f472b6",
  };

  const wrap = document.createElement("div");
  wrap.id = OVERLAY_ID;
  wrap.style.cssText =
    "position:absolute;top:0;left:0;width:0;height:0;pointer-events:none;z-index:2147483647;";
  document.body.appendChild(wrap);

  pairs.forEach(([sel, category], i) => {
    let el: Element | null = null;
    try { el = document.querySelector(sel); } catch { el = null; }
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;

    const color = COLORS[category] ?? COLORS.other;

    const box = document.createElement("div");
    box.style.cssText = [
      "position:absolute",
      `top:${Math.round(r.top + window.scrollY)}px`,
      `left:${Math.round(r.left + window.scrollX)}px`,
      `width:${Math.round(r.width)}px`,
      `height:${Math.round(r.height)}px`,
      `outline:2px solid ${color}`,
      `background:${color}1f`,
      "box-sizing:border-box",
      "pointer-events:none",
    ].join(";");

    const badge = document.createElement("div");
    badge.textContent = String(i + 1);
    badge.style.cssText = [
      "position:absolute",
      "top:-10px",
      "left:-10px",
      "min-width:20px",
      "height:20px",
      "padding:0 6px",
      "border-radius:10px",
      `background:${color}`,
      "color:#fff",
      "font:bold 11px system-ui,sans-serif",
      "line-height:20px",
      "text-align:center",
      "box-shadow:0 1px 3px rgba(0,0,0,0.3)",
    ].join(";");

    box.appendChild(badge);
    wrap.appendChild(box);
  });
}


