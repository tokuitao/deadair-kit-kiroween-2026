# Camera handoff requirements

Prepared before implementation by Codex. Kiro will read this specification,
write a small design/tasks document and implement the feature. This is a
CLI specification-guided change, not a claim of using an IDE workflow.

## Goal
An operator can point the receiving device at the sending device's handoff
QR without moving an image file. Keep image/JSON import available.

## Acceptance criteria
1. The app MUST request video only after an explicit Scan with camera action;
   it MUST never request microphone access. Prefer an environment-facing camera.
2. The app MUST explain HTTPS/browser/device limitations, permission denial,
   unavailable cameras and playback errors, with an image/JSON fallback.
3. While starting or scanning, the operator MUST be able to stop. When a pending
   permission request resolves after stop, every returned track MUST be stopped.
4. On successful decode, manual stop, document hidden, pagehide or camera error,
   the app MUST stop all tracks and release srcObject and scheduled work.
5. A decoded code MUST use the existing readEnvelope/preview path. Scanning
   MUST NOT import records automatically or skip app/workspace validation.
6. The decode loop MUST run locally with the existing jsQR dependency, throttle
   frame work, and cap the sampled image size. No frames or records are uploaded.
7. Reception and lending MUST share the same implementation and visible controls.
8. The camera module MUST be included in the service-worker precache. Existing
   QR image, JSON and record workflows MUST continue to work.
9. Meaningful automated checks MUST cover pending-start cancellation, stopping
   an active stream, successful decoding cleanup, and denial/unavailable errors.
   Simulated media tests MUST NOT be presented as physical camera validation.
10. README and steering MUST accurately distinguish implemented functionality,
    automated/synthetic checks, and physical-device verification still pending.

## Scope boundaries
No new dependencies, accounts, paid APIs, microphone, record backend, peer
authentication, multi-QR protocol or framework rewrite in this increment.
Work only in this repository. Do not read parent directories or credentials.
