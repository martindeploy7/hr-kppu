import { expect, test } from 'vitest'
import * as XLSX from 'xlsx'
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate'
import { readSheets } from '../src/lib/xlsx.ts'
import { parseMasterSheets, previewMasterImport, type MasterImport } from '../src/lib/masterImport.ts'
import { blankEmployee } from '../src/engine/roster.ts'
import { upsertEmployees } from '../shared/workspace.ts'

const nip = '000012345678901234', otherNip = '198001012020011001'
const employee = { ...blankEmployee('existing'), nama: 'Pegawai lama', nip, nika: '3.24.0404', kantor: 'Pusat', unit: 'Unit lama' }
const batch = (...values: MasterImport['rows'][number]['value'][]): MasterImport => ({ rows: values.map((value, i) => ({ value, ref: `Master · baris ${i + 2}`, errors: [] })), notices: [] })

test('master CSV preserves leading zeros and all recognized sheets carry row references', async () => {
  const csv = new File([`NIP,Nama,Kantor,Tanggal Lahir\n${nip},Uji,Pusat,1980-01-01`], 'master.csv')
  const sheets = await readSheets(csv), input = parseMasterSheets([...sheets, { name: 'DPH', rows: [['Judul'], ['NAMA', 'NI PPPK', 'JABATAN', 'UNIT KERJA'], ['DPH Uji', otherNip, 'Analis', 'Biro']] }, { name: 'Petunjuk', rows: [['Kolom', 'Keterangan']] }])
  expect(input.rows).toHaveLength(2)
  expect(input.rows[0].value.nip).toBe(nip)
  expect(input.rows[0].value.tanggalLahir).toBe('1980-01-01')
  expect(input.rows[1]).toMatchObject({ ref: 'DPH · baris 3', value: { nip: otherNip, unit: 'Biro', jabatan: 'Analis' } })
  expect(input.notices).toHaveLength(1)
})

test('master numeric XML identifier blocks the entire batch until verified as text', async () => {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['NIP', 'Nama', 'Kantor'], [1, 'Uji', 'Pusat'], [otherNip, 'Lain', 'Pusat']]), 'Master')
  const zip = unzipSync(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
  zip['xl/worksheets/sheet1.xml'] = strToU8(strFromU8(zip['xl/worksheets/sheet1.xml']).replace('<v>1</v>', '<v>198908242025211126</v>'))
  const input = parseMasterSheets(await readSheets(new File([zipSync(zip)], 'master.xlsx'))), plan = previewMasterImport(input, [])
  expect(input.rows[0].value.nip).toBe('198908242025211126')
  expect(plan.invalid).toBe(1)
  expect(plan.entries[0].errors.join(' ')).toContain('numerik')
  expect(plan.rows).toHaveLength(0)
})

test('compatible duplicate rows collapse and field changes preserve blank cells', () => {
  const plan = previewMasterImport(batch({ nip, nama: employee.nama, unit: 'Unit baru' }, { nip, nama: employee.nama, unit: '', golongan: 'III/a' }), [employee])
  expect(plan.invalid).toBe(0); expect(plan.rows).toHaveLength(1); expect(plan.updated).toBe(1)
  expect(plan.entries[0].changes).toEqual([{ field: 'Unit', before: 'Unit lama', after: 'Unit baru' }, { field: 'Golongan', before: '', after: 'III/a' }])
  expect(plan.entries[1].action).toBe('gabung')
  const result = upsertEmployees([employee], [employee], {}, plan.rows, () => 'new-id')
  expect(result.added).toBe(0); expect(result.overrides.existing.nika).toBeUndefined(); expect(result.overrides.existing.unit).toBe('Unit baru')
})

test('conflicting duplicate fields and cross-person identifiers reject all writes', () => {
  const duplicate = previewMasterImport(batch({ nip, nama: 'A', kantor: 'Pusat' }, { nip, nama: 'B', kantor: 'Pusat' }), [])
  expect(duplicate.invalid).toBe(2); expect(duplicate.rows).toHaveLength(0)
  const cross = previewMasterImport(batch({ nip: otherNip, nika: employee.nika, nama: employee.nama, kantor: 'Pusat' }), [employee])
  expect(cross.invalid).toBe(1); expect(cross.rows).toHaveLength(0)
  expect(() => upsertEmployees([employee], [employee], {}, [{ nip: otherNip, nika: employee.nika, nama: 'Uji' }], () => 'new')).toThrow('identitas berbeda')
})

test('every row is checked for office scope, enum and actual calendar validity', () => {
  const input = parseMasterSheets([{ name: 'Master', rows: [['Nama', 'Kantor', 'Tanggal Lahir', 'Email', 'Status Kepegawaian'], ['Uji', 'Pusat', '31/02/2026', 'bukan-email', 'ASN'], ['Lain', 'Kanwil I', '2026-02-29', '', 'PNS']] }])
  const plan = previewMasterImport(input, [], ['Kanwil I'])
  expect(plan.invalid).toBe(2); expect(plan.rows).toHaveLength(0)
  expect(plan.entries[0].errors.join(' ')).toMatch(/cakupan/)
  expect(plan.entries[0].errors.join(' ')).toMatch(/Email/)
  expect(plan.entries[0].errors.join(' ')).toMatch(/Status/)
  expect(plan.entries[1].errors.join(' ')).toMatch(/tanggal/)
})

test('name-only rows cannot merge existing people and unchanged data has no commit', () => {
  const sameName = previewMasterImport(batch({ nama: employee.nama, kantor: 'Pusat' }), [employee])
  expect(sameName.invalid).toBe(1); expect(sameName.rows).toHaveLength(0)
  const unchanged = previewMasterImport(batch({ nip, nama: employee.nama }), [employee])
  expect(unchanged.invalid).toBe(0); expect(unchanged.entries[0].action).toBe('tetap'); expect(unchanged.rows).toHaveLength(0)
})
