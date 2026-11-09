import assert from 'node:assert/strict'
import { test } from 'node:test'
import { reconciliationChanges, type ReconciliationState } from './reconciliationChanges.ts'

const issue = (event: string, kind: string, institution = 'one') => ({ event_id: event, kind, institution_id: institution })
const state = (issues: ReconciliationState['issues'] = [], resolved: ReconciliationState['resolved'] = []): ReconciliationState => ({ issues, resolved })

test('reports resolved movements and waiting movements that now need review', () => {
  const before = state([issue('first', 'wallet_match'), issue('later', 'dependent_wallet'), issue('last', 'dependent_wallet')])
  const after = state([issue('later', 'wallet_match')], [issue('first', 'wallet_match'), issue('last', 'wallet_match')])
  const changes = reconciliationChanges(before, after)
  assert.equal(changes.length, 3)
  assert.deepEqual(changes.map(c => [c.eventId, c.from, c.to]).sort(), [
    ['first', 'review', 'resolved'], ['last', 'waiting', 'resolved'], ['later', 'waiting', 'review'],
  ])
})

test('keeps wallet and bank status separate and deduplicates cases for one movement', () => {
  const before = state([issue('payment', 'dependent_wallet'), issue('payment', 'bank_match')])
  const after = state([issue('payment', 'bank_match')], [issue('payment', 'wallet_match'), issue('payment', 'reinvestment_group')])
  const changes = reconciliationChanges(before, after)
  assert.equal(changes.length, 1)
  assert.equal(changes[0].phase, 'wallet')
  assert.equal(changes[0].to, 'resolved')
})

test('a disappearing waiting issue without a saved match is not called resolved', () => {
  assert.equal(reconciliationChanges(state([issue('payment', 'dependent_wallet')]), state())[0].to, 'cleared')
})

test('current issues override resolved history and unrelated institutions stay separate', () => {
  const before = state([issue('payment', 'dependent_wallet')], [issue('payment', 'wallet_match', 'two')])
  const after = state([issue('payment', 'wallet_match')], [issue('payment', 'wallet_match'), issue('payment', 'wallet_match', 'two')])
  assert.deepEqual(reconciliationChanges(before, after).map(c => [c.from, c.to]), [['waiting', 'review']])
})

test('does not report unchanged states and detects newly saved automatic matches', () => {
  const before = state([issue('payment', 'bank_match')])
  assert.deepEqual(reconciliationChanges(before, before), [])
  assert.equal(reconciliationChanges(before, state(before.issues, [issue('later', 'wallet_match')]))[0].to, 'resolved')
})
