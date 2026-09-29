import { defineConfig } from "@playwright/test";

// WebGL backend for headless Chromium. On macOS the Metal-backed ANGLE renderer runs the game at
// ~60 FPS; SwiftShader (software) runs at ~16 FPS, which makes real-time physics tests sluggish.
// Force the software fallback with MM_GL=swiftshader (it is also the default off macOS).
const useSwiftShader = process.env.MM_GL === "swiftshader" || process.platform !== "darwin";
const glArgs = useSwiftShader
  ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
  : ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];

export default defineConfig({
  testDir: "tests",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // Physics runs in real time, so parallel browsers steal frames from each other. Keep it low.
  workers: Number(process.env.PW_WORKERS ?? 2),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1280, height: 720 },
    launchOptions: { args: glArgs },
  },
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
