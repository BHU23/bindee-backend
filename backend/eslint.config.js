import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "src/database/generated"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: { "func-style": ["error", "declaration"] } },
);
