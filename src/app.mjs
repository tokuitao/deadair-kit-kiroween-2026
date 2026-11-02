import { mergeOperations, projectReception } from './engine.mjs';
import { projectLending } from './lending.mjs';
import { makeEnvelope, readEnvelope, qrText, FILE_BYTE_LIMIT } from './transport.mjs';
import { createCameraScanner } from './camera.mjs';

const $ = id => document.getElementById(id);
const appId = document.body.dataset.app;
const params = new URL(location.href).searchParams;
const candidate = params.get('workspace') || 'field-demo';
const workspaceId = /^[a-zA-Z0-9_-]{1,64}$/.test(candidate) ? candidate : 'field-demo';
const key = `deadair.v1.${appId}.${workspaceId}`;
let actorId, operations = [], incoming = null, storageBroken = false;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
try {
  actorId = localStorage.getItem('deadair.device.id') || crypto.randomUUID();
  localStorage.setItem('deadair.device.id', actorId);
  const saved = localStorage.getItem(key);
  if (saved) operations = readEnvelope(saved, appId, workspaceId).operations;
} catch (error) { storageBroken = true; status(`Local storage could not be read. Existing data has not been overwritten. ${error.message}`, true); }
$('device').textContent = `Device ${actorId?.slice(0, 8) || 'unavailable'} · ${appId}`;
$('workspace').value = workspaceId;
$('open-workspace').onclick = () => {
  const value = $('workspace').value.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(value)) return status('Use 1–64 letters, digits, underscores or hyphens for the workspace.', true);
  const url = new URL(location.href); url.searchParams.set('workspace', value); location.href = url;
};
function network() { $('network').textContent = navigator.onLine ? 'NETWORK AVAILABLE · SAVED LOCALLY' : 'OFFLINE · KEEP RECORDING'; $('network').classList.toggle('offline', !navigator.onLine); }
addEventListener('online', network); addEventListener('offline', network); network();
function event(kind, payload) { return { id: crypto.randomUUID(), appId, workspaceId, actorId, kind, payload, createdAt: new Date().toISOString() }; }
function commit(next, message) {
  if (storageBroken) throw new Error('Storage is unavailable. Existing data has not been overwritten.');
  const envelope = readEnvelope(JSON.stringify(makeEnvelope(appId, workspaceId, next)), appId, workspaceId);
  localStorage.setItem(key, JSON.stringify(envelope)); operations = envelope.operations; render(); $('qr-panel').hidden = true; status(message);
}
function add(kind, payload, message) { commit(mergeOperations(operations, [event(kind, payload)]), message); }
$('record-form').onsubmit = e => {
  e.preventDefault();
  try {
    if (appId === 'reception') add('check-in', { attendeeId: $('person-id').value.trim(), name: $('person-name').value.trim() }, 'Check-in saved on this device.');
    else add('loan', { itemId: $('item-id').value.trim(), borrower: $('borrower').value.trim() }, 'Equipment loan saved on this device.');
    e.target.reset(); e.target.querySelector('input').focus();
  } catch (error) { status(error.message, true); }
};
function row(title, detail, action) {
  const outer = document.createElement('div'); outer.className = 'row';
  const copy = document.createElement('div'), h = document.createElement('h3'), p = document.createElement('p');
  h.textContent = title; p.textContent = detail; copy.append(h, p); outer.append(copy);
  if (action) { const button = document.createElement('button'); button.textContent = 'Return'; button.onclick = action; outer.append(button); }
  return outer;
}
function empty(text) { const div = document.createElement('div'); div.className = 'empty'; div.textContent = text; return div; }
function render() {
  const query = $('search').value.toLowerCase();
  const view = appId === 'reception' ? projectReception(operations) : projectLending(operations);
  $('records').replaceChildren();
  if (appId === 'reception') {
    $('metric').textContent = String(view.attendeeCount);
    for (const attendee of view.attendees.filter(a => `${a.name} ${a.attendeeId}`.toLowerCase().includes(query))) $('records').append(row(attendee.name, attendee.attendeeId));
  } else {
    $('metric').textContent = String(view.active.length);
    for (const loan of view.active.filter(l => `${l.payload.itemId} ${l.payload.borrower}`.toLowerCase().includes(query))) $('records').append(row(loan.payload.itemId, `With ${loan.payload.borrower}`, () => { try { add('return', { loanId: loan.id }, 'Return saved. Original loan remains in the trail.'); } catch (error) { status(error.message, true); } }));
    $('conflicts-panel').hidden = view.conflicts.length === 0;
    $('conflicts').replaceChildren(...view.conflicts.map(c => row(c.itemId, `${c.loans.length} active loans · ${c.loans.map(l => l.payload.borrower).join(', ')}`)));
  }
  if (!$('records').children.length) $('records').append(empty(query ? 'No matching records.' : appId === 'reception' ? 'Your first check-in starts the trail.' : 'Nothing is currently checked out.'));
  $('audit').replaceChildren(...[...view.events].reverse().map(op => {
    const li = document.createElement('li'); const values = Object.values(op.payload).join(' · ');
    li.textContent = `${op.kind} / ${values} / device ${op.actorId.slice(0, 8)}`; return li;
  }));
  $('history-count').textContent = `${operations.length} record${operations.length === 1 ? '' : 's'} in this device’s history. Importing the same handoff again does not add duplicate records.`;
}
$('search').oninput = render;
function download(blob, filename) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
$('export-json').onclick = () => download(new Blob([JSON.stringify(makeEnvelope(appId, workspaceId, operations))], { type: 'application/json' }), `deadair-${appId}-${workspaceId}.json`);
$('show-qr').onclick = () => {
  $('qr-panel').hidden = true;
  try {
    if (!operations.length) throw new Error('Create a record before making a handoff.');
    const text = qrText(makeEnvelope(appId, workspaceId, operations));
    globalThis.qrcode.stringToBytes = value => [...new TextEncoder().encode(value)];
    const qr = globalThis.qrcode(0, 'M'); qr.addData(text); qr.make();
    const count = qr.getModuleCount(), scale = 5, margin = 4, canvas = $('qr');
    canvas.width = canvas.height = (count + margin * 2) * scale;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = '#000';
    for (let y = 0; y < count; y++) for (let x = 0; x < count; x++) if (qr.isDark(y, x)) ctx.fillRect((x + margin) * scale, (y + margin) * scale, scale, scale);
    $('qr-info').textContent = `${operations.length} records · ${new TextEncoder().encode(text).length} bytes · ${appId} / ${workspaceId}`;
    $('qr-panel').hidden = false; status('QR handoff created from the records on this device.');
  } catch (error) { status(error.message, true); }
};
$('download-qr').onclick = () => $('qr').toBlob(blob => { if (blob) download(blob, `deadair-${appId}-handoff.png`); }, 'image/png');
function preview(text) {
  incoming = readEnvelope(text, appId, workspaceId);
  const merged = mergeOperations(operations, incoming.operations);
  $('preview-text').textContent = `${incoming.operations.length} records in this handoff. ${merged.length - operations.length} new records will be added to ${workspaceId}.`;
  $('import-preview').hidden = false; status('Handoff read. Review it, then import.');
}
async function readFile(input, image) {
  const file = input.files?.[0]; if (!file) return;
  if (scanner.isActive()) scanner.stop();
  incoming = null; $('import-preview').hidden = true;
  try {
    if (file.size > (image ? 8000000 : FILE_BYTE_LIMIT)) throw new Error('This file is too large.');
    if (!image) preview(await file.text());
    else {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width * bitmap.height > 16000000) { bitmap.close(); throw new Error('QR image is too large.'); }
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height); const qr = globalThis.jsQR(pixels.data, pixels.width, pixels.height);
      if (!qr) throw new Error('No readable QR found. Use the original PNG or the JSON backup.');
      preview(qr.data);
    }
  } catch (error) { status(error.message, true); }
  finally { input.value = ''; }
}
$('qr-file').onchange = e => readFile(e.target, true);
$('json-file').onchange = e => readFile(e.target, false);

// Camera decoding uses the same validation/preview/confirmation as files.
const cameraVideo = $('camera-video');
const scanner = createCameraScanner({
  getUserMedia: constraints => {
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      return Promise.reject(Object.assign(new Error('Unsupported camera context'), { name: 'NotSupportedError' }));
    return navigator.mediaDevices.getUserMedia(constraints);
  },
  jsQR: globalThis.jsQR,
  requestAnimationFrame: globalThis.requestAnimationFrame.bind(globalThis),
  cancelAnimationFrame: globalThis.cancelAnimationFrame.bind(globalThis),
  video: cameraVideo,
});
function cameraStatus(message, { state, error = false }) {
  const active = state === 'starting' || state === 'scanning';
  $('start-camera').hidden = active;
  $('stop-camera').hidden = !active;
  cameraVideo.hidden = !active;
  $('camera-status').textContent = message;
  status(message, error);
}
$('start-camera').onclick = () => {
  incoming = null; $('import-preview').hidden = true;
  scanner.start(preview, cameraStatus);
};
$('stop-camera').onclick = () => scanner.stop();
document.addEventListener('visibilitychange', () => { if (document.hidden) scanner.stop(); });
addEventListener('pagehide', () => scanner.stop());
$('cancel-import').onclick = () => { incoming = null; $('import-preview').hidden = true; status('Import cancelled. No records changed.'); };
$('confirm-import').onclick = () => {
  if (!incoming) return;
  try { const next = mergeOperations(operations, incoming.operations), added = next.length - operations.length; commit(next, `Handoff imported. ${added} new record${added === 1 ? '' : 's'} saved.`); incoming = null; $('import-preview').hidden = true; }
  catch (error) { status(error.message, true); }
};
if (storageBroken) document.querySelectorAll('form button,#confirm-import').forEach(button => { button.disabled = true; });
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register(new URL('./sw.js', import.meta.url)).catch(error => status(`Local records work, but offline reload is not ready: ${error.message}`, true));
