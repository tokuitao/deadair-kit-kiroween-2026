// engine.mjs — offline-first event-union engine (browser-compatible, pure JS)
//
// No imports. Only standard built-ins that exist in browsers and Node:
// JSON, Object, Array, Set, Map. Runs in Node --test and in a browser module
// loader without polyfills.

// ---------------------------------------------------------------------------
// Canonical serialization
// ---------------------------------------------------------------------------

// Stable JSON string with object keys sorted ascending by name at every depth.
// Used only for comparing whether two operations with the same id are
// byte-identical. Never used as the operation's identity itself.
export function canonicalSerialize(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    let out = '[';
    for (let i = 0; i < value.length; i++) {
      if (i) out += ',';
      out += canonicalSerialize(value[i]);
    }
    return out + ']';
  }
  const keys = Object.keys(value).sort();
  let out = '{';
  for (let i = 0; i < keys.length; i++) {
    if (i) out += ',';
    out += JSON.stringify(keys[i]) + ':' + canonicalSerialize(value[keys[i]]);
  }
  return out + '}';
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const REQUIRED_FIELDS = ['id', 'appId', 'workspaceId', 'actorId', 'kind', 'payload'];

function isString(v) {
  return typeof v === 'string' && v.length > 0;
}

function validateOperation(op, label) {
  if (op === null || typeof op !== 'object' || Array.isArray(op)) {
    throw new TypeError(`operation ${label} must be a non-array object`);
  }
  for (const f of REQUIRED_FIELDS) {
    if (!(f in op)) {
      throw new TypeError(`operation ${label} missing required field: ${f}`);
    }
  }
  // id, appId, workspaceId, actorId, kind are non-empty strings; payload is any
  // JSON-serializable value (object/array/primitive). We require object/array
  // here because every meaningful operation carries structured data; this keeps
  // the skeleton honest about shape.
  for (const f of ['id', 'appId', 'workspaceId', 'actorId', 'kind']) {
    if (!isString(op[f])) {
      throw new TypeError(`operation ${label} field ${f} must be a non-empty string`);
    }
  }
  if (op.payload === null || typeof op.payload !== 'object' || Array.isArray(op.payload)) {
    throw new TypeError(`operation ${label} field payload must be a non-null object`);
  }
}

function validateList(ops, label) {
  if (!Array.isArray(ops)) {
    throw new TypeError(`${label} must be an array`);
  }
  for (let i = 0; i < ops.length; i++) {
    validateOperation(ops[i], `${label}[${i}]`);
  }
}

// ---------------------------------------------------------------------------
// mergeOperations
// ---------------------------------------------------------------------------

export function mergeOperations(left, right) {
  validateList(left, 'left');
  validateList(right, 'right');

  // All operations across both lists must share one namespace.
  const all = left.concat(right);
  if (all.length) {
    const ns = all[0];
    for (const op of all) {
      if (op.appId !== ns.appId || op.workspaceId !== ns.workspaceId) {
        throw new Error(
          `namespace mismatch: cannot merge appId/workspaceId ` +
          `(${op.appId}/${op.workspaceId}) with (${ns.appId}/${ns.workspaceId})`
        );
      }
    }
  }

  // Build a map keyed by operation id. A duplicate id must serialize identically.
  const map = new Map();
  for (const op of all) {
    const existing = map.get(op.id);
    if (existing) {
      if (canonicalSerialize(existing) !== canonicalSerialize(op)) {
        throw new Error(`conflict: operation id "${op.id}" present with differing payload`);
      }
      // identical under canonical form: keep the first instance (no-op)
    } else {
      map.set(op.id, op);
    }
  }

  // Deterministic order: sort by id ascending.
  const ids = Array.from(map.keys()).sort();
  const merged = ids.map((id) => map.get(id));

  // Defensive copy so callers cannot mutate our result by mutating the
  // original operation objects. Shallow-clone each op.
  return merged.map((op) => ({ ...op, payload: { ...op.payload } }));
}

// ---------------------------------------------------------------------------
// projectReception
// ---------------------------------------------------------------------------

export function projectReception(operations) {
  validateList(operations, 'operations');

  // All must belong to reception app.
  for (let i = 0; i < operations.length; i++) {
    if (operations[i].appId !== 'reception') {
      throw new Error(`projectReception only handles appId "reception"; got "${operations[i].appId}"`);
    }
  }

  // Idempotent union by operation id (same semantics as merge against empty).
  const map = new Map();
  for (const op of operations) {
    const existing = map.get(op.id);
    if (existing) {
      if (canonicalSerialize(existing) !== canonicalSerialize(op)) {
        throw new Error(`conflict: operation id "${op.id}" present with differing payload`);
      }
    } else {
      map.set(op.id, op);
    }
  }

  // Only check-in kind is modeled in this skeleton.
  const checkIns = [];
  for (const op of Array.from(map.values())) {
    if (op.kind === 'check-in') {
      const { attendeeId, name } = op.payload;
      if (!isString(attendeeId) || !isString(name)) {
        throw new TypeError(`check-in operation ${op.id} payload needs string attendeeId and name`);
      }
      checkIns.push({ id: op.id, attendeeId, name });
    }
  }

  // Count each attendee once but keep the full event list for audit.
  // When an attendee has multiple check-ins, the name comes from the
  // operation with the canonical earliest (lexicographically smallest) id so
  // the result does not depend on input order.
  const seenAttendees = new Map(); // attendeeId -> earliest checkIn record
  for (const c of checkIns) {
    const existing = seenAttendees.get(c.attendeeId);
    if (!existing || c.id < existing.id) {
      seenAttendees.set(c.attendeeId, c);
    }
  }

  const uniqueAttendees = Array.from(seenAttendees.values());
  // Sort unique by attendeeId then id for deterministic output.
  uniqueAttendees.sort((a, b) =>
    a.attendeeId < b.attendeeId ? -1 : a.attendeeId > b.attendeeId ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );

  // Full event log, deterministic by operation id.
  const events = Array.from(map.values())
    .map((op) => ({ ...op, payload: { ...op.payload } }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    events,                 // all original check-in operations, deduped by id, sorted by id
    attendeeCount: uniqueAttendees.length,
    attendees: uniqueAttendees.map((c) => ({ attendeeId: c.attendeeId, name: c.name })),
  };
}
