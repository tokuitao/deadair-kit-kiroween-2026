# How Kiro contributed

DeadAir Kit used **Kiro CLI 2.37.1**, the `auto` model, steering and specification
files. This describes completed work, not a list of features added for a submission.
The project does not claim Kiro IDE, custom agents, hooks, MCP or powers usage.

## Shared engine: implementation followed by counterexamples

Kiro generated the initial [shared engine](src/engine.mjs), 19 engine checks and
the first project steering. Independent review then found two gaps:

| Counterexample | Required result and Kiro's repair |
| --- | --- |
| A single input list contains mixed workspaces, including when the other list is empty. | Validate the namespace across every operation in the combined input, then reject the handoff. Kiro fixed the engine and added three mixed-namespace regression cases. |
| Two check-ins for the same attendee have different names and arrive in opposite orders. | The projected name must be independent of arrival order. Kiro selected the operation with the lexicographically smallest ID and added a regression case. This is a deterministic tie-break, not a claim about chronological truth. |

These four additions brought the engine checks to 23. Their implementation and
regressions are visible in [the engine checks](test/engine.test.mjs). The full
49-check project suite also includes Codex-authored lending, transport, camera
and bounded multi-QR cases. Tests were run independently; a successful CLI exit
alone was not treated as evidence that files existed or worked.

[Project steering](.kiro/steering/project.md) records immutable IDs, namespace
isolation, retained conflicts and precise attribution. Steering made these
constraints explicit. Independent counterexamples were still necessary; the
initial generated implementation did not satisfy every invariant.

## Camera handoff: requirements before implementation

Codex prepared [camera requirements](.kiro/specs/camera-handoff/requirements.md)
before asking Kiro to implement the feature. The contract included video-only
permission, explicit start, a preview before import, and cleanup even if camera
permission arrives after the operator has stopped scanning.

Kiro read the requirements, produced initial design/tasks, generated the first
[scanner](src/camera.mjs) and five media-stub checks, and partially wired the
interface. After a service throttling error, Codex completed both app interfaces,
fixed cancellation/restart and pending-playback races, and added focused checks.
The final [design](.kiro/specs/camera-handoff/design.md) records that division.

Compared with an open-ended request to add a scanner, the written contract made
late-start cleanup and import confirmation concrete review targets. It did not
make incomplete generation successful: those paths were repaired and checked
after the first implementation.

## What remains attributable to Codex

Codex authored the interfaces, lending projection, transport, multi-QR protocol
and controls, packaging, independent browser verification and presentation.
The multi-QR specification is not evidence that Kiro implemented the protocol.

Kiro editing used a standard interactive PTY with its actual `read`, `write` and
`shell` tools. Non-interactive editing permission failures were stopped rather
than reported as successful changes. No account credentials or raw private
terminal transcripts are needed to run or review the public repository.

The software checks and sample exercise do not establish adoption or physical
camera/phone usability. The public demonstration identifies its browser-origin
and QR-image scope.
