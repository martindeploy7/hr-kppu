import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { readSheets } from '../src/lib/xlsx.ts'
import { parseWorkbook } from '../src/engine/parse.ts'
async function walk(dir: string): Promise<string[]> { const out: string[] = []; for (const e of await readdir(dir, { withFileTypes: true })) { if (['node_modules', 'dist', '.devdata', 'kppu-hr-dashboard-demo', '_backup_prototype_v0'].includes(e.name)) continue; const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...await walk(p)); else if (/\.xlsx?$/.test(e.name)) out.push(p) }; return out }
const seen = new Set<string>(), results = []
for (const p of await walk('..')) {
 console.error('Checking', path.basename(p))
 const bytes = await readFile(p), hash = createHash('sha256').update(bytes).digest('hex'); if (seen.has(hash)) continue; seen.add(hash)
 try { const sheets = await readSheets(new File([bytes], path.basename(p))); const f = parseWorkbook(path.basename(p), sheets, hash.slice(0,12)); results.push({ file: p, hash, sheets: sheets.map(s => ({ name: s.name, rows: s.rows.length, risks: s.identifierRisks?.length ?? 0 })), kind: f.kind, records: f.stats.rows, master: f.master?.length ?? 0, quarantine: f.quarantined?.length ?? 0, warnings: f.warnings }) }
 catch (e) { results.push({file:p, error: (e as Error).message }) }
}
await writeFile('artifacts/parser-audit.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2))
