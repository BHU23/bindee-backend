import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/database/globalSetup.ts"],
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      REDIS_URL: "redis://localhost:6379",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/database/generated/**",
        "**/*.config.*",
        "tests/**",
        "**/index.ts",
        "src/server.ts",
        "src/database/seeds/seed.ts",
        "**/*.d.ts",
      ],
      thresholds: { statements: 90, branches: 90, functions: 90, lines: 90 },
    },
  },
});
