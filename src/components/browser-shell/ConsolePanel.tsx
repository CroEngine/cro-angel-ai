import { ScrollArea } from "@/components/ui/scroll-area";

export interface LogRow {
  time: string;
  message: string;
}

const seedLogs: LogRow[] = [
  { time: "23:27:00", message: "[v3-piercer] installed {url: about:blank, isTop: false, readyState: loading}" },
  { time: "23:27:01", message: "[v3-piercer] installed {url: about:blank, isTop: false, readyState: loading}" },
  { time: "23:27:01", message: "[v3-piercer] installed {url: about:blank, isTop: false, readyState: loading}" },
  {
    time: "23:27:02",
    message:
      "[v3-piercer] installed {url: https://www.google.com/recaptcha/api2/bframe?hl=en…iCNgjWgHLqVJ3TY8nF965RGysWivCOV1fBXjsy846u-HiuGdw, isTop: false, readyState: loading}",
  },
  { time: "23:27:02", message: "[v3-piercer] installed {url: about:blank, isTop: false, readyState: loading}" },
  { time: "23:27:05", message: "Browserbase keeping connection alive" },
  { time: "23:27:07", message: "Browserbase keeping connection alive" },
  { time: "23:27:10", message: "browserbase-solving-finished" },
  {
    time: "23:27:10",
    message: '{"key":"browserbase-captcha-event","status":"finished","id":"019e7fee-8a72-723e-88cf-da2e21b19ff8"}',
  },
];

export function ConsolePanel() {
  return (
    <div className="flex h-64 flex-col border-t border-border bg-background">
      <div className="border-b border-border px-4 py-2">
        <h2 className="text-base font-semibold text-foreground">Console</h2>
      </div>
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border font-mono text-xs">
          {seedLogs.map((log, i) => (
            <div key={i} className="flex items-start gap-4 px-4 py-2">
              <span className="flex-1 whitespace-pre-wrap break-all text-foreground">{log.message}</span>
              <span className="shrink-0 text-muted-foreground">{log.time}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
