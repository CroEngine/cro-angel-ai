import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".output", ".vinxi"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Snippet-källan skriver AVSIKTLIGT gammaldags JS (applier.ts:14-17: "OLD-
  // SCHOOL BODIES … deliberately conservative JS for maximal browser
  // coverage") och är dessutom byte-pinnad av gen:applier:check. Regeln
  // stängs av för just den filen i stället för att filen ändras — alla 75
  // no-var-fel i repot bodde här och maskerade resten av lint-utfallet.
  {
    files: ["src/adaptive/runtime/applier.ts"],
    rules: { "no-var": "off" },
  },
  eslintPluginPrettier,
);
