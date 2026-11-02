/** Local QR scanner. Media acquisition, video and frame scheduling are injected. */
const THROTTLE_MS = 120;
const MAX_SAMPLE_DIM = 960;
const FALLBACK = ' Use Read QR image or Read JSON file instead.';

function cameraError(error) {
  if (['NotAllowedError', 'PermissionDeniedError'].includes(error?.name))
    return 'Camera permission was denied.' + FALLBACK;
  if (['NotFoundError', 'OverconstrainedError'].includes(error?.name))
    return 'No camera was found on this device.' + FALLBACK;
  if (error?.name === 'NotSupportedError')
    return 'Camera scanning needs HTTPS or localhost and a supported browser.' + FALLBACK;
  return 'Camera is unavailable: ' + (error?.message || 'unknown error') + '.' + FALLBACK;
}

export function createCameraScanner(deps) {
  const { getUserMedia, jsQR, requestAnimationFrame, cancelAnimationFrame, video } = deps;
  const canvas = deps.createCanvas ? deps.createCanvas() : document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let state = 'idle', stream = null, rafId = null, generation = 0;
  let onDecode = () => {}, onStatus = () => {}, lastDecodeTime = -Infinity;

  function stopTracks(value) { for (const track of value.getTracks()) track.stop(); }
  function notify(message, error = false) { onStatus(message, { state, error }); }
  function stop(message = 'Camera stopped.') {
    // Invalidate pending permission, playback and old frame callbacks first.
    generation++;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (stream) { const previous = stream; stream = null; stopTracks(previous); }
    video.srcObject = null;
    state = 'idle';
    lastDecodeTime = -Infinity;
    notify(message);
  }
  function fail(error) { stop(); notify(cameraError(error), true); }

  function decodeFrame() {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return null;
    const scale = Math.min(1, MAX_SAMPLE_DIM / Math.max(vw, vh));
    const w = Math.max(1, Math.round(vw * scale)), h = Math.max(1, Math.round(vh * scale));
    canvas.width = w; canvas.height = h;
    ctx.drawImage(video, 0, 0, w, h);
    const pixels = ctx.getImageData(0, 0, w, h);
    return jsQR(pixels.data, w, h)?.data || null;
  }

  async function loop(run) {
    if (run !== generation || state !== 'scanning') return;
    rafId = null;
    try {
      const now = Date.now();
      if (now - lastDecodeTime >= THROTTLE_MS) {
        lastDecodeTime = now;
        const data = decodeFrame();
        if (data) {
          // A multipart handler returns true to collect another frame. Awaiting
          // it serializes validation; no queue of frame callbacks can accumulate.
          let keepScanning;
          try { keepScanning = await onDecode(data); }
          catch (error) {
            if (run === generation) { stop(); notify('This QR could not be imported: ' + error.message, true); }
            return;
          }
          if (run !== generation || state !== 'scanning') return;
          if (keepScanning !== true) { stop('Handoff ready. Review it, then import. Camera stopped.'); return; }
        }
      }
      if (run === generation && state === 'scanning') rafId = requestAnimationFrame(() => loop(run));
    } catch (error) { fail(error); }
  }

  return {
    async start(decode, status) {
      if (state !== 'idle') return false;
      onDecode = decode; onStatus = status || (() => {});
      const run = ++generation;
      state = 'starting'; notify('Requesting camera access… You can cancel with Stop camera.');
      try {
        const received = await getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (run !== generation) { stopTracks(received); return false; }
        stream = received; video.srcObject = received;
        try { await video.play(); }
        catch { throw new Error('Camera preview could not play'); }
        if (run !== generation) return false;
        for (const track of received.getTracks()) track.addEventListener?.('ended', () => {
          if (run === generation) fail(new Error('Camera stream ended'));
        }, { once: true });
        state = 'scanning'; lastDecodeTime = -Infinity;
        notify('Scanning locally… Point at a handoff QR.');
        loop(run);
        return true;
      } catch (error) {
        // An old request must not alter a newer scanner session.
        if (run === generation) fail(error);
        return false;
      }
    },
    stop,
    isActive() { return state !== 'idle'; },
  };
}
