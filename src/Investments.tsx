import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, ArrowUpRight, ChevronDown, GitBranch, Plus, RefreshCw, SlidersHorizontal, Table2, X } from 'lucide-react'
import { api, dateLabel, jsonRequest, money, type Account, type TransactionDetail } from './api'
import { cents, decimal, kindLabel, remaining, sumMoney, type BankCandidate, type InvestmentDraft, type InvestmentEvent, type InvestmentImportSummary, type InvestmentProject, type InvestmentWorkspace } from './investmentApi'
import { DifferenceChip, ReconciliationPanel, ReconciliationRetry, trailQuery, useReconcile } from './Reconciliation'
import { useQueuedOperation } from './operations'
import { ProjectFlow } from './ProjectFlow'

function ErrorBox({ error }: { error: unknown }) { return error ? <p role="alert" className="error-box">{error instanceof Error ? error.message : 'Unable to complete this action.'}</p> : null }
function Stat({ label, value }: { label: string; value: string }) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div> }
function Amount({ value }: { value: string | null }) { return <>{value === null ? 'Not classified' : money(value)}</> }
function useRefresh() {
  const client = useQueryClient()
  return async () => { await Promise.all([client.invalidateQueries({ queryKey: ['investments'] }), client.invalidateQueries({ queryKey: ['investment-imports'] }), client.invalidateQueries({ queryKey: ['investment-review'] }), client.invalidateQueries({ queryKey: ['investment-bank'] })]) }
}

export function Investments() {
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { data, error, isPending, refetch } = useQuery({ queryKey: ['investments'], staleTime: 30_000, queryFn: ({ signal }) => api<InvestmentWorkspace>('/investments', { signal }) })
  const projectId = params.get('project') || '', kind = params.get('kind') || '', search = params.get('search') || ''
  const project = data?.projects.find(p => p.id === projectId)
  const showFlow = Boolean(project) && params.get('view') !== 'activity'
  const trail = useQuery(trailQuery(projectId))
  const related = new Set(trail.data?.events.map(e => e.id))
  const events = data?.events.filter(e => (!projectId || related.has(e.id) || e.project_id === projectId) && (!kind || e.kind === kind) && (!search || e.description.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && (!params.get('from') || e.posting_date >= params.get('from')!) && (!params.get('to') || e.posting_date <= params.get('to')!)).slice().reverse() || []
  const page = Math.max(1, Number(params.get('page') || 1) || 1), pages = Math.max(1, Math.ceil(events.length / 50)), currentPage = Math.min(page, pages)
  return <>
    <header className="page-header investment-header"><div><div className="eyebrow">INVESTMENT TRACKER · BDT</div><h1>Investments</h1><p>Follow capital, installments and where your returned money goes.</p></div><div className="reconciliation-actions"><Link to={{ pathname: '/investments/reconciliation', search: params.toString() }} className="secondary-button">Money reconciliation <ArrowUpRight size={16} /></Link><Link to="/investments/imports/new" className="primary-button"><Plus size={16} /> Import investment CSV</Link></div></header>
    <ErrorBox error={error} />
    {isPending && <p className="loading">Loading investments…</p>}
    {data && <>
      <details className="panel investment-summary">
        <summary><span>Investment summary</span><ChevronDown size={18} aria-hidden="true" /></summary>
        <div className="investment-summary-content">
      <section className="stats-grid" aria-label="Investment totals">
        <Stat label="External funding · BDT" value={money(sumMoney(data.projects.map(p => p.external_funding)))} />
        <Stat label="Total invested including reinvestments" value={money(sumMoney(data.projects.map(p => p.invested)))} />
        <Stat label="Installments and capital refunds" value={money(sumMoney(data.projects.map(p => p.returned)))} />
        <Stat label="Bank payouts recorded by provider" value={money(sumMoney(data.events.filter(e => e.kind === 'cashout').map(e => e.amount)))} />
      </section>
      <section className="stats-grid" aria-label="Investment profit and reconciliation">
        <Stat label="Classified installment profit · BDT" value={money(sumMoney(data.projects.map(p => p.classified_profit)))} />
        <Stat label="Final gain / loss · closed projects" value={data.projects.some(p => p.status === 'closed') ? money(sumMoney(data.projects.filter(p => p.status === 'closed').map(p => p.final_gain!))) : 'Not finalized'} />
        <Stat label="Repayments without capital / profit split" value={money(sumMoney(data.projects.map(p => p.unclassified_returns)))} />
        <Stat label="Payout amounts matched in bank ledger" value={money(sumMoney(data.bank_links.filter(l => data.events.find(e => e.id === l.event_id)?.kind === 'cashout').map(l => l.amount)))} />
      </section>
      <div className="investment-wallets">{data.institutions.filter(i => i.wallet_balance !== null).map(i => <p key={i.id}><strong>{i.name} wallet: {money(i.wallet_balance!)} BDT</strong><span>As reported on {dateLabel(i.wallet_as_of!)} · latest confirmed report</span></p>)}</div>
      <p className="footnote">Repayments include capital and profit. Classify each installment to measure profit and outstanding principal, or close a completed project to calculate its final gain/loss. Bank payouts require matching to your bank ledger. Tracing shows your recorded allocations; the CSV does not identify which project funded each withdrawal.</p>
      {project && <ProjectDetails key={project.id + project.status + project.expected_total} project={project} />}
        </div>
      </details>
      {!data.projects.length && <section className="panel empty-state"><h2>Start tracking your projects</h2><p>Import your institution’s CSV, review the source warnings, then confirm.</p><Link to="/investments/imports/new" className="primary-button">Import investment CSV</Link></section>}
      <section className="panel investment-activity">
        <div className="investment-filter-bar">
          <label><span className="sr-only">Project</span><select name="project" value={projectId} onChange={e => { const next = new URLSearchParams(params); e.target.value ? next.set('project', e.target.value) : next.delete('project'); next.delete('page'); setParams(next) }}><option value="">All projects and wallet</option>{data.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <button className="secondary-button" onClick={() => setFiltersOpen(true)}><SlidersHorizontal size={15} /> Filters{['kind', 'search', 'from', 'to'].filter(k => params.get(k)).length > 0 && <span className="filter-count">{['kind', 'search', 'from', 'to'].filter(k => params.get(k)).length}</span>}</button>
          <button className="secondary-button" aria-label="Refresh investments" title="Refresh investments" onClick={() => { void refetch(); if (projectId) void trail.refetch() }}><RefreshCw size={15} /></button>
          {project && <ProjectCompletion key={project.id + project.status} project={project} />}
        </div>
        {filtersOpen && <InvestmentFilters key={params.toString()} params={params} apply={next => { setParams(next); setFiltersOpen(false) }} close={() => setFiltersOpen(false)} />}
        <ErrorBox error={trail.error} />
        {project && <div className="investment-view-switch" role="group" aria-label="Investment view"><button className={showFlow ? 'selected' : ''} aria-pressed={showFlow} onClick={() => { const next = new URLSearchParams(params); next.delete('view'); next.delete('page'); setParams(next) }}><GitBranch size={16} /> Money flow</button><button className={!showFlow ? 'selected' : ''} aria-pressed={!showFlow} onClick={() => { const next = new URLSearchParams(params); next.set('view', 'activity'); next.delete('page'); setParams(next) }}><Table2 size={16} /> Activity table</button><span>{events.length} movements · BDT</span></div>}
        {!project && <p className="flow-select-hint"><GitBranch size={18} /> {events.length} movements · BDT</p>}
        {showFlow ? trail.data ? <ProjectFlow key={`flow:${params.toString()}`} trail={trail.data} project={project!} openEvent={setSelected} filters={params} /> : !trail.error && <p className="loading">Loading money flow…</p> : <>
        <p className="mobile-table-hint">Swipe the table to see amounts, money traces and bank matches.</p>
        <div className="table-scroll"><table><thead><tr><th>Date</th><th>Project / movement</th><th>Amount</th><th>Profit split / money trace</th><th>Bank match</th></tr></thead><tbody>{events.slice((currentPage - 1) * 50, currentPage * 50).map(e => <tr key={e.id}>
          <td className="date-cell">{dateLabel(e.posting_date)}</td><td><button className="description-button" onClick={() => setSelected(e.id)}><span>{data.projects.find(p => p.id === e.project_id)?.name || 'Institution wallet'}</span><small>{kindLabel(e.kind)} <ArrowUpRight size={11} /></small></button></td>
          <td><span className="amount">{money(e.amount)}</span>{e.difference && <DifferenceChip amount={e.difference.amount} />}</td><td className="subtle">{e.kind === 'repayment' ? e.principal === null ? 'Capital / profit not classified' : `Profit ${money(e.profit!)}` : ''}<br />{['repayment', 'refund'].includes(e.kind) ? `${money(remaining(e.amount, e.allocated_out))} untraced` : ['reinvestment', 'cashout'].includes(e.kind) ? `${money(e.allocated_in)} traced to source returns` : e.kind === 'reinvestment_settlement' ? 'Wallet settlement; counted with reinvestment' : 'External funding'}{trail.data?.events.find(t => t.id === e.id)?.wallet && (() => { const wallet = trail.data.events.find(t => t.id === e.id)!.wallet!; return <small className="wallet-credit">Available: {wallet.available === null ? 'Needs review' : money(wallet.available)} · Reserved: {money(wallet.reserved)} · Consumed: {money(wallet.consumed)}</small> })()}</td>
          <td className="subtle">{['investment', 'cashout'].includes(e.kind) ? `${money(e.bank_linked)} / ${money(e.amount)}` : 'Internal movement'}</td>
        </tr>)}</tbody></table></div>
        <div className="table-footer"><span>Page {currentPage} of {pages}</span><div><button className="secondary-button" disabled={currentPage <= 1} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(currentPage - 1)); setParams(next) }}>Previous</button><button className="secondary-button" disabled={currentPage >= pages} onClick={() => { const next = new URLSearchParams(params); next.set('page', String(currentPage + 1)); setParams(next) }}>Next</button></div></div>
        </>}
      </section>
      {selected && data.events.some(e => e.id === selected) && <EventDetails key={selected} data={data} event={data.events.find(e => e.id === selected)!} close={() => setSelected(null)} select={setSelected} />}
    </>}
  </>
}

function InvestmentFilters({ params, apply, close }: { params: URLSearchParams; apply: (next: URLSearchParams) => void; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [error, setError] = useState<unknown>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  const keys = ['kind', 'search', 'from', 'to']
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fields = new FormData(e.currentTarget)
    if (String(fields.get('from') || '') > String(fields.get('to') || '9999')) { setError(new Error('From date must not be after to date.')); return }
    const next = new URLSearchParams(params)
    keys.forEach(key => { const value = String(fields.get(key) || '').trim(); value ? next.set(key, value) : next.delete(key) })
    next.delete('page'); apply(next)
  }
  return <dialog ref={dialog} className="investment-filter-dialog" aria-labelledby="investment-filter-title" onClose={close}>
    <div className="filter-dialog-header"><h2 id="investment-filter-title">Investment filters</h2><button className="icon-button" aria-label="Close filters" onClick={close}><X size={18} /></button></div>
    <form onSubmit={submit}>
      <label><span>Movement</span><select name="kind" defaultValue={params.get('kind') || ''}><option value="">All movements</option>{['investment', 'reinvestment', 'repayment', 'refund', 'cashout', 'reinvestment_settlement'].map(k => <option key={k} value={k}>{kindLabel(k)}</option>)}</select></label>
      <label><span>Description</span><input name="search" defaultValue={params.get('search') || ''} /></label>
      <div className="filter-date-range"><label><span>From</span><input type="date" name="from" defaultValue={params.get('from') || ''} /></label><label><span>To</span><input type="date" name="to" defaultValue={params.get('to') || ''} /></label></div>
      <ErrorBox error={error} />
      <div className="filter-dialog-actions"><button type="button" className="flow-text-button" onClick={() => { const next = new URLSearchParams(params); keys.forEach(k => next.delete(k)); next.delete('page'); apply(next) }}>Clear filters</button><button type="button" className="secondary-button" onClick={close}>Cancel</button><button className="primary-button">Apply filters</button></div>
    </form>
  </dialog>
}

export function InvestmentReconciliation() {
  const [params] = useSearchParams()
  const [selected, setSelected] = useState<string | null>(null)
  const { data, error, isPending } = useQuery({ queryKey: ['investments'], staleTime: 30_000, queryFn: ({ signal }) => api<InvestmentWorkspace>('/investments', { signal }) })
  const event = data?.events.find(e => e.id === selected)
  return <>
    <header className="page-header"><div><div className="eyebrow">INVESTMENT TRACKER · BDT</div><h1>Money reconciliation</h1><p>Confirm where the money came from and where it went.</p></div></header>
    <Link className="review-back" to={{ pathname: '/investments', search: params.toString() }}><ArrowLeft size={12} /> Back to investments</Link>
    <ErrorBox error={error} />
    {isPending && <p className="loading">Loading reconciliation…</p>}
    {data && <div className="panel"><ReconciliationPanel data={data} openEvent={setSelected} /></div>}
    {data && event && <EventDetails key={event.id} data={data} event={event} close={() => setSelected(null)} select={setSelected} />}
  </>
}

function ProjectCompletion({ project }: { project: InvestmentProject }) {
  const refresh = useRefresh(), [confirming, setConfirming] = useState(false)
  const mutation = useMutation({ mutationFn: () => api(`/investments/projects/${project.id}`, jsonRequest('PATCH', {
    status: project.status === 'closed' ? 'active' : 'closed', expected_total: project.expected_total,
    complete_history: true, confirm_wallet_empty: project.status !== 'closed',
  })), onSuccess: refresh })
  return <div className="project-completion">
    {!confirming ? <button className="secondary-button completion-button" onClick={() => setConfirming(true)}>{project.status === 'closed' ? 'Reopen investment' : 'Mark completed'}</button> : <form onSubmit={e => { e.preventDefault(); mutation.mutate() }}>
      <label className="completion-confirm"><input type="checkbox" required />{project.status === 'closed' ? 'Reopen to record more activity.' : 'All history is imported, repayments are final, and none of this investment’s money remains in the wallet.'}</label>
      <div className="completion-actions">
        <button className="secondary-button" disabled={mutation.isPending}>{project.status === 'closed' ? 'Confirm reopen' : 'Confirm completion'}</button>
        <button type="button" className="secondary-button" onClick={() => setConfirming(false)}>Cancel</button>
      </div>
    </form>}
    <ErrorBox error={mutation.error} />
  </div>
}

function ProjectDetails({ project: p }: { project: InvestmentProject }) {
  const refresh = useRefresh()
  const [status, setStatus] = useState(p.status)
  const mutation = useMutation({ mutationFn: (body: unknown) => api(`/investments/projects/${p.id}`, jsonRequest('PATCH', body)), onSuccess: refresh })
  return <section className="panel project-detail">
    <div className="section-heading"><h2>{p.name}</h2><span className="badge badge-new">{p.status}</span></div>
    <dl className="investment-metrics"><div><dt>Principal returned (classified + refunds)</dt><dd>{money(p.principal_returned)}</dd></div><div><dt>Principal outstanding</dt><dd><Amount value={p.principal_outstanding} /></dd></div><div><dt>Returns less investments</dt><dd>{money(p.net_recovery)}</dd></div><div><dt>Final ROI (closed projects only)</dt><dd>{p.roi_percent === null ? 'Pending completion' : `${p.roi_percent}%`}</dd></div><div><dt>{p.has_settlement_difference ? 'Credits committed to payouts (before differences)' : 'Traced to bank payouts'}</dt><dd>{money(p.traced_to_bank_payout)}</dd></div><div><dt>{p.has_settlement_difference ? 'Credits committed to reinvestments (before differences)' : 'Traced to reinvestments'}</dt><dd>{money(p.traced_to_reinvestment)}</dd></div><div><dt>Returns without a destination</dt><dd>{money(p.untraced_returns)}</dd></div><div><dt>Expected repayments remaining</dt><dd>{p.expected_remaining === null ? 'No target entered' : money(p.expected_remaining)}</dd></div></dl>
    <p className="footnote">A negative “returns less investments” is unrecovered cash, not a loss estimate while a project is active. Close only when all capital and final payments are settled; final gain/loss then equals all repayments/refunds less all investments. {p.status === 'closed' && <>Closed projects have no outstanding claim. {p.capital_written_off === null ? 'Classify returns to identify capital written off.' : `Capital written off: ${money(p.capital_written_off)} BDT.`}</>}</p>
    <form className="investment-form" onSubmit={e => { e.preventDefault(); const values = new FormData(e.currentTarget); mutation.mutate({ status, expected_total: values.get('expected') || null, complete_history: values.get('complete') === 'on' }) }}>
      <label><span>Project status</span><select name="status" value={status} onChange={event => setStatus(event.target.value as 'active' | 'closed')}><option value="active">Active</option><option value="closed">Closed — all payments final</option></select></label>
      <label><span>Expected total repayments · BDT (optional)</span><input name="expected" inputMode="decimal" defaultValue={p.expected_total || ''} /></label><button className="secondary-button" disabled={mutation.isPending}>Save project</button>
      {status === 'closed' && <label className="acknowledge wide"><input name="complete" type="checkbox" required /> All investment history is imported and all payments for this project are final.</label>}
    </form><ErrorBox error={mutation.error} />
  </section>
}

export function InvestmentUpload() {
  const navigate = useNavigate(), refresh = useRefresh(), client = useQueryClient()
  const controller = useRef(new AbortController())
  useEffect(() => { controller.current = new AbortController(); return () => controller.current.abort() }, [])
  const [mode, setMode] = useState<'extend' | 'replace'>('extend')
  const { data: imports = [], error } = useQuery({ queryKey: ['investment-imports'], queryFn: () => api<InvestmentImportSummary[]>('/investments/imports') })
  const upload = useMutation({ mutationFn: (form: FormData) => api<InvestmentDraft>('/investments/imports', { method: 'POST', body: form, signal: controller.current.signal }), onSuccess: async draft => { if (controller.current.signal.aborted) return; await refresh(); if (controller.current.signal.aborted) return; client.setQueryData(['investment-review', draft.id], draft); navigate(`/investments/imports/${draft.id}`, { state: { uploaded: true } }) } })
  return <>
    <header className="page-header"><div><div className="eyebrow">INVESTMENT IMPORT</div><h1>Import investment CSV</h1><p>Preview the institution’s report before adding it to your investment ledger.</p></div><Link to="/csv-update" className="secondary-button">Update a fixed CSV</Link></header>
    <Link className="review-back" to="/investments"><ArrowLeft size={12} /> Investments</Link>
    <form className="panel upload-panel investment-upload" onSubmit={e => { e.preventDefault(); upload.mutate(new FormData(e.currentTarget)) }}>
      <label className="password-label"><span>Institution name</span><input name="institution" defaultValue="Biniyog" required maxLength={120} /></label>
      <label className="password-label"><span>Import mode</span><select className="wide" name="mode" value={mode} disabled={upload.isPending} onChange={event => setMode(event.target.value as 'extend' | 'replace')}><option value="extend">Extend existing data</option><option value="replace">Replace existing data</option></select></label>
      <p className="footnote">{mode === 'extend' ? 'Keep existing investments, saved splits, money traces and bank matches. Add new movements and link matching source occurrences.' : 'Replace all investment data for the named institution with this CSV. Missing movements and projects are removed; project settings, profit splits, money traces and bank matches are reset. Use a CSV with the complete history you want to keep. Bank transactions remain unchanged.'}</p>
      <label className="password-label"><span>Investment CSV</span><input type="file" name="file" accept=".csv,text/csv" required /></label>
      <p className="footnote">UTF-8 BDT export · 2 MB / 10,000 rows. Overlapping reports retain source references. Campaign numbers remain part of project identity.</p>
      <button className="primary-button" disabled={upload.isPending}>{upload.isPending ? 'Reading CSV…' : 'Preview investment import'}</button><ErrorBox error={upload.error} />
    </form>
    <section className="panel recent-imports"><div className="section-heading"><h2>Investment imports</h2></div><ErrorBox error={error} />{imports.map(i => <Link className="recent-import" key={i.id} to={`/investments/imports/${i.id}`}><span><strong>{i.filename}</strong><small>{i.institution} · {i.mode === 'replace' ? 'Replace' : 'Extend'} · {new Date(i.created_at).toLocaleDateString()}</small></span><span className="badge badge-new">{i.status}</span></Link>)}{!imports.length && <p className="recent-empty">No investment reports imported yet.</p>}</section>
  </>
}

export function InvestmentReview() {
  const { id } = useParams(), location = useLocation(), navigate = useNavigate(), refresh = useRefresh(), client = useQueryClient()
  const reconciliation = useReconcile()
  const [acknowledged, setAcknowledged] = useState(false)
  const [replaceAcknowledged, setReplaceAcknowledged] = useState(false)
  const [rowFilter, setRowFilter] = useState('all')
  useEffect(() => { if (location.state?.uploaded) navigate(location.pathname + location.search, { replace: true, state: null }) }, [id])
  const { data, error, refetch, isFetching, isPending } = useQuery({ queryKey: ['investment-review', id], refetchOnMount: location.state?.uploaded ? false : 'always', queryFn: () => api<InvestmentDraft>(`/investments/imports/${id}`) })
  useEffect(() => { setAcknowledged(false); setReplaceAcknowledged(false) }, [id, data?.revision, data?.mode])
  useEffect(() => { setRowFilter('all') }, [id])
  const confirm = useQueuedOperation<InvestmentDraft>({ kind: 'investment_confirm', target: id,
    parameters: () => ({ expected_revision: data!.revision, acknowledge_warnings: acknowledged, acknowledge_replace: replaceAcknowledged }),
    onSuccess: result => {
      client.setQueryData(['investment-review', id], result)
      client.invalidateQueries({ queryKey: ['investment-imports'] })
      // Defer workspace reads until reconciliation has saved its changes.
      client.invalidateQueries({ queryKey: ['investments'], refetchType: 'none' })
      if (result.reconciliation_job_id) reconciliation.resume(result.reconciliation_job_id)
      else reconciliation.mutate()
    },
    onRecovered: () => { void refetch() },
    onError: () => { void refetch() },
  })
  const cancel = useMutation({ mutationFn: () => api(`/investments/imports/${id}`, { method: 'DELETE' }), onSuccess: async () => { await refresh(); navigate('/investments/imports/new') } })
  const busy = confirm.isPending || cancel.isPending || isFetching
  const visibleRows = data?.rows.filter(row => rowFilter === 'all' || (rowFilter === 'existing' ? Boolean(row.existing_id) : !row.existing_id)) || []
  return <div className="statement-review investment-import-review">
    <header className="page-header"><div><div className="eyebrow">INVESTMENT REVIEW</div><h1>{data?.status === 'confirmed' ? 'Investment report imported' : 'Review investment report'}</h1><p>{data?.filename} · {data?.institution} · {data?.mode === 'replace' ? 'Replace existing data' : 'Extend existing data'}</p></div>{data && <span className={`badge ${data.status === 'confirmed' ? 'badge-success' : data.mode === 'replace' ? 'badge-error' : 'badge-match'}`}>{data.status === 'confirmed' ? 'Imported' : data.mode === 'replace' ? 'Replace' : 'Extend'}</span>}</header>
    <Link className="review-back" to="/investments/imports/new">Back to investment imports</Link>
    {confirm.isPending && <p className="loading" role="status">Saving your import… You can refresh this page; progress is saved.</p>}
    <ErrorBox error={error || confirm.error || cancel.error} />
    <ReconciliationRetry error={reconciliation.error} retry={() => reconciliation.mutate()} busy={reconciliation.isPending} />
    {isPending && <p className="loading">Loading investment preview…</p>}
    {data && <>
      <div className="statement-review-actions investment-import-actions" aria-label="Investment import actions">
        <div className="statement-readiness" role="status"><strong>{data.status === 'confirmed' ? 'Investment report saved' : !acknowledged ? 'Review the source warnings' : data.mode === 'replace' && !replaceAcknowledged ? 'Confirm the replacement impact below' : 'Ready to import'}</strong><span>{data.status === 'confirmed' ? 'Open investments to review your balances and money trails.' : `${data.new_count} new ${data.new_count === 1 ? 'movement' : 'movements'} · ${data.linked_count} existing ${data.linked_count === 1 ? 'movement' : 'movements'} to link`}</span></div>
        <div className="statement-action-buttons">{data.status === 'draft' ? <>
          <button className="secondary-button" aria-label="Cancel investment import" disabled={busy} onClick={() => cancel.mutate()}>Cancel import</button>
          <button className="secondary-button" disabled={busy} onClick={() => { setAcknowledged(false); setReplaceAcknowledged(false); void refetch() }}>{isFetching ? 'Refreshing…' : 'Refresh preview'}</button>
          <button className="primary-button" aria-label="Confirm investment import" disabled={!acknowledged || data.mode === 'replace' && !replaceAcknowledged || busy} onClick={() => confirm.mutate()}>{confirm.isPending ? 'Importing…' : 'Confirm import'}</button>
        </> : <Link className="primary-button" to="/investments">View investments</Link>}</div>
        {data.status === 'draft' && <label className="acknowledge import-acknowledgment"><input type="checkbox" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} /> I reviewed the warnings and the extracted movements.</label>}
      </div>
      <section className="stats-grid"><Stat label="Source rows" value={String(data.rows.length)} /><Stat label="New movements" value={String(data.new_count)} /><Stat label="Existing movements" value={String(data.linked_count)} /><Stat label="Closing provider wallet · BDT" value={money(data.closing_wallet)} /></section>
      {data.replacement && <section className="panel investment-replacement" aria-label="Replacement preview"><h2>Replace all investment data for {data.institution}</h2><p className="footnote">Confirming removes {data.replacement.events} existing movements, {data.replacement.projects} projects and {data.replacement.imports} other import reports/previews for this institution. The replacement contains only the movements in this CSV.</p><p className="footnote">This resets {data.replacement.principal_splits} saved principal/profit splits, {data.replacement.allocations} money traces and {data.replacement.bank_links} bank matches, plus project statuses and expected repayment targets. Bank transactions and other institutions are unchanged.</p><p className="footnote">Replacement also clears {data.replacement.reconciliation_cases} reconciliation cases and {data.replacement.reinvestment_associations} settlement associations for this institution.</p>{data.status === 'draft' && <label className="acknowledge"><input type="checkbox" checked={replaceAcknowledged} disabled={busy} onChange={event => setReplaceAcknowledged(event.target.checked)} /> I understand this replaces all investment data for {data.institution} and resets its saved settings and links.</label>}</section>}
      <section className="panel investment-source-checks"><div className="section-heading"><h2>Source checks and interpretation</h2><span className="badge badge-unresolved">{data.warnings.length} {data.warnings.length === 1 ? 'note' : 'notes'}</span></div>
        {data.warnings.length > 0 ? <ul className="investment-warnings">{data.warnings.map(w => <li key={w}>{w}</li>)}</ul> : <p className="footnote">No source warnings.</p>}
        <details className="investment-provider-summary"><summary>Provider summary (original labels; not calculated principal)</summary><dl className="investment-metrics">{Object.entries(data.summary).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{money(value)}</dd></div>)}</dl></details>
      </section>
      <section className="panel investment-activity investment-source-rows"><div className="section-heading"><h2>Extracted source movements</h2><span className="subtle">{visibleRows.length} of {data.rows.length} rows</span></div>
        <div className="statement-row-filters" role="group" aria-label="Source movement filters">{[{ value: 'all', label: 'All', count: data.rows.length }, { value: 'new', label: 'New', count: data.new_count }, { value: 'existing', label: 'Existing', count: data.linked_count }].map(filter => <button className="keyword-chip" key={filter.value} aria-pressed={rowFilter === filter.value} onClick={() => setRowFilter(filter.value)}>{filter.label} <strong>{filter.count}</strong></button>)}</div>
        {!visibleRows.length && <p className="statement-empty">No source movements in this category.</p>}
        <div className="table-scroll"><table><thead><tr><th>Row</th><th>Date</th><th>Source description</th><th>Amount · BDT</th><th>Overlap</th></tr></thead><tbody>{visibleRows.map(r => <tr key={r.ordinal}><td className="subtle">{r.ordinal}</td><td className="date-cell">{dateLabel(r.posting_date)}</td><td><p className="investment-description">{r.description}</p></td><td><span className="amount">{money(r.amount)}</span></td><td className="subtle">{r.existing_id ? 'Existing movement' : 'New movement'}</td></tr>)}</tbody></table></div>
      </section>
    </>}
  </div>
}

function EventDetails({ data, event: e, close, select }: { data: InvestmentWorkspace; event: InvestmentEvent; close: () => void; select: (id: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), refresh = useRefresh()
  const [localError, setLocalError] = useState<unknown>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  const mutation = useMutation({ mutationFn: ({ path, method, body }: { path: string; method: string; body?: unknown }) => api('/investments' + path, body ? jsonRequest(method, body) : { method }), onSuccess: refresh })
  const projectName = (event: InvestmentEvent) => data.projects.find(p => p.id === event.project_id)?.name || 'Institution wallet'
  const returning = ['repayment', 'refund'].includes(e.kind), destination = ['cashout', 'reinvestment'].includes(e.kind)
  const options = data.events.filter(other => other.institution_id === e.institution_id && (returning ? ['cashout', 'reinvestment'].includes(other.kind) && other.posting_date >= e.posting_date && cents(other.amount) > cents(other.allocated_in) : destination && ['repayment', 'refund'].includes(other.kind) && other.posting_date <= e.posting_date && cents(other.amount) > cents(other.allocated_out)))
  const allocations = data.allocations.filter(a => a.source_id === e.id || a.target_id === e.id)
  function submitSplit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setLocalError(null)
    try {
      const form = new FormData(event.currentTarget), value = String(form.get('profit') || '')
      if (!value) { mutation.mutate({ path: `/events/${e.id}/split`, method: 'PATCH', body: { principal: null } }); return }
      const profit = cents(value), principal = cents(e.amount) - profit
      if (profit < 0n || principal < 0n) throw new Error('Profit must be between zero and the installment amount.')
      mutation.mutate({ path: `/events/${e.id}/split`, method: 'PATCH', body: { principal: decimal(principal) } })
    } catch (error) { setLocalError(error) }
  }
  const section = (title: string, content: ReactNode) => <section className="investment-detail-section"><h3>{title}</h3>{content}</section>
  return <dialog ref={dialog} className="detail-dialog investment-dialog" onClose={close}><div className="dialog-content">
    <div className="section-heading"><h2>{kindLabel(e.kind)}</h2><button className="icon-button" aria-label="Close investment details" onClick={() => dialog.current?.close()}><X size={18} /></button></div>
    <div className="subtle">{dateLabel(e.posting_date)}</div><div className="detail-amount">{money(e.amount)} <small>BDT</small></div><h3>{projectName(e)}</h3><div className="movement-chips"><span className="movement-chip">{e.description.trim().split(/\r?\n/)[0]}</span><span className="movement-chip">{kindLabel(e.kind)}</span>{e.difference && <DifferenceChip amount={e.difference.amount} />}</div>
    {e.kind === 'repayment' && section('Capital and profit split', <>
      <p>Capital: <Amount value={e.principal} /> · Profit: <Amount value={e.profit} /></p>
      {e.reported_profit !== null && <p>Profit mentioned in source: {money(e.reported_profit)} BDT. Verify whether this note applies to this installment before saving.</p>}
      <form className="investment-form" onSubmit={submitSplit}><label><span>Profit in this installment · BDT</span><input name="profit" key={e.profit} defaultValue={e.profit || ''} placeholder={e.reported_profit ?? 'Blank = unclassified'} inputMode="decimal" /></label><button className="secondary-button" disabled={mutation.isPending}>Save split</button></form>
    </>)}
    {(returning || destination) && section(returning ? 'Destinations' : 'Source installments', <>
      <p>{e.difference ? `${money(e.allocated_in)} BDT source credits → ${money(e.amount)} BDT payment. Difference is unassigned to any business.` : returning ? `${money(remaining(e.amount, e.allocated_out))} BDT has no recorded destination.` : `${money(remaining(e.amount, e.allocated_in))} BDT has no recorded source return.`}</p>
      {allocations.map(a => { const other = data.events.find(x => x.id === (returning ? a.target_id : a.source_id))!; return <div className="investment-link" key={a.id}><button className="investment-text-button" onClick={() => select(other.id)}><strong>{money(a.amount)} BDT</strong><br />{returning ? 'To' : 'From'} {projectName(other)} · {dateLabel(other.posting_date)}{other.difference && <DifferenceChip amount={other.difference.amount} />}</button><button className="secondary-button" disabled={mutation.isPending} onClick={() => mutation.mutate({ path: `/allocations/${a.id}`, method: 'DELETE' })}>Remove trace</button></div> })}
      {!e.difference && options.length > 0 && cents(remaining(e.amount, returning ? e.allocated_out : e.allocated_in)) > 0n && <details className="movement-tools" open><summary>Add a connection</summary><form className="investment-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); mutation.mutate({ path: '/allocations', method: 'POST', body: { source_id: returning ? e.id : form.get('other'), target_id: returning ? form.get('other') : e.id, amount: form.get('amount') } }) }}>
        <label className="wide"><span>{returning ? 'Destination investment or bank payout' : 'Source installment / refund'}</span><select name="other" required defaultValue=""><option value="" disabled>{returning ? 'Select reinvestment or payout' : 'Select installment or refund'}</option>{options.map(other => <option key={other.id} value={other.id}>{dateLabel(other.posting_date)} · {projectName(other)} · {kindLabel(other.kind)} · Available {money(remaining(other.amount, returning ? other.allocated_in : other.allocated_out))}</option>)}</select></label>
        <label><span>Amount to trace · BDT</span><input name="amount" inputMode="decimal" required /></label><button className="secondary-button" disabled={mutation.isPending || !options.length}>Add money trace</button>
      </form></details>}
    </>)}
    {['investment', 'cashout'].includes(e.kind) && <BankMatching data={data} event={e} />}
    {e.kind === 'reinvestment_settlement' && <p className="footnote">This is the wallet deduction for a reinvestment on the same date. Trace the reinvestment funding row; this settlement is not a separate bank payout.</p>}
    <details className="investment-detail-section"><summary>Source evidence</summary><p className="investment-description">{e.description}</p>{e.sources.map(s => <p key={s.import_id + s.ordinal}><Link className="investment-text-button" to={`/investments/imports/${s.import_id}`}>{s.filename} · Row {s.ordinal}</Link></p>)}</details>
    <ErrorBox error={localError || mutation.error} />
  </div></dialog>
}

function BankMatching({ data, event: e }: { data: InvestmentWorkspace; event: InvestmentEvent }) {
  const refresh = useRefresh(), [days, setDays] = useState('3'), [account, setAccount] = useState(''), [manual, setManual] = useState(''), [transaction, setTransaction] = useState('')
  const { data: accounts = [] } = useQuery({ queryKey: ['accounts'], queryFn: () => api<Account[]>('/accounts') })
  const { data: candidates, error } = useQuery({ queryKey: ['investment-bank', e.id, days, account, e.bank_linked], queryFn: () => api<{ from_date: string; to_date: string; items: BankCandidate[] }>(`/investments/events/${e.id}/bank-candidates?days=${days}${account ? '&account_id=' + account : ''}`) })
  const manualLookup = useMutation({ mutationFn: (id: string) => api<TransactionDetail>(`/transactions/${encodeURIComponent(id)}`), onSuccess: t => setTransaction(t.id) })
  const mutation = useMutation({ mutationFn: ({ path, body, method = 'POST' }: { path: string; body?: unknown; method?: string }) => api('/investments' + path, body ? jsonRequest(method, body) : { method }), onSuccess: refresh })
  const selected = candidates?.items.find(t => t.id === transaction)
  const links = data.bank_links.filter(l => l.event_id === e.id)
  return <section className="investment-detail-section"><h3>Bank transfer</h3><p>{money(remaining(e.amount, e.bank_linked))} BDT unmatched. </p>
    {links.map(l => <div key={l.id} className="investment-link"><div className="bank-link-summary"><strong>{money(l.amount)} BDT</strong><span>{dateLabel(l.posting_date)} · {l.account}</span><Link className="flow-text-button" to={`/transactions?transaction=${l.transaction_id}`}>Bank details <ArrowUpRight size={12} /></Link></div><button className="secondary-button" disabled={mutation.isPending} onClick={() => mutation.mutate({ path: `/bank-links/${l.id}`, method: 'DELETE' })}>Unlink bank transfer</button></div>)}
    {cents(remaining(e.amount, e.bank_linked)) > 0n && <details className="movement-tools" open><summary>Match another transfer</summary><div className="investment-form"><label><span>Date window</span><select value={days} onChange={event => { setDays(event.target.value); setTransaction('') }}>{['0', '3', '7', '14', '30'].map(d => <option key={d} value={d}>{d} days</option>)}</select></label><label><span>Bank account</span><select value={account} onChange={event => { setAccount(event.target.value); setTransaction('') }}><option value="">All BDT accounts</option>{accounts.filter(a => a.currency === 'BDT').map(a => <option key={a.id} value={a.id}>{a.label}</option>)}</select></label></div>
    <p className="footnote">{candidates && `${dateLabel(candidates.from_date)} – ${dateLabel(candidates.to_date)} · ${candidates.items.length} candidates. Exact amounts shown first; split or combined transfers can be linked in parts.`}</p>
    <form className="investment-form" onSubmit={event => { event.preventDefault(); const form = new FormData(event.currentTarget); mutation.mutate({ path: '/bank-links', body: { event_id: e.id, transaction_id: transaction, amount: form.get('amount') } }) }}>
      <label className="wide"><span>Bank transaction</span><select value={transaction} onChange={event => setTransaction(event.target.value)} required><option value="">Select a bank movement</option>{candidates?.items.map(t => <option key={t.id} value={t.id}>{t.exact_amount ? 'Exact amount · ' : ''}{dateLabel(t.posting_date)} · {money(t.available)} available · {t.description}</option>)}{transaction && !selected && manualLookup.data?.id === transaction && <option value={transaction}>{dateLabel(manualLookup.data.posting_date)} · {money(manualLookup.data.amount)} · {manualLookup.data.description}</option>}</select></label>
      <label><span>Linked amount · BDT</span><input key={transaction + e.bank_linked} name="amount" inputMode="decimal" required defaultValue={selected ? decimal(cents(selected.available) < cents(remaining(e.amount, e.bank_linked)) ? cents(selected.available) : cents(remaining(e.amount, e.bank_linked))) : remaining(e.amount, e.bank_linked)} /></label><button className="secondary-button" disabled={!transaction || mutation.isPending || remaining(e.amount, e.bank_linked) === '0.00'}>Link bank transfer</button>
    </form>
    <details><summary>Find a transfer outside the suggested dates</summary><form className="investment-form" onSubmit={event => { event.preventDefault(); manualLookup.mutate(manual.trim()) }}><label><span>Bank transaction ID</span><input value={manual} onChange={event => setManual(event.target.value)} required /></label><button className="secondary-button" disabled={manualLookup.isPending}>Find bank transaction</button></form><p className="footnote">Copy the ID from transaction details in the Transactions page. Manual matches still require the correct debit/credit direction and sufficient unlinked amount.</p></details>
    </details>}<ErrorBox error={error || mutation.error || manualLookup.error} />
  </section>
}
