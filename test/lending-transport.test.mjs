import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLending } from '../src/lending.mjs';
import { makeEnvelope, readEnvelope, qrText } from '../src/transport.mjs';
const loan = (id, borrower = 'Alex') => ({ id, appId: 'lending', workspaceId: 'demo', actorId: id, kind: 'loan', payload: { itemId: 'DRILL-1', borrower } });
const returned = id => ({ id: 'return-1', appId: 'lending', workspaceId: 'demo', actorId: 'B', kind: 'return', payload: { loanId: id } });
test('two offline loans surface an overlap; returning one preserves both records and resolves it', () => {
  const events = [loan('a'), loan('b', 'Sam')];
  assert.equal(projectLending(events).conflicts.length, 1);
  const resolved = projectLending([...events, returned('a')]);
  assert.equal(resolved.conflicts.length, 0); assert.equal(resolved.active[0].id, 'b'); assert.equal(resolved.events.length, 3);
});
test('an out-of-order return is retained and resolves when its loan arrives', () => {
  assert.equal(projectLending([returned('a')]).unmatchedReturnCount, 1);
  assert.equal(projectLending([returned('a'), loan('a')]).active.length, 0);
});
test('handoff rejects mixed workspace even inside one batch', () => {
  const text = JSON.stringify(makeEnvelope('lending', 'demo', [loan('a'), { ...loan('b'), workspaceId: 'other' }]));
  assert.throws(() => readEnvelope(text, 'lending', 'demo'), /Mixed apps or workspaces/);
});
test('handoff rejects wrong app, unsupported kinds and oversized content', () => {
  assert.throws(() => readEnvelope(JSON.stringify(makeEnvelope('lending', 'demo', [])), 'reception', 'demo'), /different app/);
  assert.throws(() => readEnvelope(JSON.stringify(makeEnvelope('lending', 'demo', [{ ...loan('a'), kind: 'delete' }])), 'lending', 'demo'), /Unsupported record/);
  assert.throws(() => readEnvelope(' '.repeat(500001), 'lending', 'demo'), /too large/);
});
test('QR limit is measured in UTF-8 bytes and requires file fallback', () => {
  assert.throws(() => qrText({ text: 'あ'.repeat(600) }), /larger than one QR/);
  assert.ok(qrText(makeEnvelope('lending', 'demo', [loan('a')])).includes('DRILL-1'));
});
