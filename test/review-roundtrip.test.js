import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, rgb } from 'pdf-lib';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { inspectPdf, exportPdf, renderPdfPages } from '../src/pdf.js';
import { planLabels } from '../src/planner.js';

// Independent physical-coordinate oracle; avoid using the implementation's cellRect.
const origin = (slot) => ({ x: 13.5 + (slot % 3) * 198, y: 684 - Math.floor(slot / 3) * 72 });
async function source(id, pages) {
  const pdf = await PDFDocument.create();
  for (let p = 0; p < pages; p += 1) {
    const page = pdf.addPage([612, 792]);
    for (let slot = 0; slot < 30; slot += 1) {
      const { x, y } = origin(slot);
      page.drawRectangle({ x: x + 5, y: y + 5, width: 179, height: 62,
        color: rgb((slot + 1) / 31, (p + 1) / 3, id === 'a' ? 0.2 : 0.8) });
      page.drawText(`${id} ${p} ${slot}`, { x: x + 10, y: y + 30, size: 12 });
      // Distinct small marks near every interior corner expose scale, mirror and crop errors.
      for (const [dx, dy] of [[6, 6], [178, 6], [6, 61], [178, 61]]) {
        page.drawRectangle({ x: x + dx, y: y + dy, width: 3, height: 3, color: rgb(0, 0, 0) });
      }
    }
  }
  const doc = await inspectPdf(await pdf.save(), { id });
  doc.alignmentConfirmed = doc.guidesAcknowledged = true;
  return doc;
}
async function rasters(bytes) {
  return Promise.all((await renderPdfPages(bytes, { scale: 2 })).map(async ({ thumbnail }) => {
    const image = await loadImage(thumbnail);
    const canvas = createCanvas(1224, 1584);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    return context;
  }));
}
function crop(context, slot) {
  const { x, y } = origin(slot);
  return context.getImageData(x * 2 + 4, (792 - y - 72) * 2 + 4, 370, 136).data;
}

test('independent roundtrip: all source slots, two pages/documents, reverse order, copies and first-sheet holes retain artwork at 1:1', async () => {
  const docs = await Promise.all([source('a', 2), source('b', 1)]);
  const selected = docs.flatMap((doc) => [...doc.cells].reverse().map((cell, i) => ({ ...cell, copies: i % 17 === 0 ? 2 : 1 })));
  const blocked = [0, 1, 4, 7, 8, 13, 24, 29];
  const plan = planLabels(selected, 2, blocked);
  const expectedCount = selected.reduce((n, cell) => n + cell.copies, 0) * 2;
  assert.equal(plan.totalLabels, expectedCount);
  assert.equal(plan.sheetCount, Math.ceil((expectedCount + blocked.length) / 30));
  const bytes = await exportPdf(docs, plan);
  const output = await rasters(bytes);
  const originals = new Map(await Promise.all(docs.map(async (doc) => [doc.id, await rasters(doc.bytes)])));
  for (const placement of plan.placements) {
    const expected = crop(originals.get(placement.documentId)[placement.pageIndex], placement.cellIndex);
    const actual = crop(output[placement.sheetIndex], placement.slotIndex);
    assert.deepEqual(actual, expected, `Artwork differs: ${placement.documentId}/${placement.pageIndex}/${placement.cellIndex} -> ${placement.sheetIndex}/${placement.slotIndex}`);
  }
  for (const slot of blocked) {
    assert.ok(crop(output[0], slot).every((value) => value === 255), `Blocked first-sheet slot ${slot} must remain white`);
  }
});
