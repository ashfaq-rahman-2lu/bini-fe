import { ArrowUpRight, ArrowRight, BookOpen, Check, CheckCircle2, ChevronLeft, ChevronRight, FileSpreadsheet, FileText, Layers3, LoaderCircle, Menu, Plus, Search, UnlockKeyhole, UploadCloud, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { NavLink, Navigate, Link, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table'
import { StatementUpload, UnlockPdf } from './PdfTools'
import { Investments, InvestmentUpload, InvestmentReview, InvestmentReconciliation } from './Investments'
import { CsvUpdate } from './CsvUpdater'
import { useAuth } from './Auth'
import { useQueuedOperation } from './operations'
import { ReconciliationRetry, useReconcile } from './Reconciliation'
import { api, ApiError, dateLabel, jsonRequest, money, type Account, type ImportReview, type Ledger, type ReviewRow, type Transaction, type TransactionDetail } from './api'

function ErrorBox({ error }: { error: unknown }) {
  return error ? <div role="alert" className="error-box">{error instanceof Error ? error.message : 'Something went wrong. Please try again.'}</div> : null
}
function Loading() { return <div className="loading"><LoaderCircle size={19} className="animate-spin" /> Loading your workspace…</div> }
function Badge({ kind, children }: { kind: string; children: ReactNode }) { return <span className={`badge badge-${kind}`}>{children}</span> }
function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return <div className="stat"><span>{label}</span><strong className={tone}>{value}</strong></div>
}

export default function App() {
  const { username, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  useEffect(() => { setMenuOpen(false) }, [location.key])
  return <div className="app-shell">
    <aside className="sidebar">
      <Link to="/investments" className="brand"><span className="brand-mark"><Layers3 size={23} /></span>bini<span className="brand-dot">.</span></Link>
      <button className="secondary-button mobile-menu-toggle" aria-label="Open navigation" aria-expanded={menuOpen} aria-controls="mobile-navigation" onClick={() => setMenuOpen(true)}><Menu size={19} /> Menu</button>
      <div className="workspace-label">PERSONAL WORKSPACE</div>
      <nav aria-label="Main navigation">
        <NavigationLinks />
      </nav>
      <div className="sidebar-bottom"><span className="small-dot" /> {username}<div>EBL statements · BDT</div><button className="secondary-button signout-button" onClick={signOut}>Sign out</button></div>
    </aside>
    {menuOpen && <MobileNavigation close={() => setMenuOpen(false)} />}
    <main className="main-area"><Routes>
      <Route path="/transactions" element={<Transactions />} />
      <Route path="/investments" element={<Investments />} />
      <Route path="/investments/reconciliation" element={<InvestmentReconciliation />} />
      <Route path="/csv-update" element={<CsvUpdate />} />
      <Route path="/investments/imports/new" element={<InvestmentUpload />} />
      <Route path="/investments/imports/:id" element={<InvestmentReview />} />
      <Route path="/imports" element={<Navigate to="/imports/new" replace />} />
      <Route path="/pdf-unlock" element={<UnlockPdf />} />
      <Route path="/imports/new" element={<StatementUpload />} />
      <Route path="/imports/:id" element={<Review />} />
      <Route path="*" element={<Navigate to="/investments" replace />} />
    </Routes></main>
  </div>
}

function NavigationLinks() {
  return <>
    <NavLink to="/investments"><Layers3 size={18} /> Investments</NavLink>
    <NavLink to="/transactions"><BookOpen size={18} /> Transactions</NavLink>
    <NavLink to="/csv-update"><FileSpreadsheet size={18} /> Update CSV</NavLink>
    <NavLink to="/pdf-unlock"><UnlockKeyhole size={18} /> Unlock PDF</NavLink>
    <NavLink to="/imports"><UploadCloud size={18} /> Import statement</NavLink>
  </>
}

function MobileNavigation({ close }: { close: () => void }) {
  const { signOut } = useAuth()
  const ref = useRef<HTMLDialogElement>(null)
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    const dialog = ref.current!
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const desktop = matchMedia('(min-width: 761px)')
    const resize = () => { if (desktop.matches) closeRef.current() }
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    desktop.addEventListener('change', resize)
    return () => { desktop.removeEventListener('change', resize); document.body.style.overflow = overflow; dialog.close(); opener?.focus() }
  }, [])
  return <dialog ref={ref} id="mobile-navigation" className="mobile-nav-dialog" aria-labelledby="mobile-navigation-title" onCancel={e => { e.preventDefault(); close() }} onClose={() => { if (!ref.current?.open) close() }} onClick={e => { if (e.target === e.currentTarget) close() }}>
    <div className="mobile-nav-heading"><h2 id="mobile-navigation-title">Navigation</h2><button className="secondary-button mobile-signout" onClick={signOut}>Sign out</button><button className="icon-button" aria-label="Close navigation" onClick={close}><X size={20} /></button></div>
    <nav aria-label="Mobile navigation" onClick={e => { if ((e.target as Element).closest('a')) close() }}><NavigationLinks /></nav>
  </dialog>
}

function Transactions() {
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(params.get('transaction'))
  useEffect(() => { setSelected(params.get('transaction')) }, [params.get('transaction')])
  const queryString = params.toString()
  const { data: ledger, error, isPending } = useQuery({ queryKey: ['transactions', queryString], queryFn: () => api<Ledger>('/transactions?' + queryString) })
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounts') })
  const [filterError, setFilterError] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  useEffect(() => { formRef.current?.reset() }, [queryString])
  const sort = params.get('sort') || 'date_desc'
  const sorting: SortingState = [{ id: sort.startsWith('amount') ? 'amount' : 'posting_date', desc: sort.endsWith('desc') }]
  const columns: ColumnDef<Transaction>[] = [
    { accessorKey: 'posting_date', header: 'Posting date', cell: ({ getValue }) => <span className="date-cell">{dateLabel(getValue<string>())}</span> },
    { accessorKey: 'description', header: 'Description', enableSorting: false, cell: ({ row }) => <button className="description-button" onClick={() => setSelected(row.original.id)}><span>{row.original.description}</span><small>{accounts.find(a => a.id === row.original.account_id)?.label || 'Bank account'}{row.original.reference ? ` · ${row.original.reference}` : ''}</small></button> },
    { id: 'amount', header: 'Amount · BDT', accessorKey: 'amount', enableSorting: false, cell: ({ row }) => <div className="ledger-amount"><span className={`amount ${row.original.direction === 'credit' ? 'credit' : ''}`}>{row.original.direction === 'credit' ? '+' : '−'}{money(row.original.amount)}</span><span className={`ledger-direction ${row.original.direction}`}>{row.original.direction === 'credit' ? 'Credit' : 'Debit'}</span></div> },
    { accessorKey: 'balance', header: 'Statement balance', enableSorting: false, cell: ({ getValue }) => <span className="amount muted">{money(getValue<string>())}</span> },
    { id: 'source', header: '', enableSorting: false, cell: ({ row }) => <button className="icon-button" aria-label="View transaction sources" onClick={() => setSelected(row.original.id)}><ArrowUpRight size={16} /></button> },
  ]
  const table = useReactTable({ data: ledger?.items || [], columns, getCoreRowModel: getCoreRowModel(), manualSorting: true, manualPagination: true, state: { sorting },
    onSortingChange: updater => {
      const next = typeof updater === 'function' ? updater(sorting) : updater
      const nextSort = next[0] || { id: 'posting_date', desc: true }
      const copy = new URLSearchParams(params)
      copy.set('sort', `${nextSort.id === 'amount' ? 'amount' : 'date'}_${nextSort.desc ? 'desc' : 'asc'}`)
      copy.set('page', '1'); setParams(copy)
    },
  })
  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const from = String(data.get('from_date') || ''), to = String(data.get('to_date') || '')
    if (from && to && from > to) { setFilterError('From date must not be after to date.'); return }
    setFilterError('')
    const next = new URLSearchParams()
    for (const [key, value] of data) if (String(value).trim()) next.set(key, String(value).trim())
    if (params.get('sort')) next.set('sort', params.get('sort')!)
    setParams(next)
  }
  function changePage(page: number) { const next = new URLSearchParams(params); next.set('page', String(page)); setParams(next) }
  function searchKeyword(keyword: string) {
    const next = new URLSearchParams(params)
    next.set('search', keyword); next.delete('page')
    setFilterError(''); setParams(next)
  }
  const activeFilters = [
    ['search', 'Description', params.get('search')],
    ['from_date', 'From', params.get('from_date')],
    ['to_date', 'To', params.get('to_date')],
    ['direction', 'Type', params.get('direction') === 'credit' ? 'Credit' : params.get('direction') === 'debit' ? 'Debit' : null],
    ['account_id', 'Account', accounts.find(a => a.id === params.get('account_id'))?.label || params.get('account_id')],
  ].filter(([, , value]) => value) as string[][]
  const filtered = activeFilters.length > 0
  function removeFilter(key?: string) {
    const next = new URLSearchParams(params)
    for (const name of key ? [key] : ['search', 'from_date', 'to_date', 'direction', 'account_id']) next.delete(name)
    next.delete('page'); setFilterError(''); setParams(next)
  }
  return <>
    <header className="page-header ledger-header"><div><div className="eyebrow">BANK LEDGER · BDT</div><h1>Transactions</h1><p>Search payments, check amounts and view statement sources.</p></div><Link className="primary-button" to="/imports/new"><Plus size={17} /> Import statement</Link></header>
    <section className="stats-grid ledger-stats" aria-label="Filtered totals">
      <Stat label="Transactions" value={ledger ? String(ledger.total) : '—'} />
      <Stat label="Total credits · BDT" value={ledger ? money(ledger.credit_total) : '—'} tone="credit" />
      <Stat label="Total debits · BDT" value={ledger ? money(ledger.debit_total) : '—'} />
      <Stat label="Net movement · BDT" value={ledger ? money(ledger.net) : '—'} />
    </section>
    <section className="panel ledger-panel">
      <div className="section-heading"><div className="ledger-heading"><h2>Transaction activity</h2><span className="movement-chip">{ledger ? `${ledger.total} results` : 'Loading…'}</span></div><div className="table-options"><span className="subtle">{filtered ? 'Filtered' : 'All transactions'}</span><select aria-label="Sort transactions" value={sort} onChange={e => { const next = new URLSearchParams(params); next.set('sort', e.target.value); next.set('page', '1'); setParams(next) }}><option value="date_desc">Newest first</option><option value="date_asc">Oldest first</option><option value="amount_desc">Largest amount</option><option value="amount_asc">Smallest amount</option></select></div></div>
      <form key={queryString} ref={formRef} onSubmit={applyFilters} className="filters ledger-filters">
        <div className="search-field ledger-search-field"><label htmlFor="ledger-description"><span>Description</span></label><div><Search size={16} /><input id="ledger-description" name="search" placeholder="Search descriptions…" defaultValue={params.get('search') || ''} /></div><div className="ledger-keywords" role="group" aria-label="Quick description filters">{[{ label: 'EFT inflow', keyword: 'eft inflow' }, { label: 'SKB', keyword: 'skb' }].map(({ label, keyword }) => <button key={keyword} type="button" className="keyword-chip" aria-pressed={(params.get('search') || '').trim().toLowerCase() === keyword} onClick={() => searchKeyword(keyword)}>{label}</button>)}</div></div>
        <label><span>From date</span><input type="date" name="from_date" defaultValue={params.get('from_date') || ''} /></label>
        <label><span>To date</span><input type="date" name="to_date" defaultValue={params.get('to_date') || ''} /></label>
        <label><span>Type</span><select aria-label="Type" name="direction" defaultValue={params.get('direction') || ''}><option value="">Debit & credit</option><option value="debit">Debit</option><option value="credit">Credit</option></select></label>
        <label><span>Account</span><select aria-label="Account" name="account_id" defaultValue={params.get('account_id') || ''}><option value="">All accounts</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label>
        <button className="secondary-button" type="submit">Apply filters</button>
      </form>
      {filtered && <div className="ledger-filter-chips" aria-label="Applied filters">{activeFilters.map(([key, label, value]) => <button className="movement-chip" key={key} aria-label={`Remove ${label.toLowerCase()} filter`} onClick={() => removeFilter(key)}><span>{label}: {value}</span><X size={12} aria-hidden="true" /></button>)}<button className="clear-filter" onClick={() => removeFilter()}>Clear filters</button></div>}
      {filterError && <ErrorBox error={new Error(filterError)} />}<ErrorBox error={error} />
      {isPending ? <Loading /> : ledger && ledger.items.length ? <>
        <p className="mobile-table-hint ledger-mobile-hint">Tap a description for balance and source details.</p>
        <div className="table-scroll ledger-table"><table><thead>{table.getHeaderGroups().map(group => <tr key={group.id}>{group.headers.map(header => <th key={header.id}>{header.column.getCanSort() ? <button className="sort-button" onClick={header.column.getToggleSortingHandler()}>{flexRender(header.column.columnDef.header, header.getContext())}<span>{header.column.getIsSorted() === 'asc' ? '↑' : '↓'}</span></button> : flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr>)}</thead>
          <tbody>{table.getRowModel().rows.map(row => <tr key={row.id}>{row.getVisibleCells().map(cell => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div>
        <div className="table-footer"><span>{(ledger.page - 1) * ledger.page_size + 1}–{Math.min(ledger.page * ledger.page_size, ledger.total)} of {ledger.total} transactions</span><div><button className="icon-button" aria-label="Previous page" disabled={ledger.page <= 1} onClick={() => changePage(ledger.page - 1)}><ChevronLeft size={17} /></button><span>Page {ledger.page}</span><button className="icon-button" aria-label="Next page" disabled={ledger.page * ledger.page_size >= ledger.total} onClick={() => changePage(ledger.page + 1)}><ChevronRight size={17} /></button></div></div>
      </> : ledger && <div className="empty-state"><div className="empty-icon"><BookOpen size={25} /></div><h3>{filtered ? 'No matching transactions' : 'Your ledger starts here'}</h3><p>{filtered ? 'Try a different description, date range, or account.' : 'Import your first EBL statement to review and organize its transactions.'}</p>{!filtered && <Link className="primary-button" to="/imports/new">Import your first statement <ArrowRight size={16} /></Link>}</div>}
    </section>
    <p className="footnote">Totals include all matching results, across every page. Balances are statement-provided values.</p>
    {selected && <Details id={selected} close={() => { setSelected(null); if (params.has('transaction')) { const next = new URLSearchParams(params); next.delete('transaction'); setParams(next, { replace: true }) } }} />}
  </>
}

function Details({ id, close }: { id: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null)
  const { data, error, isPending } = useQuery({ queryKey: ['transaction', id], queryFn: () => api<TransactionDetail>('/transactions/' + id) })
  useEffect(() => { ref.current?.showModal() }, [])
  return <dialog className="detail-dialog" ref={ref} onCancel={close} onClick={event => { if (event.target === event.currentTarget) close() }}>
    <div className="dialog-content"><div className="section-heading"><h2>Transaction details</h2><button aria-label="Close details" className="icon-button" onClick={close}><X size={20} /></button></div>
      <ErrorBox error={error} />{isPending ? <Loading /> : data && <>
        <Badge kind={data.direction}>{data.direction}</Badge><div className="detail-amount">BDT {money(data.amount)}</div><p>{dateLabel(data.posting_date)}</p><p className="full-description">{data.description}</p>
        <div className="detail-meta"><span>Statement-provided balance</span><strong>BDT {money(data.balance)}</strong></div>
        <label className="password-label"><span>Bank transaction ID (for manual investment matching)</span><input readOnly value={data.id} onFocus={event => event.currentTarget.select()} /></label>
        <h3>Source occurrences <span className="subtle">({data.sources.length})</span></h3>
        {data.sources.map(source => <details className="source-detail" key={source.statement_id + source.ordinal}><summary><FileText size={16} /><span>{source.filename}<small>Page {source.page} · Row {source.ordinal}</small></span></summary><pre>{source.raw_text}</pre><Link to={'/imports/' + source.statement_id} onClick={close}>View statement review <ArrowUpRight size={14} /></Link></details>)}
      </>}
    </div>
  </dialog>
}

function Review() {
  const { id } = useParams()
  const reconciliation = useReconcile()
  const [rowFilter, setRowFilter] = useState('all')
  const [selectedCandidate, setSelectedCandidate] = useState<string | null>(null)
  const navigate = useNavigate()
  const client = useQueryClient()
  const location = useLocation()
  useEffect(() => { if (location.state?.uploaded) navigate(location.pathname + location.search, { replace: true, state: null }) }, [id])
  const query = useQuery({ refetchOnMount: location.state?.uploaded ? false : 'always', queryKey: ['import', id], queryFn: () => api<ImportReview>('/imports/' + id) })
  const data = query.data
  const decision = useMutation({ mutationFn: ({ row, value }: { row: ReviewRow; value: string }) => api<ImportReview>('/imports/' + id + '/decisions', jsonRequest('PATCH', { decisions: [{ row_id: row.id, decision: value === 'auto' ? null : value === 'new' ? 'new' : 'match', transaction_id: ['auto', 'new'].includes(value) ? null : value }] })), onSuccess: result => client.setQueryData(['import', id], result) })
  const confirm = useQueuedOperation<ImportReview>({ kind: 'bank_confirm', target: id, parameters: () => ({ expected_revision: data!.revision }), onSuccess: result => {
    client.setQueryData(['import', id], result); client.invalidateQueries({ queryKey: ['transactions'] }); client.invalidateQueries({ queryKey: ['accounts'] }); client.invalidateQueries({ queryKey: ['transaction'] }); client.invalidateQueries({ queryKey: ['imports'] })
    if (result.reconciliation_job_id) reconciliation.resume(result.reconciliation_job_id)
    else reconciliation.mutate()
  }, onRecovered: () => { void query.refetch() }, onError: error => { if (error instanceof ApiError && error.status === 409) query.refetch() } })
  const cancel = useMutation({ mutationFn: () => api<void>('/imports/' + id, { method: 'DELETE' }), onSuccess: () => { client.removeQueries({ queryKey: ['import', id] }); client.invalidateQueries({ queryKey: ['imports'] }); navigate('/imports/new') } })
  const busy = decision.isPending || confirm.isPending || cancel.isPending
  if (query.isPending) return <Loading />
  if (!data) return <><ErrorBox error={query.error} /><Link to="/imports/new">Return to upload</Link></>
  const valid = data.checks.every(c => c.passed)
  const passedChecks = data.checks.filter(c => c.passed).length
  const visibleRows = data.rows.filter(row => rowFilter === 'all' || row.effective === rowFilter)
  return <div className="statement-review">
    <header className="page-header"><div><div className="eyebrow">{data.status === 'confirmed' ? 'IMPORT COMPLETE' : 'CHECK BEFORE YOU SAVE'}</div><h1>{data.status === 'confirmed' ? 'Statement imported' : 'Review your statement'}</h1><p>{data.filename} · {dateLabel(data.period_from)} – {dateLabel(data.period_to)}</p></div><Badge kind={data.status === 'confirmed' || valid ? 'success' : 'error'}>{data.status === 'confirmed' ? 'Confirmed' : valid ? 'Reconciled' : 'Needs attention'}</Badge></header>
    <Link className="review-back" to="/imports/new">← Back to statement uploads</Link>
    {data.status === 'draft' && <div className="statement-review-actions" aria-label="Import actions">
      <div className="statement-readiness" role="status"><strong>{!valid ? 'Financial checks need attention' : data.summary.unresolved ? `${data.summary.unresolved} duplicate ${data.summary.unresolved === 1 ? 'decision' : 'decisions'} to review` : 'Ready to import'}</strong><span>{!valid ? 'Resolve the failed checks before importing.' : data.summary.unresolved ? 'Choose whether to link or keep the flagged transactions.' : `${data.summary.new} new transactions · ${data.summary.duplicate} existing transactions to link`}</span></div>
      <div className="statement-action-buttons"><button className="secondary-button" disabled={busy} onClick={() => cancel.mutate()}>Cancel import</button><button className="primary-button" disabled={busy || !data.can_confirm} onClick={() => confirm.mutate()}>{confirm.isPending ? <LoaderCircle size={17} className="animate-spin" /> : <Check size={17} />} Confirm import</button></div>
    </div>}
    {confirm.isPending && <p className="loading" role="status">Saving your import… You can refresh this page; progress is saved.</p>}
    <ErrorBox error={decision.error || confirm.error || cancel.error} />
    <ReconciliationRetry error={reconciliation.error} retry={() => reconciliation.mutate()} busy={reconciliation.isPending} />
    {data.status === 'confirmed' && <div className="success-banner"><CheckCircle2 size={21} /><div><strong>Your ledger is up to date.</strong><span>{data.summary.new} new transactions added · {data.summary.duplicate} existing transactions linked</span></div><Link className="secondary-button" to="/transactions">View transactions <ArrowRight size={16} /></Link></div>}
    <section className="stats-grid"><Stat label="Statement rows" value={String(data.rows.length)} /><Stat label="New transactions" value={String(data.summary.new)} tone="credit" /><Stat label="Matched duplicates" value={String(data.summary.duplicate)} /><Stat label="Needs a decision" value={String(data.summary.unresolved)} /></section>
    <section className="panel checks-panel"><div className="section-heading"><h2>Financial checks</h2><Badge kind={valid ? 'success' : 'error'}>{passedChecks}/{data.checks.length} passed</Badge></div><div className="balance-strip"><span className="statement-account">{data.account.label} · BDT</span><span>Opening <strong>{money(data.opening_balance)}</strong></span><ArrowRight size={14} /><span>Closing <strong>{money(data.closing_balance)}</strong></span></div><details className="statement-check-details" open={!valid}><summary>{valid ? 'View detailed checks' : 'Review failed checks'}</summary><div className="checks-grid">{[...data.checks].sort((a, b) => Number(a.passed) - Number(b.passed)).map(check => <div key={check.code} className={check.passed ? 'check-pass' : 'check-fail'}><span>{check.passed ? <CheckCircle2 size={15} /> : <X size={15} />}{check.label}</span><small>{check.detail}</small></div>)}</div></details>{!valid && <div className="error-box">This statement cannot be confirmed. Review the extracted source text; the parser must be corrected before retrying.</div>}</section>
    <section className="panel"><div className="section-heading"><h2>Extracted transactions</h2><span className="subtle">{visibleRows.length} of {data.rows.length} rows</span></div><div className="statement-row-filters" role="group" aria-label="Transaction review filters">{[{ value: 'all', label: 'All', count: data.rows.length }, { value: 'unresolved', label: 'Needs decision', count: data.summary.unresolved }, { value: 'new', label: 'New', count: data.summary.new }, { value: 'match', label: 'Duplicates', count: data.summary.duplicate }].map(filter => <button className="keyword-chip" key={filter.value} aria-pressed={rowFilter === filter.value} onClick={() => setRowFilter(filter.value)}>{filter.label} <strong>{filter.count}</strong></button>)}</div>{!visibleRows.length && <p className="statement-empty">No transactions in this category.</p>}<div className="review-rows">{visibleRows.map(row => <div className="review-row" key={row.id}>
      <div className="review-row-main"><span className="row-number">{String(row.ordinal).padStart(2, '0')}</span><div className="review-description"><div><span className="date-cell">{dateLabel(row.posting_date)}</span><Badge kind={row.effective}>{row.effective === 'match' ? 'Duplicate' : row.effective === 'new' ? 'New' : 'Review needed'}</Badge></div><p>{row.description}</p><small>{row.explanation}</small></div><div className={`amount ${row.direction === 'credit' ? 'credit' : ''}`}>{row.direction === 'credit' ? '+' : '−'} {money(row.amount)}<small>Balance {money(row.balance)}</small></div></div>
      <div className="review-row-tools"><details><summary>Source text · Page {row.page}</summary><pre>{row.raw_text}</pre></details>{data.status === 'draft' && row.candidates.length > 0 && <label className="decision-label"><span>Duplicate decision</span><select aria-label={`Decision for row ${row.ordinal}`} disabled={busy} value={row.decision === 'new' ? 'new' : row.decision === 'match' ? row.target_id || 'auto' : 'auto'} onChange={e => decision.mutate({ row, value: e.target.value })}><option value="auto">{row.proposal === 'duplicate' ? 'Use exact match' : 'Choose a decision…'}</option><option value="new">Keep as a separate transaction</option>{row.candidates.map(candidate => <option value={candidate.id} key={candidate.id}>Link: {candidate.description.slice(0, 52)} · balance {money(candidate.balance)} · {candidate.id.slice(0, 8)}</option>)}</select></label>}</div>
      {data.status === 'draft' && row.proposal === 'ambiguous' && <details className="candidate-comparison"><summary>Compare existing transaction candidates ({row.candidates.length})</summary>{row.candidates.map(candidate => <div key={candidate.id} className="candidate-card"><p>{candidate.description}</p><small>{dateLabel(candidate.posting_date)} · {candidate.direction} {money(candidate.amount)} · balance {money(candidate.balance)}<br />Reference: {candidate.reference || 'Not provided'} · ID {candidate.id.slice(0, 8)}</small><button className="secondary-button" onClick={() => setSelectedCandidate(candidate.id)}>Inspect existing source <ArrowUpRight size={14} /></button></div>)}</details>}
    </div>)}</div></section>
    {selectedCandidate && <Details id={selectedCandidate} close={() => setSelectedCandidate(null)} />}
  </div>
}
