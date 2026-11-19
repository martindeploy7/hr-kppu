import { describe, expect, test } from 'vitest'
import { matchParticipants, parseParticipantLines, stripTitles, type BulkEmployee } from '../src/lib/stBulk.ts'

const emp = (id: string, nama: string, nip: string, kantor = 'Pusat'): BulkEmployee => ({ id, nama, nip, kantor })
const master = [
  emp('1', 'Budi Santoso', '198001012005011001'),
  emp('2', 'Siti Aminah', '198502022010012002', 'Kanwil I'),
  emp('3', 'Ahmad Fauzi', '199003032015011003'),
  emp('4', 'Ahmad Fauzi', '199104042016011004', 'Kanwil II'),
  emp('5', 'Muhammad Fadli Rahman', '199205052018011005'),
  emp('6', 'Dewi Lestari Putri', '199306062019012006'),
]

describe('parseParticipantLines', () => {
  test('menoleransi nomor urut, tab, koma, spasi ganda, dan baris kosong', () => {
    const lines = parseParticipantLines('1. Budi Santoso\t198001012005011001\n\n 2)   Siti   Aminah ,198502022010012002 \n3\tAhmad Fauzi')
    expect(lines.map(l => [l.name, l.nip])).toEqual([['Budi Santoso', '198001012005011001'], ['Siti Aminah', '198502022010012002'], ['Ahmad Fauzi', '']])
  })
  test('NIP berformat spasi atau titik dan awalan label', () => {
    const [a, b, c] = parseParticipantLines('Budi Santoso NIP. 19800101 200501 1 001\n19850202 201001 2 002 Siti Aminah\nNIP: \'198001012005011001')
    expect(a.nip).toBe('198001012005011001')
    expect(b).toMatchObject({ nip: '198502022010012002', name: 'Siti Aminah' })
    expect(c).toMatchObject({ nip: '198001012005011001', name: '' })
  })
  test('gelar depan dan belakang dibuang, inisial nama tetap', () => {
    expect(stripTitles('Dr. Ir. Budi Santoso, S.H., M.Si')).toBe('Budi Santoso')
    expect(stripTitles('Drs. H. Ahmad Fauzi M.M.')).toBe('Ahmad Fauzi')
    expect(stripTitles('M. Fadli Rahman')).toBe('M. Fadli Rahman')
    const [line] = parseParticipantLines('4. Prof. Dr. Siti Aminah, S.E., M.Si., Ph.D')
    expect(line.name).toBe('Siti Aminah')
    expect(line.note).toBe('')
  })
  test('keterangan setelah tanda hubung atau tab menjadi catatan', () => {
    const [a, b] = parseParticipantLines('Eko Yulianto - Driver Komisi\n2.\tAde Supriyatna\tDriver Komisi')
    expect(a).toMatchObject({ name: 'Eko Yulianto', note: 'Driver Komisi', nip: '' })
    expect(b).toMatchObject({ name: 'Ade Supriyatna', note: 'Driver Komisi' })
  })
})

describe('matchParticipants', () => {
  const run = (text: string, selected: string[] = []) => matchParticipants(parseParticipantLines(text), master, new Set(selected))
  test('NIP persis didahulukan walau nama di daftar berbeda penulisan', () => {
    const [row] = run('Budi S. 198001012005011001')
    expect(row).toMatchObject({ status: 'matched', employeeId: '1' })
  })
  test('NIP cocok tetapi nama sama sekali berbeda memberi peringatan', () => {
    const [row] = run('Orang Lain 198001012005011001')
    expect(row.status).toBe('matched')
    expect(row.warning).toContain('berbeda')
  })
  test('nama dinormalisasi: huruf besar, gelar, spasi', () => {
    const rows = run('1. DR. SITI   AMINAH, S.H.\n2. budi santoso')
    expect(rows.map(r => [r.status, r.employeeId])).toEqual([['matched', '2'], ['matched', '1']])
  })
  test('nama kembar di dua kantor menjadi ambigu dan tidak dipilihkan', () => {
    const [row] = run('Ahmad Fauzi')
    expect(row.status).toBe('ambiguous')
    expect(row.employeeId).toBeUndefined()
    expect(row.candidates.map(c => c.id).sort()).toEqual(['3', '4'])
  })
  test('NIP membedakan nama kembar', () => {
    const [row] = run('Ahmad Fauzi 199104042016011004')
    expect(row).toMatchObject({ status: 'matched', employeeId: '4' })
  })
  test('nama lebih pendek yang termuat jadi usulan mirip, bukan pilihan otomatis', () => {
    const [row] = run('Muhammad Fadli')
    expect(row).toMatchObject({ status: 'ambiguous', similar: true })
    expect(row.candidates[0].id).toBe('5')
  })
  test('tidak ditemukan: tawarkan Lainnya', () => {
    const [row] = run('Eko Yulianto - Driver Komisi')
    expect(row).toMatchObject({ status: 'notfound', name: 'Eko Yulianto', note: 'Driver Komisi' })
  })
  test('NIP tidak ada di master tetapi nama cocok persis tetap dicocokkan dengan peringatan', () => {
    const [row] = run('Dewi Lestari Putri 199999999999999999')
    expect(row).toMatchObject({ status: 'matched', employeeId: '6' })
    expect(row.warning).toContain('NIP')
  })
  test('duplikat dalam tempelan dan yang sudah dipilih ditandai', () => {
    const rows = run('Budi Santoso\nBudi Santoso 198001012005011001\nSiti Aminah', ['2'])
    expect(rows.map(r => r.status)).toEqual(['matched', 'duplicate', 'duplicate'])
  })
  test('menangani 300 baris', () => {
    const big = Array.from({ length: 300 }, (_, i) => emp(`e${i}`, `Pegawai Nomor${String.fromCharCode(97 + (i % 26))}${i}`, String(198000000000000000n + BigInt(i))))
    const text = big.map((e, i) => `${i + 1}. ${e.nama}\t${e.nip}`).join('\n')
    const rows = matchParticipants(parseParticipantLines(text), big)
    expect(rows).toHaveLength(300)
    expect(rows.every(r => r.status === 'matched')).toBe(true)
  })
})
