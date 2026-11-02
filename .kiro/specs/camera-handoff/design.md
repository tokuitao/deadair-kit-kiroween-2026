# Camera handoff design

Kiro created the initial design from requirements.md before implementation.
Codex updated this final design after independent lifecycle review and a Kiro
service throttling error. This was CLI specification-guided development.

## Shared scanner
`src/camera.mjs` exposes `createCameraScanner(deps)` with `start(onDecode,
onStatus)`, `stop()` and `isActive()`. Dependencies provide getUserMedia,
jsQR, animation-frame scheduling, a video element and an optional canvas factory.
Tests inject media and canvas stubs without replacing browser globals.

Each start has a monotonically increasing generation. Stop invalidates pending
permission, playback and frame callbacks. A late permission result stops only
its own tracks; it cannot replace or stop a newer session. Playback, decoder
and ended-stream errors stop tracks and offer an image/JSON fallback.

The video-only request prefers the environment camera and a 1280×720 source.
Decoding is local, throttled to 120 ms, and sampled at a maximum 960 px dimension.
On a decode, hardware is released before the application validates the text.
Validation errors leave the scanner idle and display the specific import error.

## User interface and import
Both apps share the scanner and the same controls. Start is explicit; stop is
available during permission and playback waits as well as active scanning.
State callbacks update controls and video visibility on every exit path.
The app uses existing readEnvelope/preview and requires explicit import
confirmation. Hidden documents, pagehide and choosing an import file stop scans.
No audio, frames or records are uploaded. Image/JSON import remains available.

## Offline and checks
camera.mjs is precached. Service-worker requests read only the current revision
cache so an older cache cannot shadow updated assets.
Nine media-stub tests cover cleanup, denial, unavailability, overlapping starts,
pending playback, playback failure and decode errors. A browser canvas-stream
check exercises real video playback, jsQR Unicode decoding, preview, confirmation
and denial fallback. These are synthetic checks; physical cameras and phones
remain unverified. No IDE workflow, hooks or MCP use is claimed.
