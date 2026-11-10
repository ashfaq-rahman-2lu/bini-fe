import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { authenticatedApi, reload, visit } from './auth-helpers'

const backend = path.resolve(process.env.BACKEND_DIR || '../backend')
const env = { ...process.env, TEST_DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql+psycopg://bini:bini_local_only@127.0.0.1:55433/bini_test',
  PYTHONPATH: backend + path.delimiter + path.join(backend, 'tests'), PYTHONDONTWRITEBYTECODE: '1' }
const run = (script: string) => execFileSync(path.join(backend, '.venv/bin/python'), ['-c', script], { env }).toString().trim()
test.beforeEach(() => run("from conftest import engine; from sqlalchemy import text; c=engine.connect(); t=c.begin(); c.execute(text('TRUNCATE operation_jobs, investment_institutions, source_links, statement_rows, transactions, statements, accounts CASCADE')); t.commit(); c.close()"))

test('queued confirmation survives refresh and transient polling failures without resubmitting', async ({ page }) => {
  await visit(page, '/investments/imports/new')
  const buffer = Buffer.from(run('import base64; from test_investments import csv_fixture; print(base64.b64encode(csv_fixture()).decode())'), 'base64')
  const draft = await (await authenticatedApi(page).post('/api/investments/imports', { multipart: {
    institution: 'Biniyog', file: { name: 'synthetic.csv', mimeType: 'text/csv', buffer },
  } })).json()
  const operation = await (await authenticatedApi(page).post('/api/jobs', { data: { kind: 'investment_confirm', target_id: draft.id,
    parameters: { expected_revision: draft.revision, acknowledge_warnings: true } } })).json()
  let release = false, interrupted = false, submissions = 0
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/jobs' && request.method() === 'POST' && request.postDataJSON()?.kind === 'investment_confirm') submissions++ })
  await page.route(`**/api/investments/imports/${draft.id}`, route => release ? route.continue() : route.fulfill({ json: draft }))
  await page.route('**/api/jobs?kind=investment_confirm&target_id=*', route => route.fulfill({ json: { ...operation, status: 'queued' } }))
  await page.route(`**/api/jobs/${operation.id}`, route => {
    if (!release) return route.fulfill({ json: { ...operation, status: 'queued' } })
    if (!interrupted) { interrupted = true; return route.fulfill({ status: 502 }) }
    return route.continue()
  })
  await page.goto(`/investments/imports/${draft.id}`)
  await expect(page.getByRole('status').filter({ hasText: 'Saving your import' })).toBeVisible()
  await reload(page)
  await expect(page.getByRole('status').filter({ hasText: 'Saving your import' })).toBeVisible()
  release = true
  await expect(page.getByRole('heading', { name: 'Investment report imported' })).toBeVisible({ timeout: 15000 })
  expect(interrupted).toBe(true)
  expect(submissions).toBe(0)
  await expect.poll(async () => (await (await authenticatedApi(page).get(`/api/jobs/${operation.id}`)).json()).status).toBe('succeeded')
  const workspace = await (await authenticatedApi(page).get('/api/investments')).json()
  expect(workspace.events).toHaveLength(7)
  expect(workspace.events.every((event: { sources: unknown[] }) => event.sources.length === 1)).toBe(true)
})

test('workspace navigation reuses cache, manual refresh and logout fetch current data', async ({ page }) => {
  await page.clock.install()
  let reads = 0
  page.on('response', response => { if (new URL(response.url()).pathname === '/api/investments' && response.status() === 200) reads++ })
  await visit(page, '/investments')
  await expect(page.getByRole('heading', { name: 'Investments', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh investments' })).toBeVisible()
  await expect.poll(() => reads).toBe(1)
  await page.getByRole('link', { name: 'Transactions', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Transactions', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Investments', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh investments' })).toBeVisible()
  await expect.poll(() => reads).toBe(1)
  await page.getByRole('link', { name: 'Transactions', exact: true }).click()
  await page.clock.fastForward(31_000)
  await page.getByRole('link', { name: 'Investments', exact: true }).click()
  await expect.poll(() => reads).toBe(2)
  await page.getByRole('button', { name: 'Refresh investments' }).click()
  await expect.poll(() => reads).toBe(3)
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in', exact: true })).toBeVisible()
  await page.getByLabel('Username', { exact: true }).fill('test-user')
  await page.getByLabel('Password', { exact: true }).fill('test-only-login-password')
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh investments' })).toBeVisible()
  await expect.poll(() => reads).toBe(4)
})
