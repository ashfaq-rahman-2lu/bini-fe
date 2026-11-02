# Bini frontend

React + TypeScript + Vite interface for statement imports, financial review, duplicate decisions, and transaction filters. This directory is the frontend Git repository root. PostgreSQL infrastructure belongs to the separate backend repository.

## Start locally

Requires Node.js 22.12+; `.nvmrc` selects Node 24. Run from this checkout:

```sh
# If using nvm:
nvm use
npm ci
npm run dev
```

Open http://127.0.0.1:5173. If occupied, run `npm run dev -- --port 5175` and open http://127.0.0.1:5175.

FastAPI runs independently, normally at http://127.0.0.1:8000. Vite proxies `/api` to it. To change the development API:

```sh
API_PROXY_TARGET=http://127.0.0.1:8002 npm run dev
```

`VITE_API_BASE_URL` defaults to `/api`. Copy `.env.example` to `.env.local` only when overriding it. For separate hosting, configure this public build-time value with the API base URL (including `/api`) and configure the backend's allowed origins. Never put database credentials or private keys in frontend variables or bundles.

Normal frontend development/building requires Node.js and an accessible API; it does not require Python, PostgreSQL, or backend source in this checkout. This release is local-only; public hosting follows the authentication milestone.

## Build

```sh
npm run build
npm run preview
```

The build checks TypeScript and generates `dist/`. Queries run on navigation, filtering, and import confirmation; polling and focus/reconnect refetching are disabled.

## Browser integration tests

These tests exercise the real backend, generate synthetic PDFs using its test helpers, and reset only a dedicated `_test` database. Prepare the backend development environment and migrate its test database using the backend README first. Checkouts may have different names and live in unrelated directories:

```sh
npx playwright install chromium
BACKEND_DIR=/absolute/path/to/backend-repository npm run test:e2e
```

`BACKEND_DIR` points at the directory containing `app/`, `tests/`, and `.venv/`; it defaults to `../backend` for the current workspace. Set `TEST_DATABASE_URL` to override the dedicated test database. Do not run backend tests concurrently against the same database.

Tests launch API/frontend servers on ports 8001/5174 and stop them afterwards. Set `PLAYWRIGHT_BROWSERS_PATH` consistently for browser installation and execution if using a custom location. Screenshots and traces are written to `test-results/`.

## Version control

Commit source, configuration, `.nvmrc`, package/lockfiles, browser tests, and `.env.example`. The frontend `.gitignore` independently excludes dependencies, builds, TypeScript metadata, test output, coverage, logs, and local environment files. This repository contains no database infrastructure or private bank statement fixtures.
