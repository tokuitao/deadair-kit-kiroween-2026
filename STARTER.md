# Reuse the DeadAir skeleton

This repository is a runnable starter and two distinct applications built on
it. Reception counts attendees; lending tracks active loans, preserves overlaps
and resolves a selected loan through a return event. Both reuse the same event
union and handoff lifecycle. The initial shared engine and its tests were built
with Kiro CLI before the application interfaces were added.

## Start from the working baseline

Fork or clone this MIT repository, then run `npm ci`, `npm test`,
`npm run build`, and `npm run preview` with Node.js 24 or newer.

Open both `http://localhost:5127` and `http://127.0.0.1:5127` for isolated
browser storage on one computer. Use the same app and workspace on each side.
These origins are a development technique, not physical-device validation.

## What to reuse

| File | Responsibility |
| --- | --- |
| `src/engine.mjs` | Immutable operations, canonical comparison, namespace validation, union by ID and reception projection |
| `src/lending.mjs` | Loan/return projection and visible overlapping loans |
| `src/transport.mjs` | Bounded JSON envelope and operation validation |
| `src/qr-sequence.mjs` | Optional compression, bounded QR parts, checksum and complete reassembly |
| `src/camera.mjs` | Explicit video-only scanning, serialized validation and stream cleanup |
| `src/app.mjs` | Browser storage, input actions, projections, sender and preview/confirmation |
| `src/field.css` | Shared layout and record/handoff controls |
| `src/sw.js` | Initial-load precache and offline runtime |
| `apps/reception/`, `apps/lending/` | Separate application entry points |

## Adapt a workflow with Kiro

1. Describe the operator's completed task and its conflicts before changing
   code. Write requirements under `.kiro/specs/<workflow>/requirements.md`.
   Include a concrete example of two disconnected histories meeting.
2. Run Kiro CLI from the repository in a normal interactive terminal. Ask it to
   read `.kiro/steering/project.md` and the requirements, write a small design
   and task list, then propose the smallest implementation. Use actual
   `read`, `write` and `shell` tools; approve only the intended repository scope.
3. For a new operation kind or app, extend the explicit app/kind and payload
   checks in `transport.mjs`. Keep `engine.mjs` as the generic operation-shape,
   namespace and union layer; add a pure projection like `lending.mjs`.
   Envelope validation is deliberately specific: a new app ID alone is not
   sufficient to add an arbitrary workflow.
4. Put its entry point in a new `apps/<workflow>/` folder. Wire the fields and
   projection in `app.mjs`, preserving safe text rendering and shared transport.
   The build copies app folders; add the new entry point to the service-worker
   precache list as well.
5. Review counterexamples independently. At minimum check namespace isolation,
   repeat imports, different arrival orders, legitimate overlapping work and
   explicit resolution. Keep an original event rather than overwriting evidence.
6. Run the changed checks and build. In independent browser origins, complete
   the user's task, carry actual QR images, preview and confirm the import,
   reload offline, and carry a resolution back. Record which checks used real
   hardware and which used browser stubs or synthetic streams.

Example Kiro brief (an extension exercise, not a completed third application):

> Read the project steering and the new requirements. Design a consumable-kit
> workflow that retains independent issue events, shows negative stock after
> histories meet, and records explicit corrections. Reuse the event-union and
> validated handoff modules. Do not claim that offline copies can prevent
> simultaneous issues. Keep both existing apps working. Explain schema changes
> and add only meaningful counterexample checks before implementation.

## A completed Kiro-guided extension

The camera handoff is the implemented example. Codex wrote its requirements
first. Kiro read them, created initial design/tasks, generated the first scanner
and five media-stub checks, and partially wired both apps. Codex completed the
integration after service throttling, repaired lifecycle races and independently
verified the browser path. The specification and final attribution are in
`.kiro/specs/camera-handoff/` and the README.

Keep new attribution equally precise. The multi-QR protocol was authored by
Codex; its specification is not evidence that Kiro implemented it. Physical
phone/camera validation and first-time-user feedback remain pending.
