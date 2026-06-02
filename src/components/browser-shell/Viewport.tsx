import { Play, RotateCw, Snowflake } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SessionState = "cold" | "live" | "frozen" | "error";

export type OverlayElement = {
  selector: string;
  category: string;
  rect: { x: number; y: number; w: number; h: number };
};

export type FrozenSnapshot = {
  screenshotUrl: string;
  viewport: { w: number; h: number };
  overlayElements: OverlayElement[];
};

const CATEGORY_COLORS: Record<string, string> = {
  cta_primary: "#10b981",
  cta_secondary: "#22d3ee",
  form_submit: "#f59e0b",
  icon_button: "#a78bfa",
  nav_item: "#64748b",
  link: "#60a5fa",
  // Trust signals (match scripts/overlay.ts OVERLAY_FN colors)
  testimonial: "#f97316",
  review_badges: "#a855f7",
  social_proof_count: "#f43f5e",
  other: "#f472b6",
};

interface ViewportProps {
  sessionState: SessionState;
  liveUrl: string | null;
  frozen: FrozenSnapshot | null;
  onResume?: () => void;
}

export function Viewport({ sessionState, liveUrl, frozen, onResume }: ViewportProps) {
  if (sessionState === "live" && liveUrl) {
    return (
      <div className="relative flex-1 overflow-hidden bg-muted/20">
        <iframe
          key={`live-${liveUrl}`}
          src={liveUrl}
          title="Browserbase live session"
          className="h-full w-full border-0 bg-background"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        />
      </div>
    );
  }

  if (sessionState === "frozen") {
    if (frozen) {
      return <FrozenViewport frozen={frozen} onResume={onResume} />;
    }
    // Session ended but no snapshot was captured (e.g. collect failed).
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-muted/20 text-muted-foreground">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Snowflake className="h-5 w-5" />
        </div>
        <p className="text-sm">Session ended · no snapshot captured.</p>
        {onResume && (
          <Button size="sm" onClick={onResume} className="gap-1.5">
            <RotateCw className="h-3.5 w-3.5" />
            Resume session
          </Button>
        )}
      </div>
    );
  }

  // Cold (or error)
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-muted/20 text-muted-foreground">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Play className="h-5 w-5" />
      </div>
      <p className="text-sm">
        Enter a URL and click <span className="font-medium text-foreground">Run</span> to start a session.
      </p>
    </div>
  );
}


function FrozenViewport({ frozen, onResume }: { frozen: FrozenSnapshot; onResume?: () => void }) {
  const { screenshotUrl, viewport, overlayElements } = frozen;

  return (
    <div className="relative flex-1 overflow-y-auto overflow-x-hidden bg-muted/20">
      <div
        className="relative mx-auto"
        style={{
          width: "100%",
          maxWidth: viewport.w,
          aspectRatio: `${viewport.w} / ${viewport.h}`,
        }}
      >
        <img
          src={screenshotUrl}
          alt="Frozen page snapshot"
          className="absolute inset-0 h-full w-full"
          draggable={false}
        />
        {overlayElements
          .filter((el) => el.rect.y + el.rect.h > 0 && el.rect.y < viewport.h && el.rect.w > 0 && el.rect.h > 0)
          .map((el, i) => {
            const color = CATEGORY_COLORS[el.category] ?? CATEGORY_COLORS.other;
            return (
              <div
                key={`${el.selector}-${i}`}
                className="absolute pointer-events-none"
                style={{
                  left: `${(el.rect.x / viewport.w) * 100}%`,
                  top: `${(el.rect.y / viewport.h) * 100}%`,
                  width: `${(el.rect.w / viewport.w) * 100}%`,
                  height: `${(el.rect.h / viewport.h) * 100}%`,
                  outline: `2px solid ${color}`,
                  background: `${color}1f`,
                  boxSizing: "border-box",
                }}
              >
                <div
                  className="absolute -top-2 -left-2 flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white shadow"
                  style={{ background: color }}
                >
                  {i + 1}
                </div>
              </div>
            );
          })}
      </div>

      {onResume && (
        <div className="pointer-events-none sticky bottom-3 left-0 z-20 mt-[-50px] flex w-full justify-center opacity-0 transition-opacity hover:opacity-100">
          <Button size="sm" onClick={onResume} className="pointer-events-auto gap-1.5 shadow-lg">
            <RotateCw className="h-3.5 w-3.5" />
            Resume session
          </Button>
        </div>
      )}
    </div>
  );
}
