/// <reference types="node" />
import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  outputDir: ".harness/pw-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: ".harness/pw-report" }],
  ],
  use: { baseURL, trace: "on-first-retry" },
  // One browser is enough for a pre-merge gate. Locally we drive the system Chrome, so a
  // developer machine needs no browser download at all; CI uses Playwright's pinned build
  // (installed by the workflow) so the gate stays hermetic where it matters.
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.CI ? "chromium" : "chrome",
      },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
