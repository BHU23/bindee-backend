import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src/database/generated"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "func-style": ["error", "declaration"] } },
  {
    // Callers use the inventory module only through its barrel (the InventoryPort).
    files: ["src/**/*.ts"],
    ignores: ["src/modules/inventory/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/inventory/*/**"],
              message:
                "Import inventory only through modules/inventory/index.js (InventoryPort).",
            },
          ],
        },
      ],
    },
  },
);
