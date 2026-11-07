import { cents, decimal } from './investmentApi.ts'

export const csvLimit = 2 * 1024 * 1024
export const csvColumns = ['Date', 'Transaction', 'Withdrawn(bdt)', 'Invested into Business(bdt)', 'Investment Refund(bdt)', 'Repaid by Business(bdt)', 'Ready Balance(bdt)', 'Invested into Protection Pool(bdt)', 'Protection Pool Refund(bdt)', 'Capital With Business(bdt)']
const maxRows = 10_000
type RecordRow = { cells: string[]; raw: string }
type TransactionRow = { record: RecordRow; index: number; date: string; key: string; amounts: bigint[] }
type Report = { text: string; records: RecordRow[]; header: number; total: number; transactions: TransactionRow[]; investor: string }
export interface CsvUpdateResult {
  csv: string; addedRows: number; ignoredRows: number; lastDate: string; closingBalance: string; warnings: string[]; formulaCellsChanged: number; repaymentCellsChanged: number; capitalCellsChanged: number; summaryCellsChanged: number;
  added: { date: string; description: string; repayment: string; withdrawn: string; invested: string }[];
}
const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US')
const formula = (start: number, row: number) => `=SUM($F$${start}:F${row})-SUM($C$${start}:C${row})`
const formulaPattern = /^=SUM\(\$F\$\d+:F\d+\)-SUM\(\$C\$\d+:C\d+\)$/i
const capitalFormula = (start: number, row: number, opening: bigint) => `=SUM($D$${start}:D${row})-SUM($E$${start}:E${row})-SUM($F$${start}:F${row})` + (opening === 0n ? '' : (opening > 0n ? '+' : '') + decimal(opening))
const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

export function csvMoney(value: string): bigint {
  const text = value.trim()
  if (!text) return 0n
  if (!/^-?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(text)) throw new Error('CSV amounts must be numbers with at most two decimal places.')
  const result = cents(text.replaceAll(',', ''))
  if (result <= -(10n ** 18n) || result >= 10n ** 18n) throw new Error('A CSV amount exceeds the supported range.')
  return result
}
function formatMoney(value: bigint): string {
  const [whole, fraction] = decimal(value).split('.')
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (fraction === '00' ? '' : '.' + fraction)
}
function capitalValue(value: string, start: number, row: number, cumulative: bigint): bigint {
  const text = value.trim().toUpperCase()
  if (!text.startsWith('=')) return csvMoney(value)
  const prefix = capitalFormula(start, row, 0n)
  const suffix = text.slice(prefix.length)
  if (!text.startsWith(prefix) || suffix && !/^[+-]\d+(?:\.\d{1,2})?$/.test(suffix)) throw new Error(`J${row}: Unsupported capital formula or incorrect row references.`)
  const opening = suffix ? csvMoney(suffix.replace(/^\+/, '')) : 0n
  return csvMoney(decimal(cumulative + opening))
}
function dateKey(value: string): string {
  const match = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(value.trim())
  if (!match) throw new Error('Transaction dates must use DD-Mon-YYYY.')
  const day = Number(match[1]), month = months.indexOf(match[2].toLowerCase()), year = Number(match[3])
  const check = new Date(Date.UTC(year, month, day))
  if (year < 1900 || month < 0 || check.getUTCFullYear() !== year || check.getUTCMonth() !== month || check.getUTCDate() !== day) throw new Error('The CSV contains an invalid transaction date.')
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
function reportDate(key: string): string {
  const [year, month, day] = key.split('-'), name = months[Number(month) - 1]
  return `${day}-${name[0].toUpperCase() + name.slice(1)}-${year}`
}
const escapeCell = (value: string) => /[",\r\n]|^\s|\s$/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value
export const csvRow = (cells: string[], newline = '\n') => cells.map(escapeCell).join(',') + newline

// Replace one field span while retaining the other fields and line endings.
function replaceCell(record: RecordRow, target: number, value: string): string {
  if (record.cells[target] === value) return record.raw
  let quoted = false, column = 0, start = 0
  for (let i = 0; i <= record.raw.length; i++) {
    const char = record.raw[i]
    if (char === '"') { if (quoted && record.raw[i + 1] === '"') i++; else quoted = !quoted }
    else if (!quoted && (char === ',' || char === '\r' || char === '\n' || i === record.raw.length)) {
      if (column === target) return record.raw.slice(0, start) + (record.raw[start] === '"' ? '"' + value.replaceAll('"', '""') + '"' : escapeCell(value)) + record.raw.slice(i)
      if (char !== ',') break
      column++; start = i + 1
    }
  }
  throw new Error('Unable to locate a CSV field to update.')
}

function formulaControls(text: string, openingCapital: bigint): { csv: string; repaymentCellsChanged: number; capitalCellsChanged: number; summaryCellsChanged: number } {
  const records = parseCsvRecords(text)
  const header = records.findIndex(record => record.cells[0]?.trim() === 'Date' && record.cells[1]?.trim() === 'Transaction')
  const total = records.findIndex((record, index) => index > header && normalize(record.cells[1] || '') === 'total')
  let last = header
  for (let index = header + 1; index < total; index++) if (records[index].cells[0]?.trim()) last = index
  let repaymentCellsChanged = 0, capitalCellsChanged = 0, summaryCellsChanged = 0
  let capital = csvMoney(decimal(openingCapital))
  const csv = records.map((record, index) => {
    let raw = record.raw
    const column = index === total ? 5 : index < header && normalize(record.cells[0] || '') === 'total repaid (from campaigns):' ? 1 : -1
    if (column !== -1) {
      const value = index === total ? `=SUM(F${header + 2}:F${last + 1})` : `=F${total + 1}`
      if (record.cells[column] !== value) repaymentCellsChanged++
      raw = replaceCell(record, column, value)
    }
    if (index < header) {
      const label = normalize(record.cells[0] || '')
      const value = label === 'ready balance:' ? `=G${total + 1}` : label === 'total currently invested:' ? `=J${total + 1}+G${total + 1}` : null
      if (value !== null) {
        if (record.cells[1] !== value) summaryCellsChanged++
        raw = replaceCell({ ...record, raw }, 1, value)
      }
    }
    if (index === total || index > header && index < total && record.cells[0]?.trim()) {
      if (index !== total) {
        capital += csvMoney(record.cells[3]) - csvMoney(record.cells[4]) - csvMoney(record.cells[5])
        csvMoney(decimal(capital))
      }
      const value = index === total ? `=J${last + 1}` : capitalFormula(header + 2, index + 1, openingCapital)
      if (record.cells[9] !== value) capitalCellsChanged++
      raw = replaceCell({ ...record, raw }, 9, value)
    }
    return raw
  }).join('')
  return { csv, repaymentCellsChanged, capitalCellsChanged, summaryCellsChanged }
}

// Retain original record text so balance/control replacements preserve every
// unrelated field, including multiline descriptions and quoting.
export function parseCsvRecords(text: string): RecordRow[] {
  const records: RecordRow[] = []
  let cells: string[] = [], value = '', quoted = false, closed = false, fieldStart = true, recordStart = 0
  function field() { cells.push(value); value = ''; closed = false; fieldStart = true }
  function record(end: number) {
    if (records.length >= maxRows + 1000) throw new Error('The CSV contains too many rows, including blank or metadata rows.')
    field(); records.push({ cells, raw: text.slice(recordStart, end) }); cells = []; recordStart = end
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (i === 0 && char === '\ufeff') continue
    if (quoted) {
      if (char === '"') { if (text[i + 1] === '"') { value += '"'; i++ } else { quoted = false; closed = true } }
      else value += char
    } else if (char === ',') field()
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; record(i + 1) }
    else if (char === '"' && fieldStart && !closed) { quoted = true; fieldStart = false }
    else {
      if (closed || char === '"') throw new Error('Malformed CSV quoting. Export the files as UTF-8 CSV and try again.')
      value += char; fieldStart = false
    }
  }
  if (quoted) throw new Error('The CSV contains an unfinished quoted field.')
  if (recordStart < text.length) record(text.length)
  return records
}

function readReport(text: string): Report {
  if (!text || new TextEncoder().encode(text).length > csvLimit) throw new Error('Each CSV must be nonempty and at most 2 MB.')
  const records = parseCsvRecords(text)
  const header = records.findIndex(r => r.cells.length === 10 && r.cells.every((cell, i) => cell.trim() === csvColumns[i]))
  if (header < 0) throw new Error('The CSV must have the supported Biniyog BDT transaction columns.')
  const investor = records.slice(0, header).find(r => /^investor name:/i.test(r.cells[0]?.trim() || ''))?.cells[0].split(':').slice(1).join(':').trim()
  if (!investor) throw new Error('Both files must include the Investor Name from the original export.')
  const transactions: TransactionRow[] = []
  let total = -1, previous = ''
  let cumulativeCapital = 0n
  for (let index = header + 1; index < records.length; index++) {
    const record = records[index], cells = record.cells
    if (cells.every(cell => !cell.trim())) continue
    if (cells.length !== 10) throw new Error(`CSV row ${index + 1} must have 10 columns.`)
    if (normalize(cells[1]) === 'total') { if (total !== -1) throw new Error('The CSV contains multiple TOTAL rows.'); total = index; continue }
    if (total !== -1) throw new Error('Transactions cannot appear after TOTAL.')
    if (transactions.length >= maxRows) throw new Error('Each report is limited to 10,000 transaction rows.')
    const date = dateKey(cells[0])
    if (date < previous) throw new Error('Transaction rows must be in ascending date order.')
    previous = date
    if (!/^(investment|reinvestment|repayment received|disbursed|investment refund|refund received)(\r?\n|$)/i.test(cells[1].trim())) throw new Error(`CSV row ${index + 1} has an unrecognized transaction description.`)
    const amounts = cells.map((cell, column) => {
      if (column < 2 || column === 6 || column === 9) return 0n
      const number = csvMoney(cell)
      if (column !== 9 && number < 0n) throw new Error('Movement amounts cannot be negative.')
      return number
    })
    if ([amounts[4], amounts[7], amounts[8]].some(value => value !== 0n)) throw new Error('Refund or protection-pool activity needs manual review; this updater follows your F minus C balance rule.')
    if ([2, 3, 5].filter(column => amounts[column] > 0n).length !== 1) throw new Error(`CSV row ${index + 1} must have one positive withdrawal, investment or repayment.`)
    cumulativeCapital += amounts[3] - amounts[4] - amounts[5]
    amounts[9] = capitalValue(cells[9], header + 2, index + 1, cumulativeCapital)
    if (cells[6].trim().startsWith('=')) {
      if (!formulaPattern.test(cells[6].trim())) throw new Error('Only the existing SUM(F) minus SUM(C) balance formulas are supported in column G.')
    } else csvMoney(cells[6])
    // Amounts, running balances and source capital are intentionally excluded:
    // the fixed report may contain corrections to every one of those fields.
    transactions.push({ record, index, date, key: date + '\u0000' + normalize(cells[1]), amounts })
  }
  if (!transactions.length || total < 0) throw new Error('Each CSV must contain transaction rows and one TOTAL row.')
  return { text, records, header, total, transactions, investor: normalize(investor) }
}

export function updateFixedCsv(fixedText: string, latestText: string): CsvUpdateResult {
  const fixed = readReport(fixedText), latest = readReport(latestText)
  if (fixed.investor !== latest.investor) throw new Error('The files belong to different investors. Choose two exports for the same person.')
  const cutoff = fixed.transactions.at(-1)!.date
  const existing = new Map<string, number>(), occurrences = new Map<string, number>()
  fixed.transactions.forEach(row => existing.set(row.key, (existing.get(row.key) || 0) + 1))
  const added: TransactionRow[] = []
  let ignoredRows = 0
  for (const row of latest.transactions) {
    const occurrence = (occurrences.get(row.key) || 0) + 1
    occurrences.set(row.key, occurrence)
    if (occurrence <= (existing.get(row.key) || 0)) { ignoredRows++; continue }
    if (row.date < cutoff) throw new Error(`The newer export has an unmatched historical row on ${row.date}. Review it manually; older rows will not be appended or overwritten.`)
    added.push(row)
  }
  if (fixed.transactions.length + added.length > maxRows) throw new Error('The updated report would exceed 10,000 transaction rows.')
  const all = [...fixed.transactions, ...added]
  const first = fixed.transactions[0].amounts
  const openingCapital = first[9] - first[3] + first[4] + first[5]
  const totals = Array<bigint>(10).fill(0n)
  let balance = 0n, inconsistent = 0
  for (const row of fixed.transactions) {
    balance += row.amounts[5] - row.amounts[2]
    if (!row.record.cells[6].trim().startsWith('=') && csvMoney(row.record.cells[6]) !== balance) inconsistent++
  }
  const warnings: string[] = []
  if (inconsistent) warnings.push(`${inconsistent} existing ready-balance value(s) differ from F minus C. Column G will be recalculated by the saved formulas.`)
  const lastDate = all.at(-1)!.date
  const firstRow = fixed.header + 2
  let formulaCellsChanged = 0
  function writeFormula(record: RecordRow, value: string) {
    if (record.cells[6] !== value) formulaCellsChanged++
    return replaceCell(record, 6, value)
  }
  if (!added.length) {
    const targets = new Map(fixed.transactions.map(row => [row.index, formula(firstRow, row.index + 1)]))
    targets.set(fixed.total, `=G${fixed.transactions.at(-1)!.index + 1}`)
    const updated = fixed.records.map((record, index) => targets.has(index) ? writeFormula(record, targets.get(index)!) : record.raw).join('')
    const { csv, repaymentCellsChanged, capitalCellsChanged, summaryCellsChanged } = formulaControls(updated, openingCapital)
    if (new TextEncoder().encode(csv).length > csvLimit) throw new Error('The updated CSV would exceed 2 MB.')
    return { csv, addedRows: 0, ignoredRows, lastDate, closingBalance: decimal(balance), warnings, added: [], formulaCellsChanged, repaymentCellsChanged, capitalCellsChanged, summaryCellsChanged }
  }
  warnings.push('New rows keep the downloaded amounts. Review them for the same provider errors you corrected in earlier rows.')
  const newline = fixedText.includes('\r\n') ? '\r\n' : '\n'
  const outputRows: string[] = []
  let physicalRow = fixed.total + 1
  for (const row of added) {
    balance += row.amounts[5] - row.amounts[2]
    const cells = [...row.record.cells]
    cells[6] = formula(firstRow, physicalRow)
    formulaCellsChanged++
    outputRows.push(csvRow(cells, newline)); physicalRow++
  }
  for (const row of all) for (const column of [2, 3, 4, 5, 7, 8]) totals[column] += row.amounts[column]
  const summaryValues = new Map<string, string>([
    ['total deposited:', formatMoney(totals[3])], ['total repaid (from campaigns):', formatMoney(totals[5])],
    ['total withdrawn (to bank):', formatMoney(totals[2])], ['total investment refund:', formatMoney(totals[4])],
    ['total protection pool contribution:', formatMoney(totals[7])], ['total protection pool refund:', formatMoney(totals[8])], ['ready balance:', formatMoney(balance)],
  ])
  const latestPrefix = latest.records.slice(0, latest.header)
  for (const label of ['total expected amount:']) {
    const value = latestPrefix.find(row => normalize(row.cells[0] || '') === label)?.cells[1]
    if (value !== undefined) { csvMoney(value); summaryValues.set(label, value) }
  }
  const prefix = fixed.records.slice(0, fixed.header + 1).map(record => {
    const cells = [...record.cells], label = normalize(cells[0] || '')
    if (summaryValues.has(label)) cells[1] = summaryValues.get(label)!
    else if (/^report period:/i.test(cells[0] || '')) {
      const latestPeriod = latestPrefix.find(r => /^report period:/i.test(r.cells[0] || ''))?.cells[0]
      const originalStart = /^(Report Period:\s*\d{2}-[A-Za-z]{3}-\d{4}\s*-\s*)/i.exec(cells[0])
      const end = latestPeriod?.match(/(\d{2}-[A-Za-z]{3}-\d{4})\s*$/)?.[1]
      if (originalStart) cells[0] = originalStart[1] + (end && dateKey(end) >= lastDate ? end : reportDate(lastDate))
    } else if (/^generated on:/i.test(cells[0] || '')) {
      cells[0] = latestPrefix.find(r => /^generated on:/i.test(r.cells[0] || ''))?.cells[0] || cells[0]
    }
    return cells.some((value, i) => value !== record.cells[i]) ? csvRow(cells, newline) : record.raw
  }).join('')
  const totalCells = [...fixed.records[fixed.total].cells]
  for (const column of [2, 3, 4, 5, 7, 8]) totalCells[column] = formatMoney(totals[column])
  totalCells[6] = `=G${physicalRow - 1}`
  if (totalCells[6] !== fixed.records[fixed.total].cells[6]) formulaCellsChanged++
  const historyTargets = new Map(fixed.transactions.map(row => [row.index, formula(firstRow, row.index + 1)]))
  const history = fixed.records.slice(fixed.header + 1, fixed.total).map((record, offset) => {
    const target = historyTargets.get(fixed.header + 1 + offset)
    return target ? writeFormula(record, target) : record.raw
  }).join('')
  const { csv, repaymentCellsChanged, capitalCellsChanged, summaryCellsChanged } = formulaControls(prefix + history + (history.endsWith('\n') || history.endsWith('\r') ? '' : newline) + outputRows.join('') + csvRow(totalCells, newline) + fixed.records.slice(fixed.total + 1).map(row => row.raw).join(''), openingCapital)
  if (new TextEncoder().encode(csv).length > csvLimit) throw new Error('The updated CSV would exceed 2 MB. Keep a smaller active archive before adding more rows.')
  return {
    csv, addedRows: added.length, ignoredRows, lastDate, closingBalance: decimal(balance), warnings, formulaCellsChanged, repaymentCellsChanged, capitalCellsChanged, summaryCellsChanged,
    added: added.map(row => ({ date: row.date, description: row.record.cells[1], repayment: decimal(row.amounts[5]), withdrawn: decimal(row.amounts[2]), invested: decimal(row.amounts[3]) })),
  }
}
