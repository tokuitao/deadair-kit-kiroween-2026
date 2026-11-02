# DeadAir Kit — Project Steering

## Current scope
Offline-first browser event-union skeleton with two working field apps.
The initial engine and tests were generated and iterated using Kiro CLI;
Codex subsequently added the interfaces, lending projection, QR transport,
packaging, and independent browser checks. Keep this attribution accurate.
All runtime assets are local. Records persist in localStorage. There is no
data backend or runtime AI API.

## Apps
Two distinct apps share one workspace event-log model:
- **reception** — check-in operations (attendeeId, name).
- **lending** — loan and return operations; returns reference a loan ID.

Apps are partitioned by `appId`. A single merge must never span apps or
workspaces.

## Operation shape
Every operation: `{ id, appId, workspaceId, actorId, kind, payload }`.
Operation `id` is immutable and unique within a workspace. Operations are
append-only; nothing is edited or deleted.

## Merge rules
- Set-union by operation `id`.
- Same `id` must be byte-identical under canonical key-sorted serialization, else
  it is an honest conflict — never silently overwrite.
- Reject mixed `appId` / `workspaceId`.
- Reject malformed input.
- Deterministic output order (sorted by `id`).

## Offline conflicts
An operation-ID collision with different content is rejected.
Two different loan IDs can legitimately name the same physical item while
devices are disconnected. Preserve both records and display the overlap
after handoff. Operators resolve it by returning the selected loan.
Never claim global double-allocation prevention while disconnected.

## Honesty
- No fake success claims. Functions return a correct result or throw.
- Counts are exact (each attendee counted once) but every original event is
  retained for audit.
- Projections are pure: inputs are never mutated.

## Transport and build
- Actual QR encoding uses qrcode-generator 2.0.4. PNG import uses jsQR 1.4.0.
- QR limit: 1,600 UTF-8 bytes. JSON fallback: 500 KB and 1,000 operations.
- App/workspace validation and preview happen before import commits.
- Use textContent for user/imported data.
- npm run build creates dist with local vendor assets and their licenses.
- npm test runs domain and transport tests.
- Initial connected loading is required for the service worker cache.
- Live camera scanning and authenticated/encrypted peer exchange are pending.

## Working boundaries
Work only in this checkout. Do not read parent history, unrelated projects,
credentials, or secrets. Do not claim unperformed tests or tool usage.
Normal code work is authorized; report concrete blockers and preserve a
working version rather than repeatedly expanding optional verification.
