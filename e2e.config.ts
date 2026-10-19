import type { E2EConfig } from 'e2e'
import { web } from '@e2e-dev/web'
import { loadEnvFile } from 'node:process'
import { mkdirSync, copyFileSync, writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
loadEnvFile('.env')
mkdirSync('.e2e/fixtures', { recursive: true })
const fixture = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(fixture, XLSX.utils.aoa_to_sheet([['NIK','Nama','Tanggal','Scan Masuk','Scan Pulang'],['198001012020011999','E2E Pegawai Sintetis','15/10/2026','08:00','16:00']]), 'Sheet1')
writeFileSync('.e2e/fixtures/E2E_Pusat.xlsx', XLSX.write(fixture, { type: 'buffer', bookType: 'xlsx' }))
copyFileSync('.e2e/fixtures/E2E_Pusat.xlsx', '.e2e/fixtures/E2E_Renamed.xlsx')
writeFileSync('.e2e/fixtures/E2E_Master_Invalid.csv', 'NIP,Nama,Kantor\n198001012020011997,E2E Master A,Pusat\n198001012020011997,E2E Master B,Pusat')
writeFileSync('.e2e/fixtures/E2E_Master_Valid.csv', `NIP,Nama,Kantor,Unit,Golongan\n198001012020011997,E2E Master Bulk ${Date.now()},Pusat,Unit E2E,\n198001012020011997,,Pusat,,III/a`)
export default {
 tests: 'tests/**/*.e2e.ts', workers: 1,
 targets: [{ engine: web(), app: { url: 'http://127.0.0.1:5173' } }],
 credentials: { admin: { username: process.env.INITIAL_ADMIN_EMAIL!, password: () => process.env.INITIAL_ADMIN_PASSWORD! } },
} satisfies E2EConfig
