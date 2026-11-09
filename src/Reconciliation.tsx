import { useRef, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, dateLabel, jsonRequest, money } from './api'
import { cents, decimal, kindLabel, remaining, sumMoney, type SettlementDifference, type InvestmentEvent, type InvestmentWorkspace } from './investmentApi'
import { useQueuedOperation } from './operations'
import { reconciliationChanges, type MovementChange, type MovementStatus } from './reconciliationChanges'

export interface WalletCredit { available: string | null; reserved: string; consumed: string }
interface ReviewExplanation {
  difference?: string; accept_difference?: boolean; explanation: string; instruction_date: string | null; reviewed_at: string;
}
interface Issue {
  id: string | null; key: string; kind: string; institution_id: string; event_id: string | null; message: string;
  credit_candidates?: { source_id: string; amount: string }[];
  association_candidates?: string[]; association_ids?: string[]; allocation_ids?: string[];
  candidates?: { transaction_id?: string; amount?: string; description?: string; posting_date?: string; business_date?: string | null; allocations?: { source_id: string; amount: string }[] }[];
  resolutions?: ReviewExplanation[];
}
interface ResolvedMatch {
  id: string; kind: string; institution_id: string; event_id: string | null; amount: string | null; status: string;
  connection_count: number; provenance: string; explanation: string; resolved_at: string | null; resolutions: ReviewExplanation[];
}
interface Reconciliation {
  differences: SettlementDifference[]; difference_total: string;
  revision: string;
  institutions: { id: string; name: string; wallet_status: string; bank_status: string; closing: string | null; credits: Record<string, WalletCredit> }[];
  issues: Issue[];
  resolved: ResolvedMatch[];
  pending_allocations: unknown[]; pending_bank_links: unknown[];
  saved?: { allocations: number; bank_links: number; associations: number };
}
export interface Trail {
  differences: SettlementDifference[];
  project_id: string; project_name: string; wallet_status: string; bank_status: string;
  events: (InvestmentEvent & { project_name: string | null; wallet: WalletCredit | null })[];
  allocations: { id: string; source_id: string; target_id: string; amount: string; provenance: string; explanation: string }[];
  associations: { id: string; funding_id: string; event_id: string; provenance: string }[];
  bank_links: { id: string; event_id: string; transaction_id: string; amount: string; linked_amount: string; project_share: string | null; payout_project_share: string; posting_date: string; business_date: string | null; description: string; account: string; provenance: string; explanation: string }[];
  issues: Issue[];
}
export const trailQuery = (id: string) => ({ queryKey: ['investments', 'trail', id], queryFn: () => api<Trail>(`/investments/projects/${id}/trail`), enabled: Boolean(id) })
type ReconciliationResult = (before: Reconciliation | undefined, after: Reconciliation) => void
export function useReconcile(onResult?: ReconciliationResult) {
  const client = useQueryClient()
  return useQueuedOperation<Reconciliation, Reconciliation | undefined>({ kind: 'reconcile',
    onMutate: () => client.getQueryData<Reconciliation>(['investments', 'reconciliation']),
    onSuccess: async (result, before) => {
      onResult?.(before, result)
      // Mark all dependent views stale once, then install the returned snapshot.
      // Refetch active views except reconciliation, whose result is already here.
      await client.cancelQueries({ queryKey: ['investments', 'reconciliation'] })
      await client.invalidateQueries({ queryKey: ['investments'], refetchType: 'none' })
      client.setQueryData(['investments', 'reconciliation'], result)
      await Promise.all([
        client.refetchQueries({ predicate: q => q.queryKey[0] === 'investments' && q.queryKey[1] !== 'reconciliation', type: 'active' }),
        client.invalidateQueries({ queryKey: ['investment-review'], refetchType: 'none' }),
        client.invalidateQueries({ queryKey: ['investment-bank'] }),
      ])
    },
    onRecovered: () => { void client.invalidateQueries({ queryKey: ['investments', 'reconciliation'] }) },
  })
}
export function ReconciliationRetry({ error, retry, busy }: { error: unknown; retry: () => void; busy: boolean }) {
  return error ? <div className="error-box" role="alert">Import saved. Reconciliation could not finish: {error instanceof Error ? error.message : 'Request failed.'} <button className="secondary-button" disabled={busy} onClick={retry}>Retry reconciliation</button></div> : null
}

export function DifferenceChip({ amount, accepted = true }: { amount: string; accepted?: boolean }) {
  const value = cents(amount)
  return <span className="movement-chip chip-review" title="Source credits minus the recorded payment. Not assigned to an individual business.">{money(decimal(value < 0n ? -value : value))} BDT difference · {value < 0n ? 'short' : 'over'}{accepted ? ' · Accepted' : ''}</span>
}

const statusText = (status: string) => status === 'needs_review' ? 'Needs review' : status === 'reconciled' ? 'Reconciled' : 'Matched'
const eventName = (data: InvestmentWorkspace, id: string) => {
  const e = data.events.find(e => e.id === id)
  return e ? `${dateLabel(e.posting_date)} · ${data.projects.find(p => p.id === e.project_id)?.name || 'Wallet'} · ${kindLabel(e.kind)} · ${money(e.amount)}` : id
}

const issueCopy: Record<string, [string, string]> = {
  delayed_booking: ['Confirm earlier reinvestment', 'Select the credits used when you instructed this reinvestment. Leave later credits unselected.'],
  wallet_match: ['Choose source installments', 'Select the installments that funded this payment. Match the amount or explicitly accept a difference up to BDT 5.'],
  reinvestment_group: ['Group reinvestment records', 'Select the wallet deductions and bank top-up for this investment.'],
  bank_match: ['Match a bank transfer', 'Choose the bank transfer for this payment.'],
  dependent_wallet: ['Waiting for an earlier review', 'Resolve the earlier wallet issue, then run Reconcile now.'],
  discrepancy_balance: ['Check remaining wallet funds', 'A reviewed shortfall affects the remaining credits. Check the source history before using them.'],
  source_order: ['Check CSV order', 'Review the original CSV order or import a complete history.'],
  opening_funds: ['Earlier history needed', 'Import the earlier records that explain the opening wallet balance.'],
  source_balance: ['Check the CSV balance', 'Correct the source amounts or balance, then retry the import.'],
  credit_owner: ['Business not identified', 'Check which business owns this installment in the source CSV.'],
  settlement_group: ['Connect a wallet deduction', 'Resolve the related reinvestment group, then run Reconcile now.'],
  allocation_conflict: ['Review saved connections', 'Open the payment details to correct its source connections.'],
  bank_conflict: ['Review saved bank matches', 'Open the payment details to correct its bank links.'],
  prior_automatic: ['Recheck earlier matches', 'Review the preserved connections below before removing any.'],
  conservation: ['Check wallet totals', 'Review the source balance and saved connections.'],
}
const issueTitle = (issue: Issue) => issueCopy[issue.kind]?.[0] || 'Review this record'
function RecordLabel({ data, id }: { data: InvestmentWorkspace; id: string }) {
  const event = data.events.find(e => e.id === id)
  if (!event) return <span>Record unavailable</span>
  return <span className="review-record"><span className="review-record-date">{dateLabel(event.posting_date)}</span><strong>{data.projects.find(p => p.id === event.project_id)?.name || 'Institution wallet'}</strong><span className="movement-chip">{kindLabel(event.kind)}</span></span>
}

function ReviewExplanations({ resolutions }: { resolutions: ReviewExplanation[] }) {
  return <div className="review-explanations">{resolutions.map((r, n) => <div className="review-explanation" key={n}>
    {r.accept_difference && r.difference && <DifferenceChip amount={r.difference} />}
    <p>{r.explanation}</p>
    <small>{r.instruction_date && `Instruction: ${dateLabel(r.instruction_date)} · `}Reviewed {new Date(r.reviewed_at).toLocaleString()}</small>
  </div>)}</div>
}

function MovementChangeList({ changes, data, openEvent }: { changes: MovementChange[]; data: InvestmentWorkspace; openEvent: (id: string) => void }) {
  return <ul className="movement-change-list">{changes.map(change => <li key={change.key}>
    <div><span className={`movement-chip ${change.to === 'resolved' ? 'chip-success' : change.to === 'review' ? 'chip-review' : ''}`}>{change.phase === 'bank' ? 'Bank' : 'Wallet'}: {change.from && `${changeStatus(change.from)} → `}{changeStatus(change.to)}</span><RecordLabel data={data} id={change.eventId} /><strong>{money(data.events.find(e => e.id === change.eventId)?.amount || '0.00')} BDT</strong>{change.to === 'cleared' && <small>The previous blocker is gone; this does not confirm a saved match.</small>}</div>
    <button type="button" className="secondary-button" onClick={() => openEvent(change.eventId)}>Payment details</button>
  </li>)}</ul>
}

export function ReconciliationPanel({ data, openEvent }: { data: InvestmentWorkspace; openEvent: (id: string) => void }) {
  const query = useQuery({ queryKey: ['investments', 'reconciliation'], queryFn: () => api<Reconciliation>('/investments/reconciliation') })
  const [latestChanges, setLatestChanges] = useState<{ changes: MovementChange[]; reviewedEvent: string | null } | null>(null)
  function showChanges(before: Reconciliation | undefined, after: Reconciliation, reviewedEvent: string | null = null) {
    if (before) setLatestChanges({ changes: reconciliationChanges(before, after), reviewedEvent })
  }
  const run = useReconcile((before, after) => showChanges(before, after))
  const [visibleResolved, setVisibleResolved] = useState(5)
  const resolved = query.data?.resolved || []
  const reviewGroups = [
    { key: 'review', title: 'To review', issues: query.data?.issues.filter(i => i.kind !== 'dependent_wallet') || [], empty: 'No unresolved issues.' },
    { key: 'waiting', title: 'Waiting', issues: query.data?.issues.filter(i => i.kind === 'dependent_wallet') || [], empty: 'No items waiting for an earlier review.' },
  ]
  return <section className="reconciliation-panel" aria-label="Wallet reconciliation">
    <div className="section-heading"><div><h2>Match your money</h2><p className="footnote">Run matching, then review the items below.</p></div><button className="secondary-button" onClick={() => run.mutate()} disabled={run.isPending}>{run.isPending ? 'Reconciling…' : 'Reconcile now'}</button></div>
    {(query.error || run.error) && <p role="alert" className="error-box">{(query.error || run.error)?.message} <button className="secondary-button" onClick={() => void query.refetch()}>Refresh review</button></p>}
    {run.data?.saved && !latestChanges?.reviewedEvent && <p role="status" className="footnote">Saved {run.data.saved.allocations} money traces, {run.data.saved.bank_links} bank matches and {run.data.saved.associations} settlement associations.</p>}
    {query.data?.institutions.map(i => <p key={i.id} className="reconciliation-status"><strong>{i.name}</strong><span className={`movement-chip ${i.wallet_status === 'needs_review' ? 'chip-review' : 'chip-success'}`}>Wallet: {statusText(i.wallet_status)}</span><span className={`movement-chip ${i.bank_status === 'needs_review' ? 'chip-review' : 'chip-success'}`}>Bank: {statusText(i.bank_status)}</span></p>)}
    {query.data && <div className="reconciliation-counts" aria-label="Reconciliation counts">
      {reviewGroups.map(group => <span className="reconciliation-count" key={group.key}>{group.title}<strong>{group.issues.length}</strong></span>)}
      <span className="reconciliation-count count-resolved">Resolved<strong>{resolved.length}</strong></span>
      <span className="reconciliation-count">Accepted differences<strong>{query.data.differences.length}</strong></span>
    </div>}
    {latestChanges && <section className="reconciliation-changes" aria-label="Latest reconciliation changes">
      <div className="change-summary"><h3>{latestChanges.reviewedEvent ? 'Changes after your review' : 'Changes after reconciliation'}</h3><button type="button" className="icon-button" aria-label="Dismiss reconciliation changes" onClick={() => setLatestChanges(null)}>×</button></div>
      {latestChanges.reviewedEvent && <p className="footnote">Reviewed: {eventName(data, latestChanges.reviewedEvent)}</p>}
      <p className="footnote" aria-live="polite">{latestChanges.changes.length ? `${latestChanges.changes.length} movement status updates: ${latestChanges.changes.filter(c => c.to === 'resolved').length} resolved, ${latestChanges.changes.filter(c => c.to === 'review').length} to review, ${latestChanges.changes.filter(c => c.to === 'waiting').length} waiting, ${latestChanges.changes.filter(c => c.to === 'cleared').length} cleared.` : 'No movement statuses changed.'}</p>
      <p className="footnote">Bank and wallet matches are shown separately. This summary stays until the next review or reconciliation, or until you leave this page.</p>
      {latestChanges.changes.length > 0 && <details open><summary>View affected movements ({latestChanges.changes.length})</summary><MovementChangeList changes={latestChanges.changes} data={data} openEvent={openEvent} /></details>}
    </section>}
    {query.data && (query.data.pending_allocations.length > 0 || query.data.pending_bank_links.length > 0) && <p className="footnote">Unique matches are ready. Choose Reconcile now to save them.</p>}
    {query.isPending && <p className="footnote">Loading matches…</p>}
    {query.data && reviewGroups.map(group => <details className="review-queue" key={group.key} open={group.key === 'review'}><summary><strong>{group.title}</strong><span className="movement-chip">{group.issues.length} items</span><span className="subtle">All projects</span></summary>
      {!group.issues.length && <p className="footnote">{group.empty}</p>}
      {group.issues.map(issue => <details key={issue.key + issue.institution_id} className="reconciliation-case">
        <summary className="case-summary"><span className="case-summary-main"><strong>{issueTitle(issue)}</strong>{issue.event_id && <RecordLabel data={data} id={issue.event_id} />}</span><span className="case-summary-meta">{issue.event_id && <strong>{money(data.events.find(e => e.id === issue.event_id)?.amount || '0.00')} <small>BDT</small></strong>}<span className={`movement-chip ${issue.kind === 'dependent_wallet' ? '' : 'chip-review'}`}>{issue.kind === 'dependent_wallet' ? 'Waiting' : issue.kind.startsWith('bank_') ? 'Bank' : 'Wallet'}</span></span></summary>
        <div className="case-instruction">{issueCopy[issue.kind]?.[1] || issue.message}</div>
        <details className="case-diagnostics"><summary>Why this needs review</summary><p>{issue.message}</p></details>
        {Boolean(issue.resolutions?.length) && <details className="case-diagnostics"><summary>Previous review explanations</summary><ReviewExplanations resolutions={issue.resolutions!} /></details>}
        {issue.event_id && <button className="secondary-button" onClick={() => openEvent(issue.event_id!)}>Payment details</button>}
        {issue.id ? <CaseReview key={query.data!.revision + issue.id} issue={issue} revision={query.data!.revision} data={data} refresh={() => void query.refetch()} openEvent={openEvent} onResult={(before, after) => showChanges(before, after, issue.event_id)} /> : <p className="footnote">Run Reconcile now to enable this review.</p>}
      </details>)}
    </details>)}
    {query.data && <details className="review-queue resolved-matches" open><summary><strong>Resolved</strong><span className="movement-chip chip-success">{resolved.length} items</span><span className="subtle">Bank and wallet matches</span></summary>
      <p className="footnote">Saved matches, including automatic matches and reviewed decisions. Bank and wallet matches are counted separately for each payment.</p>
      {!resolved.length && <p className="footnote">No resolved reconciliations yet.</p>}
      {resolved.slice(0, visibleResolved).map(match => <details className="reconciliation-case resolved-case" key={match.id}>
        <summary className="case-summary"><span className="case-summary-main"><span className="resolved-heading"><strong>{match.kind === 'bank_match' ? 'Bank transfer matched' : match.kind === 'wallet_match' ? 'Wallet sources matched' : issueCopy[match.kind]?.[0] || 'Reconciliation completed'}</strong><span className="movement-chip chip-success">Resolved</span></span>{match.event_id && <RecordLabel data={data} id={match.event_id} />}</span><span className="case-summary-meta">{match.amount && <strong>{money(match.amount)} <small>BDT</small></strong>}</span></summary>
        <div className="resolved-body"><p className="footnote">{match.provenance === 'automatic' ? 'Matched automatically' : 'Reviewed match'}{match.connection_count > 0 && ` · ${match.connection_count} saved ${match.connection_count === 1 ? 'connection' : 'connections'}`}{match.resolved_at && ` · ${new Date(match.resolved_at).toLocaleString()}`}</p>
          {match.resolutions.length ? <ReviewExplanations resolutions={match.resolutions} /> : match.explanation && <p>{match.explanation}</p>}
          {match.event_id && <button className="secondary-button" onClick={() => openEvent(match.event_id!)}>Payment details</button>}
        </div>
      </details>)}
      {resolved.length > visibleResolved && <button className="secondary-button" onClick={() => setVisibleResolved(n => n + 20)}>Show more resolved ({resolved.length - visibleResolved} remaining)</button>}
    </details>}
    {query.data && <details className="review-queue accepted-differences"><summary><strong>Accepted differences</strong><span className="movement-chip">{query.data.differences.length} items</span><span className="movement-chip chip-review">{money(query.data.difference_total)} BDT total</span></summary>{!query.data.differences.length && <p className="footnote">No accepted differences.</p>}{query.data.differences.map(d => <div className="investment-link" key={d.event_id}><RecordLabel data={data} id={d.event_id} /><DifferenceChip amount={d.amount} /><button className="secondary-button" onClick={() => openEvent(d.event_id)}>Payment details</button></div>)}</details>}
  </section>
}

const changeStatus = (status: MovementStatus) => ({ waiting: 'Waiting', review: 'To review', resolved: 'Resolved', cleared: 'Blocker cleared' })[status]

function CaseReview({ issue, revision, data, refresh, onResult, openEvent }: { issue: Issue; revision: string; data: InvestmentWorkspace; refresh: () => void; onResult: ReconciliationResult; openEvent: (id: string) => void }) {
  const client = useQueryClient()
  const existing = data.allocations.filter(a => a.target_id === issue.event_id)
  const [acceptDifference, setAcceptDifference] = useState(false)
  const [selected, setSelected] = useState<string[]>(existing.map(a => a.source_id))
  const [associations, setAssociations] = useState<string[]>(issue.association_ids || [])
  const formVersion = useRef(0)
  const [preview, setPreview] = useState<{ body: unknown; changes: MovementChange[] } | null>(null)
  const previewRequest = useMutation({ mutationFn: async ({ body, version }: { body: unknown; version: number }) => {
    const before = client.getQueryData<Reconciliation>(['investments', 'reconciliation'])
    const after = await api<Reconciliation>(`/investments/reconciliation/cases/${issue.id}/preview`, jsonRequest('POST', body))
    return { body, version, changes: before ? reconciliationChanges(before, after) : [] }
  }, onSuccess: result => { if (result.version === formVersion.current) setPreview(result) } })
  const mutation = useMutation({ mutationFn: (body: unknown) => api<Reconciliation>(`/investments/reconciliation/cases/${issue.id}`, jsonRequest('PATCH', body)), onMutate: () => client.getQueryData<Reconciliation>(['investments', 'reconciliation']), onSuccess: async (result, _variables, before) => { onResult(before, result); await client.invalidateQueries({ queryKey: ['investments'] }); await client.invalidateQueries({ queryKey: ['investment-review'] }) }, onError: () => { setPreview(null); formVersion.current += 1 } })
  const remove = useMutation({ mutationFn: (path: string) => api(path, { method: 'DELETE' }), onSuccess: () => client.invalidateQueries({ queryKey: ['investments'] }) })
  const event = data.events.find(e => e.id === issue.event_id)
  const supported = ['delayed_booking', 'wallet_match', 'reinvestment_group', 'bank_match'].includes(issue.kind)
  const choices = issue.credit_candidates || data.events.filter(e => e.institution_id === issue.institution_id && ['repayment', 'refund'].includes(e.kind) && e.posting_date <= (event?.posting_date || '')).map(e => ({ source_id: e.id, amount: existing.find(a => a.source_id === e.id)?.amount || remaining(e.amount, e.allocated_out) })).filter(e => e.amount !== '0.00')
  const selectedTotal = sumMoney(choices.filter(c => selected.includes(c.source_id)).map(c => c.amount))
  const difference = cents(selectedTotal) - cents(event?.amount || '0.00')
  const absoluteDifference = difference < 0n ? -difference : difference
  const sourceReview = ['delayed_booking', 'wallet_match'].includes(issue.kind)
  const smallDifference = sourceReview && selected.length > 0 && absoluteDifference > 0n && absoluteDifference <= 500n
  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const form = new FormData(e.currentTarget)
    if (preview) { mutation.mutate(preview.body); return }
    const bank = issue.candidates?.find(c => c.transaction_id === form.get('bank'))
    previewRequest.mutate({ version: formVersion.current, body: { expected_revision: revision, explanation: form.get('explanation'), accept_difference: smallDifference && acceptDifference, delayed_booking: form.get('delayed') === 'on', instruction_date: form.get('instruction') || null,
      allocations: issue.kind === 'bank_match' ? [] : choices.filter(c => selected.includes(c.source_id)), association_ids: associations,
      bank_links: bank ? [{ transaction_id: bank.transaction_id, amount: bank.amount }] : [] } })
  }
  if (!supported) return <>
    {issue.kind === 'prior_automatic' && <div className="reconciliation-actions">{issue.allocation_ids?.map(id => <button key={id} className="secondary-button" onClick={() => remove.mutate(`/investments/allocations/${id}`)}>Remove conflicting trace {id.slice(0, 8)}</button>)}{issue.association_ids?.map(id => <button key={id} className="secondary-button" onClick={() => remove.mutate(`/investments/reconciliation/associations/${id}`)}>Remove conflicting settlement association {id.slice(0, 8)}</button>)}</div>}
    <p className="footnote">After correcting the record, run Reconcile now.</p>{remove.error && <p role="alert">{remove.error.message}</p>}
  </>
  if (issue.kind === 'bank_match' && !issue.candidates?.length) return <p className="footnote">No exact bank match. Open Payment details to search wider dates or link split transfers.</p>
  return <form className="case-review-form" onSubmit={submit} onChange={() => { formVersion.current += 1; setPreview(null) }}>
    {issue.kind === 'reinvestment_group' && <p className="footnote">Group the settlement records first. Source credits can be reviewed next.</p>}
    {issue.kind === 'bank_match' ? <label><span>Bank match to confirm</span><select name="bank" required defaultValue=""><option value="">Select a transfer</option>{issue.candidates?.map(c => <option key={c.transaction_id} value={c.transaction_id}>{c.posting_date} · {money(c.amount!)} · {c.description}</option>)}</select></label> : <fieldset><legend>1 · Select source installments</legend><div className="review-credit-list">{choices.map(c => <label className={`review-credit-option ${selected.includes(c.source_id) ? 'is-selected' : ''}`} key={c.source_id}><input type="checkbox" aria-label={eventName(data, c.source_id)} checked={selected.includes(c.source_id)} onChange={e => { setAcceptDifference(false); setSelected(e.target.checked ? [...selected, c.source_id] : selected.filter(id => id !== c.source_id)) }} /><RecordLabel data={data} id={c.source_id} /><span className="review-credit-amount"><strong>{money(c.amount)}</strong><small>BDT available</small></span></label>)}</div>{!choices.length && <p>No source installments available. Check the payment details or earlier reviews.</p>}<div className="review-selection-total" aria-live="polite"><span>Selected <strong>{money(sumMoney(choices.filter(c => selected.includes(c.source_id)).map(c => c.amount)))} BDT</strong></span><span>Needed <strong>{money(event?.amount || '0.00')} BDT</strong></span>{difference === 0n ? <span className="movement-chip">Amount matched</span> : <DifferenceChip amount={decimal(difference)} accepted={false} />}</div></fieldset>}
    {smallDifference && <label className="acknowledge"><input type="checkbox" checked={acceptDifference} onChange={e => setAcceptDifference(e.target.checked)} />Accept {money(decimal(absoluteDifference))} BDT difference as an unexplained wallet discrepancy.</label>}
    {sourceReview && absoluteDifference > 500n && <p className="footnote">Differences above BDT 5.00 need corrected source connections.</p>}
    {issue.association_candidates && <fieldset><legend>Settlement records &amp; bank top-up</legend>{issue.association_candidates.map(id => <label className="review-credit-option" key={id}><input type="checkbox" checked={associations.includes(id)} onChange={e => setAssociations(e.target.checked ? [...associations, id] : associations.filter(k => k !== id))} /><RecordLabel data={data} id={id} /><strong>{money(data.events.find(e => e.id === id)?.amount || '0.00')} BDT</strong></label>)}</fieldset>}
    {issue.kind === 'delayed_booking' && !(smallDifference && selected.length === choices.length) && <><label className="acknowledge"><input name="delayed" type="checkbox" required /> I used the full wallet before the later credits arrived.</label><label><span>Instruction date (if known)</span><input type="date" name="instruction" max={event?.posting_date} /></label></>}
    <label><span>Reason for this match</span><textarea defaultValue={smallDifference ? 'Small platform balance discrepancy; cause unknown.' : ''} placeholder="e.g. Instructed before the later installment arrived" name="explanation" required minLength={3} maxLength={2000} /></label>
    {(mutation.error || previewRequest.error) && <p role="alert" className="error-box">{(mutation.error || previewRequest.error)?.message} <button type="button" className="secondary-button" onClick={refresh}>Refresh review</button></p>}
    {preview && <section className="reconciliation-changes" aria-label="Review impact preview"><h3>Before you confirm</h3><p className="footnote">Nothing has been saved. These are the expected changes across all projects. Editing any review field requires a new preview.</p><p className="footnote">{preview.changes.length} movement status updates · {preview.changes.filter(c => c.to === 'resolved').length} resolved · {preview.changes.filter(c => c.to === 'review').length} to review · {preview.changes.filter(c => c.to === 'waiting').length} waiting · {preview.changes.filter(c => c.to === 'cleared').length} blockers cleared.</p>{preview.changes.length > 0 ? <MovementChangeList changes={preview.changes} data={data} openEvent={openEvent} /> : <p className="footnote">No movement status changes are expected.</p>}<button type="button" className="secondary-button" onClick={() => { formVersion.current += 1; setPreview(null) }}>Back to editing</button></section>}
    <button className="primary-button" disabled={mutation.isPending || previewRequest.isPending || (sourceReview && difference !== 0n && !(smallDifference && acceptDifference))}>{mutation.isPending ? 'Saving review…' : previewRequest.isPending ? 'Calculating impact…' : !preview ? 'Preview affected movements' : smallDifference && acceptDifference ? 'Accept difference and save' : 'Save reviewed match'}</button>
  </form>
}

