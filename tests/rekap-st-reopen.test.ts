import { describe, expect, test } from 'vitest'
import { editAffectedMonths, reopenedConfirmationMonths } from '../src/pages/rekapst/reopen.ts'

const complete = { start: '2026-06-01', end: '2026-06-30', status: 'complete' }
const pusatSource = { kind: 'surat-tugas', active: true, coverageDeclarations: [complete] }

describe('peringatan pembukaan ulang konfirmasi ST', () => {
  test('konfirmasi lengkap di register Pusat tetap terdeteksi walau ST baru dari Kanwil (cek berlaku untuk seluruh KPPU)', () => {
    const sources = [pusatSource, { kind: 'surat-tugas', active: true }]
    expect(reopenedConfirmationMonths(sources, ['2026-06'])).toEqual(['2026-06'])
  })
  test('konfirmasi nihil juga dibuka kembali oleh server', () => {
    expect(reopenedConfirmationMonths([{ kind: 'surat-tugas', coverageDeclarations: [{ ...complete, status: 'nil' }] }], ['2026-06'])).toEqual(['2026-06'])
  })
  test('bulan lain, status parsial, sumber nonaktif, dan sumber bukan ST tidak memicu peringatan', () => {
    expect(reopenedConfirmationMonths([pusatSource], ['2026-05', '2026-07'])).toEqual([])
    expect(reopenedConfirmationMonths([{ kind: 'surat-tugas', coverageDeclarations: [{ ...complete, status: 'partial' }] }], ['2026-06'])).toEqual([])
    expect(reopenedConfirmationMonths([{ ...pusatSource, active: false }], ['2026-06'])).toEqual([])
    expect(reopenedConfirmationMonths([{ ...pusatSource, kind: 'presensi' }], ['2026-06'])).toEqual([])
  })
  test('hanya bulan yang tumpang tindih dengan deklarasi yang dikembalikan', () => {
    expect(reopenedConfirmationMonths([pusatSource], ['2026-06', '2026-07'])).toEqual(['2026-06'])
  })
})

describe('bulan terdampak koreksi ST', () => {
  const base = { letterNo: '256/', letterDate: '2026-06-01', destination: 'Bogor', keys: ['emp:1', 'emp:2'], dates: ['2026-06-29', '2026-06-30'] }
  test('hanya catatan berubah: tidak ada bulan terdampak', () => {
    expect(editAffectedMonths(base, { ...base })).toEqual([])
  })
  test('peserta atau tujuan berubah: bulan ST terdampak', () => {
    expect(editAffectedMonths(base, { ...base, keys: ['emp:1'] })).toEqual(['2026-06'])
    expect(editAffectedMonths(base, { ...base, destination: 'Bandung' })).toEqual(['2026-06'])
  })
  test('tanggal dipindah ke bulan lain: kedua bulan terdampak', () => {
    expect(editAffectedMonths(base, { ...base, dates: ['2026-07-01'] })).toEqual(['2026-06', '2026-07'])
  })
})
