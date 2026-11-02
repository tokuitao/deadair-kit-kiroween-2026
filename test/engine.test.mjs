import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOperations, projectReception, canonicalSerialize } from '../src/engine.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkIn(id, attendeeId, name) {
  return {
    id,
    appId: 'reception',
    workspaceId: 'ws-1',
    actorId: 'desk-1',
    kind: 'check-in',
    payload: { attendeeId, name },
  };
}

const baseOps = [
  checkIn('op-a', 'att-1', 'Alice'),
  checkIn('op-b', 'att-2', 'Bob'),
];

// ---------------------------------------------------------------------------
// mergeOperations
// ---------------------------------------------------------------------------

test('merge: set-union dedupes identical ids (idempotence)', () => {
  const merged = mergeOperations(baseOps, [baseOps[0]]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged.map((o) => o.id), ['op-a', 'op-b']);
});

test('merge: left/right order does not matter (commutativity)', () => {
  const a = mergeOperations([baseOps[0]], [baseOps[1]]);
  const b = mergeOperations([baseOps[1]], [baseOps[0]]);
  assert.deepEqual(a, b);
});

test('merge: deterministic order by id ascending', () => {
  const z = checkIn('op-z', 'att-3', 'Zoe');
  const merged = mergeOperations([z], baseOps);
  assert.deepEqual(merged.map((o) => o.id), ['op-a', 'op-b', 'op-z']);
});

test('merge: same id with different payload is a conflict (honest, no silent overwrite)', () => {
  const left = [checkIn('op-x', 'att-1', 'Alice')];
  const right = [checkIn('op-x', 'att-1', 'Alicia')];
  assert.throws(
    () => mergeOperations(left, right),
    /conflict: operation id "op-x" present with differing payload/
  );
});

test('merge: same id with same data but payload keys in different order is identical', () => {
  // Two operations that are logically equal but whose payload object literal
  // lists keys in different insertion order. Canonical serialization must
  // treat them as equal.
  const left = [{ ...checkIn('op-q', 'att-9', 'Quinn'), payload: { name: 'Quinn', attendeeId: 'att-9' } }];
  const right = [{ ...checkIn('op-q', 'att-9', 'Quinn'), payload: { attendeeId: 'att-9', name: 'Quinn' } }];
  const merged = mergeOperations(left, right);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'op-q');
  assert.equal(canonicalSerialize(left[0]), canonicalSerialize(right[0]));
});

test('merge: rejects mixed appId', () => {
  const lending = [{ ...checkIn('op-a', 'att-1', 'Alice'), appId: 'lending' }];
  assert.throws(
    () => mergeOperations([baseOps[0]], lending),
    /namespace mismatch/
  );
});

test('merge: rejects mixed workspaceId', () => {
  const ws2 = [{ ...checkIn('op-a', 'att-1', 'Alice'), workspaceId: 'ws-2' }];
  assert.throws(
    () => mergeOperations([baseOps[0]], ws2),
    /namespace mismatch/
  );
});

test('merge: rejects non-array input', () => {
  assert.throws(() => mergeOperations(baseOps, {}), /right must be an array/);
  assert.throws(() => mergeOperations(null, []), /left must be an array/);
});

test('merge: rejects malformed operation (missing field)', () => {
  const bad = [{ id: 'op-1', appId: 'reception', workspaceId: 'ws-1', actorId: 'd' }];
  assert.throws(() => mergeOperations(bad, []), /missing required field: kind/);
});

test('merge: rejects malformed operation (empty string id)', () => {
  const bad = [{ ...checkIn('', 'att-1', 'Alice') }];
  assert.throws(() => mergeOperations(bad, []), /field id must be a non-empty string/);
});

test('merge: returns defensive copies (pure)', () => {
  const merged = mergeOperations(baseOps, []);
  assert.notEqual(merged[0], baseOps[0]);
  assert.notEqual(merged[0].payload, baseOps[0].payload);
  merged[0].payload.attendeeId = 'mutated';
  assert.equal(baseOps[0].payload.attendeeId, 'att-1');
});

// ---------------------------------------------------------------------------
// projectReception
// ---------------------------------------------------------------------------

test('project: counts each attendee once even with duplicate id', () => {
  const ops = [checkIn('op-a', 'att-1', 'Alice'), checkIn('op-a', 'att-1', 'Alice')];
  const r = projectReception(ops);
  assert.equal(r.attendeeCount, 1);
  assert.equal(r.attendees.length, 1);
  assert.equal(r.events.length, 1); // deduped by id
});

test('project: distinct check-ins counted separately', () => {
  const ops = baseOps;
  const r = projectReception(ops);
  assert.equal(r.attendeeCount, 2);
  assert.deepEqual(r.attendees, [
    { attendeeId: 'att-1', name: 'Alice' },
    { attendeeId: 'att-2', name: 'Bob' },
  ]);
});

test('project: same attendee checked in twice via different op ids -> count 1, events 2', () => {
  const ops = [
    checkIn('op-a', 'att-1', 'Alice'),
    checkIn('op-c', 'att-1', 'Alice'),
  ];
  const r = projectReception(ops);
  assert.equal(r.attendeeCount, 1);
  assert.equal(r.events.length, 2); // both original events retained for audit
  assert.deepEqual(r.events.map((e) => e.id), ['op-a', 'op-c']);
});

test('project: rejects non-reception operations', () => {
  const lending = [{ ...checkIn('op-a', 'att-1', 'Alice'), appId: 'lending' }];
  assert.throws(() => projectReception(lending), /projectReception only handles appId "reception"/);
});

test('project: rejects malformed check-in payload (missing name)', () => {
  const bad = [{ ...checkIn('op-a', 'att-1', 'Alice'), payload: { attendeeId: 'att-1' } }];
  assert.throws(() => projectReception(bad), /needs string attendeeId and name/);
});

test('project: deterministic output order (attendees sorted by attendeeId, events by id)', () => {
  const ops = [
    checkIn('op-z', 'att-9', 'Zoe'),
    checkIn('op-a', 'att-1', 'Alice'),
    checkIn('op-m', 'att-5', 'Mia'),
  ];
  const r = projectReception(ops);
  assert.deepEqual(r.events.map((e) => e.id), ['op-a', 'op-m', 'op-z']);
  assert.deepEqual(r.attendees.map((a) => a.attendeeId), ['att-1', 'att-5', 'att-9']);
});

test('project: is pure (does not mutate inputs)', () => {
  const ops = [checkIn('op-a', 'att-1', 'Alice')];
  const snapshot = JSON.stringify(ops);
  projectReception(ops);
  assert.equal(JSON.stringify(ops), snapshot);
});

test('project: rejects empty array of non-reception app inside mixed list', () => {
  const ops = [checkIn('op-a', 'att-1', 'Alice'), { ...checkIn('op-b', 'att-2', 'Bob'), appId: 'lending' }];
  assert.throws(() => projectReception(ops), /projectReception only handles appId "reception"/);
});

// ---------------------------------------------------------------------------
// Regression tests — namespace validation across combined input
// ---------------------------------------------------------------------------

test('regression merge: rejects mixed workspaceId within a single list (left only)', () => {
  const wsA = [checkIn('op-a', 'att-1', 'Alice')];
  const wsB = [{ ...checkIn('op-b', 'att-2', 'Bob'), workspaceId: 'ws-2' }];
  assert.throws(
    () => mergeOperations(wsA.concat(wsB), []),
    /namespace mismatch/
  );
});

test('regression merge: rejects mixed appId within a single list (right only)', () => {
  const rec = [checkIn('op-a', 'att-1', 'Alice')];
  const len = [{ ...checkIn('op-b', 'att-2', 'Bob'), appId: 'lending' }];
  assert.throws(
    () => mergeOperations([], rec.concat(len)),
    /namespace mismatch/
  );
});

test('regression merge: rejects mixed workspaceId when one list is empty', () => {
  const wsA = [checkIn('op-a', 'att-1', 'Alice')];
  const wsB = [{ ...checkIn('op-b', 'att-2', 'Bob'), workspaceId: 'ws-2' }];
  assert.throws(
    () => mergeOperations(wsA.concat(wsB), []),
    /namespace mismatch/
  );
});

// ---------------------------------------------------------------------------
// Regression tests — deterministic name selection from earliest op id
// ---------------------------------------------------------------------------

test('regression project: same attendee with different names selects name from earliest op id', () => {
  const first = [checkIn('op-b', 'sameAttendee', 'Alicia'), checkIn('op-a', 'sameAttendee', 'Alice')];
  const reversed = [checkIn('op-a', 'sameAttendee', 'Alice'), checkIn('op-b', 'sameAttendee', 'Alicia')];
  const r1 = projectReception(first);
  const r2 = projectReception(reversed);
  assert.equal(r1.attendeeCount, 1);
  assert.equal(r2.attendeeCount, 1);
  assert.deepEqual(r1.attendees, r2.attendees);
  // op-a < op-b so "Alice" (from op-a) is canonical
  assert.equal(r1.attendees[0].name, 'Alice');
});
