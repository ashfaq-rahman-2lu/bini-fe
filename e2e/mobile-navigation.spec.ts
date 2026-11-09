import { visit, authenticatedApi } from './auth-helpers'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { test, expect } from '@playwright/test'

test('mobile menu closes accessibly and investment filters stay above the fold', async ({ page }, testInfo) => {
  const backend = path.resolve(process.env.BACKEND_DIR || '../backend')
  execFileSync(path.join(backend, '.venv/bin/python'), ['-c', `
from conftest import engine
from sqlalchemy import text
from fastapi.testclient import TestClient
from app.main import app
from test_reconciliation import apon_csv, confirm, upload
with engine.begin() as c:
    c.execute(text('TRUNCATE investment_institutions, source_links, statement_rows, transactions, statements, accounts CASCADE'))
with TestClient(app, headers={"X-Bini-Request": "1"}) as c:
    c.post("/api/auth/login", json={"username": "test-user", "password": "test-only-login-password"})
    confirm(c, upload(c, apon_csv()))
`], { env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL || 'postgresql+psycopg://bini:bini_local_only@127.0.0.1:55433/bini_test', PYTHONPATH: backend + path.delimiter + path.join(backend, 'tests'), PYTHONDONTWRITEBYTECODE: '1' } })
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.setViewportSize({ width: 625, height: 695 })
  await visit(page, '/investments')
  await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden()
  expect(await page.locator('.sidebar').evaluate(e => e.getBoundingClientRect().height)).toBeLessThanOrEqual(64)
  expect(await page.locator('.investment-filter-bar').evaluate(e => e.getBoundingClientRect().bottom)).toBeLessThan(330)
  await page.screenshot({ path: testInfo.outputPath('investments-mobile.png') })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  const menu = page.getByRole('dialog', { name: 'Navigation', exact: true })
  await expect(menu.getByRole('link')).toHaveCount(5)
  await expect(menu.getByRole('link', { name: 'Investments', exact: true })).toHaveAttribute('aria-current', 'page')
  await page.screenshot({ path: testInfo.outputPath('navigation-menu.png') })
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeFocused()
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await menu.getByRole('link', { name: 'Transactions', exact: true }).click()
  await expect(page).toHaveURL(/\/transactions$/)
  await expect(menu).toHaveCount(0)
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.mouse.click(5, 600)
  await expect(menu).toHaveCount(0)
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.setViewportSize({ width: 1305, height: 800 })
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden()
  await page.setViewportSize({ width: 390, height: 695 })
  await visit(page, '/investments')
  await expect(page.getByRole('combobox', { name: 'Project', exact: true })).toBeVisible()
  expect(await page.locator('.investment-filter-bar').evaluate(e => e.getBoundingClientRect().bottom)).toBeLessThan(330)
  await page.getByRole('button', { name: /^Filters/ }).click()
  await expect(page.getByRole('dialog', { name: 'Investment filters' })).toBeVisible()
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: testInfo.outputPath('investments-phone.png') })
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg')
  const favicon = await authenticatedApi(page).get('/favicon.svg')
  expect(favicon.ok()).toBeTruthy()
  expect(favicon.headers()['content-type']).toContain('image/svg+xml')
  expect(errors).toEqual([])
})
