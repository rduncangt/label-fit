/** Avery slots are zero based, left to right, then top to bottom. */
export const CELLS_PER_SHEET = 30;
export const MAX_LABELS = 100000;

function integer(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be a whole number from ${minimum} to ${maximum}.`);
  }
}

/** Repeat the selected sequence in sets; per-entry copies stay adjacent. */
export function planLabels(selectedEntries, sets = 1, blockedSlots = []) {
  if (!Array.isArray(selectedEntries)) throw new Error('Selected labels must be an array.');
  integer(sets, 1, MAX_LABELS, 'Sets');
  if (!Array.isArray(blockedSlots) && !(blockedSlots instanceof Set)) {
    throw new Error('Blocked slots must be an array or Set.');
  }
  const blocked = [...new Set(blockedSlots)].sort((a, b) => a - b);
  blocked.forEach((slot) => integer(slot, 0, 29, 'Blocked slot'));
  if (blocked.length === 30) throw new Error('The first sheet must have at least one available label.');
  const entries = selectedEntries.map((entry) => {
    if (!entry || typeof entry.documentId !== 'string' || !entry.documentId.trim()) {
      throw new Error('Every selected label needs a documentId.');
    }
    integer(entry.pageIndex, 0, Number.MAX_SAFE_INTEGER, 'Source page index');
    integer(entry.cellIndex, 0, 29, 'Source cell index');
    const copies = entry.copies ?? 1;
    integer(copies, 1, MAX_LABELS, 'Copies');
    return { documentId: entry.documentId, pageIndex: entry.pageIndex, cellIndex: entry.cellIndex, copies };
  });
  const totalLabels = entries.reduce((sum, entry) => sum + entry.copies, 0) * sets;
  integer(totalLabels, 0, MAX_LABELS, 'Total labels');
  const sheets = [];
  const placements = [];
  const blockedSet = new Set(blocked);
  let sheetIndex = 0;
  let slotIndex = 0;
  for (let setIndex = 0; setIndex < sets; setIndex += 1) {
    for (const entry of entries) {
      for (let copyIndex = 0; copyIndex < entry.copies; copyIndex += 1) {
        while (sheetIndex === 0 && blockedSet.has(slotIndex)) slotIndex += 1;
        if (slotIndex === 30) { sheetIndex += 1; slotIndex = 0; }
        if (!sheets[sheetIndex]) sheets.push({ sheetIndex, slots: Array(30).fill(null) });
        const placement = { ...entry, sheetIndex, slotIndex, setIndex, copyIndex };
        sheets[sheetIndex].slots[slotIndex] = placement;
        placements.push(placement);
        slotIndex += 1;
      }
    }
  }
  return { sheets, placements, totalLabels, sheetCount: sheets.length, blockedSlots: blocked };
}
