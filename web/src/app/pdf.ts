/** PDF.js 6.5.438: local bytes and a bundled worker; no document upload. */
export async function readSyllabus(file: File): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error('Choose a file smaller than 20 MB, or paste the text instead.');
  if (/\.txt$/i.test(file.name)) {
    const text = (await file.text()).replace(/^\uFEFF/, '').trim();
    if (!text) throw new Error('This text file is empty. Choose another file or paste your syllabus.');
    return text;
  }
  if (!/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF or .txt file.');
  const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
  const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  GlobalWorkerOptions.workerSrc = worker;
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join(''));
      page.cleanup();
    }
    const text = pages.join('\n').trim();
    if (!text) throw new Error('This PDF is a scan; paste the text instead');
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') throw new Error('This PDF is password protected. Open an unlocked copy or paste the text instead.');
    if (error instanceof Error && error.message.includes('This PDF is a scan')) throw error;
    throw new Error('This PDF could not be read. Try another PDF or paste the text instead.');
  } finally {
    await task.destroy();
  }
}
