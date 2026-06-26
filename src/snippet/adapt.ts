// The adaptation interpreter (M4). Consumes an AdaptationPlan + the server's
// resolved inventory content and applies it to the live DOM — locally, per visitor,
// ephemerally. Two guarantees are structural here, not aspirational:
//
//   • Reversible — every op records its exact inverse; applyPlan() returns a revert()
//     that restores the DOM byte-for-byte (the customer's original site is never
//     changed; adaptation is a per-tab overlay).
//   • Never invents content — ops that change text/images read ONLY from `content`
//     (resolved by the server from the proven content inventory). No opcode accepts
//     free text. If the content isn't there, the op is skipped, not faked.
//
// Defensive throughout: a missing selector or a throwing op is skipped, never fatal.
// The snippet imports only types from contract.ts, so this stays tiny + zod-free.

import type { AdaptationOp, AdaptationPlan, ResolvedContent } from "./contract";

export type ContentMap = Record<string, ResolvedContent>;
export type Revert = () => void;

const STYLE_ID = "angel-adapt-style";

// One stylesheet backs the visibility + emphasis ops. Injected lazily, removed on
// full revert. Uses display:revert so a `show` un-hides class/inline-hidden nodes.
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent =
    "[data-angel-hide]{display:none!important}" +
    "[data-angel-show]{display:revert!important}" +
    ".angel-emphasize{outline:2px solid currentColor;outline-offset:3px;border-radius:6px}" +
    ".angel-sticky{position:fixed!important;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483646;box-shadow:0 8px 30px rgba(0,0,0,.25)}" +
    ".angel-primary{filter:saturate(1.35) brightness(1.05)}";
  (document.head || document.documentElement).appendChild(s);
}

const qs = (sel: string): Element | null => {
  try {
    return document.querySelector(sel);
  } catch {
    return null; // malformed selector ⇒ treat as "not found"
  }
};

// Document-order comparator (so a reorder lands the block at its original start).
function byDom(a: Element, b: Element): number {
  const p = a.compareDocumentPosition(b);
  if (p & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (p & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

// Reorder a set of sibling elements into `order`. Each element gets a stable home
// marker at its original slot (a comment node that never moves), so revert puts
// every element back exactly where it was. Shared by reorderSections / reorderNav.
function reorder(order: string[]): Revert | null {
  const els = order.map(qs).filter((e): e is Element => e != null);
  if (els.length < 2) return null;

  const parent = els[0].parentNode;
  if (!parent || !els.every((e) => e.parentNode === parent)) return null; // must be siblings

  const homes = new Map<Element, Comment>();
  for (const e of els) {
    const m = document.createComment("angel");
    parent.insertBefore(m, e);
    homes.set(e, m);
  }

  // Lay the elements down in plan order, contiguously, at the block's original start.
  const anchor = homes.get([...els].sort(byDom)[0])!;
  for (const e of els) parent.insertBefore(e, anchor);

  return () => {
    for (const e of els) {
      const m = homes.get(e);
      if (m && m.parentNode) m.parentNode.insertBefore(e, m);
    }
    for (const m of homes.values()) m.remove();
  };
}

function moveElement(
  selector: string,
  position: "before" | "after",
  anchorSelector: string,
): Revert | null {
  const el = qs(selector);
  const anchor = qs(anchorSelector);
  if (!el || !anchor || el === anchor || !el.parentNode || !anchor.parentNode) return null;

  const home = document.createComment("angel");
  el.parentNode.insertBefore(home, el); // remember where it came from
  if (position === "before") anchor.parentNode.insertBefore(el, anchor);
  else anchor.parentNode.insertBefore(el, anchor.nextSibling);

  return () => {
    if (home.parentNode) home.parentNode.insertBefore(el, home);
    home.remove();
  };
}

// Toggle a boolean attribute, restoring its prior presence on revert.
function setFlag(el: Element, attr: string): Revert {
  ensureStyle();
  const had = el.hasAttribute(attr);
  el.setAttribute(attr, "");
  return () => {
    if (!had) el.removeAttribute(attr);
  };
}

function addClass(el: Element, cls: string): Revert {
  ensureStyle();
  const hadAttr = el.hasAttribute("class");
  const had = el.classList.contains(cls);
  el.classList.add(cls);
  return () => {
    if (!had) el.classList.remove(cls);
    // classList.remove leaves an empty class="" behind — drop it if we created it,
    // so revert is byte-for-byte.
    if (!hadAttr && el.getAttribute("class") === "") el.removeAttribute("class");
  };
}

// Set an attribute to a new value, restoring (or removing) the old one on revert.
function setAttr(el: Element, name: string, value: string): Revert {
  const had = el.hasAttribute(name);
  const prev = el.getAttribute(name);
  el.setAttribute(name, value);
  return () => {
    if (had && prev != null) el.setAttribute(name, prev);
    else el.removeAttribute(name);
  };
}

function switchCta(fromSelector: string, c: ResolvedContent | undefined): Revert | null {
  const el = qs(fromSelector);
  if (!el || !c || (c.text == null && c.href == null)) return null; // nothing proven to show
  const reverts: Revert[] = [];
  if (c.text != null) {
    const prev = el.textContent;
    el.textContent = c.text;
    reverts.push(() => {
      el.textContent = prev;
    });
  }
  if (c.href != null && el.tagName === "A") reverts.push(setAttr(el, "href", c.href));
  return reverts.length ? () => reverts.forEach((r) => r()) : null;
}

function swapImage(selector: string, c: ResolvedContent | undefined): Revert | null {
  const el = qs(selector);
  if (!el || !c?.src) return null;
  const r1 = setAttr(el, "src", c.src);
  const hadSrcset = el.hasAttribute("srcset");
  const prevSrcset = el.getAttribute("srcset");
  el.removeAttribute("srcset"); // a stale srcset would override the swapped src
  return () => {
    r1();
    if (hadSrcset && prevSrcset != null) el.setAttribute("srcset", prevSrcset);
  };
}

function showMicrocopy(slotSelector: string, c: ResolvedContent | undefined): Revert | null {
  const slot = qs(slotSelector);
  if (!slot || !c?.text) return null; // text must come from proven inventory
  const node = document.createElement("span");
  node.setAttribute("data-angel-microcopy", "");
  node.textContent = c.text;
  slot.appendChild(node);
  return () => node.remove();
}

function applyOp(op: AdaptationOp, content: ContentMap): Revert | null {
  switch (op.op) {
    case "reorderSections":
    case "reorderNav":
      return reorder(op.order);
    case "showElement":
      return setFlagIfPresent(op.selector, "data-angel-show");
    case "hideElement":
      return setFlagIfPresent(op.selector, "data-angel-hide");
    case "moveElement":
      return moveElement(op.selector, op.position, op.anchorSelector);
    case "emphasizeCta":
      return emphasize(op.selector, op.style);
    case "switchCta":
      return switchCta(op.fromSelector, content[op.toInventoryId]);
    case "swapImage":
      return swapImage(op.selector, content[op.toInventoryId]);
    case "showMicrocopy":
      return showMicrocopy(op.slotSelector, content[op.fromInventoryId]);
  }
}

function setFlagIfPresent(selector: string, attr: string): Revert | null {
  const el = qs(selector);
  return el ? setFlag(el, attr) : null;
}

function emphasize(
  selector: string,
  style: "emphasize" | "sticky" | "primary-swap",
): Revert | null {
  const el = qs(selector);
  if (!el) return null;
  const cls =
    style === "sticky"
      ? "angel-sticky"
      : style === "primary-swap"
        ? "angel-primary"
        : "angel-emphasize";
  return addClass(el, cls);
}

// Apply every op in the plan, collecting inverses. Returns a single revert() that
// undoes them in reverse order and removes the injected stylesheet — leaving the
// DOM exactly as it was found.
export function applyPlan(plan: AdaptationPlan, content: ContentMap = {}): Revert {
  const reverts: Revert[] = [];
  for (const op of plan.ops) {
    try {
      const r = applyOp(op, content);
      if (r) reverts.push(r);
    } catch {
      /* one bad op must never break the customer's page */
    }
  }
  return () => {
    for (let i = reverts.length - 1; i >= 0; i--) {
      try {
        reverts[i]();
      } catch {
        /* best-effort restore */
      }
    }
    document.getElementById(STYLE_ID)?.remove();
  };
}
