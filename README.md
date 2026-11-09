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

`VITE_API_BASE_URL` defaults to `/api`. Copy `.env.example` to `.env.local` only when overriding it. Cookie authentication needs a same-origin proxy or same-site HTTPS custom domains; use the deployment setup below. Never put database credentials or private keys in frontend variables or bundles.

Normal frontend development/building requires Node.js and an accessible API; it does not require Python, PostgreSQL, or backend source in this checkout. Set the single account's credentials on the backend before signing in. The frontend has no credential environment variables.

## Single-account sign in

Sign in with the backend's configured `AUTH_USERNAME` and `AUTH_PASSWORD`. There is no registration or per-user ledger. Login sets an eight-hour HttpOnly cookie; the browser sends it automatically, and JavaScript cannot read it. Refreshing or opening another tab keeps you signed in until expiry. No credentials or session tokens are stored in localStorage/sessionStorage. The requested route and query string are preserved through login.

Desktop navigation and the mobile menu provide **Sign out**, which deletes the cookie on the server response and clears the frontend cache. If that request fails, the app shows an error and keeps the session so you can retry. Expiry is enforced by the backend; the next rejected API request or page refresh returns to login. A separately copied cookie remains valid until expiry or backend credential/secret rotation.

## Deploy with Netlify and Render

These steps connect an existing Render API (using your Supabase database) to Netlify. Authentication needs no database migration or Supabase Auth setup.

1. In the Render backend environment, set `AUTH_USERNAME`, `AUTH_PASSWORD`, a random `AUTH_SECRET` of at least 32 characters, and `AUTH_COOKIE_SECURE=true`. Keep your existing Supabase `DATABASE_URL` on Render only.
2. Import the frontend Git repository into Netlify. Its repository root contains `netlify.toml`; keep the configured build command `node scripts/netlify-build.mjs` and publish directory `dist`. If importing the parent workspace instead, set the base directory to `frontend`.
3. Add a Netlify build environment variable `BACKEND_URL=https://your-backend.onrender.com` (replace the hostname; do not append `/api`). The script builds with `VITE_API_BASE_URL=/api` and generates API proxy and SPA fallback rules. It does not need any password, signing secret, or database variable.
4. In Render, set `ALLOWED_ORIGINS` to the exact Netlify site origin as a JSON array, for example `["https://your-site.netlify.app"]`, then redeploy the backend. Add your custom frontend origin if you later use one. Do not use `*`.
5. Deploy Netlify, open its HTTPS URL, sign in, refresh to confirm the session persists, then sign out and refresh to confirm the workspace stays locked. Check an upload and a protected deep link as well.

The browser calls its own site's `/api`; Netlify forwards requests and cookies to Render. All API responses are marked `no-store`. Avoid setting the frontend directly to an `onrender.com` API URL from a `netlify.app` site: those domains are cross-site and the Lax session cookie will not work.

**Long uploads:** Netlify's proxy has a [26-second timeout](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/), while PDF processing can take up to 60 seconds. A timeout does not cancel backend work; check Recent imports before retrying. For longer requests, use HTTPS custom domains on the same site, such as `app.example.com` on Netlify and `api.example.com` on Render. To call that API directly, change `netlify.toml`'s build command to `npm run build`, add the SPA fallback below, set Netlify's `VITE_API_BASE_URL=https://api.example.com/api`, and set Render's `ALLOWED_ORIGINS=["https://app.example.com"]`. Keep `AUTH_COOKIE_SECURE=true` and access the frontend via its custom domain. This bypasses Netlify's API proxy; `BACKEND_URL` is then unused.

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

## Unlock PDFs and import multiple statements

Use **Unlock PDF** to select one protected PDF, enter its password, and download an unlocked copy to your computer. Your browser's normal download settings determine the save location. PDF bytes and passwords are never written to browser localStorage. This tool does not add transactions or create database records. Unlocked downloads support any PDF format within 10 MB / 50 pages.

Use **Import statement** to select up to 20 EBL BDT PDFs at once. Enter a shared password and optional individual overrides; leave passwords blank for unlocked PDFs. The queue sends one existing import API request per file, sequentially, and shows progress/results separately. Failed files can be retried without re-uploading successes. Keep the page open until processing finishes; navigation stops remaining uploads, while already saved drafts remain available under **Recent imports** (latest 50).

Review and confirm statements individually. After confirming one statement, open the next review to see overlap matching against the updated ledger. Recent imports reflect confirmation/cancellation and survive page reloads. Password fields are cleared on submission/completion and never persisted. Selecting a new set of files replaces the current selection.

Restart an API process running without `--reload` after updating backend code, then refresh the frontend to use the new endpoints.

## Investment tracker

Open **Investments** to import the institution's multiline BDT CSV, review source checks/warnings, and confirm. Existing bank statements remain in **Transactions**. A CSV draft or failed import never changes investment totals. Saved investment reviews are available from **Import investment CSV**.

**Import mode** defaults to **Extend existing data**: retain existing projects, movements, profit splits, money traces and bank matches; add new records and link matching source occurrences. Choose **Replace existing data** to rebuild all investment data for the institution named on the upload form. Use a complete-history CSV: missing movements/projects, previous reports/previews, classifications, traces, bank matches, project statuses and expected repayment targets are removed on confirmation. Bank transactions and other institutions are unchanged. The replacement review shows removal counts and requires a separate acknowledgment before confirmation. Cancel leaves existing investment data unchanged; refreshing or receiving a new preview revision clears review acknowledgments. Completed replacements invalidate the institution's other saved preview links.

Choose a project using the activity filters. **Investment summary** starts collapsed; expand it for portfolio totals, wallet balances, and the selected project's outstanding principal, source-return tracing, optional expected repayments, and final gain/loss. The page does not show a separate project card list. Close only after confirming complete history and final settlement; a negative cash recovery while active is not automatically a loss. Portfolio totals separate external funding from total funding including reinvestments, provider payouts from bank-matched payouts, and classified profit from final gains on closed projects. These last two profit figures overlap and should not be added together.

Click a movement to enter installment profit (the remaining amount is principal), trace a return into a later reinvestment or bank payout, inspect source CSV references, or match a bank transfer. A source return can fund multiple destinations and a payout can combine returns. Provider reinvestment settlement rows are displayed for traceability but are excluded from bank payouts. The latest reported wallet balance is shown with its date; untraced returns are not necessarily money still in that wallet.

Bank matching defaults to a three-day lag: bank debit on/before investment booking, bank credit on/after cashout. Widen to 7/14/30 days, filter the bank account, or find a transaction outside these dates by copying its ID from **Transactions → transaction details**. Suggestions require your decision, including exact amounts. Link split/combined transfers in parts. Remove a trace or bank link to correct it. Source profit notes are shown for review and are not silently treated as the installment's confirmed profit.

Activity supports project, movement, description and inclusive date filters in the URL, with 50 rows per page. Investment workspace data is fetched on navigation or successful changes, with no polling/focus refresh. The backend owns the financial arithmetic and validates allocation capacities. Frontend totals use integer cents, with decimal strings on the wire. Investment import previews preserve the provider's original summary labels and flag conflicting figures rather than using them as calculated principal.

Apply backend migrations through `0004` and restart a non-reloading API after updating. Independent frontend/API deployment settings remain unchanged; there are no new frontend dependencies. `e2e/investments.spec.ts` covers extend/replacement review and confirmation, cancellation, overlap, profit splits, return traces, delayed bank matching, final gain, reload persistence and mobile layout using synthetic data only.

## Update a fixed investment CSV

Open **Update CSV**, or follow **Update a fixed CSV** from the investment upload page. Select your corrected archive and the latest Biniyog export, then choose **Update and download CSV**. The browser automatically downloads a copy using the fixed file's name, with a manual download link as a fallback. Replace your local fixed archive with that copy before the next update. Browsers may add a filename suffix; the original selected files are never overwritten.

The tool runs entirely in browser memory, without API requests, uploads, localStorage, or database writes. It accepts two UTF-8 BDT exports for the same Investor Name, up to 2 MB each and 10,000 merged transactions. Numeric formats include Indian and Western comma grouping, with at most two decimal places. Quoted multiline descriptions, BOMs, padded metadata rows and different header offsets are supported.

Existing transaction amounts and descriptions are retained exactly. Columns G and J are always saved as running-balance formulas for every existing/appended transaction, with references to the final balances in TOTAL's G/J cells. References follow the file's actual header/data row positions. This also works when there are no new transactions; there is no formula toggle. Only existing G/J field spans are replaced, preserving the other transaction fields and their original quoting. Matching uses normalized date/full description and occurrence count, deliberately ignoring monetary values and running/source balances. This protects corrected historical amounts while preserving legitimate repeated movements. Additional rows on the final existing date can be appended when their occurrence count exceeds the archive's count; use complete exports for reliable repeated-row matching. An unmatched row before that date is rejected for manual review rather than being silently dropped or inserted into corrected history. Different investors, invalid dates/amounts, malformed records and unsupported refund/protection-pool activity are rejected.

New rows keep their downloaded movement amounts, so provider errors still require review. G formulas follow **cumulative F minus cumulative C**, for example `=SUM($F$19:F19)-SUM($C$19:C19)` when data starts at row 19. J follows **cumulative D minus E minus F**, for example `=SUM($D$19:D19)-SUM($E$19:E19)-SUM($F$19:F19)`, and TOTAL's J references the final transaction. The fixed file's opening capital is inferred from its first transaction balance and movement; any nonzero opening is preserved as a signed constant in every J formula. Later stale J values are recalculated from the recorded movements. This CSV capital convention subtracts full repayments, including profit, and does not measure principal outstanding. The expected-amount summary remains a provider value.

CSV stores formula text rather than workbook calculation settings/cached results; the spreadsheet app must interpret imported amounts as numbers and formula cells as formulas to calculate them. Known transaction totals and summary controls are recalculated when rows are appended; period/generated metadata is updated. This utility does not import the file into the investment ledger.

Every download writes TOTAL's F cell as `=SUM(F[first transaction]:F[last transaction])` and links the “Total Repaid (from campaigns)” summary amount to that TOTAL cell, for example `=F91`. These formulas use the final output's actual record positions, including shifted headers and blank rows, and refresh even with no new transactions. Editing a repayment updates both controls when your spreadsheet recalculates. The backend accepts these specific formulas and validates their references without executing arbitrary spreadsheet expressions.

Summary “Ready Balance” always references TOTAL's G cell, for example `=G91`. “Total Currently Invested” is capital with business plus ready balance, referencing TOTAL's J and G cells as `=J91+G91`. These summary formulas are refreshed even without appended rows and replace stale downloaded summary figures. Their references follow the output TOTAL row and remain safe to reuse in later updates.

Running the same update again adds nothing and returns an identical copy once the summary/control formulas and G/J formulas are present. With no new rows, only those summary controls and G/J cells are changed. Other fields and metadata remain untouched. The page shows appended transactions (up to 100 in the preview; all are in the download), matched-row count, calculated closing balance and any saved-balance inconsistencies.

Run **`npm run test:csv`** for deterministic merge/financial tests. `e2e/csv-update.spec.ts` verifies automatic download, correction preservation, repeat safety, browser-only processing, validation errors and responsive layout with synthetic data. No extra runtime dependencies are required.

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


## Investment money trails

The backend must be migrated through `0005` before using reconciliation. Select a project with the existing filters to open **Money flow** by default. The overview connects invested funds → installments returned to the wallet → cashouts, reinvestments and confirmed available funds. These are all-time project totals. The installment timeline follows the movement, description and date filters, includes directly linked context, and shows each return's destinations and its share of combined payouts. Unverified wallet funds remain marked for review. Use **Show more installments** to reveal history beyond the first 20.

Funding rows distinguish bank posting dates from investment booking dates. **View installment**, **View payout** and **View reinvestment** open the existing movement details; destination investment links open that project's direct flow. Expand **Bank transactions** for full descriptions, bank amounts, project shares and separate BUSINESS DATE evidence. Bank evidence and **Investment summary** start collapsed. Switch to **Activity table** to inspect every movement, including reserved and consumed credit amounts and settlement rows; the selected view and filters survive reload through the URL. Without a selected project, the activity table remains the default.

Open **Money reconciliation** from the Investments page header to visit `/investments/reconciliation`. The matching controls, review queue and saved explanations live on this separate page. **Back to investments** preserves the project and activity filters, including after a reload. Movement details remain available directly from the review queue.

**Reconcile now** saves uniquely resolved wallet/bank matches. The collapsible review queue distinguishes wallet attribution from bank matching, exposes preserved conflicting links, and supports source-credit selection, settlement grouping and an earlier-instruction/later-booking explanation. Saved review explanations remain visible after reload. Use movement details for manual wider-date or split bank matches. Related bank links open the existing transaction/source dialog.

After CSV or bank-statement confirmation, a separate reconciliation request runs. A failed request does not undo the import; use **Retry reconciliation**. No polling or GET mutations were added. Extend retains reviewed decisions; replace previews the reconciliation records it will remove. Existing manual links stay intact until explicitly removed.

`e2e/reconciliation.spec.ts` covers automatic Apon matching, flow totals and installment destinations, flow/table switching, project filters, collapsed bank evidence, bank details, mobile width, collapsed summary, delayed-booking resolution/reload, and import-success/reconciliation-failure retry. It uses synthetic fixtures and the existing separate PostgreSQL test database and temporary test servers.

Investment flow uses compact installment rows and status chips. Movement dialogs keep fully matched editing tools and source text collapsed. The selected project's **Mark completed** action confirms final repayments and checks that every return has a destination with no available/reserved wallet funds. It does not clear money or add adjustments. Use **Reopen investment** before adding further activity. The summary's existing close action remains available for final settlement when wallet returns are still being managed.

The investment toolbar keeps only Project and a Filters button. Project selection applies immediately. Movement, description and dates are edited in a modal; Apply filters saves them to the URL, Cancel discards edits, and Clear filters preserves the selected project and view. A badge counts active extra filters.

Project selection, Filters, status and completion share a compact toolbar (wrapping on phones). Destination totals use one row on wider screens. Profit is shown separately: saved installment profit for active projects, with unclassified amounts identified, and final returns-minus-invested gain/loss for closed projects. Profit is already included in returns and is not another destination.

Reconciliation opens its review queue with action-based titles, project/date/type chips and separate Wallet/Bank statuses. Each item explains the next action; the original diagnostic is available under “Why this needs review.” Source-credit checkboxes show available amounts in aligned rows, with selected/needed totals and the remaining difference. The queue covers all projects because an earlier wallet issue can block later ones.

Small wallet differences: source-credit reviews offer explicit acceptance for differences up to BDT 5.00. The chip shows the exact amount and direction (`1.00 BDT difference · over`), adding `Accepted` after saving. Source-selection changes reset consent. Larger differences stay blocked. Accepted differences and their cumulative absolute total remain visible on the reconciliation page; payment details and direct project trails retain the chip after reload. Source amounts on affected trails are labeled as credits committed before settlement differences, rather than exact net investment/bank shares. CSV, bank and profit amounts are unchanged.
