import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90000,
  use: { baseURL: "http://localhost:5173" },
  webServer: [
    {
      command: "python -m uvicorn app.main:app --port 8128",
      cwd: "../backend",
      url: "http://127.0.0.1:8128/health",
      timeout: 60000,
    },
    {
      command: "npm run dev -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      timeout: 120000,
      env: { VITE_API_BASE_URL: "http://127.0.0.1:8128" },
    },
  ],
});
