import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const baseURL = "http://127.0.0.1:3390";
const database = process.env.PLAYGROUND_TEST_DB ?? join(mkdtempSync(join(tmpdir(), "lucena-playground-")), "sessions.sqlite3");

export default defineConfig({
  testDir: "./playground-tests",
  use: {
    baseURL,
    launchOptions: process.env.PLAYGROUND_CHROMIUM ? {executablePath: process.env.PLAYGROUND_CHROMIUM} : {},
  },
  webServer: [
    {command: "npm run start", url: "http://127.0.0.1:3391/health", env: {PORT: "3391", PLAYGROUND_ONLY: "1", PLAYGROUND_ORIGIN: baseURL}},
    {command: "../backend/.venv/bin/uvicorn app.playground.server:factory --factory --app-dir ../backend --port 3392",
      port: 3392, env: {PLAYGROUND_LOCAL: "1", PLAYGROUND_ORIGIN: baseURL, PLAYGROUND_DB: database}},
    {command: "node playground-tests/proxy.mjs", url: `${baseURL}/playground`},
  ],
});
