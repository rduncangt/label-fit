import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFNumber, PDFRawStream, rgb, degrees, decodePDFRawStream } from 'pdf-lib';
import { inspectPdf, exportPdf, renderPdfPages, cellRect, GEOMETRY } from '../src/pdf.js';
import { planLabels } from '../src/planner.js';

async function makeSource(edit = () => {}) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  for (let index = 0; index < 30; index += 1) {
    page.drawRectangle({ ...cellRect(index), borderWidth: 0.3, borderColor: rgb(0.8, 0.8, 0.8) });
  }
  page.drawText('Vector label', { x: 20, y: 725, size: 14 });
  await edit(page, pdf);
  return pdf.save();
}

async function inspected(bytes, id = 'source') {
  const document = await inspectPdf(bytes, { id, name: `${id}.pdf` });
  document.alignmentConfirmed = true;
  document.guidesAcknowledged = true;
  return document;
}

async function pixels(bytes, pageNumber = 1) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(pageNumber);
    const surface = pdf.canvasFactory.create(612, 792);
    try {
      await page.render({ canvasContext: surface.context, viewport: page.getViewport({ scale: 1 }) }).promise;
      return surface.context.getImageData(0, 0, 612, 792).data;
    } finally { pdf.canvasFactory.destroy(surface); }
  } finally { await task.destroy(); }
}

function at(data, x, y) { return [...data.slice((Math.floor(y) * 612 + Math.floor(x)) * 4, (Math.floor(y) * 612 + Math.floor(x)) * 4 + 3)]; }
function streams(pdf) { return pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter((object) => object instanceof PDFRawStream); }

test('fixed grid has exact Letter geometry and 30 cells in reading order', () => {
  assert.equal(GEOMETRY.cellsPerSheet, 30);
  assert.deepEqual(cellRect(0), { x: 13.5, y: 684, width: 189, height: 72 });
  assert.deepEqual(cellRect(1), { x: 211.5, y: 684, width: 189, height: 72 });
  assert.deepEqual(cellRect(3), { x: 13.5, y: 612, width: 189, height: 72 });
  assert.deepEqual(cellRect(29), { x: 409.5, y: 36, width: 189, height: 72 });
  assert.throws(() => cellRect(30));
});

test('inspection leaves confirmations false and does not count empty template outlines', async () => {
  const input = await makeSource();
  const original = Uint8Array.from(input);
  const doc = await inspectPdf(input, { id: 'outline', name: 'Outlines.pdf' });
  assert.deepEqual(input, original, 'worker must not detach or change caller bytes');
  assert.deepEqual(doc.bytes, original);
  assert.equal(doc.pages.length, 1);
  assert.equal(doc.cells.length, 30);
  assert.equal(doc.cells.filter((cell) => cell.classification === 'candidate').length, 1);
  assert.equal(doc.cells.filter((cell) => cell.classification === 'empty').length, 29);
  assert.match(doc.cells[0].text, /Vector label/);
  assert.equal(doc.alignmentConfirmed, false);
  assert.equal(doc.guidesAcknowledged, false);
  assert.match(doc.warnings.join(' '), /guides.*retained/);
  assert.match(doc.pages[0].thumbnail, /^data:image\/png;base64,/);
  assert.ok(doc.cells.every((cell) => cell.thumbnail.startsWith('data:image/png;base64,')));
  assert.ok(doc.cells.every((cell) => !('selected' in cell)));
});

test('image/vector-only interior content is uncertain, never automatically a candidate', async () => {
  const doc = await inspected(await makeSource((page) => {
    page.drawRectangle({ x: 230, y: 710, width: 30, height: 30, color: rgb(0, 0, 0) });
  }));
  assert.equal(doc.cells[1].classification, 'uncertain');
  assert.equal(doc.cells[2].classification, 'empty');
});

test('faint visible artwork remains selectable while white, invisible and guide-only cells stay empty', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  for (let index = 0; index < 30; index += 1) {
    page.drawRectangle({ ...cellRect(index), borderWidth: 0.3, borderColor: rgb(0.8, 0.8, 0.8) });
  }
  page.drawText('Visible pale gray label', { x: 20, y: 720, size: 16, color: rgb(0.9, 0.9, 0.9) });
  page.drawText('White label', { x: 220, y: 720, size: 16, color: rgb(1, 1, 1) });
  page.drawText('Invisible label', { x: 420, y: 720, size: 16, opacity: 0 });
  page.drawRectangle({ x: 30, y: 630, width: 30, height: 20, color: rgb(0.99, 0.99, 0.99) });
  const doc = await inspected(await pdf.save());
  assert.equal(doc.cells[0].classification, 'uncertain');
  assert.match(doc.cells[0].text, /Visible pale gray label/);
  assert.equal(doc.cells[1].classification, 'empty');
  assert.match(doc.cells[1].text, /White label/);
  assert.equal(doc.cells[2].classification, 'empty');
  assert.match(doc.cells[2].text, /Invisible label/);
  assert.equal(doc.cells[3].classification, 'uncertain');
  assert.equal(doc.cells[4].classification, 'empty');
  assert.equal(doc.cells.filter((cell) => cell.classification === 'candidate').length, 0);
  const output = await exportPdf([doc], planLabels([doc.cells[0], doc.cells[3]]));
  assert.equal((await PDFDocument.load(output)).getPageCount(), 1);
  await assert.rejects(exportPdf([doc], planLabels([doc.cells[1]])), /empty/);
});

test('rejects wrong size, rotated, offset, cropped, scaled-unit and annotation source PDFs', async () => {
  const cases = [
    [(page) => page.setSize(595.28, 841.89), /US Letter/],
    [(page) => page.setRotation(degrees(90)), /rotated/],
    [(page) => page.setMediaBox(1, 0, 612, 792), /start at 0/],
    [(page) => page.setCropBox(0, 0, 610, 792), /CropBox/],
    [(page) => page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2)), /UserUnit/],
    [(page, pdf) => page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [20, 20, 30, 30] })])), /annotations/],
  ];
  for (const [edit, message] of cases) await assert.rejects(inspectPdf(await makeSource(edit)), message);
  await assert.rejects(inspectPdf(new Uint8Array([1, 2, 3])), /Cannot open/);
});

test('export requires both confirmations and rejects blanks, missing sources and inconsistent plans', async () => {
  const doc = await inspected(await makeSource());
  const selected = [{ documentId: doc.id, pageIndex: 0, cellIndex: 0 }];
  const plan = planLabels(selected);
  await assert.rejects(exportPdf([], plan), /missing/);
  await assert.rejects(exportPdf([doc], planLabels([])), /at least one/);
  doc.alignmentConfirmed = false;
  await assert.rejects(exportPdf([doc], plan), /grid alignment/);
  doc.alignmentConfirmed = true;
  doc.guidesAcknowledged = false;
  await assert.rejects(exportPdf([doc], plan), /printed guides/);
  doc.guidesAcknowledged = true;
  await assert.rejects(exportPdf([doc], planLabels([{ ...selected[0], cellIndex: 1 }])), /empty/);
  await assert.rejects(exportPdf([doc], { ...plan, totalLabels: 2 }), /count is inconsistent/);
  await assert.rejects(exportPdf([doc], { ...plan, blockedSlots: [0] }), /destination/);
  await assert.rejects(exportPdf([doc], planLabels([{ ...selected[0], pageIndex: 2 }])), /Inspect/);
  const changed = { ...doc, bytes: await makeSource((page) => page.setSize(700, 792)) };
  await assert.rejects(exportPdf([changed], plan), /US Letter/);
});

test('export clips source overflow, preserves exact scale, and honors partly used first sheet', async () => {
  const doc = await inspected(await makeSource((page) => {
    // Deliberately bleed beyond the source cell; destination gutters must stay white.
    page.drawRectangle({ x: 0, y: 680, width: 210, height: 80, color: rgb(1, 0, 0) });
    page.drawText('Vector retained', { x: 24, y: 720, size: 12 });
    page.drawRectangle({ x: 211.5, y: 684, width: 189, height: 72, color: rgb(0, 0, 1) });
  }));
  const plan = planLabels([{ documentId: doc.id, pageIndex: 0, cellIndex: 0, copies: 2 }], 1,
    Array.from({ length: 29 }, (_, index) => index));
  const bytes = await exportPdf([doc], plan);
  const output = await PDFDocument.load(bytes);
  assert.equal(output.getPageCount(), 2);
  assert.ok(output.getPages().every((page) => page.getWidth() === 612 && page.getHeight() === 792));
  const forms = streams(output).filter((stream) => stream.dict.get(PDFName.of('Subtype'))?.toString() === '/Form');
  assert.equal(forms.length, 1, 'repeated copies share the source cell Form');
  assert.equal(forms[0].dict.get(PDFName.of('BBox')).toString(), '[ 13.5 684 202.5 756 ]');
  assert.equal(forms[0].dict.get(PDFName.of('Matrix')).toString(), '[ 1 0 0 1 -13.5 -684 ]');
  const decoded = new TextDecoder().decode(decodePDFRawStream(forms[0]).decode());
  assert.match(decoded, /BT[\s\S]*Tj[\s\S]*ET/, 'vector text operators remain');
  const first = await pixels(bytes, 1);
  const second = await pixels(bytes, 2);
  assert.deepEqual(at(first, 500, 720), [255, 0, 0]);
  assert.deepEqual(at(first, 500, 680), [255, 255, 255]);
  assert.deepEqual(at(first, 405, 720), [255, 255, 255]);
  assert.deepEqual(at(first, 603, 720), [255, 255, 255]);
  assert.deepEqual(at(first, 100, 60), [255, 255, 255]);
  assert.deepEqual(at(second, 100, 60), [255, 0, 0]);
  assert.deepEqual(at(second, 205, 60), [255, 255, 255]);
  assert.deepEqual(at(second, 250, 60), [255, 255, 255]);
  const previews = await renderPdfPages(bytes);
  assert.equal(previews.length, 2);
  assert.equal(previews[0].width, 612);
  assert.equal(previews[0].height, 792);
  assert.match(previews[1].thumbnail, /^data:image\/png;base64,/);
});

test('unique crops share existing image resources without rerasterizing labels', async () => {
  const bytes = await makeSource(async (page, pdf) => {
    // Small existing PNG represents a QR/image resource, reused by multiple cells.
    const png = await pdf.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64'));
    for (let index = 0; index < 3; index += 1) {
      const rect = cellRect(index);
      page.drawImage(png, { x: rect.x + 100, y: rect.y + 10, width: 30, height: 30 });
      page.drawText(`Cell ${index}`, { x: rect.x + 8, y: rect.y + 20, size: 12 });
    }
  });
  const doc = await inspected(bytes);
  const outputBytes = await exportPdf([doc], planLabels(doc.cells.slice(0, 3), 8));
  const before = streams(await PDFDocument.load(bytes)).filter((stream) => stream.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
  const after = streams(await PDFDocument.load(outputBytes)).filter((stream) => stream.dict.get(PDFName.of('Subtype'))?.toString() === '/Image');
  assert.equal(after.length, before.length, 'one shared image, not one image per crop/copy');
  assert.deepEqual(after.map((stream) => [...stream.getContents()]), before.map((stream) => [...stream.getContents()]));
});
