import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createQrFrames, createQrReceiver, MAX_QR_PARTS, QR_PART_DATA_CHARS } from '../src/qr-sequence.mjs';
import { makeEnvelope, readEnvelope, QR_BYTE_LIMIT, FILE_BYTE_LIMIT } from '../src/transport.mjs';

const APP = 'reception', WS = 'sequence-test';
function sample(count = 50) {
  const actorId = randomUUID(), createdAt = new Date().toISOString();
  return makeEnvelope(APP, WS, Array.from({ length: count }, (_, i) => ({
    id: randomUUID(), appId: APP, workspaceId: WS, actorId, kind: 'check-in',
    payload: { attendeeId: 'TICKET-' + i, name: '参加者 🛠️ ' + i }, createdAt,
  })));
}
async function collect(receiver, frames) {
  let result;
  for (const frame of frames) result = await receiver.accept(frame);
  return result;
}
function rawFrames(bytes, encoding = 'identity') {
  const encoded = Buffer.from(bytes).toString('base64');
  const total = Math.ceil(encoded.length / QR_PART_DATA_CHARS);
  const transferId = createHash('sha256').update(bytes).digest('hex');
  return Array.from({ length: total }, (_, index) => JSON.stringify({
    deadair: 2, appId: APP, workspaceId: WS, transferId, encoding, index, total,
    chunk: encoded.slice(index * QR_PART_DATA_CHARS, (index + 1) * QR_PART_DATA_CHARS),
  }));
}

test('50 Unicode attendees round-trip through bounded compressed QR parts in shuffled/repeated order', async () => {
  const envelope = sample(), frames = await createQrFrames(envelope);
  assert.ok(frames.length > 1);
  assert.ok(frames.every(frame => new TextEncoder().encode(frame).length <= QR_BYTE_LIMIT));
  const receiver = createQrReceiver(APP, WS), order = [...frames].reverse();
  await receiver.accept(order[0]);
  await receiver.accept(order[0]);
  assert.equal(receiver.progress().received, 1);
  const result = await collect(receiver, order);
  assert.equal(result.complete, true);
  assert.equal(result.received, frames.length);
  assert.deepEqual(result.envelope, readEnvelope(JSON.stringify(envelope), APP, WS));
});

test('missing parts never produce an importable envelope', async () => {
  const frames = await createQrFrames(sample(), { compress: false });
  const receiver = createQrReceiver(APP, WS);
  const result = await collect(receiver, frames.slice(0, -1));
  assert.equal(result.complete, false);
  assert.equal(result.envelope, undefined);
  assert.deepEqual(receiver.progress(), {received:frames.length - 1,total:frames.length,complete:false});
});

test('foreign transfers, namespaces and conflicting duplicate parts preserve accepted progress', async () => {
  const frames = await createQrFrames(sample(), { compress: false });
  const receiver = createQrReceiver(APP, WS), original = JSON.parse(frames[0]);
  await receiver.accept(frames[0]);
  const wrong = [
    {...original, transferId:'0'.repeat(64)},
    {...original, workspaceId:'other-desk'},
    {...original, appId:'lending'},
    {...original, encoding:'deflate'},
    {...original, total:original.total + 1},
    {...original, chunk:(original.chunk[0] === 'A' ? 'B' : 'A') + original.chunk.slice(1)},
  ];
  for (const frame of wrong) await assert.rejects(receiver.accept(JSON.stringify(frame)));
  assert.equal(receiver.progress().received, 1);
  await assert.rejects(receiver.accept((await createQrFrames(sample(1)))[0]), /in progress/);
  assert.equal((await collect(receiver, frames.slice(1))).envelope.operations.length, 50);
});

test('corrupted bytes fail integrity checks and reset permits a clean retry', async () => {
  const frames = await createQrFrames(sample(), { compress: false });
  const corrupted = [...frames], last = JSON.parse(corrupted.at(-1));
  last.chunk = (last.chunk[0] === 'A' ? 'B' : 'A') + last.chunk.slice(1);
  corrupted[corrupted.length - 1] = JSON.stringify(last);
  const receiver = createQrReceiver(APP, WS);
  await assert.rejects(collect(receiver, corrupted), /checksum/);
  assert.equal(receiver.progress().complete, false);
  receiver.reset();
  assert.equal((await collect(receiver, frames)).envelope.operations.length, 50);
});

test('frame and transfer bounds reject input before retaining a collection', async () => {
  const valid = JSON.parse((await createQrFrames(sample(), {compress:false}))[0]);
  const receiver = createQrReceiver(APP, WS);
  for (const text of ['x'.repeat(QR_BYTE_LIMIT + 1), 'あ'.repeat(QR_BYTE_LIMIT), ...[
    {...valid,total:MAX_QR_PARTS + 1}, {...valid,index:-1}, {...valid,index:valid.total},
    {...valid,index:0.5}, {...valid,chunk:'!!!!'}, {...valid,chunk:'AB=='},
    {...valid,transferId:'not-a-digest'}, {...valid,encoding:'rot13'},
  ].map(frame => JSON.stringify(frame))]) await assert.rejects(receiver.accept(text));
  assert.deepEqual(receiver.progress(), {received:0,total:0,complete:false});
  await assert.rejects(createQrFrames(sample(250), {compress:false}), /64 QR parts/);
});

test('legacy single QR and raw multipart transfer work without native compression', async t => {
  const previousC = globalThis.CompressionStream, previousD = globalThis.DecompressionStream;
  t.after(() => { globalThis.CompressionStream = previousC; globalThis.DecompressionStream = previousD; });
  globalThis.CompressionStream = undefined; globalThis.DecompressionStream = undefined;
  const single = await createQrFrames(sample(1));
  assert.equal(JSON.parse(single[0]).deadair, 1);
  assert.equal((await createQrReceiver(APP, WS).accept(single[0])).envelope.operations.length, 1);
  const raw = await createQrFrames(sample());
  assert.ok(raw.length > 1);
  assert.equal(JSON.parse(raw[0]).encoding, 'identity');
  assert.equal((await collect(createQrReceiver(APP, WS), raw)).envelope.operations.length, 50);
});

test('decompression is bounded even for a tiny valid compressed input', async () => {
  const bomb = new TextEncoder().encode(JSON.stringify({padding:'x'.repeat(FILE_BYTE_LIMIT + 1)}));
  const zipped = new Uint8Array(await new Response(new Blob([bomb]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
  assert.ok(zipped.length < 2000);
  await assert.rejects(collect(createQrReceiver(APP, WS), rawFrames(zipped, 'deflate')), /500 KB/);
});

test('invalid UTF-8 and unavailable decompression cannot return a handoff', async t => {
  await assert.rejects(collect(createQrReceiver(APP, WS), rawFrames(new Uint8Array([255,254]))), /UTF-8/);
  const compressed = await createQrFrames(sample());
  assert.equal(JSON.parse(compressed[0]).encoding, 'deflate');
  const previous = globalThis.DecompressionStream;
  t.after(() => { globalThis.DecompressionStream = previous; });
  globalThis.DecompressionStream = undefined;
  await assert.rejects(collect(createQrReceiver(APP, WS), compressed), /uncompressed QR or JSON/);
});

test('reset invalidates an asynchronous completion and allows a new collection', async () => {
  const frames = await createQrFrames(sample(), {compress:false}), receiver = createQrReceiver(APP, WS);
  await collect(receiver, frames.slice(0, -1));
  const oldCompletion = receiver.accept(frames.at(-1));
  receiver.reset();
  await assert.rejects(oldCompletion, /reset/);
  assert.deepEqual(receiver.progress(), {received:0,total:0,complete:false});
  assert.equal((await collect(receiver, frames)).envelope.operations.length, 50);
});

test('concurrent duplicate accepts share completion and cannot mutate the stored verified envelope', async () => {
  const frames = await createQrFrames(sample(), {compress:false}), receiver = createQrReceiver(APP, WS);
  const results = await Promise.all([...frames].reverse().concat(frames[0]).map(frame => receiver.accept(frame)));
  const verified = results.find(result => result.complete);
  assert.equal(verified.envelope.operations.length, 50);
  const originalName = verified.envelope.operations[0].payload.name;
  verified.envelope.operations[0].payload.name = 'Modified caller copy';
  const again = await receiver.accept(frames[0]);
  assert.equal(again.envelope.operations[0].payload.name, originalName);
  assert.equal(receiver.progress().received, frames.length);
});
