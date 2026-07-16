// Skalad spegel-iframe — delad mellan sandboxen (godtycklig URL FÖRE/EFTER)
// och dashboardens "se live"-panel per variant. Ramen renderar sidan i full
// enhetsbredd (frameW) och skalar ner den till kortets bredd; sandbox-attributet
// håller den speglade sajtens skript i en opak origin (kan aldrig nå vår
// session — spegel-svaret bär dessutom samma CSP).

import { useEffect, useRef, useState } from "react";

export function MirrorFrame({
  src,
  frameW,
  label,
  iframeRef,
}: {
  src: string;
  frameW: number;
  label: string;
  iframeRef?: React.Ref<HTMLIFrameElement>;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setScale(Math.min(1, el.clientWidth / frameW));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [frameW]);

  const wrapH = Math.round(
    typeof window !== "undefined" ? Math.min(640, window.innerHeight * 0.66) : 520,
  );

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] tracking-wider text-stone-400">{label}</span>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] tracking-wider text-emerald-700 underline decoration-emerald-300 underline-offset-2 hover:decoration-emerald-700"
        >
          öppna i ny flik ↗
        </a>
      </div>
      <div
        ref={wrapRef}
        className="overflow-hidden rounded-md border border-stone-200 bg-white"
        style={{ height: wrapH }}
      >
        <iframe
          ref={iframeRef}
          src={src}
          title={label}
          sandbox="allow-scripts"
          style={{
            width: frameW,
            height: Math.round(wrapH / scale),
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            border: "0",
          }}
        />
      </div>
    </div>
  );
}
