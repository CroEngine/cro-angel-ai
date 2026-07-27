import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // scripts/ med i sviten (granskningsfynd 2026-07-28): kedjans skript var
    // varken typkollade eller testbara — mönstret gör framtida skript-tester
    // körbara utan config-ändring.
    include: ["src/**/__tests__/**/*.test.ts", "scripts/**/__tests__/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
