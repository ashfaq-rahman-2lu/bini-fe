export interface InvestmentProject {
  id: string; institution_id: string; name: string; status: 'active' | 'closed'; expected_total: string | null;
  invested: string; returned: string; external_funding: string; reinvestment_funding: string;
  classified_profit: string; principal_returned: string; unclassified_returns: string; principal_outstanding: string | null; capital_written_off: string | null;
  net_recovery: string; final_gain: string | null; roi_percent: string | null; expected_remaining: string | null;
  traced_to_bank_payout: string; traced_to_reinvestment: string; untraced_returns: string;
}
export interface InvestmentEvent {
  id: string; institution_id: string; project_id: string | null; posting_date: string;
  kind: 'investment' | 'reinvestment' | 'repayment' | 'refund' | 'cashout' | 'reinvestment_settlement';
  amount: string; description: string; principal: string | null; profit: string | null; reported_profit: string | null;
  ready_balance: string; reported_capital: string; allocated_out: string; allocated_in: string; bank_linked: string;
  sources: { import_id: string; filename: string; ordinal: number }[];
}
export interface InvestmentWorkspace {
  institutions: { id: string; name: string; wallet_balance: string | null; wallet_as_of: string | null }[]; projects: InvestmentProject[]; events: InvestmentEvent[];
  allocations: { id: string; source_id: string; target_id: string; amount: string }[];
  bank_links: { id: string; event_id: string; transaction_id: string; amount: string; posting_date: string; description: string; account: string }[];
}
export interface InvestmentDraft {
  id: string; institution: string; filename: string; status: 'draft' | 'confirmed'; revision: number;
  mode: 'extend' | 'replace';
  replacement: { events: number; projects: number; imports: number; principal_splits: number; allocations: number; bank_links: number } | null;
  rows: { ordinal: number; posting_date: string; kind: string; amount: string; description: string; project: string | null; existing_id: string | null }[];
  warnings: string[]; summary: Record<string, string>; opening_wallet: string; closing_wallet: string; new_count: number; linked_count: number;
}
export interface InvestmentImportSummary { id: string; filename: string; institution: string; status: string; mode: 'extend' | 'replace'; created_at: string }
export interface BankCandidate { id: string; account: string; posting_date: string; description: string; amount: string; available: string; exact_amount: boolean }

// Financial arithmetic stays in integer cents; JSON monetary fields stay strings.
export function cents(value: string): bigint {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) throw new Error('Enter an amount with at most two decimal places.')
  const negative = value.startsWith('-'), [whole, part = ''] = value.replace('-', '').split('.')
  const result = BigInt(whole) * 100n + BigInt(part.padEnd(2, '0'))
  return negative ? -result : result
}
export function decimal(value: bigint): string {
  const absolute = value < 0n ? -value : value
  return (value < 0n ? '-' : '') + String(absolute / 100n) + '.' + String(absolute % 100n).padStart(2, '0')
}
export const sumMoney = (values: string[]) => decimal(values.reduce((sum, value) => sum + cents(value), 0n))
export const remaining = (amount: string, used: string) => decimal(cents(amount) - cents(used))
export const kindLabel = (kind: string) => ({ investment: 'Bank-funded investment', reinvestment: 'Reinvestment', repayment: 'Installment received', refund: 'Capital refund', cashout: 'Bank payout', reinvestment_settlement: 'Reinvestment settlement' }[kind] || kind)
