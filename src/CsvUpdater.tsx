import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, Download, FileSpreadsheet, LoaderCircle, RefreshCw } from 'lucide-react'
import { csvLimit, updateFixedCsv, type CsvUpdateResult } from './csvUpdate'
import { dateLabel, money } from './api'

type DownloadResult = CsvUpdateResult & { url: string; filename: string }

async function readFile(file: File): Promise<string> {
  if (!file.size || file.size > csvLimit) throw new Error('Choose nonempty CSV files of at most 2 MB each.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? '\ufeff' + text : text
  } catch { throw new Error('Export both files as UTF-8 CSV and try again.') }
}

export function CsvUpdate() {
  const [fixed, setFixed] = useState<File | null>(null), [latest, setLatest] = useState<File | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [result, setResult] = useState<DownloadResult | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])
  function change(file: File | null, type: 'fixed' | 'latest') {
    if (type === 'fixed') setFixed(file); else setLatest(file)
    setResult(null); setError('')
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setResult(null)
    if (!fixed || !latest) { setError('Choose both the fixed CSV and the latest downloaded CSV.'); return }
    setBusy(true)
    try {
      const [fixedText, latestText] = await Promise.all([readFile(fixed), readFile(latest)])
      if (!mounted.current) return
      const updated = updateFixedCsv(fixedText, latestText)
      const url = URL.createObjectURL(new Blob([updated.csv], { type: 'text/csv;charset=utf-8' }))
      const filename = fixed.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').replace(/\.csv$/i, '') + '.csv'
      setResult({ ...updated, url, filename })
      const link = document.createElement('a')
      link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove()
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Unable to update these CSV files.') }
    finally { if (mounted.current) setBusy(false) }
  }
  return <>
    <header className="page-header"><div><div className="eyebrow">INVESTMENT CSV TOOLS</div><h1>Update a fixed CSV</h1><p>Keep your corrections and add new transactions from the latest export.</p></div></header>
    <div className="upload-layout"><section className="panel upload-panel">
      <form onSubmit={submit}>
        <label className="csv-file-label"><span>1. Fixed CSV with your corrections</span><div><FileSpreadsheet size={21} /><strong>{fixed?.name || 'Select your current fixed_transactions.csv'}</strong></div><input aria-label="Fixed CSV" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => change(event.target.files?.[0] || null, 'fixed')} /></label>
        <label className="csv-file-label"><span>2. Latest downloaded CSV</span><div><RefreshCw size={21} /><strong>{latest?.name || 'Select the new export from Biniyog'}</strong></div><input aria-label="Latest downloaded CSV" type="file" accept=".csv,text/csv" disabled={busy} onChange={event => change(event.target.files?.[0] || null, 'latest')} /></label>
        <p className="footnote">UTF-8 CSV · 2 MB per file · up to 10,000 merged transactions. Both files must belong to the same investor.</p>
        <p className="footnote">Every transaction’s ready balance and the final G total are always saved as formulas. Excel/Google Sheets can recalculate them when you change withdrawals or repayments.</p>
        <p className="footnote">Column J and its TOTAL are also formulas: invested amounts minus repayments and refunds, including any opening business capital.</p>
        <p className="footnote">The TOTAL row’s column F always sums all business repayments. “Total Repaid (from campaigns)” references that total, so both stay in sync when you edit repayments.</p>
        <p className="footnote">The summary’s Ready Balance references the G total. Total Currently Invested equals capital with business plus ready balance (J total + G total).</p>
        {error && <div className="error-box" role="alert">{error}</div>}
        <button className="primary-button wide" disabled={!fixed || !latest || busy}>{busy ? <><LoaderCircle size={17} className="animate-spin" /> Updating CSV…</> : <><Download size={17} /> Update and download CSV</>}</button>
      </form>
      {result && <div className="download-ready csv-download" role="status"><CheckCircle2 size={21} /><div><strong>{result.addedRows ? `Added ${result.addedRows} new transaction${result.addedRows === 1 ? '' : 's'}.` : result.formulaCellsChanged || result.repaymentCellsChanged || result.capitalCellsChanged || result.summaryCellsChanged ? 'No new transactions. CSV formulas updated.' : 'No new transactions. Your fixed CSV is unchanged.'}</strong><p>{result.ignoredRows} existing transactions matched. Your download starts automatically.</p><a className="secondary-button" href={result.url} download={result.filename}><Download size={16} /> Download updated CSV again</a></div></div>}
    </section><aside className="import-info"><div className="eyebrow">KEEP THE FIXED COPY</div><h2>Your corrections<br /> stay intact.</h2><p>Your corrected transaction amounts and descriptions stay intact. Ready-balance cells are automatically saved as formulas. We compare dates and descriptions without using the amounts you corrected. Repeated payments remain separate.</p><p className="support-note">New rows keep the downloaded amounts for you to review. Ready balances follow your F minus C rule. Repayment totals are linked on every download, even without new rows; other totals refresh when rows are appended. Your browser saves an updated copy; replace your fixed file with that download before the next update.</p><p className="support-note">Everything runs in this browser. Files are not uploaded or added to the database, and the selected originals are not overwritten.</p></aside></div>
    {result && <>
      <div className="csv-update-facts"><span>Through {dateLabel(result.lastDate)}</span><span>Calculated ready balance: <strong>BDT {money(result.closingBalance)}</strong></span></div>
      {result.warnings.length > 0 && <section className="panel csv-update-notes"><h2>Review before using the updated file</h2><ul>{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></section>}
      {result.added.length > 0 && <section className="panel investment-activity"><div className="section-heading"><h2>New transactions</h2><span className="subtle">{result.added.length > 100 ? 'First 100 appended rows; download includes all' : 'Only appended rows'} · BDT</span></div><p className="mobile-table-hint">Swipe the table to see repayment, withdrawal and investment amounts.</p><div className="table-scroll"><table><thead><tr><th>Date</th><th>Description</th><th>Repaid by business</th><th>Withdrawn</th><th>Invested</th></tr></thead><tbody>{result.added.slice(0, 100).map((row, index) => <tr key={index}><td className="date-cell">{dateLabel(row.date)}</td><td><p className="investment-description">{row.description}</p></td><td><span className="amount">{money(row.repayment)}</span></td><td><span className="amount">{money(row.withdrawn)}</span></td><td><span className="amount">{money(row.invested)}</span></td></tr>)}</tbody></table></div></section>}
    </>}
  </>
}
