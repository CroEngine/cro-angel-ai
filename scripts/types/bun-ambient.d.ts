// Minimal ambient-deklaration för Bun-globalen — typkollen (tsconfig.scripts)
// kör utan bun-types-paketet; skripten rör bara dessa ytor. Utöka vid behov,
// hellre än att dra in ett typpaket för en handfull anrop.
declare const Bun: {
  version: string;
  spawn(
    cmd: string[],
    opts?: { stdout?: string; stderr?: string; env?: Record<string, string | undefined> },
  ): {
    kill(): void;
    exited: Promise<number>;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
  };
  spawnSync(
    cmd: string[],
    opts?: { stdout?: string; stderr?: string; env?: Record<string, string | undefined> },
  ): { exitCode: number; stdout: { toString(): string }; stderr: { toString(): string } };
  serve(opts: {
    port: number;
    fetch: (req: Request) => Response | Promise<Response>;
  }): { stop(force?: boolean): void; port: number };
  build(opts: { entrypoints: string[]; target?: string; format?: string }): Promise<{
    success: boolean;
    logs: unknown[];
    outputs: Array<{ text(): Promise<string> }>;
  }>;
  file(path: string): { text(): Promise<string> };
};

// Bun-egna ImportMeta-ytor. `import.meta.dir` är Bun-specifikt (Node/TS känner
// bara import.meta.dirname) och används av lab-skripten, som alla kör under
// bun-shebang. Deklareras hellre än ersätts: att byta property i fyra skript
// som aldrig körts end-to-end i den här ändringen vore en tyst runtime-
// ändring i en typkolls-fix (städsvepet 2026-08-15, när scripts/lab togs in
// i tsconfig.scripts).
interface ImportMeta {
  /** Katalogen modulen ligger i, utan avslutande slash. Bun-only. */
  readonly dir: string;
}
