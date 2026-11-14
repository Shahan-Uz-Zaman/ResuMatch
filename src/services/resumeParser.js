import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';
import WordExtractor from 'word-extractor';

// pdf-parse 1.x uses this bundled PDF.js build, which logs recoverable
// TrueType-font warnings for some resumes. Keep errors visible without the noise.
const require = createRequire(import.meta.url);
require('pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js').PDFJS.verbosity = 0;

export async function extractResumeText(file) {
  const ext = file.originalname.toLowerCase().split('.').pop();
  if (ext === 'txt') return (await fs.readFile(file.path, 'utf8')).trim();
  if (ext === 'pdf') {
    const buffer = await fs.readFile(file.path);
    const result = await pdf(buffer);
    const text = (result.text || '').trim();
    if (!text) throw new Error('No selectable text found in this PDF. Please upload a text-based PDF or run OCR first.');
    return text;
  }
  if (ext === 'doc') {
    const extractor = new WordExtractor();
    const document = await extractor.extract(file.path);
    const text = (document.getBody() || '').trim();
    if (!text) throw new Error('No readable text found in this DOC file.');
    return text;
  }
  if (ext === 'docx') {
    const result = await mammoth.extractRawText({ path: file.path });
    const text = (result.value || '').trim();
    if (!text) throw new Error('No readable text found in this DOCX file.');
    return text;
  }
  throw new Error('Unsupported file type. Upload PDF, DOCX or TXT.');
}
