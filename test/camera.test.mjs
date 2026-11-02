import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraScanner } from '../src/camera.mjs';

// ---------------------------------------------------------------------------
// Test infrastructure: minimal DOM-ish stubs for injected deps.
// No real camera is used. These are synthetic checks only.
// ---------------------------------------------------------------------------

/** Fake MediaStream with track stubs whose stop() calls are recorded. */
function makeStream() {
  const tracks = [
    { stopped: false, stop() { this.stopped = true; } },
    { stopped: false, stop() { this.stopped = true; } },
  ];
  return {
    getTracks: () => tracks,
    _tracks: tracks,
  };
}

/** Fake video element. */
function makeVideo(vw, vh) {
  return {
    videoWidth: vw,
    videoHeight: vh,
    readyState: 4,
    srcObject: null,
    play() { return Promise.resolve(); },
  };
}

/**
 * Build deps with controllable getUserMedia and jsQR.
 * Injects a canvas so tests do not replace browser globals.
 */
function makeHarness({ video, jsqrResult, getUserMediaImpl }) {
  let rafCallback = null;
  const requestAnimationFrame = cb => { rafCallback = cb; return 1; };
  const cancelAnimationFrame = () => { rafCallback = null; };

  const fakeCanvas = { width: 0, height: 0, _ctx: null };
  const fakeCtx = {
    willReadFrequently: true,
    drawImage(_v, _dx, _dy, w, h) { fakeCtx._w = w; fakeCtx._h = h; },
    getImageData() {
      const w = fakeCtx._w || 640, h = fakeCtx._h || 480;
      return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
    },
  };
  fakeCanvas.getContext = () => fakeCtx;

  const jsQR = (_data, w, h) => {
    if (typeof jsqrResult === 'function') return jsqrResult(w, h);
    return jsqrResult || null;
  };

  return {
    deps: { getUserMedia: getUserMediaImpl, jsQR, requestAnimationFrame, cancelAnimationFrame, video, createCanvas: () => fakeCanvas },
    getRafCallback: () => rafCallback,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('pending-start cancellation: stop before permission resolves stops all tracks', async () => {
  let resolveGum;
  const getUserMediaImpl = () => new Promise(resolve => { resolveGum = resolve; });
  const video = makeVideo(640, 480);
  const harness = makeHarness({ video, jsqrResult: null, getUserMediaImpl });

  const scanner = createCameraScanner(harness.deps);
  scanner.start(() => {}, () => {});

  // Stop while still starting (permission pending)
  scanner.stop();
  assert.equal(scanner.isActive(), false, 'scanner should be idle after stop');

  // Now resolve the getUserMedia promise — tracks must be stopped
  const stream = makeStream();
  resolveGum(stream);

  // Allow microtasks to settle
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(stream._tracks.every(t => t.stopped), 'all tracks stopped after late resolution');
  assert.equal(video.srcObject, null, 'video.srcObject released');
});

test('stopping an active stream: all tracks stopped, srcObject null, no further RAF', async () => {
  const stream = makeStream();
  const getUserMediaImpl = () => Promise.resolve(stream);
  const video = makeVideo(640, 480);
  const harness = makeHarness({ video, jsqrResult: null, getUserMediaImpl });

  const scanner = createCameraScanner(harness.deps);
  scanner.start(() => {}, () => {});

  // Allow getUserMedia + play promises to resolve
  await Promise.resolve();
  await Promise.resolve();

  assert.ok(scanner.isActive(), 'scanner should be active (scanning)');

  scanner.stop();

  assert.ok(stream._tracks.every(t => t.stopped), 'all tracks stopped');
  assert.equal(video.srcObject, null, 'video.srcObject released');
  assert.equal(harness.getRafCallback(), null, 'RAF callback cleared');
  assert.equal(scanner.isActive(), false, 'scanner idle after stop');
});

test('successful decoding: onDecode called, tracks stopped, srcObject null, loop halted', async () => {
  const stream = makeStream();
  const getUserMediaImpl = () => Promise.resolve(stream);
  const video = makeVideo(320, 240);
  const decodedData = '{"deadair":1,"appId":"reception","workspaceId":"demo","operations":[]}';
  const harness = makeHarness({ video, jsqrResult: { data: decodedData }, getUserMediaImpl });

  const scanner = createCameraScanner(harness.deps);
  let decoded = null;
  scanner.start(data => { decoded = data; }, () => {});

  // Allow getUserMedia + play to resolve
  await Promise.resolve();
  await Promise.resolve();

  // The RAF loop is synchronous in our stub — the first loop() call runs
  // during the play().then(). If decode didn't fire yet, manually trigger RAF.
  const rafCb = harness.getRafCallback();
  if (rafCb && decoded === null) rafCb();

  assert.equal(decoded, decodedData, 'onDecode received the decoded data');
  assert.ok(stream._tracks.every(t => t.stopped), 'tracks stopped after decode');
  assert.equal(video.srcObject, null, 'srcObject released after decode');
  assert.equal(scanner.isActive(), false, 'scanner idle after decode');
  assert.equal(harness.getRafCallback(), null, 'no further RAF scheduled');
});

test('permission-denied error: onStatus receives denial message, returns to idle', async () => {
  const getUserMediaImpl = () => Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }));
  const video = makeVideo(640, 480);
  const harness = makeHarness({ video, jsqrResult: null, getUserMediaImpl });

  const scanner = createCameraScanner(harness.deps);
  const statuses = [];
  scanner.start(() => {}, msg => statuses.push(msg));

  await Promise.resolve();
  await Promise.resolve();

  assert.ok(statuses.some(s => s.includes('permission was denied')), 'denial message shown');
  assert.ok(statuses.some(s => s.includes('Read QR image') || s.includes('JSON file')), 'fallback mentioned');
  assert.equal(scanner.isActive(), false, 'scanner idle after denial');
});

test('unavailable-camera error: onStatus receives unavailable message', async () => {
  const getUserMediaImpl = () => Promise.reject(Object.assign(new Error('No camera'), { name: 'NotFoundError' }));
  const video = makeVideo(640, 480);
  const harness = makeHarness({ video, jsqrResult: null, getUserMediaImpl });

  const scanner = createCameraScanner(harness.deps);
  const statuses = [];
  scanner.start(() => {}, msg => statuses.push(msg));

  await Promise.resolve();
  await Promise.resolve();

  assert.ok(statuses.some(s => s.includes('No camera was found')), 'unavailable message shown');
  assert.equal(scanner.isActive(), false, 'scanner idle after error');
});

test('restart after cancellation isolates the late first permission result', async () => {
  const resolvers = [], video = makeVideo(640, 480);
  const harness = makeHarness({ video, getUserMediaImpl: () => new Promise(resolve => resolvers.push(resolve)) });
  const scanner = createCameraScanner(harness.deps);
  const firstStart = scanner.start(() => {}, () => {});
  scanner.stop();
  const secondStart = scanner.start(() => {}, () => {});
  const first = makeStream(), second = makeStream();
  resolvers[1](second); await secondStart;
  resolvers[0](first); await firstStart;
  assert.ok(first._tracks.every(t => t.stopped));
  assert.ok(second._tracks.every(t => !t.stopped));
  assert.equal(video.srcObject, second);
  assert.equal(scanner.isActive(), true);
  scanner.stop();
});

test('stopping during pending playback cannot restart the decode loop', async () => {
  const video = makeVideo(640, 480), stream = makeStream();
  let finishPlayback;
  video.play = () => new Promise(resolve => { finishPlayback = resolve; });
  const harness = makeHarness({ video, jsqrResult: {data:'must not decode'}, getUserMediaImpl: () => Promise.resolve(stream) });
  const scanner = createCameraScanner(harness.deps);
  let decoded = 0;
  const start = scanner.start(() => decoded++, () => {});
  await Promise.resolve();
  scanner.stop(); finishPlayback(); await start;
  assert.equal(decoded, 0);
  assert.equal(scanner.isActive(), false);
  assert.equal(harness.getRafCallback(), null);
  assert.ok(stream._tracks.every(t => t.stopped));
});

test('playback failure releases the acquired stream and offers a fallback', async () => {
  const video = makeVideo(640, 480), stream = makeStream(), statuses = [];
  video.play = () => Promise.reject(new Error('Autoplay blocked'));
  const harness = makeHarness({ video, getUserMediaImpl: () => Promise.resolve(stream) });
  const scanner = createCameraScanner(harness.deps);
  await scanner.start(() => {}, message => statuses.push(message));
  assert.equal(video.srcObject, null);
  assert.equal(scanner.isActive(), false);
  assert.ok(stream._tracks.every(t => t.stopped));
  assert.ok(statuses.some(message => message.includes('preview could not play') && message.includes('Read QR image')));
});

test('decoder errors stop hardware rather than leaving a running camera', async () => {
  const video = makeVideo(640, 480), stream = makeStream(), statuses = [];
  const harness = makeHarness({ video, jsqrResult: () => { throw new Error('Decode failed'); }, getUserMediaImpl: () => Promise.resolve(stream) });
  const scanner = createCameraScanner(harness.deps);
  await scanner.start(() => assert.fail('No valid decode'), message => statuses.push(message));
  assert.equal(scanner.isActive(), false);
  assert.equal(video.srcObject, null);
  assert.equal(harness.getRafCallback(), null);
  assert.ok(stream._tracks.every(t => t.stopped));
  assert.ok(statuses.some(message => message.includes('Decode failed')));
});
