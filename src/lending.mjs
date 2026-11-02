import { mergeOperations } from './engine.mjs';

export function projectLending(input) {
  const events = mergeOperations(input, []);
  const loans = new Map();
  const returned = new Set();
  for (const event of events) {
    if (event.appId !== 'lending') throw new Error('Expected lending records');
    if (event.kind === 'loan') {
      if (!event.payload.itemId?.trim() || !event.payload.borrower?.trim()) throw new Error('A loan needs an item and borrower');
      loans.set(event.id, event);
    } else if (event.kind === 'return') {
      if (!event.payload.loanId?.trim()) throw new Error('A return needs a loan ID');
      returned.add(event.payload.loanId);
    } else throw new Error('Unknown lending operation');
  }
  const active = [...loans.values()].filter(loan => !returned.has(loan.id));
  const byItem = new Map();
  for (const loan of active) byItem.set(loan.payload.itemId, [...(byItem.get(loan.payload.itemId) || []), loan]);
  const conflicts = [...byItem].filter(([, group]) => group.length > 1).map(([itemId, group]) => ({ itemId, loans: group }));
  return { events, active, conflicts, unmatchedReturnCount: [...returned].filter(id => !loans.has(id)).length };
}
