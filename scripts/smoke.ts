// Headless check of the pluck pipeline: parse a model, pick elements, export, re-parse the result.
// Usage: npm run smoke -- <model.ifc> [output.ifc] [IfcType] [count] [--bare]
import { readFileSync, writeFileSync } from 'node:fs';
import { IfcParser } from '@ifc-lite/parser';
import { IfcQuery } from '@ifc-lite/query';
import { DEFAULT_PLUCK_OPTIONS, pluck, type PluckOptions } from '../src/pluck.ts';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const bare = process.argv.includes('--bare');
const [input, output = 'plucked.ifc', type = 'IfcWall', count = '3'] = args;
if (!input) {
  console.error('Usage: npm run smoke -- <model.ifc> [output.ifc] [IfcType] [count] [--bare]');
  process.exit(1);
}

const toArrayBuffer = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const store = await new IfcParser().parseColumnar(toArrayBuffer(readFileSync(input)));
const picked = new IfcQuery(store).ofType(type).execute().slice(0, Number(count)).map((e) => e.expressId);
if (picked.length === 0) {
  console.error(`No ${type} found in ${input}`);
  process.exit(1);
}

const options: PluckOptions = bare
  ? { properties: false, hosted: false, types: false, materials: false, parts: false }
  : DEFAULT_PLUCK_OPTIONS;
const result = pluck(store, picked, options);
writeFileSync(output, result.content);

const out = await new IfcParser().parseColumnar(toArrayBuffer(result.content));
const countOf = (s: typeof store, t: string) => s.entityIndex.byType.get(t)?.length ?? 0;
const watched = [...new Set(['IFCPROJECT', 'IFCSITE', 'IFCBUILDING', 'IFCBUILDINGSTOREY', type.toUpperCase(), 'IFCOPENINGELEMENT', 'IFCDOOR', 'IFCWINDOW', 'IFCRELDEFINESBYPROPERTIES', 'IFCRELDEFINESBYTYPE', 'IFCRELASSOCIATESMATERIAL'])];

console.log(`source  ${input}: ${store.entityCount} entities, ${store.schemaVersion}`);
console.log(`picked  ${picked.length} × ${type}: ${picked.map((id) => store.entities.getGlobalId(id)).join(', ')}`);
console.log(`output  ${output}: ${out.entityCount} entities, ${result.stats.fileSize} bytes, truncated=${result.truncated}`);
console.log('type                          source   output');
for (const t of watched) console.log(`${t.padEnd(28)} ${String(countOf(store, t)).padStart(7)} ${String(countOf(out, t)).padStart(8)}`);

const missing = picked.map((id) => store.entities.getGlobalId(id)).filter((gid) => out.entities.getExpressIdByGlobalId(gid) < 0);
if (result.stats.warnings.length) console.log('warnings:', result.stats.warnings);
if (missing.length) {
  console.error('FAIL: picked elements missing from output:', missing);
  process.exit(1);
}
console.log('OK: every picked element is in the output');
