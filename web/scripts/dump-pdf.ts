// Run with tsx scripts/dump-pdf.ts path/to/syllabus.pdf
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSyllabus } from '../src/app/pdf';

// Supply PDF.js's Node-compatible build and the worker URL Vite bundles in the browser.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'pdfjs-dist') return next('pdfjs-dist/legacy/build/pdf.mjs', context);
  if (specifier === 'pdfjs-dist/build/pdf.worker.min.mjs?url') {
    const worker = pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')).href;
    return { shortCircuit: true, url: 'data:text/javascript,export default ' + encodeURIComponent(JSON.stringify(worker)) };
  }
  return next(specifier, context);
} });

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error('Pass a PDF path.');
  console.log(await readSyllabus(new File([await readFile(path)], basename(path))));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
