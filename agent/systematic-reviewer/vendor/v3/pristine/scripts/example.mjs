import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { readText, writeOutput } from '../lib/io.mjs';
import { renderDocument } from '../lib/citations.mjs';
import { exportDocx } from '../lib/docx.mjs';
const examples = fileURLToPath(new URL('../examples/', import.meta.url));
const directory = resolve(process.argv[2] ?? 'output/example');
const rendered = renderDocument(await readText(join(examples, 'manuscript.md')), JSON.parse(await readText(join(examples, 'references.json'))));
for (const [name, content] of [
  ['manuscript.md', rendered.markdown],
  ['manuscript.docx', exportDocx(rendered)],
  ['manuscript-word-fields.docx', exportDocx(rendered, { mode: 'fields' })],
]) {
  await writeOutput(join(directory, name), content);
  console.log(join(directory, name));
}
console.log('Synthetic references only. Existing output files are never overwritten; use a new output directory to rerun.');
