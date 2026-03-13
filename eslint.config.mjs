import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: ["dist/"],
  },
  {
    rules: {
      // VS Code extension + webview message-passing uses `any` pervasively
      // at API boundaries. Enforcing explicit types here would require a
      // massive refactor with minimal safety gain — the real contracts are
      // defined by the message protocol, not TypeScript types on `any`.
      "@typescript-eslint/no-explicit-any": "off",
      // Allow unused vars prefixed with _ (common pattern for required but unused params)
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  }
);
