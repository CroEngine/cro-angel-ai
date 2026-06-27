// Ambient type for the global the snippet (public/adaptive.js) installs.
import type { AngelEvent, Decision } from "./types";

declare global {
  interface Window {
    AngelAdaptive?: {
      version: string;
      site: string;
      decision: Decision;
      applied: string[];
      reset: () => void;
      track: (
        type: AngelEvent["type"],
        payload?: Record<string, unknown>,
        decisionId?: string,
      ) => void;
    };
  }
}

export {};
