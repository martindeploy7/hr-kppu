import type { Cell, Sheet } from '../engine/types.ts'
import { unzipSync, strFromU8 } from 'fflate'

let mod: Promise<typeof import('xlsx')> | undefined
export const loadXlsx = () => (mod ??= import('xlsx'))

export async function readSheets(file: File): Promise<Sheet[]> {
  const XLSX = await loadXlsx()
  const data = new Uint8Array(await file.arrayBuffer())
  let expanded = 0
  const zip = data[0] === 0x50 && data[1] === 0x4b ? unzipSync(data, { filter: info => {
    expanded += info.originalSize
    if (expanded > 64 * 1024 * 1024) throw new Error('Workbook terkompresi melebihi batas 64 MB')
    return /\.xml$|\.rels$/.test(info.name)
  } }) : null
  const wb = XLSX.read(data, { type: 'array', cellText: false, raw: true })
  const attr = (tag: string, key: string) => tag.match(new RegExp(`${key}="([^"]*)"`))?.[1]
  const rels = zip?.['xl/_rels/workbook.xml.rels'] ? [...strFromU8(zip['xl/_rels/workbook.xml.rels']).matchAll(/<Relationship\b[^>]*\/>/g)] : []
  const sheetTags = zip?.['xl/workbook.xml'] ? [...strFromU8(zip['xl/workbook.xml']).matchAll(/<sheet\b[^>]*\/?\s*>/g)] : []
  return wb.SheetNames.map((name, index) => {
    const ws = wb.Sheets[name], risks: NonNullable<Sheet['identifierRisks']> = []
    if (ws['!ref']) {
      const range = XLSX.utils.decode_range(ws['!ref'])
      if (range.e.r >= 100000 || range.e.c >= 512 || (range.e.r + 1) * (range.e.c + 1) > 2000000) throw new Error(`Rentang sheet "${name}" terlalu besar. Hapus format/baris kosong di luar tabel atau pecah workbook sebelum mengunggah.`)
    }
    const rel = rels.find(r => attr(r[0], 'Id') === attr(sheetTags[index]?.[0] ?? '', 'r:id'))
    const target = rel ? attr(rel[0], 'Target') : undefined
    const path = target?.startsWith('/') ? target.slice(1) : `xl/${target ?? `worksheets/sheet${index + 1}.xml`}`
    if (zip?.[path]) {
      for (const match of strFromU8(zip[path]).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const address = attr(match[1], 'r'), raw = match[2]?.match(/<v>([^<]+)<\/v>/)?.[1]
        if (!address || !raw || !/^\d{16,}$/.test(raw) || (attr(match[1], 't') && attr(match[1], 't') !== 'n')) continue
        const cell = ws[address]
        if (cell) { cell.t = 's'; cell.v = raw; delete cell.w }
        const pos = XLSX.utils.decode_cell(address)
        risks.push({ row: pos.r, col: pos.c, raw, type: 'numeric-xml' })
      }
    }
    for (const [address, cell] of Object.entries(ws)) {
      if (address.startsWith('!') || typeof cell !== 'object' || !cell || cell.t !== 'n' || typeof cell.v !== 'number' || Math.abs(cell.v) <= Number.MAX_SAFE_INTEGER) continue
      const pos = XLSX.utils.decode_cell(address)
      risks.push({ row: pos.r, col: pos.c, raw: String(cell.v), type: 'unsafe-number' })
      cell.t = 's'; cell.v = String(cell.v); delete cell.w
    }
    return { name, rows: XLSX.utils.sheet_to_json<Cell[]>(ws, { header: 1, range: 0, raw: true, defval: null, blankrows: true }), merges: ws['!merges'], identifierRisks: risks }
  })
}

export async function downloadWorkbook(fileName: string, sheets: { name: string; rows: (string | number | null)[][]; widths?: number[] }[]) {
  const XLSX = await loadXlsx()
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    if (s.widths) ws['!cols'] = s.widths.map(wch => ({ wch }))
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  XLSX.writeFile(wb, fileName)
}
