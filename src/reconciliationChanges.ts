export type MovementStatus = 'waiting' | 'review' | 'resolved' | 'cleared'
export interface ReconciliationState {
  issues: { institution_id: string; event_id: string | null; kind: string }[];
  resolved: { institution_id: string; event_id: string | null; kind: string }[];
}
export interface MovementChange {
  key: string; eventId: string; phase: 'bank' | 'wallet'; from: MovementStatus | null; to: MovementStatus;
}

function movementStates(snapshot: ReconciliationState) {
  const states = new Map<string, Omit<MovementChange, 'from' | 'to'> & { status: MovementStatus }>()
  const keyFor = (row: ReconciliationState['issues'][number]) => {
    const phase = row.kind.startsWith('bank_') ? 'bank' as const : 'wallet' as const
    return { key: `${row.institution_id}:${phase}:${row.event_id}`, eventId: row.event_id!, phase }
  }
  for (const row of snapshot.resolved || []) {
    if (row.event_id) {
      const identity = keyFor(row)
      states.set(identity.key, { ...identity, status: 'resolved' })
    }
  }
  // A current issue takes precedence over historical resolved cases for that payment.
  for (const row of snapshot.issues) {
    if (!row.event_id) continue
    const identity = keyFor(row)
    const status = row.kind === 'dependent_wallet' ? 'waiting' : 'review'
    if (status === 'review' || states.get(identity.key)?.status !== 'review') states.set(identity.key, { ...identity, status })
  }
  return states
}

export function reconciliationChanges(before: ReconciliationState, after: ReconciliationState): MovementChange[] {
  const previous = movementStates(before), current = movementStates(after)
  const changes: MovementChange[] = []
  for (const [key, movement] of current) {
    const from = previous.get(key)?.status || null
    if (from !== movement.status) changes.push({ key, eventId: movement.eventId, phase: movement.phase, from, to: movement.status })
  }
  for (const [key, movement] of previous) {
    if (!current.has(key) && movement.status !== 'resolved') {
      // Disappearing from Waiting alone does not prove that a saved match exists.
      changes.push({ key, eventId: movement.eventId, phase: movement.phase, from: movement.status, to: 'cleared' })
    }
  }
  return changes
}
