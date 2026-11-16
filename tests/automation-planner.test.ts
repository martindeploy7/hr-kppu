import { describe, expect, test } from 'vitest'
import { anniversaryOn, campaignOccurrence, dateList, displayName, firstWorkday, planRule, render, wib, wibInstant, type PlanInput } from '../server/automationPlanner.ts'
import { DEFAULT_AUTOMATION_SETTINGS, DEFAULT_HOLIDAYS, RULE_DEFS, normalizePhone, type AutomationRule, type AutomationRuleId } from '../shared/automation.ts'
import { blankEmployee } from '../src/engine/roster.ts'
import type { Employee, Evidence, SourceFile } from '../src/engine/types.ts'

const emp = (id: string, change: Partial<Employee>): Employee => ({ ...blankEmployee(id), nama: `Pegawai ${id}`, kantor: 'Pusat', nomorWhatsApp: '081200000001', ...change })
const rules = new Map(RULE_DEFS.map(d => [d.id, { ...d, enabled: true, sendTime: d.defaultSendTime, template: d.defaultTemplate, options: { ...(d.defaultOptions ?? {}) } } as AutomationRule]))
const input = (date: string, employees: Employee[], extra: Partial<PlanInput> = {}): PlanInput => ({
  date, employees, rules, settings: DEFAULT_AUTOMATION_SETTINGS, holidays: DEFAULT_HOLIDAYS, files: [], evidenceLink: new Map(), publicHolidays: [], ...extra,
})
const plan = (id: AutomationRuleId, i: PlanInput) => planRule(rules.get(id)!, i)

describe('waktu WIB', () => {
  test('tanggal WIB berganti pukul 17:00 UTC', () => {
    expect(wib(new Date('2026-11-16T16:59:00Z')).date).toBe('2026-11-16')
    expect(wib(new Date('2026-11-16T17:00:00Z'))).toMatchObject({ date: '2026-11-17', hhmm: '00:00' })
    expect(wibInstant('2026-11-17', '07:00').toISOString()).toBe('2026-11-17T00:00:00.000Z')
  })
})

describe('ulang tahun', () => {
  test('29 Februari dirayakan 28 Februari di tahun bukan kabisat', () => {
    expect(anniversaryOn('1992-02-29', 2027)).toBe('2027-02-28')
    expect(anniversaryOn('1992-02-29', 2028)).toBe('2028-02-29')
    expect(anniversaryOn('', 2027)).toBeUndefined()
  })
  test('hanya pegawai aktif yang berulang tahun hari ini; sapaan dan nama dipersonalisasi', () => {
    const people = [
      emp('a', { nama: 'SITI RAHMA', jenisKelamin: 'Perempuan', tanggalLahir: '1990-11-16' }),
      emp('b', { tanggalLahir: '1985-11-17' }),
      emp('c', { tanggalLahir: '1980-11-16', statusPegawai: 'Nonaktif' }),
      emp('d', { tanggalLahir: '1960-11-16', tanggalPensiun: '2026-06-01' }),
    ]
    const { drafts } = plan('birthday', input('2026-11-16', people))
    expect(drafts.map(d => d.employeeId)).toEqual(['a'])
    expect(drafts[0]).toMatchObject({ dedupeKey: 'birthday:2026:a', phone: '6281200000001', recipientName: 'Siti Rahma' })
    expect(drafts[0].message).toContain('Ibu Siti Rahma')
    expect(drafts[0].message).toContain('Human Resources KPPU')
    expect(drafts[0].scheduledFor.toISOString()).toBe('2026-11-16T00:00:00.000Z') // 07:00 WIB
  })
  test('pegawai tanpa nomor tetap muncul sebagai draf tanpa nomor (untuk awareness)', () => {
    const { drafts } = plan('birthday', input('2026-11-16', [emp('x', { tanggalLahir: '1990-11-16', nomorWhatsApp: '' })]))
    expect(drafts[0].phone).toBe('')
  })
})

describe('hari raya sesuai agama', () => {
  const people = [emp('k', { agama: 'Kristen' }), emp('c', { agama: 'Katolik' }), emp('i', { agama: 'Islam' }), emp('n', { agama: '' })]
  test('Natal hanya untuk Kristen dan Katolik', () => {
    const { drafts } = plan('religion', input('2026-12-25', people))
    expect(drafts.map(d => d.employeeId).sort()).toEqual(['c', 'k'])
    expect(drafts[0].message).toContain('Selamat Hari Natal')
  })
  test('hari raya yang belum dikonfirmasi tidak dikirim dan diberi catatan', () => {
    const r = plan('religion', input('2027-03-10', people))
    expect(r.drafts).toHaveLength(0)
    expect(r.note).toContain('belum dikonfirmasi')
  })
  test('hari raya yang dinonaktifkan tidak dikirim', () => {
    const holidays = DEFAULT_HOLIDAYS.map(h => h.date === '2026-12-25' ? { ...h, enabled: false } : h)
    expect(plan('religion', input('2026-12-25', people, { holidays })).drafts).toHaveLength(0)
  })
})

describe('masa kerja', () => {
  test('hanya tahun milestone', () => {
    const people = [emp('five', { tanggalMulaiKerja: '2021-11-16' }), emp('four', { tanggalMulaiKerja: '2022-11-16' }), emp('new', { tanggalMulaiKerja: '2026-11-16' })]
    const { drafts } = plan('anniversary', input('2026-11-16', people))
    expect(drafts.map(d => d.employeeId)).toEqual(['five'])
    expect(drafts[0].message).toContain('5 tahun')
  })
})

describe('konfirmasi data berkala', () => {
  test('hari kerja pertama bulan terpilih, melewati libur nasional', () => {
    expect(firstWorkday('2027-01', ['2027-01-01'])).toBe('2027-01-04')
    expect(plan('datarefresh', input('2027-01-04', [emp('a', {})], { publicHolidays: ['2027-01-01'] })).drafts).toHaveLength(1)
    expect(plan('datarefresh', input('2027-01-05', [emp('a', {})], { publicHolidays: ['2027-01-01'] })).drafts).toHaveLength(0)
    expect(plan('datarefresh', input('2027-02-01', [emp('a', {})])).drafts).toHaveLength(0)
  })
})

describe('presensi Reject dan scan pulang', () => {
  const ev = (id: string, kind: SourceFile['kind'], date: string, extra: Partial<Evidence>): Evidence => ({ id, fileId: kind, kind: kind as Evidence['kind'], office: 'Pusat', name: 'X', ids: {}, date, ref: id, ...extra })
  const file = (kind: SourceFile['kind'], evidence: Evidence[]): SourceFile => ({ id: kind, fileName: `${kind}.xlsx`, kind, label: kind, office: 'Pusat', importedAt: '2026-11-10T00:00:00Z', period: { start: '2026-11-02', end: '2026-11-13' }, evidence, assignments: [], warnings: [], stats: { rows: evidence.length, people: 1 } })
  const files = [
    file('daring', [ev('r1', 'daring', '2026-11-03', { approvalStatus: 'rejected', clockIn: '07:50', clockOut: '16:10' }), ev('r2', 'daring', '2026-11-05', { approvalStatus: 'rejected', clockIn: '07:40', clockOut: '16:00' }), ev('r3', 'daring', '2026-11-10', { approvalStatus: 'rejected', clockIn: '07:40' })]),
    file('mesin', [ev('m1', 'mesin', '2026-11-04', { clockIn: '07:30' }), ev('m2', 'mesin', '2026-11-10', { clockIn: '07:30' }), ev('m3', 'mesin', '2026-11-06', { clockIn: '07:30' }), ev('m3b', 'mesin', '2026-11-06', { clockOut: '16:30' })]),
  ]
  const evidenceLink = new Map(['r1', 'r2', 'r3', 'm1', 'm2', 'm3', 'm3b'].map(id => [id, 'a']))
  const people = [emp('a', { jenisKelamin: 'Laki-laki' })]
  test('Reject digabung satu pesan per pegawai per pekan', () => {
    const { drafts } = plan('rejected', input('2026-11-16', people, { files, evidenceLink }))
    expect(drafts.map(d => d.dedupeKey).sort()).toEqual(['rejected:2026-11-02:a', 'rejected:2026-11-09:a'])
    const first = drafts.find(d => d.dedupeKey.endsWith('2026-11-02:a'))!
    expect(first.message).toContain('Selasa, 3 November 2026 dan Kamis, 5 November 2026')
  })
  test('scan masuk tanpa pulang; hari dengan scan pulang di baris lain tidak dihitung', () => {
    const { drafts } = plan('forgotout', input('2026-11-16', people, { files, evidenceLink }))
    const week1 = drafts.find(d => d.dedupeKey === 'forgotout:2026-11-02:a')!
    expect(week1.message).toContain('Rabu, 4 November 2026')
    expect(week1.message).not.toContain('6 November')
  })
  test('data di luar rentang hari tidak diberitahukan', () => {
    expect(plan('rejected', input('2026-12-20', people, { files, evidenceLink })).drafts).toHaveLength(0)
  })
})

describe('utilitas', () => {
  test('normalisasi nomor', () => {
    expect(normalizePhone('0812-3456-7890')).toBe('6281234567890')
    expect(normalizePhone('+62 812 3456 7890')).toBe('6281234567890')
    expect(normalizePhone('8123456789')).toBe('628123456789')
    expect(normalizePhone('021-555-1234')).toBeUndefined()
    expect(normalizePhone('')).toBeUndefined()
  })
  test('token yang tidak terisi dilaporkan', () => {
    expect(render('Halo {{nama}}, {{tautan_resmi}}', { nama: 'Budi' })).toEqual({ text: 'Halo Budi, {{tautan_resmi}}', unresolved: ['tautan_resmi'] })
  })
  test('nama huruf kapital menjadi huruf judul, nama campuran tidak diubah', () => {
    expect(displayName("ANDI ZUBAIDAH ASSAF")).toBe('Andi Zubaidah Assaf')
    expect(displayName('Martin Marcelino Tarigan')).toBe('Martin Marcelino Tarigan')
  })
  test('daftar tanggal', () => expect(dateList(['2026-11-05', '2026-11-03'])).toBe('Selasa, 3 November 2026 dan Kamis, 5 November 2026'))
  test('kampanye bulanan tanggal 31 jatuh di akhir bulan pendek', () => {
    const c = { sendAt: '2027-01-31T02:00:00.000Z', repeatMonthly: true } // 09:00 WIB
    expect(campaignOccurrence(c, '2027-02-28')?.toISOString()).toBe('2027-02-28T02:00:00.000Z')
    expect(campaignOccurrence(c, '2027-02-27')).toBeUndefined()
    expect(campaignOccurrence(c, '2026-12-31')).toBeUndefined()
    expect(campaignOccurrence({ ...c, repeatMonthly: false }, '2027-02-28')).toBeUndefined()
  })
})
