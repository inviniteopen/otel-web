import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

export default defineConfig({
  optimizeDeps: {
    include: [
      "@opentelemetry/api",
      "@opentelemetry/api-logs",
      "@opentelemetry/sdk-logs",
      "@opentelemetry/exporter-logs-otlp-http",
      "@opentelemetry/exporter-trace-otlp-http",
      "@opentelemetry/sdk-trace-base",
      "@opentelemetry/sdk-trace-web",
      "@opentelemetry/resources",
      "@opentelemetry/semantic-conventions",
      "@opentelemetry/otlp-exporter-base",
      "@opentelemetry/otlp-transformer",
      "@opentelemetry/core",
    ],
  },
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true,
      instances: [{ browser: "chromium" }],
    },
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
  },
});
