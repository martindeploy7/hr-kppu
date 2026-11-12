import { describe, expect, test } from 'vitest'
import { mapImportOffices } from '../server/imports.ts'
import { officeFromText } from '../src/engine/ids.ts'
import type { Evidence, Employee } from '../src/engine/types.ts'
const row = (patch: Partial<Evidence> = {}): Evidence => ({ id: 'row', fileId: 'file', kind: 'daring', office: 'Belum ditentukan', officePending: true, name: 'Contoh', ids: {}, date: '2026-04-01', ref: 'Sheet!2', ...patch })
describe('mapping kantor setoran gabungan', () => {
  test('Lobby Utama KPPU adalah Pusat dan WFA mengikuti unit', () => {
    expect(officeFromText('Lobby   Utama KPPU')).toBe('Pusat')
    expect(mapImportOffices([row({ location: 'Lobby Utama KPPU' }), row({ unit: 'Satuan Pelaksana Medan - Sekretaris Jenderal', location: 'Work From Anywhere' })], []).map(r => r.office)).toEqual(['Pusat', 'Kanwil I'])
  })
  test('mempertahankan kantor sumber campuran dan menolak konflik', () => {
    expect(mapImportOffices([row({office:'Kanwil II',officePending:false}),row({office:'Pusat',officePending:false})], []).map(r=>r.office)).toEqual(['Kanwil II','Pusat'])
    expect(()=>mapImportOffices([row({officeConflict:true})],[])).toThrow('konflik mapping kantor')
  })
  test('offline mengikuti NIP unik master; tanpa master, ekspor mesin Pusat jatuh ke Pusat', () => {
    const master = [{nip:'123', nama:'Contoh', kantor:'Kanwil VI'}] as Employee[]
    const mapped=mapImportOffices([row({kind:'mesin',ids:{nip:'123'}}),row({kind:'mesin'}),row({kind:'daring'})], master)
    expect(mapped[0].office).toBe('Kanwil VI')
    expect(mapped[1].office).toBe('Pusat')
    expect(mapped[1].officePending).toBe(false)
    expect(mapped[2].officePending).toBe(true)
  })
})
