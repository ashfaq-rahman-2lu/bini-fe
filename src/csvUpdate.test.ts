import assert from 'node:assert/strict'
import { test } from 'node:test'
import { csvColumns, csvLimit, csvMoney, csvRow, parseCsvRecords, updateFixedCsv } from './csvUpdate.ts'

const investment = (date = '02-Jul-2025', value = '1,000') => [date, 'Investment\nBANK_TRANSFER for Alpha [1]', '', value, '0', '', '0', '0', '0', '1,000']
const repayment = (date = '03-Jul-2025', value = '10', ready = value) => [date, 'Repayment Received\npayment made by Alpha [1] to biniyog', '', '', '0', value, ready, '0', '0', '990']
function report(rows: string[][], { investor = 'Synthetic Investor', padded = false, newline = '\n' } = {}) {
  const prefix = [[`Investor Name: ${investor}`], ['Report Period: 30-Jun-2025 - 04-Nov-2026'], ['Generated On: 07-Nov-2026'], [], ['Summary'], ['Total Repaid (from campaigns):', 'wrong old control'], ['Ready Balance:', '0'], [], ['Transactions'], csvColumns]
  if (padded) prefix.unshift([])
  return prefix.map(row => csvRow(padded ? [...row, ...Array(Math.max(0, 10 - row.length)).fill('')] : row, newline)).join('') + rows.map(row => csvRow(row, newline)).join('') + csvRow(['', 'TOTAL', '0', '1,000', '0', '10', '10', '0', '0', '990'], newline)
}
const transactions = (text: string) => parseCsvRecords(text).filter(r => /^\d{2}-/.test(r.cells[0]))
const total = (text: string) => parseCsvRecords(text).find(row => row.cells[1] === 'TOTAL')!.cells
function restoreBalances(after: ReturnType<typeof transactions>[number], before: ReturnType<typeof transactions>[number]) {
  return after.raw.replace(after.cells[6], before.cells[6]).replace(after.cells[9], before.cells[9])
}

test('preserves corrected historical transaction bytes and appends downloaded values with corrected balances/totals', () => {
  const fixed = report([investment(), repayment('03-Jul-2025', '9', '9')], { padded: true })
  const latest = report([investment(), repayment(), repayment('04-Jul-2025', '2', '12')])
  const result = updateFixedCsv(fixed, latest)
  assert.equal(result.addedRows, 1); assert.equal(result.ignoredRows, 2)
  assert.equal(result.closingBalance, '11.00')
  transactions(result.csv).slice(0, 2).forEach((row, index) => assert.equal(restoreBalances(row, transactions(fixed)[index]), transactions(fixed)[index].raw))
  assert.equal(transactions(result.csv)[2].cells[5], '2')
  assert.equal(transactions(result.csv)[2].cells[6], '=SUM($F$12:F14)-SUM($C$12:C14)')
  assert.equal(total(result.csv)[5], '=SUM(F12:F14)'); assert.equal(total(result.csv)[6], '=G14')
  assert.ok(result.warnings.some(w => w.includes('downloaded amounts')))
  assert.equal(parseCsvRecords(result.csv).find(r => r.cells[0] === 'Total Repaid (from campaigns):')!.cells[1], '=F15')
})

test('repeated updates are exact no-ops after repayment formulas are written', () => {
  const fixed = report([investment(), repayment()])
  const latest = report([investment(), repayment(), repayment('04-Jul-2025', '2')])
  const first = updateFixedCsv(fixed, latest)
  const again = updateFixedCsv(first.csv, latest)
  assert.equal(again.addedRows, 0); assert.equal(again.csv, first.csv)
  const converted = updateFixedCsv(fixed, fixed)
  assert.equal(converted.repaymentCellsChanged, 2)
  assert.equal(updateFixedCsv(converted.csv, fixed).csv, converted.csv)
})

test('preserves corrected paired rows and appends additional same-day repeated occurrences', () => {
  const fixed = report([investment(), repayment('03-Jul-2025', '4', '4'), repayment('03-Jul-2025', '5', '9')])
  const latest = report([investment(), repayment('03-Jul-2025', '4', '4'), repayment('03-Jul-2025', '6', '10'), repayment('03-Jul-2025', '7', '17')])
  const result = updateFixedCsv(fixed, latest)
  assert.equal(result.addedRows, 1); assert.equal(result.ignoredRows, 3)
  assert.deepEqual(transactions(result.csv).map(r => r.cells[5]), ['', '4', '5', '7'])
  assert.equal(result.closingBalance, '16.00')
})

test('new same-day transactions from another business remain separate', () => {
  const fixed = report([investment(), repayment()])
  const beta = repayment(); beta[1] = beta[1].replace('Alpha [1]', 'Beta [2]')
  const result = updateFixedCsv(fixed, report([investment(), repayment(), beta]))
  assert.equal(result.addedRows, 1); assert.equal(result.closingBalance, '20.00')
})

test('rejects unmatched historical activity rather than overwriting or appending out of order', () => {
  const fixed = report([investment(), repayment('05-Jul-2025')])
  assert.throws(() => updateFixedCsv(fixed, report([investment(), repayment('04-Jul-2025')])), /unmatched historical/)
})

test('supports formula balances and shifted header rows without rewriting earlier formulas', () => {
  const one = investment(), two = repayment()
  const text = report([one, two], { padded: true })
  const first = parseCsvRecords(text).findIndex(row => row.cells[0] === 'Date') + 2
  one[6] = `=SUM($F$${first}:F${first})-SUM($C$${first}:C${first})`
  two[6] = `=SUM($F$${first}:F${first + 1})-SUM($C$${first}:C${first + 1})`
  const fixed = report([one, two], { padded: true })
  const result = updateFixedCsv(fixed, report([investment(), repayment(), repayment('04-Jul-2025', '2')]))
  const rows = transactions(result.csv)
  assert.equal(rows[0].cells[6], one[6]); assert.equal(rows[1].cells[6], two[6])
  assert.equal(rows[2].cells[6], `=SUM($F$${first}:F${first + 2})-SUM($C$${first}:C${first + 2})`)
  assert.equal(total(result.csv)[6], `=G${first + 2}`)
})

test('formula output replaces every G balance while preserving corrected amounts and other fields', () => {
  const fixed = report([investment(), repayment('03-Jul-2025', '9', '9')], { padded: true, newline: '\r\n' })
  const latest = report([investment(), repayment(), repayment('04-Jul-2025', '2')])
  const result = updateFixedCsv(fixed, latest)
  const before = transactions(fixed), records = parseCsvRecords(result.csv)
  const first = records.findIndex(row => row.cells[0] === 'Date') + 2
  const after = transactions(result.csv)
  for (let i = 0; i < before.length; i++) {
    for (let column = 0; column < 10; column++) if (column !== 6 && column !== 9) assert.equal(after[i].cells[column], before[i].cells[column])
    assert.equal(restoreBalances(after[i], before[i]), before[i].raw)
  }
  for (let i = 0; i < after.length; i++) assert.equal(after[i].cells[6], `=SUM($F$${first}:F${first+i})-SUM($C$${first}:C${first+i})`)
  assert.equal(total(result.csv)[6], `=G${first + after.length - 1}`)
  assert.equal(result.closingBalance, '11.00')
  assert.equal(result.formulaCellsChanged, 4)
})

test('formula output works without new rows, updates only balance and repayment controls, and repeats as an exact no-op', () => {
  const fixed = report([investment(), repayment('03-Jul-2025', '9', '9')])
  const latest = report([investment(), repayment()])
  const result = updateFixedCsv(fixed, latest)
  const before = parseCsvRecords(fixed), after = parseCsvRecords(result.csv)
  assert.equal(result.addedRows, 0); assert.equal(result.formulaCellsChanged, 3)
  for (let i = 0; i < before.length; i++) for (let column = 0; column < before[i].cells.length; column++) {
    const repaymentControl = before[i].cells[0] === 'Total Repaid (from campaigns):' && column === 1 || before[i].cells[1] === 'TOTAL' && column === 5
    const summaryControl = column === 1 && ['Ready Balance:', 'Total Currently Invested:'].includes(before[i].cells[0])
    if (column !== 6 && column !== 9 && !repaymentControl && !summaryControl) assert.equal(after[i].cells[column], before[i].cells[column])
  }
  assert.equal(total(result.csv)[6], '=G12')
  const repeated = updateFixedCsv(result.csv, latest)
  assert.equal(repeated.csv, result.csv); assert.equal(repeated.formulaCellsChanged, 0)
})

test('formula output retains original quote styles, blank rows, BOM and references the actual final transaction', () => {
  const fixed = '\ufeff' + report([investment(), repayment('03-Jul-2025', '9999', '9,999')], { padded: true, newline: '\r\n' }).replace(',TOTAL,', ',TOTAL,')
  const records = parseCsvRecords(fixed), totalRecord = records.find(r => r.cells[1] === 'TOTAL')!
  const input = fixed.replace(totalRecord.raw, '\r\n' + totalRecord.raw)
  const result = updateFixedCsv(input, report([investment(), repayment()]))
  assert.ok(result.csv.startsWith('\ufeff'))
  const before = transactions(input).at(-1)!, after = transactions(result.csv).at(-1)!
  assert.equal(restoreBalances(after, before), before.raw)
  const lastRow = parseCsvRecords(result.csv).findIndex(r => r.cells[0] === '03-Jul-2025') + 1
  assert.equal(total(result.csv)[6], `=G${lastRow}`)
})

test('accepts Indian grouping, decimal precision, BOM, CRLF, quoted descriptions and trailing empty columns', () => {
  assert.equal(csvMoney('2,54,411.50'), 25441150n); assert.equal(csvMoney('254,411.50'), 25441150n)
  assert.equal(csvMoney('-52.25'), -5225n)
  const row = repayment('03-Jul-2025', '1.25', '1.25'); row[1] += '\nNote "kept", reference'
  const fixed = '\ufeff' + report([investment(), row], { padded: true, newline: '\r\n' })
  const next = repayment('04-Jul-2025', '0.50', '1.75')
  const result = updateFixedCsv(fixed, report([next]))
  assert.ok(result.csv.startsWith('\ufeff'))
  const before = transactions(fixed)[1], after = transactions(result.csv)[1]
  assert.equal(restoreBalances(after, before), before.raw)
  assert.equal(result.closingBalance, '1.75')
})

test('rejects different investors, malformed CSV and unsupported headers', () => {
  const fixed = report([investment()])
  assert.throws(() => updateFixedCsv(fixed, report([investment()], { investor: 'Other Person' })), /different investors/)
  assert.throws(() => parseCsvRecords('"unfinished'), /unfinished/)
  assert.throws(() => parseCsvRecords('"closed"bad,field'), /quoting/)
  assert.throws(() => updateFixedCsv(fixed, 'Date,Wrong columns\n'), /columns/)
})

test('rejects invalid money, dates, movement amounts, formulas, excessive size and refund/pool activity', () => {
  const fixed = report([investment()])
  for (const value of ['1,23,4', 'NaN', '1.123', '1e3', '10000000000000000']) assert.throws(() => csvMoney(value))
  assert.throws(() => updateFixedCsv(fixed, report([repayment('31-Feb-2026')])) , /invalid transaction date/)
  const negative = repayment(); negative[5] = '-1'
  assert.throws(() => updateFixedCsv(fixed, report([negative])), /negative/)
  const unsafe = repayment(); unsafe[6] = '=HYPERLINK("https://example.com")'
  assert.throws(() => updateFixedCsv(fixed, report([unsafe])), /Only the existing SUM/)
  const pool = repayment(); pool[7] = '1'
  assert.throws(() => updateFixedCsv(fixed, report([pool])), /manual review/)
  assert.throws(() => updateFixedCsv(fixed, 'x'.repeat(csvLimit + 1)), /2 MB/)
})

test('recalculates stale source capital with formulas and references the final J balance in TOTAL', () => {
  const next = repayment('04-Jul-2025', '2'); next[9] = '888'
  const result = updateFixedCsv(report([investment(), repayment()]), report([next]))
  assert.equal(transactions(result.csv)[1].cells[9], '=SUM($D$11:D12)-SUM($E$11:E12)-SUM($F$11:F12)')
  assert.equal(transactions(result.csv)[2].cells[9], '=SUM($D$11:D13)-SUM($E$11:E13)-SUM($F$11:F13)')
  assert.equal(total(result.csv)[9], '=J13')
  assert.equal(result.capitalCellsChanged, 4)
  assert.equal(updateFixedCsv(result.csv, report([next])).csv, result.csv)
})

test('reports inconsistent saved balances and always replaces them with formulas', () => {
  const fixed = report([investment(), repayment('03-Jul-2025', '9', '10')])
  const result = updateFixedCsv(fixed, report([repayment('04-Jul-2025', '2')]))
  assert.equal(transactions(result.csv)[1].cells[6], '=SUM($F$11:F12)-SUM($C$11:C12)')
  assert.equal(result.closingBalance, '11.00')
  assert.ok(result.warnings.some(w => w.includes('existing ready-balance')))
})

test('refreshes metadata and provider expected amount while deriving balance and repayment summaries', () => {
  const extra = (expected: string) => `Summary\nTotal Expected Amount:,${expected}\nTotal Currently Invested:,900\n`
  const fixed = report([investment(), repayment('03-Jul-2025', '9', '9')]).replace('Summary\n', extra('1200'))
  const latest = report([repayment('04-Jul-2025', '2')]).replace('Summary\n', extra('1300')).replace('04-Nov-2026', '02-Jul-2025').replace('07-Nov-2026', '05-Jul-2025')
  const result = updateFixedCsv(fixed, latest)
  const rows = parseCsvRecords(result.csv)
  assert.ok(rows.some(r => r.cells[0] === 'Report Period: 30-Jun-2025 - 04-Jul-2025'))
  assert.ok(rows.some(r => r.cells[0] === 'Generated On: 05-Jul-2025'))
  assert.equal(rows.find(r => r.cells[0] === 'Total Expected Amount:')!.cells[1], '1300')
  assert.equal(rows.find(r => r.cells[0] === 'Total Repaid (from campaigns):')!.cells[1], '=F16')
  assert.equal(rows.find(r => r.cells[0] === 'Ready Balance:')!.cells[1], '=G16')
  assert.equal(rows.find(r => r.cells[0] === 'Total Currently Invested:')!.cells[1], '=J16+G16')
})

test('balance and repayment formulas are always written even without new rows', () => {
  const fixed = '\ufeff' + report([investment(), repayment('03-Jul-2025', '9.25', '9.25')], { padded: true, newline: '\r\n' })
  const records = parseCsvRecords(fixed), totalRecord = records.find(r => r.cells[1] === 'TOTAL')!
  const input = fixed.replace(totalRecord.raw, '\r\n' + totalRecord.raw)
  const result = updateFixedCsv(input, report([investment(), repayment()]))
  const after = parseCsvRecords(result.csv)
  assert.equal(result.addedRows, 0); assert.equal(result.formulaCellsChanged, 3); assert.equal(result.repaymentCellsChanged, 2)
  const before = transactions(input), output = transactions(result.csv)
  output.forEach((row, index) => assert.equal(restoreBalances(row, before[index]), before[index].raw))
  assert.equal(output[1].cells[6], '=SUM($F$12:F13)-SUM($C$12:C13)')
  assert.equal(total(result.csv)[6], '=G13')
  assert.equal(total(result.csv)[5], '=SUM(F12:F13)')
  assert.equal(after.find(r => r.cells[0] === 'Total Repaid (from campaigns):')!.cells[1], '=F15')
  assert.ok(result.csv.startsWith('\ufeff')); assert.ok(result.csv.includes('\r\n\r\n'))
  const repeated = updateFixedCsv(result.csv, result.csv)
  assert.equal(repeated.csv, result.csv); assert.equal(repeated.repaymentCellsChanged, 0)
  assert.equal(repeated.capitalCellsChanged, 0)
})

test('preserves positive and negative opening capital in partial exports across repeated updates', () => {
  for (const opening of ['250.00', '-100.00']) {
    const first = investment(); first[9] = opening === '250.00' ? '1,250' : '900'
    const fixed = report([first, repayment()])
    const latest = report([first, repayment(), repayment('04-Jul-2025', '2')])
    const result = updateFixedCsv(fixed, latest)
    const suffix = opening.startsWith('-') ? opening : '+' + opening
    const rows = transactions(result.csv)
    assert.equal(rows[0].cells[9], '=SUM($D$11:D11)-SUM($E$11:E11)-SUM($F$11:F11)' + suffix)
    assert.equal(rows[2].cells[9], '=SUM($D$11:D13)-SUM($E$11:E13)-SUM($F$11:F13)' + suffix)
    assert.equal(updateFixedCsv(result.csv, latest).csv, result.csv)
  }
})

test('ready and currently-invested summaries always reference the final G/J totals', () => {
  const addSummary = (text: string) => text.replace('\n\nTransactions\n', '\nTotal Currently Invested:,99999\nTransactions\n')
  const fixed = addSummary(report([investment(), repayment('03-Jul-2025', '9.25', '9.25')]))
  const latest = addSummary(report([investment(), repayment(), repayment('04-Jul-2025', '2')]))
  const result = updateFixedCsv(fixed, latest)
  let rows = parseCsvRecords(result.csv)
  assert.equal(rows.find(r => r.cells[0] === 'Ready Balance:')!.cells[1], '=G14')
  assert.equal(rows.find(r => r.cells[0] === 'Total Currently Invested:')!.cells[1], '=J14+G14')
  // Repairs just these summaries even when every other output formula already exists.
  const stale = result.csv.replace('=G14\n', '999\n').replace('=J14+G14', '888')
  const repaired = updateFixedCsv(stale, result.csv)
  rows = parseCsvRecords(repaired.csv)
  assert.equal(repaired.addedRows, 0); assert.equal(repaired.summaryCellsChanged, 2)
  assert.equal(rows.find(r => r.cells[0] === 'Ready Balance:')!.cells[1], '=G14')
  assert.equal(rows.find(r => r.cells[0] === 'Total Currently Invested:')!.cells[1], '=J14+G14')
  assert.equal(repaired.csv, result.csv)
  assert.equal(updateFixedCsv(repaired.csv, result.csv).csv, result.csv)
})

test('rejects invalid capital formula references, arbitrary expressions and excess opening precision', () => {
  for (const formula of ['=J11', '=SUM($D$11:D99)-SUM($E$11:E99)-SUM($F$11:F99)', '=HYPERLINK("https://example.com")', '=SUM($D$11:D12)-SUM($E$11:E12)-SUM($F$11:F12)+1.001']) {
    const row = repayment(); row[9] = formula
    assert.throws(() => updateFixedCsv(report([investment(), row]), report([investment()])), /J12: Unsupported capital formula/)
  }
})

test('enforces the merged row limit', () => {
  const fixed = report([investment(), ...Array.from({ length: 9999 }, () => repayment())])
  assert.throws(() => updateFixedCsv(fixed, report([repayment('04-Jul-2025')])), /exceed 10,000/)
})

test('bounds blank-row parsing and keeps generated files within the next-upload size limit', () => {
  assert.throws(() => parseCsvRecords('\n'.repeat(11001)), /too many rows/)
  const older = repayment(), newer = repayment('04-Jul-2025')
  older[1] += '\n' + 'x'.repeat(11000); newer[1] += '\n' + 'y'.repeat(11000)
  const fixed = report([investment(), ...Array.from({ length: 100 }, () => older)])
  const latest = report(Array.from({ length: 100 }, () => newer))
  assert.throws(() => updateFixedCsv(fixed, latest), /updated CSV would exceed 2 MB/)
})
