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
      env: { DATABASE_URL: testDatabase, AUTH_COOKIE_SECURE: 'false', ALLOWED_ORIGINS: '["http://127.0.0.1:5174"]', AUTH_USERNAME: 'test-user', AUTH_PASSWORD: 'test-only-login-password', AUTH_SECRET: 'test-only-signing-secret-at-least-32-characters', PYTHONDONTWRITEBYTECODE: '1', JOBS_ENABLED: 'true', BETTERSTACK_SOURCE_TOKEN: '', BETTERSTACK_INGESTION_URL: '' }, url: 'http://127.0.0.1:8001/api/health', reuseExistingServer: false },
    { command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5174',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:8001' }, url: 'http://127.0.0.1:5174', reuseExistingServer: false },
  ],
})
