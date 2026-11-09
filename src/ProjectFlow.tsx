import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, CheckCircle2, ChevronDown, CircleHelp, GitBranch, Landmark, Wallet } from 'lucide-react'
import { dateLabel, money } from './api'
import { cents, decimal, kindLabel, sumMoney, type InvestmentProject } from './investmentApi'
import { DifferenceChip, type Trail } from './Reconciliation'

type Movement = Trail['events'][number]
const positive = (value: bigint) => value > 0n ? value : 0n
const amountLabel = (value: bigint) => money(decimal(value))

export function ProjectFlow({ trail, project, openEvent, filters }: {
  trail: Trail; project: InvestmentProject; openEvent: (id: string) => void; filters: URLSearchParams
}) {
  const [visibleCount, setVisibleCount] = useState(20)
  const byId = new Map(trail.events.map(e => [e.id, e]))
  const ownCredits = trail.events.filter(e => e.project_id === project.id && ['repayment', 'refund'].includes(e.kind))
  const creditIds = new Set(ownCredits.map(e => e.id))
  const outgoing = trail.allocations.filter(a => creditIds.has(a.source_id))
  const returned = ownCredits.reduce((total, e) => total + cents(e.amount), 0n)
  const cashouts = outgoing.filter(a => byId.get(a.target_id)?.kind === 'cashout').reduce((total, a) => total + cents(a.amount), 0n)
  const reinvested = outgoing.filter(a => byId.get(a.target_id)?.kind === 'reinvestment').reduce((total, a) => total + cents(a.amount), 0n)
  const walletKnown = ownCredits.every(e => e.wallet?.available != null)
  const wallet = walletKnown ? ownCredits.reduce((total, e) => total + cents(e.wallet!.available!), 0n) : 0n
  const unresolved = positive(returned - cashouts - reinvested - wallet)
  const bankReceipts = trail.bank_links.filter(b => byId.get(b.event_id)?.kind === 'cashout')
  const bankShareKnown = bankReceipts.every(b => b.project_share !== null)
  const linkedInBank = bankReceipts.reduce((total, b) => total + cents(b.project_share || '0.00'), 0n)
  const reviewUrl = { pathname: '/investments/reconciliation', search: filters.toString() }
  const matches = (e: Movement | undefined) => Boolean(e && (!filters.get('kind') || e.kind === filters.get('kind'))
    && (!filters.get('search') || e.description.toLocaleLowerCase().includes(filters.get('search')!.toLocaleLowerCase()))
    && (!filters.get('from') || e.posting_date >= filters.get('from')!) && (!filters.get('to') || e.posting_date <= filters.get('to')!))
  const relevant = (id: string) => matches(byId.get(id)) || outgoing.some(a => a.target_id === id && matches(byId.get(a.source_id)))
  const credits = ownCredits.filter(e => matches(e) || outgoing.some(a => a.source_id === e.id && matches(byId.get(a.target_id))))
  const funding = trail.events.filter(e => e.project_id === project.id && ['investment', 'reinvestment'].includes(e.kind) && matches(e))
  const bank = trail.bank_links.filter(b => relevant(b.event_id))
  const hasDifference = (kind: string) => outgoing.some(a => byId.get(a.target_id)?.kind === kind && byId.get(a.target_id)?.difference)
  const needsReview = trail.wallet_status === 'needs_review' || trail.bank_status === 'needs_review' || unresolved > 0n
  const hasProfitSplit = ownCredits.some(e => e.kind === 'repayment' && e.principal !== null)
  const profitLabel = project.status === 'closed' ? 'Final gain / loss' : 'Classified profit'
  const profitValue = project.status === 'closed' ? project.final_gain : hasProfitSplit || cents(project.unclassified_returns) === 0n ? project.classified_profit : null
  const filtered = ['kind', 'search', 'from', 'to'].some(key => filters.has(key))

  return <section className="project-flow" aria-label="Project money trail">
    <header className="flow-heading"><div><span className="eyebrow">MONEY FLOW</span><h2>Money flow</h2><p>Investment → repayments → destination.</p></div><div className="flow-heading-statuses"><span className={`movement-chip project-status ${project.status === 'closed' ? 'chip-success' : ''}`} aria-label="Project status">{project.status === 'closed' ? 'Completed' : 'Active'}</span><span className={`flow-status ${needsReview ? 'flow-status-warning' : ''}`}>{needsReview ? <CircleHelp size={15} /> : <CheckCircle2 size={15} />}{needsReview ? 'Needs review' : 'Reconciled'}</span></div></header>

    <div className="money-map" aria-label="All-time project money flow">
      <div className="map-stage map-investment"><span className="flow-icon"><GitBranch size={20} /></span><span className="map-label">Invested</span><strong>{money(project.invested)} <small>BDT</small></strong><span className="map-project">{project.name}</span><dl><div><dt>From your bank</dt><dd>{money(project.external_funding)}</dd></div><div><dt>From wallet returns</dt><dd>{money(project.reinvestment_funding)}</dd></div></dl></div>
      <ArrowRight className="map-arrow" size={22} aria-hidden="true" />
      <div className="map-stage map-returns"><span className="flow-icon"><ArrowDownLeft size={20} /></span><span className="map-label">Returned</span><strong>{amountLabel(returned)} <small>BDT</small></strong><span>{ownCredits.length} installment{ownCredits.length !== 1 ? 's' : ''} / refund{ownCredits.length !== 1 ? 's' : ''}</span><p>Capital + profit</p></div>
      <div className="map-stage map-profit" aria-label="Project profit"><span className="map-label">{profitLabel}</span><strong>{profitValue === null ? 'Not classified' : money(profitValue)}{profitValue !== null && <small> BDT</small>}</strong><span>{project.status === 'closed' ? 'Returns − invested' : cents(project.unclassified_returns) > 0n ? `${money(project.unclassified_returns)} BDT awaiting split` : 'From saved installment splits'}</span><p>Included in returns</p></div>
      <div className="map-destinations"><span className="map-label">Destinations</span>
        <div className="map-destination"><Landmark size={18} /><div><span>{hasDifference('cashout') ? 'Credits for cashouts' : 'Cashouts'}</span><small>{bankShareKnown ? `${amountLabel(linkedInBank)} linked in bank` : 'Bank receipt split needs review'}</small></div><strong>{amountLabel(cashouts)}</strong></div>
        <div className="map-destination"><GitBranch size={18} /><div><span>{hasDifference('reinvestment') ? 'Credits for reinvestment' : 'Reinvested'}</span><small>{hasDifference('reinvestment') ? 'Before settlement differences' : 'Funding another investment'}</small></div><strong>{amountLabel(reinvested)}</strong></div>
        <div className="map-destination"><Wallet size={18} /><div><span>Still in wallet</span><small>This business’s available returns</small></div><strong>{walletKnown ? amountLabel(wallet) : 'Unverified'}</strong></div>
        {unresolved > 0n && <div className="map-destination map-unresolved"><CircleHelp size={18} /><div><span>Destination not confirmed</span><small>Review before treating as available</small></div><strong>{amountLabel(unresolved)}</strong></div>}
      </div>
    </div>
    {trail.differences?.map(d => <div className="movement-chips" key={d.event_id}><DifferenceChip amount={d.amount} /><span className="subtle">Settlement difference · business share unassigned</span></div>)}
    <p className="flow-caption">All-time amounts for this project · BDT. {filtered ? 'The history below follows your filters and includes directly linked context.' : 'Transfers are included in returns.'}</p>


    {funding.length > 0 && <section className="flow-funding" aria-label="Investment funding"><div className="flow-section-title"><h3>Funding</h3><span>{funding.length} funding movement{funding.length !== 1 ? 's' : ''}</span></div>{funding.map(e => {
      const linked = trail.bank_links.filter(b => b.event_id === e.id)
      const sources = trail.allocations.filter(a => a.target_id === e.id)
      return <div className="funding-connection" key={e.id}>
        <div className="funding-origin"><span className="flow-icon">{e.kind === 'investment' ? <Landmark size={18} /> : <Wallet size={18} />}</span><div><strong>{e.kind === 'investment' ? 'Your bank account' : 'Previous investment returns'}</strong><small>{e.kind === 'investment' ? linked.length ? linked.map(b => `${dateLabel(b.posting_date)} · ${money(b.linked_amount)} BDT`).join(' / ') : 'Bank transfer not linked yet' : sources.length ? sources.map(a => `${byId.get(a.source_id)?.project_name || 'Wallet'} · ${money(a.amount)}`).join(' / ') : 'Source credits not linked yet'}</small></div></div>
        <ArrowRight className="funding-arrow" size={18} aria-hidden="true" /><div className="funding-booking"><strong>{money(e.amount)} BDT invested</strong><small>Booked {dateLabel(e.posting_date)}</small>{e.difference && <DifferenceChip amount={e.difference.amount} />}</div><button className="flow-text-button" onClick={() => openEvent(e.id)}>View funding <ArrowUpRight size={14} /></button>
      </div>
    })}</section>}

    <section className="installment-history" aria-label="Installment destinations"><div className="flow-section-title"><div><h3>Installments</h3><p>Wallet credit → destination</p></div><span>{credits.length} movement{credits.length !== 1 ? 's' : ''} · oldest first</span></div>
      {!credits.length && <div className="flow-empty"><Wallet size={25} /><h4>{filtered ? 'No installments match these filters' : 'No installments recorded yet'}</h4><p>{filtered ? 'Choose All movements or adjust the dates to see the return journey.' : 'Imported installments will appear here with their wallet, cashout or reinvestment destination.'}</p></div>}
      <ol className="installment-timeline">{credits.slice(0, visibleCount).map(e => {
        const allocations = outgoing.filter(a => a.source_id === e.id)
        const displayed = allocations.filter(a => matches(e) || matches(byId.get(a.target_id)))
        const allocated = allocations.reduce((total, a) => total + cents(a.amount), 0n)
        const available = e.wallet?.available == null ? null : cents(e.wallet.available)
        const unassigned = positive(cents(e.amount) - allocated - (available ?? 0n))
        return <li key={e.id} className="installment-item"><span className="timeline-dot" aria-hidden="true" /><article className="installment-card" aria-label={`${dateLabel(e.posting_date)} ${kindLabel(e.kind)} ${money(e.amount)}`}>
          <div className="installment-origin"><span className="installment-date">{dateLabel(e.posting_date)}</span><strong>{money(e.amount)} <small>BDT</small></strong><span className="installment-type">{e.kind === 'refund' ? 'Capital refund' : 'Installment received'}</span><span className="wallet-entry"><Wallet size={13} /> Wallet credit</span><button className="flow-text-button" onClick={() => openEvent(e.id)}>Details <ArrowUpRight size={13} /></button></div>
          <div className="installment-arrow" aria-hidden="true"><ArrowRight size={20} /></div>
          <div className="installment-destinations">{displayed.map(a => {
            const target = byId.get(a.target_id)!
            const receiptAmount = sumMoney(trail.bank_links.filter(b => b.event_id === target.id).map(b => b.linked_amount))
            const matched = cents(receiptAmount) === cents(target.amount) && !trail.issues.some(i => i.event_id === target.id && i.kind.startsWith('bank_'))
            return <div className={`destination-card ${target.kind === 'reinvestment' ? 'destination-reinvestment' : ''}`} key={a.id}>
              <span className="destination-icon">{target.kind === 'reinvestment' ? <GitBranch size={17} /> : <Landmark size={17} />}</span>
              <div className="destination-content"><strong>{target.kind === 'reinvestment' ? `${target.difference ? 'Committed to' : 'Reinvested in'} ${target.project_name || 'another business'}` : 'Bank payout'}</strong><span>{dateLabel(target.posting_date)} · {a.amount !== target.amount ? `Part of ${money(target.amount)} BDT ${target.kind === 'cashout' ? 'payout' : 'reinvestment'}` : kindLabel(target.kind)}</span><span className={`destination-status ${target.kind === 'cashout' && !matched ? 'destination-pending' : ''}`}>{target.kind === 'reinvestment' ? 'Wallet funding' : matched ? 'Bank linked' : 'Bank unmatched'}</span><div className="destination-actions"><button className="flow-text-button" onClick={() => openEvent(target.id)}>{target.kind === 'cashout' ? 'Payout' : 'Reinvestment'} <ArrowUpRight size={13} /></button>{target.kind === 'reinvestment' && <Link to={`/investments?project=${target.project_id}`}>View investment <ArrowUpRight size={13} /></Link>}</div></div><strong className="destination-amount">{money(a.amount)}<small>{target.difference ? 'BDT source credit' : 'BDT share'}</small>{target.difference && <DifferenceChip amount={target.difference.amount} />}</strong>
            </div>
          })}
          {matches(e) && available !== null && available > 0n && <div className="destination-card destination-wallet"><span className="destination-icon"><Wallet size={17} /></span><div className="destination-content"><strong>Available in your wallet</strong><span>Still attributed to {project.name}</span></div><strong className="destination-amount">{amountLabel(available)}<small>BDT</small></strong></div>}
          {matches(e) && (unassigned > 0n || allocated > cents(e.amount)) && <div className="destination-card destination-unknown"><span className="destination-icon"><CircleHelp size={17} /></span><div className="destination-content"><strong>{allocated > cents(e.amount) ? 'Conflicting links need review' : 'Destination needs review'}</strong><span>{available === null ? 'Wallet availability is unverified.' : 'No saved cashout or reinvestment connection yet.'}</span><Link className="flow-text-button" to={reviewUrl}>Review this connection <ArrowUpRight size={13} /></Link></div><strong className="destination-amount">{amountLabel(unassigned)}<small>BDT not attributed</small></strong></div>}
          </div>
        </article></li>
      })}</ol>
      {credits.length > visibleCount && <button className="secondary-button flow-show-more" onClick={() => setVisibleCount(n => n + 20)}>Show more installments ({credits.length - visibleCount} remaining)</button>}
    </section>

    <details className="flow-bank-evidence"><summary><span><Landmark size={18} /> Bank transactions <small>{bank.length} linked transfer{bank.length !== 1 ? 's' : ''}</small></span><ChevronDown size={17} /></summary>
      <p className="flow-caption">Full bank amounts can include other businesses. Your project’s share is shown separately. Posting dates remain the bank’s dates.</p>
      {!bank.length && <p className="flow-caption">No bank links match this view yet. <Link to={reviewUrl}>Review bank matches</Link></p>}
      <div className="bank-evidence-list">{bank.map(b => <article className="bank-evidence-card" key={b.id}><div><span className="installment-date">{dateLabel(b.posting_date)}</span><strong>{b.account}</strong><span className="bank-evidence-description">{b.description}</span>{b.business_date && <small>Business date in description: {dateLabel(b.business_date)}</small>}<small>{b.provenance} match · {b.explanation || 'Manually linked transfer'}</small></div><div className="bank-evidence-amounts"><strong>Full bank amount: {money(b.amount)} BDT</strong><span>This project: {b.project_share === null ? `Net share unassigned (source credits ${money(b.payout_project_share)} BDT)` : `${money(b.project_share)} BDT`}</span><Link className="flow-text-button" to={`/transactions?transaction=${b.transaction_id}`}>Open bank transaction <ArrowUpRight size={14} /></Link></div></article>)}</div>
    </details>
  </section>
}
