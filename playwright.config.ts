import { defineConfig } from '@playwright/test'
import path from 'node:path'

const testDatabase = process.env.TEST_DATABASE_URL || 'postgresql+psycopg://bini:bini_local_only@127.0.0.1:55433/bini_test'
const backend = path.resolve(process.env.BACKEND_DIR || '../backend')
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
export default defineConfig({
  testDir: './e2e', workers: 1, fullyParallel: false, timeout: 45_000,
  use: { baseURL: 'http://127.0.0.1:5174', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure', actionTimeout: 10_000 },
  webServer: [
    { command: `${quote(path.join(backend, '.venv/bin/python'))} -m uvicorn app.main:app --app-dir ${quote(backend)} --host 127.0.0.1 --port 8001`,
      env: { DATABASE_URL: testDatabase }, url: 'http://127.0.0.1:8001/api/health', reuseExistingServer: false },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:8001' }, url: 'http://127.0.0.1:5174', reuseExistingServer: false },
  ],
})
