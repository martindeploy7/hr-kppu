import { describe, expect, test } from 'vitest'
import { blankEmployee, buildRoster } from '../src/engine/roster.ts'
import { matchKind, stQueryTokens } from '../src/engine/stMatch.ts'
import { nameTokens } from '../src/engine/names.ts'
import type { Employee, Evidence, SourceFile } from '../src/engine/types.ts'

const emp = (id: string, nama: string, change: Partial<Employee> = {}): Employee => ({ ...blankEmployee(id), nama, kantor: 'Pusat', ...change })
const stFile = (name: string, office = 'Pusat', start = '2026-10-05', end = '2026-10-07'): SourceFile => ({ id: `st:${name}`, fileName: 'st.xlsx', kind: 'surat-tugas', label: 'ST', office, importedAt: '2026-10-01T00:00:00Z', period: { start, end }, evidence: [], assignments: [{ id: `a:${name}`, fileId: `st:${name}`, office, name, start, end, rawDate: '5-7 Okt', local: false, ref: 'A2', letterNo: '700/' }], warnings: [], stats: { rows: 1, people: 1 } })
const linked = (files: SourceFile[], master: Employee[], name: string) => {
  const roster = buildRoster(files, master, {}, [])
  return { id: roster.assignmentLink.get(`a:${name}`), item: roster.identity.find(i => i.context === 'surat-tugas' && i.name === name)! }
}

describe('pola nama ST', () => {
  const martin = nameTokens('Martin Marcelino Tarigan')
  test.each([
    ['Martin Marcelino Tarigan', 'lengkap'], ['Martin', 'sebagian'], ['Tarigan', 'sebagian'], ['Martin Tarigan', 'sebagian'],
    ['Martin MT', 'inisial'], ['Martin M. T.', 'inisial'], ['M. Marcelino T', 'inisial'], ['MMT', 'akronim'], ['MT', 'akronim'],
    ['Martn Marcelino', 'ejaan'],
  ])('"%s" → %s', (raw, kind) => expect(matchKind(stQueryTokens(raw), martin)).toBe(kind))
  test.each(['Marcelino MT', 'TMM', 'M', 'Budi'])('"%s" tidak cocok', raw => expect(matchKind(stQueryTokens(raw), martin)).toBeUndefined())
})

describe('penautan nama ST ke pegawai', () => {
  const master = [emp('martin', 'Martin Marcelino Tarigan', { nip: '199001012020011001' }), emp('mario', 'Mario Teguh'), emp('andi1', 'Andi Zubaidah Assaf', { nip: '197204142025212022' }), emp('andi2', 'Andi Pratama', { nip: '199002022020011002' })]
  test.each(['Martin', 'Martin MT', 'MMT', 'Tarigan'])('"%s" tertaut ke Martin Marcelino Tarigan', name => {
    const { id, item } = linked([stFile(name)], master, name)
    expect(id).toBe('martin')
    expect(item.reason).toBeTruthy()
  })
  test('nama panggilan yang cocok ke dua pegawai menunggu admin, dengan kandidat', () => {
    const { id, item } = linked([stFile('Andi')], master, 'Andi')
    expect(id).toBeUndefined()
    expect(item.status).toBe('ambiguous')
    expect(item.candidates.map(c => c.employeeId).sort()).toEqual(['andi1', 'andi2'])
  })
  test('bukti dinas di mesin pada tanggal ST memilih satu kandidat', () => {
    const pd: Evidence = { id: 'pd1', fileId: 'mesin', kind: 'mesin', office: 'Pusat', name: 'Andi Pratama', ids: { nip: '199002022020011002' }, date: '2026-10-06', code: 'PD', codeLabel: 'Perjalanan Dinas', ref: 'baris 9' }
    const mesin: SourceFile = { id: 'mesin', fileName: 'mesin.xls', kind: 'mesin', label: 'Mesin', office: 'Pusat', importedAt: '2026-10-01T00:00:00Z', period: { start: '2026-10-06', end: '2026-10-06' }, evidence: [pd], assignments: [], warnings: [], stats: { rows: 1, people: 1 } }
    const { id, item } = linked([mesin, stFile('Andi')], master, 'Andi')
    expect(id).toBe('andi2')
    expect(item.reason).toContain('dinas')
  })
  test('entri master tanpa NIP yang hanya nama panggilan tidak mengalahkan pegawai ber-NIP', () => {
    const { id } = linked([stFile('Martin')], [...master, emp('fake', 'Martin')], 'Martin')
    expect(id).toBe('martin')
  })
  test('register Kanwil memilih kandidat di kantor yang sama', () => {
    const kanwil = [emp('k1', 'Rudi Hartono', { kantor: 'Kanwil II', nip: '1' }), emp('p1', 'Rudi Santoso', { nip: '2' })]
    expect(linked([stFile('Rudi', 'Kanwil II')], kanwil, 'Rudi').id).toBe('k1')
  })
  test('nama yang tidak ditemukan: usulan dari pegawai yang dinas tanpa ST, tidak ditautkan', () => {
    const pd: Evidence = { id: 'pd2', fileId: 'mesin', kind: 'mesin', office: 'Pusat', name: 'Mario Teguh', ids: {}, date: '2026-10-05', code: 'PD', ref: 'baris 3' }
    const mesin: SourceFile = { id: 'mesin', fileName: 'mesin.xls', kind: 'mesin', label: 'Mesin', office: 'Pusat', importedAt: '2026-10-01T00:00:00Z', period: { start: '2026-10-05', end: '2026-10-05' }, evidence: [pd], assignments: [], warnings: [], stats: { rows: 1, people: 1 } }
    const { id, item } = linked([mesin, stFile('Marius')], master, 'Marius')
    expect(linked([mesin, stFile('Ocha')], master, 'Ocha').item.candidates).toHaveLength(0)
    expect(id).toBeUndefined()
    expect(item.status).toBe('unmatched')
    expect(item.candidates[0]?.hint).toContain('dinas tercatat')
  })
  test('nama panggilan = nama depan: "Erika" ke Erika Rovita, bukan Irene Erika', () => {
    const m = [emp('e1', 'Erika Rovita Maharani', { nip: '1' }), emp('e2', 'Irene Erika Isabella', { nip: '2' })]
    expect(linked([stFile('Erika')], m, 'Erika').id).toBe('e1')
  })
  test('bukti dinas yang menunjuk nama tengah bertentangan dengan nama depan → admin memutuskan', () => {
    const m = [emp('e1', 'Erika Rovita Maharani', { nip: '1' }), emp('e2', 'Irene Erika Isabella', { nip: '2' })]
    const pd: Evidence = { id: 'pd3', fileId: 'mesin', kind: 'mesin', office: 'Pusat', name: 'Irene Erika Isabella', ids: { nip: '2' }, date: '2026-10-06', code: 'PD', ref: 'baris 4' }
    const mesin: SourceFile = { id: 'mesin', fileName: 'mesin.xls', kind: 'mesin', label: 'Mesin', office: 'Pusat', importedAt: '2026-10-01T00:00:00Z', period: { start: '2026-10-06', end: '2026-10-06' }, evidence: [pd], assignments: [], warnings: [], stats: { rows: 1, people: 1 } }
    const { id, item } = linked([mesin, stFile('Erika')], m, 'Erika')
    expect(id).toBeUndefined()
    expect(item.candidates[0].employeeId).toBe('e2')
  })
  test('kecocokan ejaan tidak ditautkan otomatis tetapi diusulkan', () => {
    const { id, item } = linked([stFile('Martn Marcelino')], master, 'Martn Marcelino')
    expect(id).toBeUndefined()
    expect(item.candidates[0].employeeId).toBe('martin')
  })
  test('kandidat yang scan kantor lengkap pada tanggal ST tidak dipilih; kandidat lain yang dinas dipilih', () => {
    const m = [emp('a1', 'Andi', { nip: '1' }), emp('a2', 'Andi Zubaidah Assaf', { nip: '2' })]
    const ev = (id: string, nip: string, name: string, date: string, extra: Partial<Evidence>): Evidence => ({ id, fileId: 'mesin', kind: 'mesin', office: 'Pusat', name, ids: { nip }, date, ref: id, ...extra })
    const mesin: SourceFile = { id: 'mesin', fileName: 'mesin.xls', kind: 'mesin', label: 'Mesin', office: 'Pusat', importedAt: '2026-10-01T00:00:00Z', period: { start: '2026-10-05', end: '2026-10-07' }, evidence: [
      ev('x1', '1', 'Andi', '2026-10-05', { code: 'PD' }), ev('x2', '1', 'Andi', '2026-10-06', { clockIn: '07:00', clockOut: '16:05' }), ev('x3', '1', 'Andi', '2026-10-07', { clockIn: '07:02', clockOut: '16:03' }),
      ev('y1', '2', 'Andi Zubaidah Assaf', '2026-10-06', { code: 'PD' }),
    ], assignments: [], warnings: [], stats: { rows: 4, people: 2 } }
    const { id, item } = linked([mesin, stFile('Andi')], m, 'Andi')
    expect(id).toBe('a2')
    expect(item.candidates.find(c => c.employeeId === 'a1')?.hint).toContain('scan kantor lengkap 2 hari')
  })
})
