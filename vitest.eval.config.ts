// Accuracy check on real card images (needs network): npm run eval
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["eval/**/*.eval.ts"], testTimeout: 30 * 60_000 },
});
