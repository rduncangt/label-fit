import './style.css';
import { inspectPdf, exportPdf, renderPdfPages, GEOMETRY } from './pdf.js';
import { planLabels } from './planner.js';

const app = document.querySelector('#app');
const state = { step: 1, documents: [], selected: new Map(), sets: 1, blocked: new Set(), busy: false, status: '', errors: [], showEmpty: false, bytes: null, previews: [], previewIndex: 0, previewError: '', revision: 0 };
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const plural = (count, word) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
const ready = doc => doc.alignmentConfirmed && doc.guidesAcknowledged;
const entries = () => state.documents.flatMap(doc => doc.cells.filter(cell => state.selected.has(cell.id)).map(cell => ({ documentId: doc.id, pageIndex: cell.pageIndex, cellIndex: cell.cellIndex, copies: state.selected.get(cell.id) })));
function plan() { return planLabels(entries(), state.sets, [...state.blocked]); }
function invalidate() { state.revision++; state.bytes = null; state.previews = []; state.previewError = ''; state.previewIndex = 0; }
function selectedCount(doc) { return doc.cells.filter(cell => state.selected.has(cell.id)).length; }
function icon(name) {
  const paths = { plus: '<path d="M12 5v14M5 12h14"/>', arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/>', download: '<path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/>', lock: '<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', check: '<path d="m5 12 4 4L19 6"/>', file: '<path d="M14 3H5v18h14V8zM14 3v5h5M8 12h8M8 16h6"/>' };
  return `<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.file}</svg>`;
}
function render(focusId) {
  const previousFocus = focusId || document.activeElement?.id;
  let currentPlan;
  let planningError = '';
  try { currentPlan = plan(); } catch (error) { planningError = error.message; currentPlan = { totalLabels: 0, sheetCount: 0, invalid: true }; }
  const visibleErrors = [...state.errors, ...(planningError ? [planningError] : [])];
  app.innerHTML = `<header class="site-header"><div class="header-inner"><a class="brand" href="./" aria-label="LabelFit home"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i><i></i></span>Label<span>Fit</span></a><span class="privacy">${icon('lock')} Your PDFs stay on your device</span></div></header>
    <div class="workspace"><nav aria-label="Print run steps"><ol class="steps">${['Choose labels', 'Sheet setup', 'Preview & download'].map((title, index) => `<li class="${state.step === index + 1 ? 'current' : state.step > index + 1 ? 'complete' : ''}"><button id="step-${index + 1}" data-action="step" data-step="${index + 1}" ${state.busy || (index > 0 && !state.selected.size) ? 'disabled' : ''} ${state.step === index + 1 ? 'aria-current="step"' : ''}><span class="step-number">${state.step > index + 1 ? icon('check') : index + 1}</span><span>${title}</span></button></li>`).join('')}</ol></nav>
    <div id="status" class="status ${state.busy ? 'loading' : ''}" role="status" aria-live="polite">${state.busy ? '<span class="spinner" aria-hidden="true"></span>' : ''}${escape(state.status)}</div>
    ${visibleErrors.length ? `<div class="error-banner" role="alert"><div><strong>Something needs a second look</strong>${visibleErrors.map(error => `<p>${escape(error)}</p>`).join('')}</div><button data-action="dismiss" aria-label="Dismiss errors">×</button></div>` : ''}
    <div class="workspace-grid"><main id="main" tabindex="-1">${state.step === 1 ? chooseView() : state.step === 2 ? setupView(currentPlan) : previewView(currentPlan)}</main>${summary(currentPlan)}</div>
    <footer class="site-footer"><span>Made for Avery® 5160 / 58160</span><span>US Letter · 30 labels · 2⅝ × 1 in</span></footer></div>
    ${state.step === 1 && state.selected.size ? `<div class="mobile-continue"><span><strong>${state.selected.size} selected</strong><small>${plural(currentPlan.totalLabels, 'label')} to print</small></span><button id="mobile-continue" class="button primary" data-action="step" data-step="2" ${state.busy || currentPlan.invalid ? 'disabled' : ''}>Sheet setup ${icon('arrow')}</button></div>` : ''}
    <dialog id="source-dialog" aria-labelledby="source-dialog-title"><div class="dialog-heading"><h2 id="source-dialog-title">Source alignment</h2><button class="button secondary" data-action="close-dialog" autofocus>Done</button></div><p class="small-text">Teal outlines show each label crop. Check that the intended artwork fits inside a single cell.</p><div id="source-dialog-content"></div></dialog>
    <input id="file-input" type="file" accept="application/pdf,.pdf" multiple hidden />`;
  app.querySelectorAll('button[data-action]:not([id])').forEach(button => {
    button.id = ['action', button.dataset.action, button.dataset.doc, button.dataset.page, button.dataset.slot].filter(value => value !== undefined).join('-');
  });
  if (previousFocus) {
    const target = document.getElementById(previousFocus) || (previousFocus.startsWith('action-remove-') ? document.getElementById('action-add') || document.getElementById('step-title') : null);
    target?.focus({ preventScroll: true });
  }
}
function chooseView() {
  return `<div class="section-heading"><div><p class="eyebrow">A better fit for every sheet</p><h1 id="step-title" tabindex="-1">Choose your labels.</h1><p>Bring the labels you need together. Leave the rest behind.</p></div>${state.documents.length ? `<button class="button secondary" data-action="add" ${state.busy ? 'disabled' : ''}>${icon('plus')} Add PDFs</button>` : ''}</div>
    ${!state.documents.length ? `<section class="empty-state" id="drop-zone" aria-label="Add source PDFs"><div class="sheet-illustration" aria-hidden="true"><div class="illustration-back"></div><div class="illustration-sheet">${Array.from({ length: 12 }, (_, i) => `<i class="${[0, 1, 3, 4, 6, 8].includes(i) ? 'filled' : ''}"></i>`).join('')}</div><span class="illustration-badge">${icon('check')}</span></div><h2>Good labels. Less waste.</h2><p>Combine labels from several PDFs into one neatly packed print run—even on a partly used sheet.</p><button class="button primary" data-action="add" ${state.busy ? 'disabled' : ''}>${icon('upload')} Choose PDF files</button><span class="drop-hint">or drop your PDFs here</span><div class="empty-details"><span>Compatible Avery 5160 / 58160 PDFs</span><span>Local processing. No uploads.</span></div></section>
    <div class="how-it-works"><div><span>01</span><h3>Pick what you need</h3><p>Check the source layout, then select labels and copies.</p></div><div><span>02</span><h3>Use what you have</h3><p>Mark used cells on your first sheet. We fit around them.</p></div><div><span>03</span><h3>Print with confidence</h3><p>Review the finished PDF, then print at actual size.</p></div></div>` : `<p class="selection-note">Nothing is selected automatically. Check each document, then choose visible content. Labels follow source order, left to right and top to bottom.</p><div class="sources">${state.documents.map(documentView).join('')}</div>`}`;
}
function documentView(doc) {
  const confirmed = ready(doc);
  return `<section class="source-card" aria-labelledby="name-${doc.id}"><header class="source-header"><div class="file-icon">${icon('file')}</div><div class="source-name"><h2 id="name-${doc.id}">${escape(doc.name)}</h2><p>${plural(doc.pages.length, 'page')} <span aria-hidden="true">·</span> ${selectedCount(doc)} selected</p></div><button class="text-button" data-action="remove" data-doc="${doc.id}" aria-label="Remove ${escape(doc.name)}" ${state.busy ? 'disabled' : ''}>Remove</button></header>
    <div class="source-review"><div class="review-heading"><span class="tag ${confirmed ? 'verified' : ''}">${confirmed ? 'Layout confirmed' : 'Check this source first'}</span><span class="small-text">Letter size is verified; label alignment needs your eye.</span></div><details ${confirmed ? '' : 'open'}><summary>Inspect full pages & confirm alignment</summary><p class="small-text">Check every page below. Teal outlines show the fixed label crop: each intended label must fit inside one cell. A single positioned label is supported if it fits the grid.</p><div class="source-page-previews">${doc.pages.map(page => `<figure><div class="source-sheet">${page.thumbnail ? `<img src="${page.thumbnail}" alt="${escape(doc.name)}, page ${page.pageIndex + 1}, with label alignment grid" loading="lazy" />` : '<p>Page preview unavailable</p>'}<div class="alignment-grid" aria-hidden="true">${page.cells.map(cell => `<span style="left:${cell.rect.x / GEOMETRY.pageWidth * 100}%;top:${(GEOMETRY.pageHeight - cell.rect.y - cell.rect.height) / GEOMETRY.pageHeight * 100}%;width:${cell.rect.width / GEOMETRY.pageWidth * 100}%;height:${cell.rect.height / GEOMETRY.pageHeight * 100}%"></span>`).join('')}</div></div><figcaption><button class="text-button" data-action="inspect-page" data-doc="${doc.id}" data-page="${page.pageIndex}">Enlarge page ${page.pageIndex + 1}</button></figcaption></figure>`).join('')}</div><div class="confirmations"><label><input id="alignment-${doc.id}" type="checkbox" data-change="alignment" data-doc="${doc.id}" ${doc.alignmentConfirmed ? 'checked' : ''} ${state.busy ? 'disabled' : ''} /><span>I checked every page: the intended labels fit the outlined cells.</span></label><label><input id="guides-${doc.id}" type="checkbox" data-change="guides" data-doc="${doc.id}" ${doc.guidesAcknowledged ? 'checked' : ''} ${state.busy ? 'disabled' : ''} /><span>I understand that existing borders, template guides, and artwork inside selected labels will print.</span></label></div>${doc.warnings.length ? `<p class="source-warning">${doc.warnings.map(escape).join(' ')}</p>` : ''}</details></div>
    <div class="document-toolbar"><div class="button-group"><button class="button small secondary" data-action="select-doc" data-doc="${doc.id}" ${!confirmed || state.busy ? 'disabled' : ''}>Select document content</button><button class="text-button" data-action="clear-doc" data-doc="${doc.id}" ${!selectedCount(doc) || state.busy ? 'disabled' : ''}>Clear selection</button></div><label class="toggle-label"><input id="empty-${doc.id}" type="checkbox" data-change="empty" ${state.showEmpty ? 'checked' : ''} /> Show empty cells</label></div>
    ${!confirmed ? '<p class="locked-note">Confirm both checks above to unlock label selection.</p>' : ''}
    ${doc.pages.map(page => `<section class="source-page" aria-labelledby="page-${doc.id}-${page.pageIndex}"><div class="page-heading"><h3 id="page-${doc.id}-${page.pageIndex}">Page ${page.pageIndex + 1}<span>${page.cells.filter(cell => cell.classification !== 'empty').length} content cells</span></h3><button class="text-button" data-action="select-page" data-doc="${doc.id}" data-page="${page.pageIndex}" ${!confirmed || state.busy ? 'disabled' : ''}>Select page content</button></div><div class="label-grid">${page.cells.filter(cell => state.showEmpty || cell.classification !== 'empty').map(cell => labelView(cell, confirmed)).join('') || '<p class="small-text">No visible label content found on this page.</p>'}</div>${page.cells.some(cell => cell.classification === 'uncertain') ? '<p class="small-text uncertain-note">Artwork needs a closer look. These cells are excluded from page and document selection; check each one individually.</p>' : ''}</section>`).join('')}</section>`;
}
function labelView(cell, confirmed) {
  const selected = state.selected.has(cell.id);
  const empty = cell.classification === 'empty';
  const uncertain = cell.classification === 'uncertain';
  return `<article class="label-card ${selected ? 'selected' : ''} ${empty ? 'empty-cell' : ''}"><label class="label-choice"><span class="label-image">${cell.thumbnail ? `<img src="${cell.thumbnail}" alt="${escape(cell.text || (empty ? 'Empty label cell' : 'Label artwork'))}" loading="lazy" />` : '<span>Preview unavailable</span>'}</span><span class="label-meta"><input id="cell-${cell.id}" type="checkbox" data-change="cell" data-cell="${cell.id}" ${selected ? 'checked' : ''} ${!confirmed || empty || state.busy ? 'disabled' : ''} /><span>${uncertain ? 'I checked this artwork' : empty ? 'Empty / guides only' : `Row ${cell.row + 1}, column ${cell.col + 1}`}</span><span class="cell-number">${cell.cellIndex + 1}</span></span></label>${selected ? `<div class="copies-control"><label for="copies-${cell.id}">Copies per set</label><input id="copies-${cell.id}" aria-label="Copies per set for page ${cell.pageIndex + 1}, cell ${cell.cellIndex + 1}" type="number" min="1" max="100000" step="1" value="${state.selected.get(cell.id)}" data-change="copies" data-cell="${cell.id}" ${state.busy ? 'disabled' : ''} /></div>` : ''}</article>`;
}
function setupView(currentPlan) {
  return `<div class="section-heading"><div><p class="eyebrow">Make room for your labels</p><h1 id="step-title" tabindex="-1">Set up your sheets.</h1><p>Start fresh, or make the most of a sheet you’ve already used.</p></div></div><div class="setup-grid"><section class="panel sheet-panel"><div class="panel-heading"><h2>Your first sheet</h2><button class="text-button" data-action="reset-slots" ${!state.blocked.size ? 'disabled' : ''}>Reset</button></div><p>Tap cells that are already used or unavailable. Only this first sheet is affected.</p><div class="sheet-key"><span><i></i> Available</span><span><i class="blocked"></i> Unavailable</span></div><div class="destination-sheet" aria-label="First sheet unavailable cells">${Array.from({ length: 30 }, (_, index) => `<button id="slot-${index}" class="slot ${state.blocked.has(index) ? 'blocked' : ''}" data-action="slot" data-slot="${index}" aria-pressed="${state.blocked.has(index)}" aria-label="Row ${Math.floor(index / 3) + 1}, column ${index % 3 + 1}: ${state.blocked.has(index) ? 'unavailable' : 'available'}"><span>${index + 1}</span>${state.blocked.has(index) ? '<span aria-hidden="true">×</span>' : ''}</button>`).join('')}</div><p class="sheet-caption">${30 - state.blocked.size} available cells on the first sheet</p></section><div class="setup-options"><section class="panel"><p class="eyebrow">Repeat your selection</p><h2>How many sets?</h2><p>One set includes every selected label and its individual copy count.</p><label class="field-label" for="sets">Number of complete sets</label><input id="sets" class="sets-input" data-change="sets" type="number" min="1" max="100000" step="1" value="${state.sets}" /><div class="calculation"><span>${plural(entries().reduce((sum, entry) => sum + entry.copies, 0), 'label')} per set × ${state.sets}</span><strong>${plural(currentPlan.totalLabels, 'label')} total</strong></div></section><section class="quiet-panel"><h3>In a predictable order</h3><p>Documents stay in the order you added them. Within each page, labels run left to right, then top to bottom. Copies stay together, and each set repeats that order.</p><p>Available cells fill in reading order. Any unused space stays at the end.</p></section></div></div>`;
}
function previewView(currentPlan) {
  const page = state.previews[state.previewIndex];
  return `<div class="section-heading"><div><p class="eyebrow">One last look</p><h1 id="step-title" tabindex="-1">Ready for a fresh sheet.</h1><p>${plural(currentPlan.totalLabels, 'label')}, packed across ${plural(currentPlan.sheetCount, 'sheet')}.</p></div></div><section class="panel preview-panel"><div class="panel-heading"><div><h2>Your finished PDF</h2><p class="small-text">${state.previews.length ? 'Rendered from the exact PDF you’ll download.' : 'Vector artwork · Original size · US Letter'}</p></div>${state.previews.length ? `<div class="preview-pagination"><button id="prev-preview" class="icon-button" data-action="prev-preview" aria-label="Previous sheet" ${!state.previewIndex ? 'disabled' : ''}>←</button><span>Sheet ${state.previewIndex + 1} of ${state.previews.length}</span><button id="next-preview" class="icon-button" data-action="next-preview" aria-label="Next sheet" ${state.previewIndex === state.previews.length - 1 ? 'disabled' : ''}>→</button></div>` : ''}</div><div class="preview-stage">${page ? `<img class="exported-page" src="${page.thumbnail}" alt="Exported PDF sheet ${state.previewIndex + 1} of ${state.previews.length}" />` : `<div class="preview-placeholder">${state.busy ? '<span class="spinner"></span><h3>Preparing your print run…</h3><p>Keeping every label at its original size.</p>' : `<h3>${state.previewError ? 'The PDF is ready, but its preview couldn’t load.' : 'Preview not available yet.'}</h3><p>${escape(state.previewError)}</p><button class="button secondary" data-action="retry-preview">Try preview again</button>${state.bytes ? '<button class="text-button" data-action="open-pdf">Open PDF to inspect</button>' : ''}`}</div>`}</div></section><div class="print-note">${icon('file')}<div><strong>Print at actual size (100%).</strong><p>Choose US Letter and turn off “Fit to page” or scaling in your PDF print dialog. Check the first sheet’s orientation and try plain paper before using label stock.</p></div></div>`;
}
function summary(currentPlan) {
  const perSet = entries().reduce((sum, entry) => sum + entry.copies, 0);
  return `<aside class="run-summary" aria-labelledby="summary-title"><div class="summary-heading"><span class="eyebrow">Your print run</span><span class="summary-dot" aria-hidden="true"></span></div><h2 id="summary-title">Every label in place.</h2><dl><div><dt>Source PDFs</dt><dd>${state.documents.length}</dd></div><div><dt>Selected labels</dt><dd>${state.selected.size}</dd></div><div><dt>Labels per set</dt><dd>${perSet.toLocaleString()}</dd></div><div><dt>Complete sets</dt><dd>${state.sets.toLocaleString()}</dd></div></dl><div class="summary-total"><span>${plural(currentPlan.totalLabels, 'label')} to print</span><strong>${currentPlan.sheetCount}<small>${currentPlan.sheetCount === 1 ? 'sheet' : 'sheets'}</small></strong></div><p class="summary-format">Avery 5160 / 58160<br/>US Letter · 3 columns × 10 rows</p>${state.step === 1 ? `<button id="continue" class="button primary full-width" data-action="step" data-step="2" ${!state.selected.size || state.busy || currentPlan.invalid ? 'disabled' : ''}>Sheet setup ${icon('arrow')}</button><p class="summary-help">${state.selected.size ? 'Adjust copies on any selected label.' : 'Add a PDF and select labels to get started.'}</p>` : state.step === 2 ? `<button id="continue" class="button primary full-width" data-action="step" data-step="3" ${!state.selected.size || state.busy || currentPlan.invalid ? 'disabled' : ''}>Preview sheets ${icon('arrow')}</button><button class="text-button summary-back" data-action="step" data-step="1">← Back to labels</button>` : `<button id="download" class="button primary full-width" data-action="download" ${!state.bytes || state.busy ? 'disabled' : ''}>${icon('download')} Download PDF</button><button class="text-button summary-back" data-action="step" data-step="2" ${state.busy ? 'disabled' : ''}>← Adjust sheet setup</button>`}<div class="local-note">${icon('lock')}<span>Processed in this browser.<br/>Your files never leave your device.</span></div></aside>`;
}
async function addFiles(files) {
  if (state.busy || !files.length) return;
  state.busy = true; state.errors = [];
  for (const file of files) {
    state.status = `Reading ${file.name}… Checking pages and creating label previews.`; render();
    try {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') throw new Error('Choose a PDF file.');
      const doc = await inspectPdf(await file.arrayBuffer(), { id: crypto.randomUUID(), name: file.name });
      state.documents.push(doc); invalidate();
    } catch (error) { state.errors.push(`${file.name}: ${error.message}`); }
  }
  state.busy = false; state.status = `${plural(state.documents.length, 'source PDF')} ready. Check alignment before selecting labels.`; render('step-title');
}
async function generatePreview() {
  if (state.busy) return;
  state.busy = true; state.status = 'Building your vector PDF…'; state.previewError = ''; render();
  try {
    state.bytes = await exportPdf(state.documents, plan());
    state.status = 'Rendering the finished PDF for your review…'; render();
    try { state.previews = await renderPdfPages(state.bytes, { scale: 1.2 }); }
    catch (error) { state.previewError = error.message; }
    state.status = state.previews.length ? 'Your PDF is ready. Review each sheet, then download.' : 'PDF created. Open the PDF to inspect it before printing.';
  } catch (error) { state.errors.push(error.message); state.status = ''; }
  finally { state.busy = false; render('step-title'); }
}
function download(open = false) {
  if (!state.bytes) return;
  const url = URL.createObjectURL(new Blob([state.bytes], { type: 'application/pdf' }));
  const anchor = document.createElement('a'); anchor.href = url;
  if (open) { anchor.target = '_blank'; anchor.rel = 'noopener'; } else anchor.download = 'LabelFit-labels.pdf';
  document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000);
  state.status = open ? 'PDF opened for inspection.' : 'PDF download started. Print at actual size (100%).'; render();
}
app.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const { action, doc: docId } = button.dataset;
  const selectionBefore = new Map(state.selected);
  const doc = state.documents.find(item => item.id === docId);
  if (action === 'inspect-page') {
    const source = button.closest('.source-card').querySelectorAll('.source-sheet')[Number(button.dataset.page)];
    document.querySelector('#source-dialog-title').textContent = `${doc.name} — page ${Number(button.dataset.page) + 1}`;
    document.querySelector('#source-dialog-content').replaceChildren(source.cloneNode(true));
    document.querySelector('#source-dialog').showModal();
    return;
  }
  if (action === 'close-dialog') { document.querySelector('#source-dialog').close(); return; }
  if (action === 'add') { document.querySelector('#file-input').click(); return; }
  if (action === 'download' || action === 'open-pdf') { download(action === 'open-pdf'); return; }
  if (action === 'retry-preview') { await generatePreview(); return; }
  if (action === 'step') {
    if (state.busy) return;
    const next = Number(button.dataset.step); if (next > 1 && !state.selected.size) return;
    state.step = next; state.errors = []; render('step-title'); window.scrollTo({ top: 0, behavior: 'smooth' });
    if (next === 3 && !state.bytes) await generatePreview(); return;
  }
  if (action === 'dismiss') state.errors = [];
  if (action === 'remove') { doc.cells.forEach(cell => state.selected.delete(cell.id)); state.documents = state.documents.filter(item => item.id !== docId); invalidate(); state.status = `${doc.name} removed.`; }
  if (action === 'select-doc' || action === 'select-page') {
    if (!ready(doc)) return;
    doc.cells.filter(cell => cell.classification === 'candidate' && (action === 'select-doc' || cell.pageIndex === Number(button.dataset.page))).forEach(cell => { if (!state.selected.has(cell.id)) state.selected.set(cell.id, 1); });
    invalidate(); state.status = 'Visible text labels selected. Empty cells and artwork needing review were left unselected.';
  }
  if (action === 'clear-doc') { doc.cells.forEach(cell => state.selected.delete(cell.id)); invalidate(); state.status = 'Document selection cleared.'; }
  if (action === 'slot') {
    const slot = Number(button.dataset.slot);
    if (!state.blocked.has(slot) && state.blocked.size === 29) { state.errors = ['Keep at least one available cell on your first sheet. Use a fresh sheet if this one is fully used.']; }
    else { state.blocked.has(slot) ? state.blocked.delete(slot) : state.blocked.add(slot); state.errors = []; invalidate(); }
  }
  if (action === 'reset-slots') { state.blocked.clear(); invalidate(); }
  if (action === 'prev-preview') state.previewIndex = Math.max(0, state.previewIndex - 1);
  if (action === 'next-preview') state.previewIndex = Math.min(state.previews.length - 1, state.previewIndex + 1);
  try { plan(); } catch (error) { state.selected = selectionBefore; state.errors = [error.message]; state.status = 'Selection unchanged. Reduce copies or sets before adding more labels.'; }
  render();
});
app.addEventListener('change', async event => {
  const input = event.target;
  if (input.id === 'file-input') { await addFiles([...input.files]); return; }
  const change = input.dataset.change; if (!change || state.busy) return;
  const selectionBefore = new Map(state.selected);
  const doc = state.documents.find(item => item.id === input.dataset.doc);
  if (change === 'alignment' || change === 'guides') {
    doc[change === 'alignment' ? 'alignmentConfirmed' : 'guidesAcknowledged'] = input.checked;
    if (!ready(doc)) doc.cells.forEach(cell => state.selected.delete(cell.id));
    invalidate(); state.status = ready(doc) ? `${doc.name}: selection unlocked. Choose the labels you need.` : 'Complete both source checks to select labels.';
  }
  if (change === 'empty') state.showEmpty = input.checked;
  if (change === 'cell') { input.checked ? state.selected.set(input.dataset.cell, 1) : state.selected.delete(input.dataset.cell); invalidate(); state.status = `${plural(state.selected.size, 'label')} selected.`; }
  if (change === 'copies' || change === 'sets') {
    const value = Number(input.value); const before = change === 'sets' ? state.sets : state.selected.get(input.dataset.cell);
    try {
      if (!Number.isSafeInteger(value) || value < 1 || value > 100000) throw new Error('Enter a whole number from 1 to 100,000.');
      if (change === 'sets') state.sets = value; else state.selected.set(input.dataset.cell, value);
      plan(); state.errors = []; invalidate();
    } catch (error) { if (change === 'sets') state.sets = before; else state.selected.set(input.dataset.cell, before); state.errors = [error.message]; }
  }
  try { plan(); } catch (error) { state.selected = selectionBefore; state.errors = [error.message]; state.status = 'Selection unchanged. Reduce copies or sets before adding more labels.'; }
  render((change === 'alignment' || change === 'guides') && ready(doc) ? `action-select-doc-${doc.id}` : input.id);
});
document.addEventListener('dragover', event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); document.querySelector('#drop-zone')?.classList.add('drag-over'); } });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) document.querySelector('#drop-zone')?.classList.remove('drag-over'); });
document.addEventListener('drop', event => { event.preventDefault(); document.querySelector('#drop-zone')?.classList.remove('drag-over'); if (state.step === 1) addFiles([...event.dataTransfer.files]); });
render();
