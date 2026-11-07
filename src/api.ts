export interface Account { id: string; label: string; currency: string }
export interface Transaction {
  id: string; account_id: string; posting_date: string; direction: 'debit' | 'credit';
  amount: string; balance: string; description: string; reference: string;
}
export interface ReviewRow extends Transaction {
  ordinal: number; page: number; raw_text: string;
  proposal: 'new' | 'duplicate' | 'ambiguous'; decision: 'new' | 'match' | null;
  effective: 'new' | 'match' | 'unresolved'; target_id: string | null;
  explanation: string; candidates: Transaction[];
}
export interface ImportReview {
  id: string; filename: string; status: 'draft' | 'confirmed'; account: Account;
  period_from: string; period_to: string; opening_balance: string; closing_balance: string;
  checks: { code: string; label: string; passed: boolean; detail: string }[];
  rows: ReviewRow[]; revision: string;
  summary: { new: number; duplicate: number; unresolved: number }; can_confirm: boolean;
}
export interface Ledger {
  items: Transaction[]; total: number; page: number; page_size: number;
  debit_total: string; credit_total: string; net: string;
}
export interface Source { statement_id: string; filename: string; page: number; ordinal: number; raw_text: string }
export interface TransactionDetail extends Transaction { sources: Source[] }
export interface ImportSummary { id: string; filename: string; status: 'draft' | 'confirmed'; created_at: string }

const base = (import.meta.env.VITE_API_BASE_URL || '/api').replace(/\/$/, '')
export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(base + path, init)
  if (!response.ok) {
    let message = `Request failed (${response.status}).`
    try {
      const body = await response.json()
      message = typeof body.detail === 'string' ? body.detail : 'Check the submitted fields and try again.'
    } catch { /* retain the generic error */ }
    throw new ApiError(response.status, message)
  }
  return response
}
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await request(path, init)
  return response.status === 204 ? undefined as T : response.json()
}
export async function unlockPdf(data: FormData, signal?: AbortSignal): Promise<Blob> {
  return (await request('/pdfs/unlock', { method: 'POST', body: data, signal })).blob()
}
export const jsonRequest = (method: string, body: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

// Format decimal strings without converting financial values to binary floats.
export function money(value: string) {
  const [integer, fraction = ''] = value.split('.')
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + fraction.padEnd(2, '0').slice(0, 2)
}
export function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T00:00:00Z'))
}
