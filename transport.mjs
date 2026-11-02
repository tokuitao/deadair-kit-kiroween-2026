import { mergeOperations } from './engine.mjs';
import { projectLending } from './lending.mjs';

export const QR_BYTE_LIMIT = 1600;
export const FILE_BYTE_LIMIT = 500000;
export function makeEnvelope(appId, workspaceId, operations) {
  return { deadair: 1, appId, workspaceId, operations };
}
export function readEnvelope(text, appId, workspaceId) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > FILE_BYTE_LIMIT) throw new Error('Handoff is too large. Maximum JSON size is 500 KB.');
  let envelope;
  try { envelope = JSON.parse(text); } catch { throw new Error('This is not a valid DeadAir handoff.'); }
  if (!envelope || envelope.deadair !== 1 || !Array.isArray(envelope.operations) || envelope.operations.length > 1000) throw new Error('Unsupported handoff format or record limit.');
  if (envelope.appId !== appId || envelope.workspaceId !== workspaceId) throw new Error('This handoff belongs to a different app or workspace.');
  for (const op of envelope.operations) {
    if (!op || op.appId !== appId || op.workspaceId !== workspaceId) throw new Error('Mixed apps or workspaces in the handoff.');
    for (const key of ['id', 'actorId']) if (typeof op[key] !== 'string' || !op[key].length || op[key].length > 180) throw new Error('Invalid record identifier.');
    const required = appId === 'reception' && op.kind === 'check-in' ? ['attendeeId', 'name'] : appId === 'lending' && op.kind === 'loan' ? ['itemId', 'borrower'] : appId === 'lending' && op.kind === 'return' ? ['loanId'] : null;
    if (!required || !op.payload || Array.isArray(op.payload)) throw new Error('Unsupported record type.');
    if (Object.keys(op.payload).length !== required.length || required.some(k => typeof op.payload[k] !== 'string' || !op.payload[k].trim() || op.payload[k].length > 120)) throw new Error('Invalid record fields. Use 1–120 characters.');
    if (op.createdAt !== undefined && (typeof op.createdAt !== 'string' || op.createdAt.length > 40)) throw new Error('Invalid record timestamp.');
  }
  const operations = mergeOperations(envelope.operations, []);
  if (appId === 'lending') projectLending(operations);
  return { ...envelope, operations };
}
export function qrText(envelope) {
  const text = JSON.stringify(envelope);
  if (new TextEncoder().encode(text).length > QR_BYTE_LIMIT) throw new Error('This history is larger than one QR. Export a JSON file instead.');
  return text;
}
