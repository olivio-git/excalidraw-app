import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests of the whole app against a mocked Tauri backend
 * (e2e/fixtures/tauri-mock.js). Run with `pnpm test:e2e`; the dev server
 * starts by itself. WebGL runs in software (SwiftShader), so no GPU is needed.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5174",
    viewport: { width: 1440, height: 860 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 860 },
        launchOptions: {
          executablePath: process.env.CHROMIUM_PATH || undefined,
          args: [
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            "--ignore-gpu-blocklist",
          ],
        },
      },
    },
  ],
  webServer: {
    command: "pnpm exec vite --port 5174 --strictPort",
    url: "http://localhost:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
