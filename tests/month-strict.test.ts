import { describe, expect, test } from 'vitest'
import { limitToRange, previewImport } from '../server/imports.ts'
import { inspectSourceCoverage, createCoverageLookup } from '../src/engine/monthlyFlow.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { buildRoster, blankEmployee } from '../src/engine/roster.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import { addDays, eachDay, isWeekend, monthBounds, overlapsMonth, splitByMonth, weekOtherPart, weekRange, weekStartForDate, weeksInMonth } from '../src/engine/dates.ts'
import { neighbourCoverage, weekOptionLabel } from '../src/lib/weekLabel.ts'
import { emptyWorkspace, type User, type Workspace } from '../shared/workspace.ts'
import type { Assignment, Evidence, SourceFile } from '../src/engine/types.ts'

// Atribusi bulan per tanggal kalender: unit unggah = pekan Senin–Minggu penuh, baris disimpan dengan tanggalnya sendiri,
// dan setiap tanggal hanya dihitung di bulannya, apa pun pekan atau file pembawanya.

const admin: User = { id: 'admin', name: 'Superadmin Uji', email: 'admin@example.test', role: 'superadmin', offices: null }
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-11-01T00:00:00.000Z'
const ASOF = '2026-12-31'
const people = ['198001012020011001', '198001012020011002', '198001012020011003'].map((nip, index) => ({ ...blankEmployee(`person-${index + 1}`), nama: `Pegawai ${index + 1}`, nip, kantor: 'Pusat', golongan: 'III/a', statusKepegawaian: 'PNS' as const }))
const policy = { ...DEFAULT_POLICY, holidays: [], parametersApproved: true }

function sourceFile(args: { id: string; kind: SourceFile['kind']; office: string; evidence?: Evidence[]; assignments?: Assignment[]; period?: { start: string; end: string }; coverage?: SourceFile['coverageDeclarations'] }): SourceFile {
  const dates = [...(args.evidence ?? []).map(row => row.date), ...(args.assignments ?? []).flatMap(row => [row.start, row.end])].sort()
  return {
    id: args.id, fileName: `${args.id}.xlsx`, kind: args.kind, label: args.kind, office: args.office, importedAt: stamp,
    period: args.period ?? (dates.length ? { start: dates[0], end: dates.at(-1)! } : null), evidence: args.evidence ?? [], assignments: args.assignments ?? [], coverageDeclarations: args.coverage,
    warnings: [], stats: { rows: (args.evidence?.length ?? 0) + (args.assignments?.length ?? 0), people: people.length }, active: true,
  }
}
const declaration = (status: 'complete' | 'nil' | 'not-applicable', start: string, end: string) => [{ start, end, status, basis: 'Konfirmasi cakupan sintetis untuk uji', actorId: admin.id, at: stamp }]

function row(fileId: string, date: string, person: typeof people[number], clockIn = '07:50', clockOut = '17:00'): Evidence {
  return { id: `${fileId}|${person.nip}|${date}`, fileId, kind: 'mesin', office: 'Pusat', name: person.nama, ids: { nip: person.nip }, date, clockIn, clockOut, ref: `Sheet1 · ${date}` }
}
const workdays = (start: string, end: string) => eachDay(start, end).filter(date => !isWeekend(date))
const rowsFor = (fileId: string, start: string, end: string) => workdays(start, end).flatMap(date => people.map(person => row(fileId, date, person)))

/** Online dan ST dinyatakan "tidak berlaku/nihil" sepanjang rentang uji, supaya yang diuji hanya Mesin Offline. */
function baseState(): Workspace {
  const state = emptyWorkspace()
  state.master = people
  state.policy = policy
  state.files = [
    sourceFile({ id: 'online-na', kind: 'daring', office: 'Semua kantor', period: { start: '2026-05-25', end: '2026-09-06' }, coverage: declaration('not-applicable', '2026-05-25', '2026-09-06') }),
    sourceFile({ id: 'st-nil', kind: 'surat-tugas', office: 'Pusat', period: { start: '2026-05-25', end: '2026-09-06' }, coverage: declaration('nil', '2026-05-25', '2026-09-06') }),
  ]
  return state
}

/** Meniru ImportPage.handle: satu unggahan = pekan penuh, cakupan "lengkap" untuk seluruh pekan (dipotong ke hari ini). */
function weeklyUpload(state: Workspace, revision: number, parsed: SourceFile, week: { start: string; end: string }) {
  const intent = {
    uploadId: parsed.id, expectedRevision: revision, office: 'Semua kantor', mode: 'add', resolveUnmappedOffice: false, range: week,
    coverage: { start: week.start, end: week.end, status: 'complete', basis: `Setoran mingguan Mesin Offline seluruh KPPU melalui unggah file ${parsed.fileName}` },
    reason: `Setoran Mesin Offline seluruh KPPU, ${week.start}–${week.end} melalui kartu mingguan`,
  }
  const result = previewImport(state, revision, parsed, admin, intent as never)
  return { state: result.next, impact: result.impact }
}

const calc = (state: Workspace, month: string) => {
  const files = state.files.filter(file => file.active !== false)
  return reconcile(files, buildRoster(files, state.master, state.overrides, state.decisions), monthBounds(month), state.policy, state.resolutions, ASOF, state.dayReviews, createCoverageLookup(files))
}
const dayOf = (state: Workspace, month: string, personId: string, date: string) => calc(state, month).months.find(m => m.employee.id === personId)!.days.find(d => d.date === date)!
const mealDays = (state: Workspace, month: string) => calc(state, month).months.reduce((sum, m) => sum + m.mealDays, 0)

describe('helper tanggal dan label pekan', () => {
  test('splitByMonth membelah rentang di batas bulan dan weekOtherPart memberi bagian bulan tetangga', () => {
    expect(splitByMonth('2026-06-29', '2026-07-05')).toEqual([{ month: '2026-06', start: '2026-06-29', end: '2026-06-30' }, { month: '2026-07', start: '2026-07-01', end: '2026-07-05' }])
    expect(splitByMonth('2026-12-28', '2027-01-03').map(part => part.month)).toEqual(['2026-12', '2027-01'])
    expect(splitByMonth('2026-07-06', '2026-07-12')).toHaveLength(1)
    const july = weeksInMonth('2026-07').at(-1)!, august = weeksInMonth('2026-08')[0]
    expect(weekOtherPart(july)).toEqual([{ month: '2026-08', start: '2026-08-01', end: '2026-08-02' }])
    expect(weekOtherPart(august)).toEqual([{ month: '2026-07', start: '2026-07-27', end: '2026-07-31' }])
    expect(weekOtherPart(weeksInMonth('2026-07')[1])).toEqual([])
  })

  test('label pekan lintas bulan menyebut rentang setor penuh dan bagian bulan tetangga', () => {
    expect(weekOptionLabel(weeksInMonth('2026-07').at(-1)!)).toBe('Pekan 5 · 27–31 Jul (setor 27 Jul–2 Agu, termasuk 1–2 Agu)')
    expect(weekOptionLabel(weeksInMonth('2026-08')[0])).toBe('Pekan 1 · 1–2 Agu (setor 27 Jul–2 Agu, termasuk 27–31 Jul)')
    expect(weekOptionLabel(weeksInMonth('2026-07')[1])).toBe('Pekan 2 · 6–12 Jul')
  })

  test('teks konfirmasi menyebut tanggal bulan tetangga yang ikut tercakup, dipotong ke hari ini', () => {
    const week = weekRange('2026-07-27')
    expect(neighbourCoverage(week, '2026-08', '2026-11-19')).toBe('Konfirmasi ini juga berlaku untuk 27–31 Jul (Juli).')
    expect(neighbourCoverage(week, '2026-08', '2026-07-28')).toBe('Konfirmasi ini juga berlaku untuk 27–28 Jul (Juli).')
    expect(neighbourCoverage(week, '2026-07', '2026-11-19')).toBe('Konfirmasi ini juga berlaku untuk 1–2 Agu (Agustus).')
    expect(neighbourCoverage(weekRange('2026-07-06'), '2026-07', '2026-11-19')).toBe('')
  })

  test('ST beririsan dengan bulan lewat tumpang tindih tanggal, bukan bulan awal ST', () => {
    expect(overlapsMonth('2026-08-31', '2026-09-02', '2026-09')).toBe(true)
    expect(overlapsMonth('2026-08-31', '2026-09-02', '2026-08')).toBe(true)
    expect(overlapsMonth('2026-08-31', '2026-09-02', '2026-10')).toBe(false)
  })
})

describe('S1: file lintas bulan diunggah di pekan terakhir bulan lama', () => {
  const week = weekRange('2026-06-29')
  const parsed = () => sourceFile({ id: uuid(1), kind: 'mesin', office: 'Pusat', evidence: rowsFor(uuid(1), '2026-06-29', '2026-07-03') })

  test('seluruh 15 baris tersimpan, deklarasi cakupan terbelah per bulan, dan 1–3 Jul dihitung Juli', () => {
    const before = baseState()
    const held = dayOf(before, '2026-07', people[0].id, '2026-07-01')
    expect(held.meal).toMatchObject({ state: 'held', heldBy: 'coverage' })
    expect(held.meal.reason).toContain('Mesin Offline')

    const { state, impact } = weeklyUpload(before, 0, parsed(), week)
    const stored = state.files.find(file => file.id === uuid(1))!
    expect(stored.evidence).toHaveLength(15)
    expect(impact.counts.added).toBe(15)
    expect(impact.source.parsedRows).toBe(15)
    expect(impact.source.selectedRows - 0).toBe(15)
    expect(stored.coverageDeclarations?.map(d => [d.start, d.end, d.status])).toEqual([['2026-06-29', '2026-06-30', 'complete'], ['2026-07-01', '2026-07-05', 'complete']])
    expect(stored.warnings.some(w => w.includes('di luar pekan'))).toBe(false)

    for (const date of ['2026-07-01', '2026-07-02', '2026-07-03']) for (const person of people) expect(dayOf(state, '2026-07', person.id, date).meal.state).toBe('eligible')
    for (const date of ['2026-06-29', '2026-06-30']) for (const person of people) expect(dayOf(state, '2026-06', person.id, date).meal.state).toBe('eligible')
    expect(mealDays(state, '2026-06')).toBe(6)
    expect(mealDays(state, '2026-07')).toBe(9)
  })

  test('pekan lintas bulan tampak disetor di kedua bulan untuk tanggal masing-masing', () => {
    const { state } = weeklyUpload(baseState(), 0, parsed(), week)
    const offline = (start: string, end: string) => inspectSourceCoverage(state.files, start, end).find(item => item.source === 'offline')!
    expect(offline('2026-06-29', '2026-06-30')).toMatchObject({ ready: true, state: 'complete' })
    expect(offline('2026-07-01', '2026-07-05')).toMatchObject({ ready: true, state: 'complete' })
    expect(offline('2026-06-29', '2026-07-05').ready).toBe(true)
    expect(inspectSourceCoverage(state.files, '2026-07-01', '2026-07-05').every(item => item.ready)).toBe(true)
    expect(offline('2026-07-06', '2026-07-12').ready).toBe(false)
  })

  test('dampak unggahan dirinci per bulan: baris baru, hari berubah, dan nominal berubah', () => {
    const { impact } = weeklyUpload(baseState(), 0, parsed(), week)
    expect(impact.byMonth?.map(row => [row.month, row.added, row.duplicate, row.changedDays, row.changedAmounts])).toEqual([['2026-06', 6, 0, 6, 6], ['2026-07', 9, 0, 9, 9]])
    expect(impact.review.byMonth).toEqual({ '2026-06': expect.objectContaining({ changedDays: 6 }), '2026-07': expect.objectContaining({ changedDays: 9 }) })
    expect(impact.review.changedDays).toBe(15)
  })

  test('unggah ulang file yang sama dari sisi bulan lain menambah 0 baris baru', () => {
    const first = weeklyUpload(baseState(), 0, parsed(), week)
    const again = weeklyUpload(first.state, 1, sourceFile({ id: uuid(2), kind: 'mesin', office: 'Pusat', evidence: rowsFor(uuid(2), '2026-06-29', '2026-07-03') }), week)
    expect(again.impact.counts).toMatchObject({ added: 0, duplicate: 15 })
    expect(mealDays(again.state, '2026-07')).toBe(9)
  })
})

describe('S2: file yang hanya memuat 27–28 Jul diunggah dari pekan 1 Agustus', () => {
  const week = weekRange('2026-07-27')
  const parsed = () => sourceFile({ id: uuid(3), kind: 'mesin', office: 'Pusat', evidence: rowsFor(uuid(3), '2026-07-27', '2026-07-28') })

  test('diterima, baris dihitung di Juli, dan peringatan menyebut tanggal per bulan', () => {
    const { state, impact } = weeklyUpload(baseState(), 0, parsed(), week)
    const stored = state.files.find(file => file.id === uuid(3))!
    expect(stored.evidence).toHaveLength(6)
    expect(stored.coverageDeclarations?.map(d => [d.start, d.end])).toEqual([['2026-07-27', '2026-07-31'], ['2026-08-01', '2026-08-02']])
    expect(mealDays(state, '2026-07')).toBe(6)
    expect(mealDays(state, '2026-08')).toBe(0)
    expect(impact.byMonth?.map(row => [row.month, row.added])).toEqual([['2026-07', 6]])
    expect(impact.coverageNote).toContain('Data di file berakhir 2026-07-28')
    expect(impact.coverageNote).toContain('Juli 2026 27–31 Jul (data terakhir 28 Jul)')
    expect(impact.coverageNote).toContain('Agustus 2026 1–2 Agu (tanpa baris data)')
  })

  test('tidak ada peringatan bila file memuat sampai akhir rentang yang dinyatakan', () => {
    const full = sourceFile({ id: uuid(4), kind: 'mesin', office: 'Pusat', evidence: rowsFor(uuid(4), '2026-07-27', '2026-08-02') })
    expect(weeklyUpload(baseState(), 0, full, week).impact.coverageNote).toBeUndefined()
  })
})

describe('invarian atribusi bulan', () => {
  test('satu tanggal pegawai muncul tepat di satu bulan dan berawalan bulan itu', () => {
    const first = weeklyUpload(baseState(), 0, sourceFile({ id: uuid(1), kind: 'mesin', office: 'Pusat', evidence: rowsFor(uuid(1), '2026-06-29', '2026-07-03') }), weekRange('2026-06-29'))
    const second = weeklyUpload(first.state, 1, sourceFile({ id: uuid(3), kind: 'mesin', office: 'Pusat', evidence: rowsFor(uuid(3), '2026-07-27', '2026-08-03') }), weekRange('2026-07-27'))
    const seen = new Map<string, string>()
    for (const month of ['2026-06', '2026-07', '2026-08']) {
      for (const m of calc(second.state, month).months) for (const day of m.days) {
        expect(day.date.startsWith(month)).toBe(true)
        const key = `${m.employee.id}|${day.date}`
        expect(seen.has(key), `${key} muncul di ${seen.get(key)} dan ${month}`).toBe(false)
        seen.set(key, month)
      }
    }
    expect(seen.size).toBe(people.length * workdays('2026-06-01', '2026-08-31').length)
  })

  test('unggah tidak pernah mengalihkan baris ke bulan unggahan: tanggal baris tetap', () => {
    const { state } = weeklyUpload(baseState(), 0, sourceFile({ id: uuid(3), kind: 'mesin', office: 'Pusat', evidence: rowsFor(uuid(3), '2026-07-27', '2026-08-03') }), weekRange('2026-07-27'))
    const stored = state.files.find(file => file.id === uuid(3))!
    expect(stored.evidence.map(e => e.date).sort()).toEqual(rowsFor(uuid(3), '2026-07-27', '2026-08-02').map(e => e.date).sort())
    expect(stored.warnings.some(w => w.includes('1 baris') || w.includes('3 baris'))).toBe(true) // 3 Agu (Senin pekan berikutnya) di luar pekan
  })
})

describe('properti: total UM bulanan tidak bergantung cara file dipecah per pekan', () => {
  // Pembangkit acak deterministik (mulberry32) agar kegagalan dapat diulang.
  const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const FIRST = '2026-06-01', LAST = '2026-08-31'
  const synthetic = (seed: number) => {
    const next = rng(seed)
    return workdays(FIRST, LAST).flatMap(date => people.flatMap(person => {
      const roll = next()
      if (roll < 0.1) return [] // tidak ada bukti
      if (roll < 0.25) return [{ date, person, clockIn: '08:30', clockOut: '17:00' }] // terlambat
      if (roll < 0.35) return [{ date, person, clockIn: '07:45', clockOut: '16:00' }] // pulang cepat
      return [{ date, person, clockIn: '07:50', clockOut: '17:05' }]
    }))
  }
  type Raw = ReturnType<typeof synthetic>[number]
  const build = (id: string, rows: Raw[]) => sourceFile({ id, kind: 'mesin', office: 'Pusat', evidence: rows.map(r => ({ ...row(id, r.date, r.person, r.clockIn, r.clockOut) })) })
  const weekStarts = (() => { const out: string[] = []; for (let d = weekStartForDate(FIRST); d <= LAST; d = addDays(d, 7)) out.push(d); return out })()
  const inRange = (r: Raw, start: string, end: string) => r.date >= start && r.date <= end

  const canonical = (state: Workspace) => ['2026-06', '2026-07', '2026-08'].map(month => calc(state, month)).map(c => c.months.flatMap(m => m.days.map(d => `${m.employee.id}|${d.date}|${d.status}|${d.meal.state}|${d.meal.amount}`)).sort().join('\n'))
  const totals = (state: Workspace) => ['2026-06', '2026-07', '2026-08'].map(month => { const c = calc(state, month); return { month, days: c.months.reduce((s, m) => s + m.mealDays, 0), bruto: c.months.reduce((s, m) => s + m.bruto, 0) } })

  const truth = (rows: Raw[]) => {
    const state = baseState()
    state.files.push({ ...build('truth', rows), coverageDeclarations: declaration('complete', '2026-06-01', '2026-09-06') })
    return state
  }
  const strategies: { name: string; files: (week: { start: string; end: string }, rows: Raw[], n: number) => SourceFile[] }[] = [
    { name: 'satu file per pekan', files: (week, rows, n) => [build(uuid(100 + n), rows.filter(r => inRange(r, week.start, week.end)))] },
    { name: 'file kumulatif yang sama diunggah tiap pekan', files: (_week, rows, n) => [build(uuid(200 + n), rows)] },
    { name: 'dua file per pekan lintas bulan (satu per bulan)', files: (week, rows, n) => splitByMonth(week.start, week.end).map((part, i) => build(uuid(300 + n * 2 + i), rows.filter(r => inRange(r, part.start, part.end)))) },
    { name: 'file pekan dengan limpahan 3 hari ke pekan tetangga', files: (week, rows, n) => [build(uuid(400 + n), rows.filter(r => inRange(r, addDays(week.start, -3), addDays(week.end, 3))))] },
  ]

  for (const seed of [7, 2026]) {
    test(`seed ${seed}: setiap strategi menghasilkan UM per bulan dan per tanggal identik dengan data utuh`, () => {
      const rows = synthetic(seed)
      const expected = canonical(truth(rows)), expectedTotals = totals(truth(rows))
      expect(expectedTotals.every(t => t.days > 0 && t.bruto > 0)).toBe(true)
      for (const strategy of strategies) {
        let state = baseState(), revision = 0
        weekStarts.forEach((weekStart, n) => {
          const week = weekRange(weekStart)
          for (const file of strategy.files(week, rows, n)) {
            if (!file.evidence.length) continue
            const result = weeklyUpload(state, revision, file, week)
            state = result.state; revision++
          }
        })
        expect(totals(state), strategy.name).toEqual(expectedTotals)
        expect(canonical(state), strategy.name).toEqual(expected)
      }
    }, 120000)
  }
})

describe('ST mingguan', () => {
  const longSt = (fileId: string): Assignment => ({ id: `${fileId}-st`, fileId, office: 'Pusat', unit: 'Kesekjenan', letterNo: '010/ST/2026', letterDate: '2026-08-20', name: people[0].nama, nip: people[0].nip, start: '2026-08-25', end: '2026-09-10', rawDate: '25 Agustus–10 September 2026', destination: 'Bandung', local: false, ref: 'ST sintetis' })

  test('period file ST dipotong ke tanggal di dalam pekan, data ST tetap utuh', () => {
    const parsed = sourceFile({ id: uuid(10), kind: 'surat-tugas', office: 'Pusat', assignments: [longSt(uuid(10))] })
    expect(parsed.period).toEqual({ start: '2026-08-25', end: '2026-09-10' })
    const limited = limitToRange(parsed, weekRange('2026-08-31'))
    expect(limited.period).toEqual({ start: '2026-08-31', end: '2026-09-06' })
    expect(limited.assignments[0]).toMatchObject({ start: '2026-08-25', end: '2026-09-10' })
  })

  test('ST di dalam pekan lintas bulan: period tidak keluar pekan dan deklarasi terbelah per bulan', () => {
    const st = { ...longSt(uuid(11)), start: '2026-08-31', end: '2026-09-02' }
    const parsed = sourceFile({ id: uuid(11), kind: 'surat-tugas', office: 'Pusat', assignments: [st] })
    const week = weekRange('2026-08-31')
    const result = previewImport(baseState(), 0, parsed, admin, {
      uploadId: parsed.id, expectedRevision: 0, office: 'Semua kantor', mode: 'add', range: week,
      coverage: { start: week.start, end: week.end, status: 'complete', basis: 'Setoran mingguan Rekap ST seluruh KPPU melalui unggah file st.xlsx' }, reason: 'Setoran Rekap ST mingguan sintetis',
    } as never)
    const stored = result.next.files.find(file => file.id === parsed.id)!
    expect(stored.period).toEqual({ start: '2026-08-31', end: '2026-09-02' })
    expect(stored.coverageDeclarations?.map(d => [d.start, d.end])).toEqual([['2026-08-31', '2026-08-31'], ['2026-09-01', '2026-09-06']])
    expect(result.impact.byMonth?.map(row => [row.month, row.added])).toEqual([['2026-08', 1], ['2026-09', 1]])
    // ST yang sama dihitung per tanggal di bulannya masing-masing.
    expect(dayOf(result.next, '2026-08', people[0].id, '2026-08-31').assignments).toHaveLength(1)
    expect(dayOf(result.next, '2026-09', people[0].id, '2026-09-01').assignments).toHaveLength(1)
  })
})

describe('pengaman cakupan bulan tetangga tanpa baris', () => {
  test('file pekan 29 Jun–5 Jul yang hanya berisi Juni tidak menyatakan 1–3 Jul lengkap', () => {
    const week = { start: '2026-06-29', end: '2026-07-05' }
    const parsed = sourceFile({ id: uuid(901), kind: 'mesin', office: 'Pusat', evidence: rowsFor(uuid(901), '2026-06-29', '2026-06-30') })
    const { state, impact } = weeklyUpload(baseState(), 0, parsed, week)
    const stored = state.files.find(file => file.id === parsed.id)!
    expect(stored.coverageDeclarations?.map(d => [d.start, d.end])).toEqual([['2026-06-29', '2026-06-30']])
    expect(impact.coverageNote).toContain('belum dinyatakan lengkap')
    expect(dayOf(state, '2026-06', 'person-1', '2026-06-30').meal.state).toBe('eligible')
    // 1 Juli tetap menunggu setoran, bukan dianggap tanpa absensi.
    expect(dayOf(state, '2026-07', 'person-1', '2026-07-01').meal.state).toBe('held')
  })

  test('bagian bulan tetangga yang hanya akhir pekan tetap ikut dinyatakan lengkap', () => {
    const week = { start: '2026-07-27', end: '2026-08-02' }
    const parsed = sourceFile({ id: uuid(902), kind: 'mesin', office: 'Pusat', evidence: rowsFor(uuid(902), '2026-07-27', '2026-07-31') })
    const { state } = weeklyUpload(baseState(), 0, parsed, week)
    expect(state.files.find(file => file.id === parsed.id)!.coverageDeclarations?.map(d => [d.start, d.end])).toEqual([['2026-07-27', '2026-07-31'], ['2026-08-01', '2026-08-02']])
  })
})
