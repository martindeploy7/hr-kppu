import { expect, test } from 'vitest'
import { buildRoster } from '../src/engine/roster.ts'
import type { Evidence, SourceFile } from '../src/engine/types.ts'

const ev = (fileId: string, date: string): Evidence => ({ id: `${fileId}:${date}`, fileId, kind: 'jadwal-kanwil', office: 'Kanwil V', name: 'Pegawai Tanpa NIP', ids: {}, date, clockIn: '07:30', clockOut: '16:05', ref: `${fileId} baris 2` })
const file = (id: string, dates: string[]): SourceFile => ({ id, fileName: `${id}.xlsx`, kind: 'jadwal-kanwil', label: 'Jadwal manual Kanwil', office: 'Kanwil V', importedAt: '2026-10-01T00:00:00Z', period: { start: dates[0], end: dates.at(-1)! }, evidence: dates.map(d => ev(id, d)), assignments: [], warnings: [], stats: { rows: dates.length, people: 1 } })

test('setoran mingguan: pegawai tanpa identifier dari beberapa file pekan tetap satu pegawai', () => {
  const files = [file('pekan-1', ['2026-09-01', '2026-09-02']), file('pekan-2', ['2026-09-07', '2026-09-08']), file('pekan-3', ['2026-09-14'])]
  const roster = buildRoster(files, [], {}, [])
  expect(roster.employees).toHaveLength(1)
  const ids = new Set(files.flatMap(f => f.evidence.map(e => roster.evidenceLink.get(e.id))))
  expect(ids.size).toBe(1)
  const items = roster.identity.filter(i => i.context === 'absensi' && i.name === 'Pegawai Tanpa NIP')
  expect(items).toHaveLength(1)
  expect(items[0].occurrences).toBe(5)
})

import { blankEmployee } from '../src/engine/roster.ts'
import { isAttachmentMarker } from '../src/engine/names.ts'
const st = (name: string): SourceFile => ({ id: `st-${name}`, fileName: 'st.xlsx', kind: 'surat-tugas', label: 'ST', office: 'Pusat', importedAt: '2026-10-01T00:00:00Z', period: { start: '2026-09-01', end: '2026-09-02' }, evidence: [], assignments: [{ id: `a-${name}`, fileId: `st-${name}`, office: 'Pusat', name, start: '2026-09-01', end: '2026-09-02', rawDate: '1-2 Sep', local: false, ref: 'A2' }], warnings: [], stats: { rows: 1, people: 1 } })
const master = ['Denny Julian Risakotta', 'Febi Nugraheni', 'Muhamad Hafis Putra Septian', 'Reza Ahmad Cheema', 'Reza Aditya'].map((nama, i) => ({ ...blankEmployee(`m${i}`), nama, kantor: 'Pusat' }))

test.each([['Denny JR', 'm0'], ['Febi N', 'm1'], ['M. Hafis PS', 'm2']])('nama depan + inisial "%s" tertaut bila hanya satu pegawai cocok', (name, id) => {
  const roster = buildRoster([st(name)], master, {}, [])
  expect(roster.assignmentLink.get(`a-${name}`)).toBe(id)
})
test('inisial yang cocok ke dua pegawai tetap menunggu admin', () => {
  const roster = buildRoster([st('Reza A')], master, {}, [])
  expect(roster.assignmentLink.has('a-Reza A')).toBe(false)
})
test('"Daftar Terlampir" bukan nama peserta', () => {
  expect(isAttachmentMarker('Daftar Terlampir')).toBe(true)
  expect(isAttachmentMarker('Terlampir')).toBe(true)
  expect(isAttachmentMarker('Dafitri Lampiri')).toBe(false)
})
