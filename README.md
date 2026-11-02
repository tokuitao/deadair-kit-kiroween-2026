# DeadAir Kit

Two offline field apps built from one reusable skeleton: keep the desk moving
through a connection failure, then carry records between devices by QR.
Built as a new Kiroween 2026 project.

[Open the prototype](https://tokuitao.github.io/deadair-kit-kiroween-2026/) · [Reception](https://tokuitao.github.io/deadair-kit-kiroween-2026/apps/reception/) · [Equipment lending](https://tokuitao.github.io/deadair-kit-kiroween-2026/apps/lending/)

- **Reception:** check people in, find an attendee, and count each attendee once
  while retaining the original check-in trail.
- **Equipment lending:** record loans and returns, then show overlapping loans
  when disconnected devices exchange histories. Return the selected loan to
  resolve an overlap while preserving both records.

Both apps share immutable event union, namespace validation, QR transport and
camera lifecycle. Their distinct interfaces live in `apps/reception` and
`apps/lending`. No account or data backend is required at runtime.

## Run locally

Requires Node.js 24 or newer.

```sh
npm ci
npm test
npm run build
npm run preview
```

Open `http://localhost:5127`. For independent storage on the same computer,
also open `http://127.0.0.1:5127`. These are two origins on one computer;
physical phone/camera testing remains a separate verification step.

## Try a handoff

1. Initially load the same app on both devices with a connection. Use the same
   workspace name. Wait for that first load before going offline.
2. Create records on the sender and choose **Create handoff QR**. A small
   handoff fits one code; a larger one becomes a numbered sequence.
3. On the receiver choose **Scan with camera**. On the sender choose
   **Play sequence**, or step through **Previous / Next**. The receiver shows
   how many distinct parts have arrived. Repeats and any arrival order are safe.
4. Once every part is verified, the camera stops and an import preview appears.
   Review it and choose **Import records**. Partial handoffs never save records.
5. Image files also work: **Download this QR PNG** on the sender and **Read QR
   image** on the receiver, once per part. JSON export/import is a backup.
6. Repeat the same handoff: original records must not be duplicated. For lending,
   try independent loans for one item; handoff reveals the overlap and returning
   the appropriate loan resolves it.

**Stop camera** releases the stream while keeping collected parts in this page.
**Reset received QR** clears that temporary collection. A reload discards partial
parts; records already imported or created stay in browser storage.

## Capacity and compatibility

Large handoffs use optional native deflate, base64 chunks and a SHA-256 checksum.
The sender offers **Use uncompressed QR for older browsers**. If the receiver
cannot decompress, select that option and make a new handoff, or use JSON.

- Each QR frame is at most 1,600 UTF-8 bytes; a sequence is at most 64 parts.
- Encoded payloads are bounded to 48 KB before base64. Compressed data is read
  with a 500 KB decompressed limit; envelopes contain at most 1,000 operations.
- In the measured QA fixture, 50 UUID-based Japanese attendee records (13.5 KB
  JSON) used 3 compressed QR parts or 19 uncompressed parts. Actual size depends
  on the records. Larger histories explicitly require the JSON backup.
- JSON imports are at most 500 KB / 1,000 operations. All history is exchanged;
  incremental peer acknowledgements are future work.

QR contains the actual records, including names. Exported images and JSON files
are copies of those records. The checksum detects corruption; this prototype
does not authenticate peers or encrypt handoffs.

## Offline behavior and verification

The service worker precaches runtime assets after an initial connected load.
Records use browser storage; clearing it removes records, so export a backup.
Disconnected devices cannot prevent two simultaneous loans. The lending app
retains both and surfaces the overlap after histories meet.

Camera access starts explicitly, requests video only, and processes frames
locally. It stops on completion, cancellation, hidden/pagehide and errors.
HTTPS or localhost and a supported camera/browser are required. No frames or
records are uploaded, and no runtime AI service is called.

Automated checks cover domain invariants, namespace isolation, corrupt or mixed
QR parts, shuffled/repeated/missing parts, bounded decompression and reset races.
Browser QA uses isolated origins, actual generated QR images and synthetic
canvas MediaStreams to exercise video/QR/preview/confirmation. Physical camera
and phone validation remains pending. Test success does not establish adoption
or competition placement.

## How Kiro was used

Kiro CLI 2.37.1 (`auto` model) generated the initial shared engine, its tests and
`.kiro/steering/project.md`. Independent review found mixed-namespace imports and
order-dependent attendee naming; Kiro fixed them and added four regression cases.
The final tests were executed independently.

For camera handoff, Codex wrote requirements first. Kiro read them, wrote the
initial design/tasks, generated the first scanner and five media-stub tests, and
partially wired the interface. Codex completed the feature after a service
throttling error, fixed lifecycle races and added focused regressions. The workflow
uses CLI steering and specification files; physical verification is tracked separately.

Codex authored the app interfaces, lending projection, QR sequence protocol and
controls, packaging and independent browser verification. The `.kiro/specs/`
files record the requirements and the actual implementation/verification scope.

## License

Project code is MIT licensed. Built `vendor/LICENSES.txt` preserves the dependency
licenses: qrcode-generator 2.0.4 (MIT, Kazuhiko Arase) and jsQR 1.4.0 (Apache-2.0).
