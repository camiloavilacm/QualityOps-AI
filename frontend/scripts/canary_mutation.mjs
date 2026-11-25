import assert from 'node:assert/strict'

export function mutateExport(original) {
  const mutated = structuredClone(original)
  const source = original.campaigns.filter(item => item.id === 'fixture-mixed')
  assert.equal(source.length, 1, 'Exactly one mixed campaign')
  const removed = source[0].gate.reasons.filter(item => item.code === 'INSUFFICIENT_EVIDENCE')
  assert.equal(removed.length, 1, 'Exactly one missing-evidence reason')
  assert.equal(source[0].gate.decision, 'BLOCKED')
  const target = mutated.campaigns.find(item => item.id === 'fixture-mixed')
  target.gate.reasons = target.gate.reasons.filter(item => item.code !== 'INSUFFICIENT_EVIDENCE')
  assert.equal(target.gate.reasons.length, source[0].gate.reasons.length - 1)
  assert.ok(target.gate.reasons.some(item => item.code === 'REQUIRED_FAILURE'))
  const restored = structuredClone(mutated)
  restored.campaigns.find(item => item.id === 'fixture-mixed').gate.reasons = structuredClone(source[0].gate.reasons)
  assert.deepEqual(restored, original, 'No other export difference allowed')
  return { mutated, removedReason: removed[0] }
}
