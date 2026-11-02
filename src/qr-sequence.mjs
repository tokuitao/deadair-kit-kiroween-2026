import { readEnvelope, QR_BYTE_LIMIT, FILE_BYTE_LIMIT } from './transport.mjs';

export const MAX_QR_PARTS = 64;
export const QR_PART_DATA_CHARS = 1000;
const MAX_ENCODED_BYTES = MAX_QR_PARTS * QR_PART_DATA_CHARS / 4 * 3;
const utf8 = new TextEncoder();

function namespace(appId, workspaceId) {
  if (!['reception', 'lending'].includes(appId) || typeof workspaceId !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(workspaceId))
    throw new Error('Invalid QR app or workspace.');
}
async function digest(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('QR sequences need HTTPS or localhost. Use the JSON backup.');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function unbase64(text) {
  if (!text.length || text.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw new Error('Invalid QR base64 data.');
  let binary;
  try { binary = atob(text); } catch { throw new Error('Invalid QR base64 data.'); }
  if (btoa(binary) !== text) throw new Error('Non-canonical QR base64 data.');
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
async function readBounded(stream, limit) {
  const reader = stream.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Decompressed QR handoff exceeds the 500 KB limit.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

export async function createQrFrames(envelope, { compress = true } = {}) {
  if (!envelope || typeof envelope !== 'object') throw new Error('Invalid handoff.');
  const { appId, workspaceId } = envelope;
  namespace(appId, workspaceId);
  const validated = readEnvelope(JSON.stringify(envelope), appId, workspaceId);
  const text = JSON.stringify(validated);
  let bytes = utf8.encode(text), encoding = 'identity';
  if (bytes.length <= QR_BYTE_LIMIT) return [text];
  if (compress && typeof CompressionStream === 'function' && typeof DecompressionStream === 'function') {
    try {
      const compressed = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
      if (compressed.length < bytes.length) { bytes = compressed; encoding = 'deflate'; }
    } catch { /* Unsupported native compression falls back to the raw format. */ }
  }
  if (bytes.length > MAX_ENCODED_BYTES) throw new Error('This history exceeds 64 QR parts. Export a JSON file instead.');
  const encoded = base64(bytes), transferId = await digest(bytes);
  const total = Math.ceil(encoded.length / QR_PART_DATA_CHARS);
  const frames = Array.from({ length: total }, (_, index) => JSON.stringify({
    deadair: 2, appId, workspaceId, transferId, encoding, index, total,
    chunk: encoded.slice(index * QR_PART_DATA_CHARS, (index + 1) * QR_PART_DATA_CHARS),
  }));
  if (frames.some(frame => utf8.encode(frame).length > QR_BYTE_LIMIT)) throw new Error('QR part exceeds its byte limit. Export JSON instead.');
  return frames;
}

function validatePart(frame, appId, workspaceId) {
  if (!frame || Array.isArray(frame) || frame.deadair !== 2 || Object.keys(frame).length !== 8) throw new Error('Unsupported QR sequence format.');
  if (frame.appId !== appId || frame.workspaceId !== workspaceId) throw new Error('This QR belongs to a different app or workspace.');
  if (!/^[a-f0-9]{64}$/.test(frame.transferId) || !['identity', 'deflate'].includes(frame.encoding)) throw new Error('Invalid QR transfer metadata.');
  if (!Number.isInteger(frame.total) || frame.total < 1 || frame.total > MAX_QR_PARTS || !Number.isInteger(frame.index) || frame.index < 0 || frame.index >= frame.total)
    throw new Error('Invalid QR part count or index.');
  if (typeof frame.chunk !== 'string' || frame.chunk.length > QR_PART_DATA_CHARS || (frame.index < frame.total - 1 && (frame.chunk.length !== QR_PART_DATA_CHARS || frame.chunk.includes('='))))
    throw new Error('Invalid QR part length.');
  unbase64(frame.chunk); // Validate before retaining or binding a collection.
}
function empty() { return { transferId: null, encoding: null, total: 0, parts: new Map(), envelope: null, finishing: null }; }
function copy(envelope) { return JSON.parse(JSON.stringify(envelope)); }

export function createQrReceiver(appId, workspaceId) {
  namespace(appId, workspaceId);
  let state = empty(), generation = 0;
  function progress() { return { received: state.parts.size, total: state.total, complete: state.envelope !== null }; }
  function reset() { generation++; state = empty(); }
  async function finish(current, run) {
    const encoded = Array.from({ length: current.total }, (_, index) => current.parts.get(index)).join('');
    let bytes = unbase64(encoded);
    if (bytes.length > MAX_ENCODED_BYTES) throw new Error('QR transfer exceeds the encoded byte limit.');
    if (await digest(bytes) !== current.transferId) throw new Error('QR checksum mismatch. Reset received QR and try again.');
    if (current.encoding === 'deflate') {
      if (typeof DecompressionStream !== 'function') throw new Error('Compression is unavailable. Ask the sender for uncompressed QR or JSON.');
      try { bytes = await readBounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')), FILE_BYTE_LIMIT); }
      catch (error) { throw new Error('Could not read compressed QR: ' + error.message); }
    }
    if (bytes.length > FILE_BYTE_LIMIT) throw new Error('QR handoff exceeds 500 KB.');
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('The completed QR is not valid UTF-8.'); }
    const envelope = readEnvelope(text, appId, workspaceId);
    if (run !== generation || current !== state) throw new Error('QR transfer was reset. Scan the handoff again.');
    current.envelope = envelope;
    return envelope;
  }
  async function accept(text) {
    if (typeof text !== 'string' || text.length > QR_BYTE_LIMIT || utf8.encode(text).length > QR_BYTE_LIMIT) throw new Error('QR frame exceeds its byte limit.');
    let frame;
    try { frame = JSON.parse(text); } catch { throw new Error('This is not a valid DeadAir QR.'); }
    if (frame?.deadair === 1) {
      const envelope = readEnvelope(text, appId, workspaceId);
      if (state.transferId && !state.envelope) throw new Error('Another QR transfer is in progress. Reset received QR first.');
      state = empty(); state.transferId = 'legacy'; state.total = 1; state.parts.set(0, text); state.envelope = envelope;
      return { ...progress(), envelope: copy(envelope) };
    }
    validatePart(frame, appId, workspaceId);
    if (state.transferId && (state.transferId !== frame.transferId || state.encoding !== frame.encoding || state.total !== frame.total))
      throw new Error('A different QR transfer is in progress. Reset received QR first.');
    if (!state.transferId) { state.transferId = frame.transferId; state.encoding = frame.encoding; state.total = frame.total; }
    const previous = state.parts.get(frame.index);
    if (previous !== undefined && previous !== frame.chunk) throw new Error('Conflicting QR part. Reset received QR and try again.');
    state.parts.set(frame.index, frame.chunk);
    if (state.parts.size < state.total) return progress();
    const current = state, run = generation;
    if (!current.finishing) current.finishing = finish(current, run);
    const envelope = await current.finishing;
    if (current !== state || run !== generation) throw new Error('QR transfer was reset. Scan the handoff again.');
    return { ...progress(), envelope: copy(envelope) };
  }
  return { accept, reset, progress };
}
