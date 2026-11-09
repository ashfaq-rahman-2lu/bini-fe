import { visit } from './auth-helpers'
import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { csvColumns, csvRow, parseCsvRecords } from '../src/csvUpdate'

function report(latest: boolean, investor = 'Synthetic Investor') {
  const rows = [
    [`Investor Name: ${investor}`], ['Report Period: 30-Jun-2025 - 04-Nov-2026'], ['Generated On: 07-Nov-2026'], [],
    ['Summary'], ['Total Repaid (from campaigns):', '1.00'], ['Ready Balance:', '1.00'], ['Total Currently Invested:', '99999'], ['Transactions'], csvColumns,
    ['02-Jul-2025', 'Investment\nBANK_TRANSFER for Alpha [1]', '', '100', '0', '', '0', '0', '0', '100'],
    ['03-Jul-2025', 'Repayment Received\npayment made by Alpha [1] to biniyog', '', '', '0', latest ? '1.00' : '1.05', latest ? '1.00' : '1.05', '0', '0', '99'],
  ]
  if (latest) rows.push(['04-Jul-2025', 'Repayment Received\npayment made by Alpha [1] to biniyog', '', '', '0', '0.50', '1.50', '0', '0', '98.50'])
  rows.push(['', 'TOTAL', '0', '100', '0', latest ? '1.50' : '1.05', latest ? '1.50' : '1.05', '0', '0', latest ? '98.50' : '99'])
  return rows.map(row => csvRow(row)).join('')
}
const file = (name: string, text: string) => ({ name, mimeType: 'text/csv', buffer: Buffer.from(text) })

test('preserves corrections, automatically downloads appended rows, repeats safely and works on mobile without uploading files', async ({ page }, info) => {
  const requests: string[] = [], errors: string[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/') && !new URL(request.url()).pathname.startsWith('/api/auth/')) requests.push(request.url()) })
  page.on('pageerror', error => errors.push(error.message))
  await visit(page, '/csv-update')
  await expect(page.getByRole('heading', { name: 'Update a fixed CSV' })).toBeVisible()
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Update and download CSV' })).toBeDisabled()
  await page.getByLabel('Fixed CSV', { exact: true }).setInputFiles(file('fixed_transactions.csv', report(false)))
  await page.getByLabel('Latest downloaded CSV').setInputFiles(file('latest.csv', report(true)))
  const downloading = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Update and download CSV' }).click()
  const download = await downloading
  expect(download.suggestedFilename()).toBe('fixed_transactions.csv')
  const saved = info.outputPath('fixed_transactions.csv')
  await download.saveAs(saved)
  const output = await readFile(saved, 'utf8'), rows = parseCsvRecords(output)
  const transactions = rows.filter(row => /^\d{2}-/.test(row.cells[0]))
  expect(transactions).toHaveLength(3)
  const original = parseCsvRecords(report(false)).find(row => row.cells[0] === '03-Jul-2025')!
  for (let column = 0; column < 10; column++) if (column !== 6 && column !== 9) expect(transactions[1].cells[column]).toBe(original.cells[column])
  expect(transactions[0].cells[6]).toBe('=SUM($F$11:F11)-SUM($C$11:C11)')
  expect(transactions[2].cells[6]).toBe('=SUM($F$11:F13)-SUM($C$11:C13)')
  expect(rows.find(row => row.cells[1] === 'TOTAL')!.cells[6]).toBe('=G13')
  expect(rows.find(row => row.cells[1] === 'TOTAL')!.cells[5]).toBe('=SUM(F11:F13)')
  expect(rows.find(row => row.cells[0] === 'Total Repaid (from campaigns):')!.cells[1]).toBe('=F14')
  expect(rows.find(row => row.cells[0] === 'Ready Balance:')!.cells[1]).toBe('=G14')
  expect(rows.find(row => row.cells[0] === 'Total Currently Invested:')!.cells[1]).toBe('=J14+G14')
  expect(transactions[1].cells[9]).toBe('=SUM($D$11:D12)-SUM($E$11:E12)-SUM($F$11:F12)')
  expect(transactions[2].cells[9]).toBe('=SUM($D$11:D13)-SUM($E$11:E13)-SUM($F$11:F13)')
  expect(rows.find(row => row.cells[1] === 'TOTAL')!.cells[9]).toBe('=J13')
  await expect(page.getByRole('status')).toContainText('Added 1 new transaction.')
  await expect(page.getByText('BDT 1.55')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download updated CSV again' })).toBeVisible()
  await page.screenshot({ path: 'test-results/csv-update-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'test-results/csv-update-mobile.png', fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.getByLabel('Fixed CSV', { exact: true }).setInputFiles(file('fixed_transactions.csv', output))
  const repeated = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Update and download CSV' }).click()
  const next = await repeated
  expect(await readFile((await next.path())!, 'utf8')).toBe(output)
  await expect(page.getByRole('status')).toContainText('No new transactions. Your fixed CSV is unchanged.')
  // Convert numeric balances and repayment controls even without new transactions.
  await page.getByLabel('Fixed CSV', { exact: true }).setInputFiles(file('fixed_transactions.csv', report(false)))
  await page.getByLabel('Latest downloaded CSV').setInputFiles(file('latest.csv', report(false)))
  const totalsDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Update and download CSV' }).click()
  const controls = parseCsvRecords(await readFile((await (await totalsDownload).path())!, 'utf8'))
  expect(controls.find(row => row.cells[1] === 'TOTAL')!.cells[5]).toBe('=SUM(F11:F12)')
  expect(controls.find(row => row.cells[0] === 'Total Repaid (from campaigns):')!.cells[1]).toBe('=F13')
  expect(controls.find(row => row.cells[0] === 'Ready Balance:')!.cells[1]).toBe('=G13')
  expect(controls.find(row => row.cells[0] === 'Total Currently Invested:')!.cells[1]).toBe('=J13+G13')
  const converted = controls.find(row => row.cells[0] === '03-Jul-2025')!
  expect(converted.cells[6]).toBe('=SUM($F$11:F12)-SUM($C$11:C12)')
  expect(converted.raw.replace(converted.cells[6], original.cells[6]).replace(converted.cells[9], original.cells[9])).toBe(original.raw)
  expect(converted.cells[9]).toBe('=SUM($D$11:D12)-SUM($E$11:E12)-SUM($F$11:F12)')
  expect(controls.find(row => row.cells[1] === 'TOTAL')!.cells[9]).toBe('=J12')
  expect(controls.find(row => row.cells[1] === 'TOTAL')!.cells[6]).toBe('=G12')
  await expect(page.getByRole('status')).toContainText('No new transactions. CSV formulas updated.')
  expect(await page.evaluate(() => localStorage.length)).toBe(0)
  expect(requests).toEqual([]); expect(errors).toEqual([])
})

test('rejects malformed, mismatched-investor and invalid-UTF8 files without downloading', async ({ page }) => {
  let downloads = 0
  page.on('download', () => downloads++)
  await visit(page, '/csv-update')
  await page.getByLabel('Fixed CSV', { exact: true }).setInputFiles(file('fixed.csv', report(false)))
  await page.getByLabel('Latest downloaded CSV').setInputFiles(file('bad.csv', 'wrong headers'))
  await page.getByRole('button', { name: 'Update and download CSV' }).click()
  await expect(page.getByRole('alert')).toContainText('supported Biniyog BDT')
  await page.getByLabel('Latest downloaded CSV').setInputFiles(file('other.csv', report(true, 'Someone Else')))
  await page.getByRole('button', { name: 'Update and download CSV' }).click()
  await expect(page.getByRole('alert')).toContainText('different investors')
  await page.getByLabel('Latest downloaded CSV').setInputFiles({ name: 'invalid-utf8.csv', mimeType: 'text/csv', buffer: Buffer.from([0xff, 0xff]) })
  await page.getByRole('button', { name: 'Update and download CSV' }).click()
  await expect(page.getByRole('alert')).toContainText('UTF-8')
  expect(downloads).toBe(0)
})
