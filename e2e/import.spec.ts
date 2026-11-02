import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { test, expect, type Page } from '@playwright/test'

const backend = path.resolve(process.env.BACKEND_DIR || '../backend')
const python = path.join(backend, '.venv/bin/python')
const testDatabase = process.env.TEST_DATABASE_URL || 'postgresql+psycopg://bini:bini_local_only@127.0.0.1:55433/bini_test'
const env = { ...process.env, DATABASE_URL: testDatabase, TEST_DATABASE_URL: testDatabase, PYTHONPATH: backend + path.delimiter + path.join(backend, 'tests'), PYTHONDONTWRITEBYTECODE: '1' }

function pdf(options: Record<string, unknown> = {}) {
  const program = `import base64,json; from conftest import synthetic_pdf; print(base64.b64encode(synthetic_pdf(**json.loads(${JSON.stringify(JSON.stringify(options))}))).decode())`
  return { name: 'synthetic.pdf', mimeType: 'application/pdf', buffer: Buffer.from(execFileSync(python, ['-c', program], { env }).toString().trim(), 'base64') }
}

test.beforeEach(() => {
  execFileSync(python, ['-c', "from conftest import engine; from sqlalchemy import text; c=engine.connect(); t=c.begin(); c.execute(text('TRUNCATE source_links, statement_rows, transactions, statements, accounts CASCADE')); t.commit(); c.close()"], { env })
})

async function upload(page: Page, file: ReturnType<typeof pdf>, password = 'test-only-password') {
  await page.goto('/imports/new')
  await page.getByLabel('PDF statement').setInputFiles(file)
  await page.getByLabel('PDF password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Continue to review' }).click()
}

test('upload, review, confirm, filter, inspect sources and reuse an import', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const file = pdf()
  await page.goto('/transactions')
  await expect(page.getByText('Your ledger starts here')).toBeVisible()
  await page.getByRole('link', { name: 'Import statement', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'Import a statement' })).toBeVisible()
  await page.screenshot({ path: 'test-results/upload-desktop.png', fullPage: true })
  await upload(page, file)
  await expect(page.getByRole('heading', { name: 'Review your statement' })).toBeVisible()
  await expect(page.getByText('Reconciled', { exact: true })).toBeVisible()
  await page.screenshot({ path: 'test-results/review-desktop.png', fullPage: true })
  await page.getByRole('button', { name: 'Confirm import' }).click()
  await expect(page.getByRole('heading', { name: 'Statement imported' })).toBeVisible()
  await page.getByRole('link', { name: 'View transactions', exact: true }).click()
  await expect(page.getByRole('button', { name: /Coffee purchase/ })).toBeVisible()
  await page.getByLabel('Description', { exact: true }).fill('COFFEE')
  await page.getByLabel('From date').fill('2025-12-03')
  await page.getByLabel('To date').fill('2025-12-03')
  await page.getByLabel('Type', { exact: true }).selectOption('debit')
  await page.getByRole('button', { name: 'Apply filters' }).click()
  await expect(page).toHaveURL(/search=COFFEE/)
  await expect(page.getByText('1–1 of 1 transactions')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('COFFEE')
  await page.getByRole('button', { name: /Coffee purchase/ }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('Source occurrences')).toBeVisible()
  await page.getByRole('button', { name: 'Close details' }).click()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByText('1–2 of 2 transactions')).toBeVisible()
  await page.screenshot({ path: 'test-results/ledger-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect((await page.getByLabel('Type', { exact: true }).boundingBox())!.width).toBeGreaterThan(100)
  await page.screenshot({ path: 'test-results/ledger-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy()
  await upload(page, file, '')
  await expect(page.getByRole('heading', { name: 'Statement imported' })).toBeVisible()
  expect(errors).toEqual([])
})

test('wrong password, failed reconciliation and cancellation', async ({ page }) => {
  const file = pdf({ closing_delta: '0.01' })
  await upload(page, file, 'wrong')
  await expect(page.getByRole('alert')).toHaveText('Incorrect PDF password.')
  await expect(page.getByLabel('PDF password', { exact: true })).toHaveValue('')
  await page.getByLabel('PDF password', { exact: true }).fill('test-only-password')
  await page.getByRole('button', { name: 'Continue to review' }).click()
  await expect(page.getByRole('heading', { name: 'Review your statement' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm import' })).toBeDisabled()
  await page.getByRole('button', { name: 'Cancel import' }).click()
  await expect(page.getByText('Your ledger starts here')).toBeVisible()
})

test('overlapping statements link existing sources', async ({ page }) => {
  await upload(page, pdf())
  await page.getByRole('button', { name: 'Confirm import' }).click()
  await expect(page.getByRole('heading', { name: 'Statement imported' })).toBeVisible()
  await upload(page, pdf({ memo: 'Another overlapping statement' }))
  await expect(page.getByRole('heading', { name: 'Review your statement' })).toBeVisible()
  await expect(page.locator('.badge-match')).toHaveCount(2)
  await page.getByRole('button', { name: 'Confirm import' }).click()
  await page.getByRole('link', { name: 'View transactions', exact: true }).click()
  await expect(page.getByText('1–2 of 2 transactions')).toBeVisible()
  await page.getByRole('button', { name: /Coffee purchase/ }).click()
  await expect(page.getByText('Source occurrences')).toContainText('(2)')
})

test('an ambiguous payment can be kept separately before confirmation', async ({ page }) => {
  await upload(page, pdf())
  await page.getByRole('button', { name: 'Confirm import' }).click()
  await expect(page.getByRole('heading', { name: 'Statement imported' })).toBeVisible()
  await upload(page, pdf({ entries: [
    ['02-Dec-2025', 'credit', '100.00', 'A different deposit', 'REF-C'],
    ['03-Dec-2025', 'debit', '25.50', 'Coffee purchase', 'REF-B'],
  ] }))
  await expect(page.getByRole('heading', { name: 'Review your statement' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Confirm import' })).toBeDisabled()
  await page.getByText('Compare existing transaction candidates (1)').click()
  await page.getByRole('button', { name: 'Inspect existing source' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByText('Source occurrences')).toContainText('(1)')
  await page.getByRole('button', { name: 'Close details' }).click()
  await page.getByLabel('Decision for row 1', { exact: true }).selectOption('new')
  await expect(page.getByRole('button', { name: 'Confirm import' })).toBeEnabled()
  await page.getByRole('button', { name: 'Confirm import' }).click()
  await page.getByRole('link', { name: 'View transactions', exact: true }).click()
  await expect(page.getByText('1–3 of 3 transactions')).toBeVisible()
})
