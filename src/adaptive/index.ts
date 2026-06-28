// Angel Adaptive — public surface of the adaptive runtime.
//
// Import from "@/adaptive" rather than reaching into individual files. Note:
// persistence lives in persistence.server.ts and is intentionally NOT exported
// here, so this barrel stays safe to import from client code.

export * from "./types";
export { PATTERNS, ALL_PATTERNS, getPattern } from "./patterns";
export {
  buildVisitorContext,
  readServerSignals,
  classifyDevice,
  classifyBrowser,
  classifyOS,
  classifyTrafficSource,
  type ServerSignals,
} from "./context";
export { getDemoInventory, emptyInventory, firstItem, pickItem } from "./inventory";
export {
  mapAuditToInventory,
  mapGoldenToInventory,
  classifyCtaIntent,
  extractMicrocopy,
} from "./crawler-inventory";
export { decide, decisionIdFor, MAX_ADAPTATIONS } from "./decide";
