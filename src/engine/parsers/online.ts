import type { Evidence, Sheet } from '../types.ts'
import { parseDuration, parseSingleDate, parseTime } from '../dates.ts'
import { classifyId, officeFromUnit } from '../ids.ts'
import { cleanText } from '../names.ts'
import { columnIndex, findHeaderRow, parseCoord, rowRef, str } from './common.ts'

/** Unduhan "Presensi Daring KPPU" (aplikasi HP): satu baris per pegawai per hari, WFO/WFA, koordinat, status approval. */
export function isOnlineExport(sheet: Sheet) {
  return findHeaderRow(sheet, [/^nama pegawai$/, /^jam mulai$/, /^jenis$/]) >= 0
}

export function parseOnline(sheet: Sheet, fileId: string, warnings: string[]): Evidence[] {
  const h = findHeaderRow(sheet, [/^nama pegawai$/, /^jam mulai$/, /^jenis$/])
  const header = sheet.rows[h]
  const col = {
    name: columnIndex(header, /^nama pegawai$/),
    date: columnIndex(header, /^tanggal$/),
    nip: columnIndex(header, /^nip$/),
    start: columnIndex(header, /^jam mulai$/),
    end: columnIndex(header, /^jam selesai$/),
    late: columnIndex(header, /^terlambat$/),
    early: columnIndex(header, /^pulang cepat$/),
    ot: columnIndex(header, /^lembur$/),
    min: columnIndex(header, /^min\. durasi$/),
    type: columnIndex(header, /^jenis$/),
    photo: columnIndex(header, /^foto$/),
    loc: columnIndex(header, /^nama lokasi$/),
    unit: columnIndex(header, /^unit$/),
    cin: columnIndex(header, /^koordinat \(in\)$/),
    cout: columnIndex(header, /^koordinat \(out\)$/),
    status: columnIndex(header, /^status$/),
  }
  const out: Evidence[] = []
  let rejected = 0
  for (let r = h + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]
    const name = cleanText(row[col.name])
    const date = parseSingleDate(row[col.date])
    if (!name || !date) continue
    const rawNip = str(row[col.nip])
    const ids = /^0+\d{1,4}$/.test(rawNip) ? { nonAsn: true } as Evidence['ids'] : classifyId(rawNip) as Evidence['ids']
    // Prefix nama file foto = ID pengguna aplikasi; umumnya sama dengan NIKA, tetapi tidak selalu.
    const appId = str(row[col.photo]).match(/^(\d\.\d{2}\.\d{4})_/)?.[1]
    if (appId) ids.appId = appId
    const unit = str(row[col.unit]) || undefined
    const minDur = parseDuration(row[col.min])
    const start = parseTime(row[col.start])
    const status = str(row[col.status])
    const approved = /approv/i.test(status) ? true : /reject|tolak/i.test(status) ? false : undefined
    if (approved === false) rejected++
    const type = str(row[col.type]).toUpperCase()
    out.push({
      id: `${fileId}:${sheet.name}:${r}`,
      fileId, kind: 'daring',
      office: officeFromUnit(unit) ?? 'Pusat',
      name, ids, date,
      schedule: minDur ? { start: '08:00', end: minutesToClock(8 * 60 + minDur), label: `Min. ${str(row[col.min])}` } : undefined,
      clockIn: start,
      clockOut: parseTime(row[col.end]),
      lateMin: parseDuration(row[col.late]),
      earlyMin: parseDuration(row[col.early]),
      overtimeMin: parseDuration(row[col.ot]),
      mode: type === 'WFA' ? 'WFA' : 'WFO',
      approved,
      location: str(row[col.loc]) || undefined,
      coordIn: parseCoord(row[col.cin]),
      coordOut: parseCoord(row[col.cout]),
      unit,
      ref: rowRef(sheet, r),
    })
  }
  if (rejected) warnings.push(`${rejected} presensi berstatus Reject (umumnya tanpa jam selesai) — tidak dihitung sebagai hadir lengkap.`)
  return out
}

const minutesToClock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
