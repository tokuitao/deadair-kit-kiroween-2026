# Bounded QR sequence design

Codex implemented this increment. Kiro read the prewritten requirements but did
not create source files within its eight-minute initial allocation; the process
was stopped. No protocol generation or hardware verification is attributed to it.

## Wire and resource bounds
Small validated envelopes retain version-1 JSON QR compatibility. Larger ones
use version-2 frames with namespace, full SHA-256 payload ID, encoding, zero-based
index, total and base64 chunk. Non-final chunks are exactly 1000 characters;
frames are <=1600 UTF-8 bytes and collections <=64 parts / 48 KB encoded bytes.
Deflate is optional and selected only when smaller. A raw path remains available.

A receiver binds one transfer after frame validation. A map retains distinct
parts; exact duplicates do not advance progress. Foreign metadata and conflicting
indices fail without overwriting accepted parts. Once complete, decode base64,
check digest, decompress with a streaming byte cap, validate UTF-8 and readEnvelope.
A generation invalidates completion after reset. Concurrent final accepts share
one completion promise; returned envelopes are defensive copies.

## Interfaces and camera
Sender controls provide numbered frames, previous/next/play, PNG export and raw
compatibility mode. Receiver shows progress/reset and never commits partial data.
The camera awaits each collector callback; explicit true requests another frame.
Completion/error/manual stop/hidden/pagehide releases tracks. UI reset invalidates
async results before a preview can appear. Every final import requires confirmation.
File imports validate namespace and merge before replacing a pending collection.

The service worker precaches qr-sequence.mjs. Current-cache lookup prevents an
older asset cache from shadowing updated code. Record lists are height-bounded
and a Carry update link keeps the handoff reachable with larger datasets.

## Verification scope
Ten protocol and eleven camera tests cover the meaningful failure modes.
A 50-record fixture measures compressed/raw counts. Independent-origin browser
QA uses actual generated PNGs and synthetic video, and stops the source server.
Physical phone/camera verification remains separate and unconfirmed.
