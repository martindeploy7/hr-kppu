import type { Evidence, Sheet, SourceFile } from '../types.ts'
import { parseAttendanceDate, parseDuration, parseTime } from '../dates.ts'
import { classifyId, officeFromText, officeFromUnit } from '../ids.ts'
import { cleanText } from '../names.ts'
import { findHeaderRow, mappedColumns, parseCoord, rowRef, str } from './common.ts'

/** Ekspor Presensi Daring KPPU: baris transaksi per pegawai/hari dengan status persetujuan sumber. */
export function isOnlineExport(sheet: Sheet) {
  return findHeaderRow(sheet, [/^nama pegawai$/, /^jam mulai$/, /^jenis$/], 100) >= 0
}

function approval(raw: string): NonNullable<Evidence['approvalStatus']> {
  const value = raw.toLocaleLowerCase('id-ID').replace(/[\u200b-\u200f\ufeff]/g, '').replace(/[^a-z]+/g, ' ').trim()
  if (['approved', 'approve', 'disetujui', 'disetujui atasan'].includes(value)) return 'approved'
  if (['reject', 'rejected', 'ditolak', 'tolak'].includes(value)) return 'rejected'
  if (['pending', 'menunggu', 'menunggu persetujuan'].includes(value)) return 'pending'
  return raw ? 'unknown' : 'not-reported'
}

export function parseOnline(
  sheet: Sheet, fileId: string, warnings: string[], dateOrder?: 'MDY' | 'DMY',
  quarantined?: NonNullable<SourceFile['quarantined']>, officeCandidate?: string,
): Evidence[] {
  const h = findHeaderRow(sheet, [/^nama pegawai$/, /^jam mulai$/, /^jenis$/], 100)
  const header = sheet.rows[h]
  const col = mappedColumns(header, {
    name: [/^nama pegawai$/], date: [/^tanggal$/], nip: [/^nip$/], start: [/^jam mulai$/], end: [/^jam selesai$/], duration: [/^durasi$/],
    late: [/^terlambat$/], early: [/^pulang cepat$/], ot: [/^lembur$/], min: [/^min\.? durasi$/], type: [/^jenis$/], photo: [/^foto$/],
    loc: [/^nama lokasi$/], office: [/^kantor$/, /^office$/, /^nama kantor$/], unit: [/^unit$/], cin: [/^koordinat \(in\)$/], cout: [/^koordinat \(out\)$/],
    status: [/^status$/], target: [/^target pekerjaan$/], result: [/^hasil pekerjaan$/],
  }, ['name', 'date', 'start', 'type'])
  if (!dateOrder && sheet.rows.slice(h + 1).some(row => {
    const match = str(row[col.date]).match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/)
    return !!match && Number(match[1]) <= 12 && Number(match[2]) <= 12
  })) throw new Error('Tanggal Online memakai DD/MM atau MM/DD yang sama-sama mungkin. Pilih format tanggal pada Impor Sumber sebelum mengunggah ulang; tidak ada data yang di-commit.')
  const out: Evidence[] = []
  let rejected = 0, pending = 0, unknownApproval = 0, unknownType = 0, overlongWorkText = 0, missingDates = 0
  let hasMinimumDuration = false
  for (let r = h + 1; r < sheet.rows.length; r++) {
    const row = sheet.rows[r]
    const rawName = str(row[col.name]), rawDate = row[col.date]
    if (!row.some(value => str(value))) continue
    if (/^(total|jumlah|summary|grand total)$/i.test(rawName)) continue
    if (/^nama pegawai$/i.test(rawName)) continue
    const name = cleanText(rawName), date = parseAttendanceDate(rawDate, dateOrder)
    if (!name || !date) {
      missingDates++
      quarantined?.push({ ref: `${rowRef(sheet, r)}, kolom ${col.date + 1}`, reason: !name ? 'Nama pegawai tidak terbaca.' : 'Tanggal tidak valid atau ambigu; pilih profil tanggal yang benar sebelum impor.', raw: str(rawDate).slice(0, 200) })
      continue
    }
    const targetPekerjaan = col.target === undefined ? '' : str(row[col.target])
    const hasilPekerjaan = col.result === undefined ? '' : str(row[col.result])
    if (targetPekerjaan.length > 1000 || hasilPekerjaan.length > 1000) {
      overlongWorkText++
      const fields = [targetPekerjaan.length > 1000 && 'Target Pekerjaan', hasilPekerjaan.length > 1000 && 'Hasil Pekerjaan'].filter(Boolean).join(' dan ')
      quarantined?.push({ ref: rowRef(sheet, r), reason: `${fields} melebihi batas 1.000 karakter; perbaiki file sumber tanpa pemotongan otomatis.`, raw: `panjang teks ${Math.max(targetPekerjaan.length, hasilPekerjaan.length)} karakter` })
      continue
    }
    const rawNip = str(row[col.nip]), ids = classifyId(rawNip) as Evidence['ids']
    // Prefix foto pada ekspor lama hanya menjadi alias tambahan, bukan kunci tunggal.
    const rawPhoto = col.photo === undefined ? '' : str(row[col.photo])
    const appId = rawPhoto.match(/^(\d\.\d{2}\.\d{4})_/)?.[1]
    if (appId) ids.appId = appId
    const unit = col.unit === undefined ? '' : str(row[col.unit])
    const rawOffice = col.office === undefined ? '' : str(row[col.office])
    const explicitOffice = officeFromText(rawOffice)
    const unitOffice = officeFromUnit(unit)
    const officeCandidates = [...new Set([explicitOffice, unitOffice].filter((value): value is string => !!value))]
    const officeConflict = officeCandidates.length > 1
    const locationOffice = col.loc === undefined ? undefined : officeFromText(str(row[col.loc]))
    const resolvedOffice = officeConflict ? undefined : officeCandidates[0] ?? locationOffice
    const rawMin = col.min === undefined ? '' : str(row[col.min])
    const minDur = col.min === undefined ? undefined : parseDuration(row[col.min])
    if (rawMin) hasMinimumDuration = true
    const rawType = str(row[col.type]), type = rawType.toLocaleUpperCase('id-ID').trim()
    const mode = type === 'WFA' ? 'WFA' as const : type === 'WFO' ? 'WFO' as const : undefined
    const rawStatus = col.status === undefined ? '' : str(row[col.status]), approvalStatus = col.status === undefined ? 'not-reported' : approval(rawStatus)
    if (approvalStatus === 'rejected') rejected++
    if (approvalStatus === 'pending') pending++
    if (approvalStatus === 'unknown' || approvalStatus === 'not-reported') unknownApproval++
    if (!mode) unknownType++
    const rawDuration = col.duration === undefined ? '' : str(row[col.duration])
    const office = resolvedOffice ?? 'Belum ditentukan'
    out.push({
      id: `${fileId}:${sheet.name}:${r}`, fileId, kind: 'daring', office, officePending: !resolvedOffice,
      ...(officeConflict || (rawOffice && !explicitOffice) ? { officeConflict: true, officeCandidates } : {}), ...(!resolvedOffice && officeCandidate ? { officeCandidate } : {}),
      name, ids, date, clockIn: parseTime(row[col.start]), clockOut: col.end === undefined ? undefined : parseTime(row[col.end]),
      lateMin: col.late === undefined ? undefined : parseDuration(row[col.late]), earlyMin: col.early === undefined ? undefined : parseDuration(row[col.early]),
      overtimeMin: col.ot === undefined ? undefined : parseDuration(row[col.ot]), sourceDurationMin: rawDuration ? parseDuration(row[col.duration]) : undefined,
      minimumDurationMin: minDur, mode, approved: approvalStatus === 'approved', approvalStatus,
      ...(!mode ? { code: 'T' as const, codeLabel: rawType || 'Jenis tidak diketahui' } : {}),
      location: col.loc === undefined ? undefined : str(row[col.loc]) || undefined,
      coordIn: col.cin === undefined ? undefined : parseCoord(row[col.cin]), coordOut: col.cout === undefined ? undefined : parseCoord(row[col.cout]),
      unit: unit || undefined, targetPekerjaan: targetPekerjaan || undefined, hasilPekerjaan: hasilPekerjaan || undefined, ref: rowRef(sheet, r),
      sourceValues: {
        name: rawName || undefined, identifier: rawNip || undefined, date: str(rawDate) || undefined,
        duration: rawDuration || undefined, minimumDuration: rawMin || undefined, mode: rawType || undefined,
        approval: rawStatus || undefined, office: rawOffice || undefined, unit: unit || undefined,
      },
    })
  }
  if (rejected) warnings.push(`${rejected} presensi berstatus Reject; tidak dapat menjadi bukti approved.`)
  if (pending) warnings.push(`${pending} presensi masih Pending; perlu menunggu/memeriksa persetujuan sumber.`)
  if (unknownApproval) warnings.push(`${unknownApproval} presensi berstatus kosong atau tidak dikenal; ditahan untuk review, bukan dianggap Approved.`)
  if (unknownType) warnings.push(`${unknownType} baris memiliki Jenis selain WFO/WFA; nilai asal dipertahankan dan baris ditahan untuk review.`)
  if (missingDates) warnings.push(`${missingDates} baris dikarantina karena nama atau tanggal tidak valid/ambigu.`)
  if (overlongWorkText) warnings.push(`${overlongWorkText} baris dikarantina karena teks Target/Hasil Pekerjaan melebihi 1.000 karakter.`)
  if (hasMinimumDuration) warnings.push('Min. Durasi disimpan sebagai informasi sumber dan tidak dipakai untuk menebak jam jadwal. Periksa jadwal resmi bila sumber tidak menyertakan jadwal harian.')
  const unresolvedOffice = out.filter(e => e.officePending).length
  if (unresolvedOffice) warnings.push(`${unresolvedOffice} baris belum mendapat kantor dari kolom Kantor atau mapping Unit; pilih scope kantor pada preview jika file memang satu kantor, atau perbaiki mapping untuk file campuran.`)
  if (out.some(e => e.officeCandidates?.length)) warnings.push('Ada kantor eksplisit dan kantor hasil mapping Unit yang berbeda; baris terkait tidak dapat diimpor sebelum konflik sumber diperbaiki.')
  return out
}
