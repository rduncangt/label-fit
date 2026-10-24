# LabelFit

Combine selected labels from several PDFs into one efficient, print-ready run. LabelFit runs in your browser: your PDFs stay on your device, with no upload service or account required by the app.

[Open LabelFit](https://rduncangt.github.io/label-fit/)

The supported format is **Avery 5160 / 58160**: 30 labels on US Letter, arranged in 3 columns and 10 rows. Each label is 2⅝ inches wide and 1 inch high.

## Compose a print run

1. **Choose labels.** Add compatible PDFs. Inspect each page against the label grid, confirm the alignment, and acknowledge any existing printed guides. Select individual labels, a page, or a document. Empty cells are not selected automatically. Review uncertain cells before including them.
2. **Set up the sheet.** Adjust individual copy counts and the number of complete sets. If the first sheet is partly used, mark its unavailable positions. Later sheets start fresh.
3. **Preview and download.** Check the generated sheets, then download one PDF. The preview uses the exported PDF itself.

Labels fill each sheet from left to right, then top to bottom, following document and page order. Copies of a label stay together within each set. Unused labels remain at the end of the run where possible. For example, 80 selected labels use 3 fresh sheets; eight sets use 22 sheets.

## Print at actual size

- Choose **US Letter**, **Actual size / 100%**, and **one page per sheet** in your PDF print dialog. Disable fit-to-page, scaling, and duplex printing.
- Test on plain paper and hold it against a label sheet to check alignment before using label stock. Printer feed tolerances can affect physical alignment.
- Match the partly used sheet to the first preview page and feed it in the correct orientation. Follow your printer and label-stock guidance for refeeding sheets.
- Existing borders and guide marks inside a selected label remain part of its artwork. LabelFit does not erase them.

## Compatibility and privacy

Sources must use the Avery 5160 / 58160 grid on unrotated, standard US Letter PDF pages. A Letter PDF containing just one positioned label is supported. Cropped label-sized pages, different label formats, rotated pages, and mismatched page boxes are rejected rather than stretched to fit. A matching page size alone does not prove correct label alignment: inspect the preview.

Label content is embedded and clipped from the original PDF without rescaling. Vector text and artwork remain vector, and existing images retain their source quality. Screen thumbnails are only for inspection; they are not used as the printable artwork.

Clipping controls what prints; it does not securely remove other source content from the exported PDF. Do not use LabelFit to redact sensitive information before sharing a document.

Blank-cell detection is a convenience, not a guarantee. Faint artwork, unusual graphics, or printed template guides can be ambiguous. Confirm the grid and review your selection before printing. PDFs that depend on interactive fields or annotations should be flattened by their source application before use.

Files and selections are held in browser memory and are cleared on reload. There is no PDF upload, analytics, or remote document processing. Large documents and print runs can take time and memory, particularly on phones. Use smaller batches if your browser runs out of memory.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm ci
npm run dev
```

Open the local URL shown by Vite. To run the critical planning/PDF tests and produce the static app:

```sh
npm test
npm run build
npm run preview
```

The `dist/` directory can be hosted by a static web server. It contains the app and PDF worker assets; no application server, database, or file-upload endpoint is needed.

## Publish with GitHub Pages

In the repository's **Settings → Pages**, select **GitHub Actions** as the publishing source. The **Check and publish** workflow runs the tests, builds the static app, and deploys `dist/` after a successful push to `main`. Pull requests run tests and build without deploying. The workflow can also be started manually from the Actions tab.

All PDF libraries and worker assets are bundled with the app. No API keys, AI services, external font services, or runtime CDN dependencies are required.
