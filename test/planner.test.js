import test from 'node:test';
import assert from 'node:assert/strict';
import { planLabels, MAX_LABELS } from '../src/planner.js';

const entry = (cellIndex, copies = 1, documentId = 'source') => ({ documentId, pageIndex: 0, cellIndex, copies });

test('80 labels in eight sets use 22 sheets, preserve source/set order, and leave 20 slots free', () => {
  const selected = Array.from({ length: 80 }, (_, i) => ({ ...entry(i % 30), pageIndex: Math.floor(i / 30) }));
  const plan = planLabels(selected, 8);
  assert.equal(plan.totalLabels, 640);
  assert.equal(plan.sheetCount, 22);
  assert.equal(plan.sheets[21].slots.filter(Boolean).length, 10);
  assert.equal(plan.placements[80].setIndex, 1);
  assert.equal(plan.placements[80].cellIndex, 0);
  assert.equal(plan.placements[79].cellIndex, 19);
});

test('blocked cells apply only to the FIRST sheet, including gaps and its last slot', () => {
  const blocked = [0, 2, 29];
  const plan = planLabels([entry(7, 31)], 1, blocked);
  assert.equal(plan.sheetCount, 2);
  assert.deepEqual(plan.placements.slice(0, 3).map((p) => p.slotIndex), [1, 3, 4]);
  assert.equal(plan.sheets[0].slots.filter(Boolean).length, 27);
  for (const slot of blocked) assert.equal(plan.sheets[0].slots[slot], null);
  assert.deepEqual(plan.placements.slice(27).map((p) => [p.sheetIndex, p.slotIndex]), [[1, 0], [1, 1], [1, 2], [1, 3]]);
  assert.deepEqual(blocked, [0, 2, 29]);
});

test('per-entry copies stay adjacent within each ordered set without mutating inputs', () => {
  const selected = [Object.freeze(entry(3, 2, 'a')), Object.freeze(entry(1, 1, 'b'))];
  const plan = planLabels(Object.freeze(selected), 2, new Set([5, 0, 5]));
  assert.deepEqual(plan.placements.map((p) => [p.documentId, p.cellIndex, p.setIndex, p.copyIndex]), [
    ['a', 3, 0, 0], ['a', 3, 0, 1], ['b', 1, 0, 0], ['a', 3, 1, 0], ['a', 3, 1, 1], ['b', 1, 1, 0],
  ]);
  assert.deepEqual(plan.blockedSlots, [0, 5]);
});

test('empty selection creates no blank sheets and default copies equal one', () => {
  assert.deepEqual(planLabels([]).sheets, []);
  assert.equal(planLabels([{ documentId: 'a', pageIndex: 0, cellIndex: 0 }]).totalLabels, 1);
  assert.equal(planLabels([entry(0, 30)]).sheetCount, 1);
});

test('invalid counts, slots, references and fully blocked first sheets are rejected', () => {
  for (const count of [0, -1, 1.5, NaN, Infinity, '2', MAX_LABELS + 1]) {
    assert.throws(() => planLabels([entry(0)], count), /Sets/);
    assert.throws(() => planLabels([entry(0, count)]), /Copies/);
  }
  for (const slot of [-1, 30, 0.5, '0']) {
    assert.throws(() => planLabels([entry(0)], 1, [slot]), /Blocked slot/);
    assert.throws(() => planLabels([entry(slot)]), /Source cell/);
  }
  assert.throws(() => planLabels([entry(0, MAX_LABELS)], 2), /Total labels/);
  assert.throws(() => planLabels([entry(0)], 1, Array.from({ length: 30 }, (_, i) => i)), /available label/);
  assert.throws(() => planLabels([{ ...entry(0), documentId: '' }]), /documentId/);
  assert.throws(() => planLabels([{ ...entry(0), pageIndex: -1 }]), /Source page/);
});
