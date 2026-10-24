import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';
import { MAX_LABELS } from './planner.js';

export const GEOMETRY = Object.freeze({
  pageWidth: 612, pageHeight: 792, left: 13.5, top: 36,
  labelWidth: 189, labelHeight: 72, colPitch: 198, rowPitch: 72,
  columns: 3, rows: 10, cellsPerSheet: 30,
});
export const GUIDE_WARNING = 'Source borders, template guides, and other artwork inside a label are retained and will print. Review the previews and confirm before exporting.';
const TOLERANCE = 0.001; // PDF decimal serialization tolerance, never a scale correction.
let pdfjsPromise;

export function cellRect(cellIndex) {
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || cellIndex >= 30) {
    throw new Error('Cell index must be a whole number from 0 to 29.');
  }
  return {
    x: GEOMETRY.left + (cellIndex % 3) * GEOMETRY.colPitch,
    y: GEOMETRY.pageHeight - GEOMETRY.top - (Math.floor(cellIndex / 3) + 1) * GEOMETRY.rowPitch,
    width: GEOMETRY.labelWidth, height: GEOMETRY.labelHeight,
  };
}

function bytesCopy(bytes) {
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes.slice(0));
  if (bytes instanceof Uint8Array) return Uint8Array.from(bytes);
  throw new Error('Provide PDF bytes as an ArrayBuffer or Uint8Array.');
}

function close(a, b) { return Math.abs(a - b) <= TOLERANCE; }

/** Validate actual PDF boxes; visual confirmation handles artwork alignment. */
export function validateGeometry(pdf) {
  if (!pdf.getPageCount()) throw new Error('The PDF has no pages.');
  pdf.getPages().forEach((page, pageIndex) => {
    const prefix = `Page ${pageIndex + 1}: `;
    const media = page.getMediaBox();
    const crop = page.getCropBox();
    if (!close(media.width, 612) || !close(media.height, 792)) {
      throw new Error(`${prefix}expected US Letter 612 × 792 pt. Resizing is not supported.`);
    }
    if (!close(media.x, 0) || !close(media.y, 0)) {
      throw new Error(`${prefix}the MediaBox must start at 0, 0.`);
    }
    if (page.getRotation().angle !== 0) throw new Error(`${prefix}rotated pages are not supported.`);
    if (!['x', 'y', 'width', 'height'].every((key) => close(crop[key], media[key]))) {
      throw new Error(`${prefix}CropBox must match MediaBox exactly. Cropped pages are not supported.`);
    }
    const unit = page.node.lookupMaybe(PDFName.of('UserUnit'), PDFNumber)?.asNumber() ?? 1;
    if (unit !== 1) throw new Error(`${prefix}UserUnit must be 1; scaled page units are not supported.`);
    // Annotation appearances are not embedded by pdf-lib. Never silently omit them.
    if (page.node.Annots()?.size()) {
      throw new Error(`${prefix}PDF annotations or form fields are not supported. Flatten them in the source PDF first.`);
    }
  });
}

async function loadSource(bytes) {
  let pdf;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch (error) { throw new Error(`Cannot open this PDF. It may be damaged or password protected. ${error.message}`); }
  validateGeometry(pdf);
  return pdf;
}

async function pdfjs() {
  if (!pdfjsPromise) pdfjsPromise = (async () => {
    const library = await import('pdfjs-dist/legacy/build/pdf.mjs');
    if (typeof window !== 'undefined') {
      const { default: workerUrl } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
      library.GlobalWorkerOptions.workerSrc = workerUrl;
    }
    return library;
  })();
  return pdfjsPromise;
}

async function openRenderer(bytes) {
  const library = await pdfjs();
  // A separate copy prevents worker transfer from detaching the export source.
  const task = library.getDocument({ data: bytesCopy(bytes), isEvalSupported: false,
    useSystemFonts: true, useWasm: false, stopAtErrors: true });
  try { return await task.promise; }
  catch (error) { await task.destroy(); throw error; }
}

async function renderPage(pdf, page, scale) {
  const viewport = page.getViewport({ scale });
  const surface = pdf.canvasFactory.create(Math.ceil(viewport.width), Math.ceil(viewport.height));
  try {
    await page.render({ canvasContext: surface.context, viewport, background: 'rgb(255,255,255)',
      annotationMode: 0 }).promise;
    return surface;
  } catch (error) {
    pdf.canvasFactory.destroy(surface);
    throw error;
  }
}

function thumbnailForCell(pdf, surface, rect, scale) {
  const x = rect.x * scale;
  const y = (792 - rect.y - rect.height) * scale;
  const width = rect.width * scale;
  const height = rect.height * scale;
  const crop = pdf.canvasFactory.create(Math.ceil(width), Math.ceil(height));
  try {
    crop.context.fillStyle = 'white';
    crop.context.fillRect(0, 0, crop.canvas.width, crop.canvas.height);
    crop.context.drawImage(surface.canvas, x, y, width, height, 0, 0, crop.canvas.width, crop.canvas.height);
    // Ignore a 3 pt perimeter so thin printed template rectangles are not labels.
    const inset = Math.ceil(3 * scale);
    const pixels = crop.context.getImageData(inset, inset, crop.canvas.width - 2 * inset, crop.canvas.height - 2 * inset).data;
    let ink = 0;
    let faintInk = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const darkest = Math.min(pixels[i], pixels[i + 1], pixels[i + 2]);
      if (pixels[i + 3] > 128) {
        if (darkest < 220) ink += 1;
        if (darkest < 255) faintInk += 1;
      }
    }
    return { thumbnail: crop.canvas.toDataURL('image/png'), hasInteriorInk: ink > 3,
      hasFaintInteriorInk: faintInk > 3 };
  } finally { pdf.canvasFactory.destroy(crop); }
}

/** No cell is selected or confirmed by inspection. Classification is only a hint. */
export async function inspectPdf(input, { name = 'Source.pdf', id = globalThis.crypto.randomUUID() } = {}) {
  if (typeof id !== 'string' || !id.trim()) throw new Error('A nonempty document id is required.');
  const bytes = bytesCopy(input);
  await loadSource(bytes);
  const pdf = await openRenderer(bytes);
  const pages = [];
  const cells = [];
  try {
    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex + 1);
      const text = await page.getTextContent();
      const scale = 1.5;
      const surface = await renderPage(pdf, page, scale);
      try {
        const pageCells = Array.from({ length: 30 }, (_, cellIndex) => {
          const rect = cellRect(cellIndex);
          const items = text.items.filter((item) => {
            if (!item.str?.trim() || !item.transform) return false;
            const x = item.transform[4];
            const y = item.transform[5];
            return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
          });
          const labelText = items.map((item) => item.str).join(' ').trim();
          const visual = thumbnailForCell(pdf, surface, rect, scale);
          return { id: `${id}:${pageIndex}:${cellIndex}`, documentId: id, pageIndex, cellIndex,
            row: Math.floor(cellIndex / 3), col: cellIndex % 3, rect, text: labelText,
            // Faint or image-only artwork remains selectable with explicit review.
            // Extracted text alone cannot make white/invisible content a label.
            classification: visual.hasInteriorInk ? (labelText ? 'candidate' : 'uncertain')
              : (visual.hasFaintInteriorInk ? 'uncertain' : 'empty'),
            thumbnail: visual.thumbnail };
        });
        pages.push({ pageIndex, thumbnail: surface.canvas.toDataURL('image/png'), cells: pageCells });
        cells.push(...pageCells);
      } finally { pdf.canvasFactory.destroy(surface); page.cleanup(); }
    }
  } finally { await pdf.loadingTask.destroy(); }
  return { id, name, bytes, pages, cells, warnings: [GUIDE_WARNING,
    'Detection is a hint only. Confirm the fixed grid visually and select each intended label; image-only artwork and unusual guides may need extra review.'],
  alignmentConfirmed: false, guidesAcknowledged: false };
}

/** Render the actual exported PDF, rather than reconstructing a predicted preview. */
export async function renderPdfPages(input, { scale = 1 } = {}) {
  if (!Number.isFinite(scale) || scale <= 0 || scale > 4) throw new Error('Preview scale must be greater than 0 and at most 4.');
  const pdf = await openRenderer(input);
  const pages = [];
  try {
    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
      const page = await pdf.getPage(pageIndex + 1);
      const surface = await renderPage(pdf, page, scale);
      try { pages.push({ pageIndex, width: surface.canvas.width, height: surface.canvas.height,
        thumbnail: surface.canvas.toDataURL('image/png') }); }
      finally { pdf.canvasFactory.destroy(surface); page.cleanup(); }
    }
    return pages;
  } finally { await pdf.loadingTask.destroy(); }
}

/** Embed source cell Form XObjects at 1:1 size. Their BBox clips neighboring art. */
export async function exportPdf(documents, plan) {
  if (!Array.isArray(documents)) throw new Error('Source documents must be an array.');
  if (!plan || !Array.isArray(plan.sheets) || !plan.sheets.length || !Number.isInteger(plan.totalLabels)
    || plan.totalLabels < 1 || plan.totalLabels > MAX_LABELS) {
    throw new Error('Select at least one visible label before exporting.');
  }
  const byId = new Map();
  for (const document of documents) {
    if (byId.has(document.id)) throw new Error('Source document ids must be unique.');
    byId.set(document.id, document);
  }
  const sources = new Map();
  const embedded = new Map();
  const cropsByDocument = new Map();
  const output = await PDFDocument.create();
  output.setTitle('LabelFit — Avery 5160 / 58160');
  output.setCreator('LabelFit');
  let count = 0;
  for (let sheetIndex = 0; sheetIndex < plan.sheets.length; sheetIndex += 1) {
    const sheet = plan.sheets[sheetIndex];
    if (sheet.sheetIndex !== sheetIndex || !Array.isArray(sheet.slots) || sheet.slots.length !== 30
      || !sheet.slots.some(Boolean)) throw new Error('Invalid or blank destination sheet.');
    for (let slotIndex = 0; slotIndex < 30; slotIndex += 1) {
      const placement = sheet.slots[slotIndex];
      if (!placement) continue;
      if (placement.sheetIndex !== sheetIndex || placement.slotIndex !== slotIndex
        || (sheetIndex === 0 && plan.blockedSlots?.includes(slotIndex))) throw new Error('Invalid destination placement.');
      const document = byId.get(placement.documentId);
      if (!document) throw new Error('A selected source document is missing.');
      if (document.alignmentConfirmed !== true) throw new Error(`Confirm the grid alignment for ${document.name} before exporting.`);
      if (document.guidesAcknowledged !== true) throw new Error(`Acknowledge the printed guides warning for ${document.name} before exporting.`);
      const sourceRect = cellRect(placement.cellIndex);
      if (!Number.isInteger(placement.pageIndex) || placement.pageIndex < 0) throw new Error('Invalid source page.');
      const inspectedCell = document.cells?.find((cell) => cell.pageIndex === placement.pageIndex && cell.cellIndex === placement.cellIndex);
      if (!inspectedCell) throw new Error('Inspect the selected source label before exporting.');
      if (inspectedCell.classification === 'empty') throw new Error('A selected cell appears empty or contains only template guides. Select a visible label instead.');
      if (!sources.has(document.id)) sources.set(document.id, await loadSource(bytesCopy(document.bytes)));
      const source = sources.get(document.id);
      if (placement.pageIndex >= source.getPageCount()) throw new Error('The selected source page does not exist.');
      const key = JSON.stringify([document.id, placement.pageIndex, placement.cellIndex]);
      if (!cropsByDocument.has(document.id)) cropsByDocument.set(document.id, new Map());
      cropsByDocument.get(document.id).set(key, { page: source.getPage(placement.pageIndex),
        box: { left: sourceRect.x, bottom: sourceRect.y,
          right: sourceRect.x + sourceRect.width, top: sourceRect.y + sourceRect.height } });
      count += 1;
      if (count > MAX_LABELS) throw new Error('Too many labels in this print run.');
    }
  }
  if (count !== plan.totalLabels) throw new Error('The print plan label count is inconsistent.');
  // One copier per source shares its original fonts and QR/image resources across
  // every unique crop. Repeated destination copies reuse the same clipped Form.
  for (const crops of cropsByDocument.values()) {
    const items = [...crops.values()];
    const forms = await output.embedPages(items.map((item) => item.page), items.map((item) => item.box));
    [...crops.keys()].forEach((key, index) => embedded.set(key, forms[index]));
  }
  for (const sheet of plan.sheets) {
    const destination = output.addPage([612, 792]);
    for (const placement of sheet.slots) {
      if (!placement) continue;
      const key = JSON.stringify([placement.documentId, placement.pageIndex, placement.cellIndex]);
      const target = cellRect(placement.slotIndex);
      destination.drawPage(embedded.get(key), { x: target.x, y: target.y, xScale: 1, yScale: 1 });
    }
  }
  return output.save();
}
