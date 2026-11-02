# Bounded QR-sequence requirements

Written by Codex before implementation. The existing reception handoff exceeds
one QR at ten typical records (2,646 bytes). The goal is a practical 50-record
QR-only handoff. This is CLI specification-guided work, not an IDE-workflow claim.

## Public protocol API
Implement only `src/qr-sequence.mjs` and `test/qr-sequence.test.mjs` for this task.
Read `src/transport.mjs` and import its validation and size constants. Do not
edit UI, camera, dependencies or other files; Codex integrates those separately.
Export:
- `async createQrFrames(envelope, {compress = true} = {})`: string[]
- `createQrReceiver(appId, workspaceId)`: {accept: async function(text), reset,
  progress: function()}. `accept` returns {received,total,complete,envelope?}.
- Constants MAX_QR_PARTS=64 and QR_PART_DATA_CHARS=1000 (for tests/UI).

## Sending
1. Validate via existing readEnvelope. Accept only reception/lending and a
   workspace of 1–64 alphanumeric/underscore/hyphen characters.
2. Preserve legacy single-QR version-1 JSON when validated UTF-8 text fits the
   current 1600-byte limit. Larger data uses sequence frames.
3. If requested and CompressionStream/DecompressionStream are available, deflate
   UTF-8 bytes locally, using compressed bytes only when smaller. Otherwise use
   identity. `compress:false` always offers the compatible raw path. No new deps.
4. Encode bytes as standard base64, split into 1000-character chunks. Each
   sequence frame is JSON: {deadair:2,appId,workspaceId,transferId,encoding,index,
   total,chunk}. index is zero-based; encoding is deflate or identity;
   transferId is the full 64-character lowercase SHA-256 hex digest of the
   encoded bytes. SHA-256 detects corruption; it is NOT peer authentication.
5. Enforce <=64 parts and <=1600 UTF-8 bytes per frame. If larger, explicitly
   offer JSON backup; never silently omit records. JSON remains <=500 KB/1000 ops.

## Receiving
6. Reject malformed, oversized or out-of-range frames BEFORE retaining data.
   Validate namespace, transferId, encoding, integer index/total, and strict
   canonical base64 chunk shape/length. Non-final chunks are exactly 1000 chars,
   multiples of four with no padding; padding is allowed only in the final part.
7. Receive only one transfer at a time; bind metadata on the first valid part.
   A different ID/namespace/encoding/total must never overwrite the collection.
   Legacy JSON is accepted only through existing readEnvelope; do not silently
   replace an unfinished multipart collection with a different legacy handoff.
8. Missing parts remain incomplete. Accept any arrival order; repeated identical
   parts do not increase progress. Same index with different bytes is rejected.
9. After all parts arrive, join/decode, verify digest BEFORE decompression, then
   perform bounded streaming decompression. Abort reading after FILE_BYTE_LIMIT
   bytes and validate UTF-8 fatally. A small compressed input must not inflate
   beyond the cap. A receiver without decompression support must explicitly ask
   for uncompressed QR or JSON.
10. Validate the complete text with readEnvelope before returning complete:true.
    The module never commits local records. Sequential or concurrent accepts
    must not produce inconsistent progress. Reset during async completion must
    invalidate the old completion so it cannot return an importable envelope.
11. `reset()` clears only this in-memory collection. Retain no global state,
    records, camera frames or unbounded queues. `progress()` exposes received,
    total and complete but not mutable maps. Errors must leave existing records
    untouched and allow explicit reset/retry.

## Meaningful checks
- 50 realistic UUID-based Unicode attendee records round-trip, all frame bytes
  below cap; shuffled and repeated parts preserve exact content.
- Missing parts never complete. Mismatched ID/namespace/metadata and conflicting
  duplicate indices are rejected without losing already accepted good parts.
- Deliberate byte corruption fails the digest; encoded part limits are enforced.
- Legacy JSON and compress:false still work; no dependency on compression APIs
  in raw paths. A deflated bomb larger than the JSON cap is rejected.
- Reset cannot surface an old asynchronous completion; receiver state can be
  reused after reset. Tests are automated/synthetic, not physical-device proof.

## Integration contract for Codex
Sender offers previous/next/play and compatibility mode. Receiver shows part
progress and reset, keeps camera scanning until completion, stops on error,
hidden/pagehide/manual stop/completion, validates before preview and requires
explicit import. UI must serialize decoding and ignore results invalidated by
reset. These UI changes are outside this Kiro subtask.

## Sources checked 2026-11-02
- https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream
- https://developer.mozilla.org/en-US/docs/Web/API/CompressionStream/CompressionStream
- https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream
Node 24.22.1 exposes CompressionStream, DecompressionStream, base64 and SHA-256.
