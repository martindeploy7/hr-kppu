import { test } from '@e2e-dev/web'
import { expect, credentials } from 'e2e'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
const backupMarker = '.e2e/fixtures/correction-backup.json'

test('locked period correction is reviewed and locked by another finance account', async ({ app, screen, browser }) => {
  await app.open('/')
  const account = credentials.user('admin')
  const loginAdmin = async () => {
    await screen.getByLabel('Email akun').fill(account.username)
    await screen.getByLabel('Password').fill(account.password)
    await screen.getByRole('button', 'Masuk', { exact: true }).tap()
    await expect(screen.getByRole('button', 'Uang Makan', { exact: true })).toBeVisible()
  }
  await loginAdmin()
  const cleanup = async () => {
    await browser.evaluate(async () => { await fetch('/api/auth/logout', { method: 'POST' }) })
    await app.open('/'); await loginAdmin()
    const marker = JSON.parse(readFileSync(backupMarker, 'utf8'))
    await browser.evaluate(async (restoreId: string) => {
      const w = await (await fetch('/api/workspace')).json(), saved = await (await fetch(`/api/backup/restore-points/${restoreId}`)).json()
      const r = await fetch('/api/backup/restore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ state: saved.state, expectedRevision: w.revision, reason: 'E2E restore original local workspace after synthetic correction' }) })
      if (!r.ok) throw new Error(`Restore E2E workspace: ${r.status}`)
      const users = await (await fetch('/api/users')).json()
      for (const u of users.users.filter((u: any) => u.active && u.email.startsWith('e2e-finance-') && u.email.endsWith('@kppu.test'))) {
        const disabled = await fetch(`/api/users/${u.id}/disable`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'E2E synthetic finance cleanup' }) })
        if (!disabled.ok) throw new Error(`Disable E2E user: ${disabled.status}`)
      }
    }, marker.id)
    unlinkSync(backupMarker)
  }
  if (existsSync(backupMarker)) await cleanup()
  try {
  const seed = await browser.evaluate(async () => {
    const get = async (path: string) => (await fetch(`/api${path}`)).json()
    const post = async (path: string, value: unknown) => {
      const r = await fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
      if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(await r.json())}`)
      return r.json()
    }
    const w = await get('/workspace'), actor = (await get('/auth/me')).user
    const person = { id: 'e2e-correction-person', nama: 'E2E Koreksi Sintetis', nip: '198001012020011996', nika: '', kantor: 'Kanwil VII', unit: 'E2E', statusKepegawaian: 'PNS', golongan: 'III/a', jabatan: '', tanggalLahir: '', jenisKelamin: '', tempatLahir: '', pendidikan: '', disiplinIlmu: '', pelatihan: [], tanggalMulaiKerja: '', alamat: '', kontakDarurat: '', namaKontakDarurat: '', statusPerkawinan: '', agama: '', nomorWhatsApp: '', email: '', statusPegawai: 'Aktif', aliases: [], sources: [], derived: [], rateHistory: [{ start: '2026-08-01', end: '2026-08-31', rate: 37000, pph: 5, basis: 'E2E synthetic baseline' }] }
    const evidence = Array.from({ length: 31 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`).filter(date => ![0, 6].includes(new Date(`${date}T00:00:00Z`).getUTCDay())).map(date => ({ id: `e2e-correction-${date}`, fileId: 'e2e-correction-file', kind: 'mesin', office: person.kantor, name: person.nama, ids: { nip: person.nip }, date, clockIn: '08:00', clockOut: new Date(`${date}T00:00:00Z`).getUTCDay() === 5 ? '16:30' : '16:00', ref: `E2E synthetic ${date}` }))
    const file = { id: 'e2e-correction-file', fileName: 'E2E synthetic correction fixture', kind: 'mesin', label: 'E2E synthetic', office: person.kantor, importedAt: new Date().toISOString(), period: { start: '2026-08-01', end: '2026-08-31' }, completeThrough: '2026-08-31', evidence, assignments: [], warnings: [], stats: { rows: evidence.length, people: 1 } }
    const nil = { ...file, id: 'e2e-correction-nil', fileName: 'E2E synthetic nil ST', kind: 'surat-tugas', evidence: [], stats: { rows: 0, people: 0 }, declaration: { actorId: actor.id, basis: 'E2E synthetic nil declaration, not real operational data', at: new Date().toISOString() } }
    const state = { ...w.state, master: [...w.state.master.filter((e: any) => e.id !== person.id), person], files: [...w.state.files.filter((f: any) => !f.id.startsWith('e2e-correction-')), file, nil], overrides: { ...w.state.overrides }, period: '2026-08', policy: { ...w.state.policy, parametersApproved: true, arrivalBoundary: 'inclusive', holidays: [] } }
    delete state.overrides[person.id]
    const restored = await post('/backup/restore', { state, expectedRevision: w.revision, reason: 'E2E isolated synthetic August correction fixture' })
    const restorePoint = (await get('/audit')).events.find((e: any) => e.action === 'workspace.restore' && e.revision === restored.revision)
    return { restorePointId: restorePoint.id }
  })
  writeFileSync(backupMarker, JSON.stringify({ id: seed.restorePointId }), { mode: 0o600 })
  const base = await browser.evaluate(async () => {
    const get = async (path: string) => (await fetch(`/api${path}`)).json()
    const post = async (path: string, value: unknown) => {
      const r = await fetch(`/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
      if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(await r.json())}`)
      return r.json()
    }
    const items = (await get('/meal-submissions')).submissions
    for (const s of items.filter((s: any) => s.period === '2026-08' && s.office === 'Kanwil VII' && ['submitted', 'approved'].includes(s.status))) await post(`/meal-submissions/${s.id}/cancel`, { expectedRevision: s.revision, reason: 'E2E restart pending fixture proposal' })
    const current = (await get('/meal-submissions')).submissions, parent = current.find((s: any) => s.period === '2026-08' && s.office === 'Kanwil VII' && s.status === 'locked' && !s.correctionId)
    const response = await post('/meal-submissions', { id: crypto.randomUUID(), period: '2026-08', office: 'Kanwil VII', expectedRevision: (await get('/workspace')).revision, ...(parent ? { supersedesId: parent.id, reason: 'E2E new baseline for repeatable correction scenario' } : {}) })
    return { id: response.submission.id, version: response.submission.version }
  })
  const switchToNewFinance = async () => {
    await browser.evaluate(async () => {
      const email = `e2e-finance-${crypto.randomUUID()}@kppu.test`, password = crypto.randomUUID() + crypto.randomUUID()
      const response = await fetch('/api/users', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password, name: 'E2E Finance Sintetis', role: 'finance' }) })
      if (!response.ok) throw new Error(`Create synthetic finance: ${response.status}`)
      const users = await (await fetch('/api/users')).json(), user = users.users.find((u: any) => u.email === email)
      const login = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })
      if (!login.ok) throw new Error(`Finance login: ${login.status}`)
      return user.id
    })
    await browser.reload()
    await screen.getByRole('button', 'Uang Makan', { exact: true }).tap()
  }
  await switchToNewFinance()
  await screen.getByLabel('Catatan tindakan', { exact: true }).fill('E2E Finance memeriksa snapshot dan sumber sintetis')
  await screen.getByRole('button', 'Setujui', { exact: true }).tap()
  await expect(screen.getByRole('button', 'Kunci', { exact: true })).toBeVisible()
  await screen.getByRole('button', 'Kunci', { exact: true }).tap()
  await expect(screen.getByRole('button', 'Kunci', { exact: true })).not.toBeVisible()
  await screen.getByRole('button', /Keluar ·/).tap(); await loginAdmin()
  await browser.evaluate(async () => {
    const w = await (await fetch('/api/workspace')).json(), id = 'e2e-correction-person'
    const r = await fetch('/api/workspace', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ expectedRevision: w.revision, patch: { overrides: { ...w.state.overrides, [id]: { rateHistory: [{ start: '2026-08-01', end: '2026-08-31', rate: 38000, pph: 5, basis: 'E2E verified synthetic correction' }] } } }, reason: 'E2E synthetic rate correction after lock' }) })
    if (!r.ok) throw new Error(`Rate correction: ${r.status}`)
  })
  await browser.reload(); await screen.getByRole('button', 'Uang Makan', { exact: true }).tap()
  await screen.getByLabel('Catatan tindakan', { exact: true }).fill('E2E koreksi tarif dengan bukti sintetis terbaru')
  await screen.getByRole('button', `Ajukan koreksi v${base.version + 1}`, { exact: true }).tap()
  await expect(screen.getByText('Rp19.950', { exact: true })).toBeVisible()
  await switchToNewFinance()
  await screen.getByLabel('Catatan tindakan', { exact: true }).fill('E2E Finance menyetujui selisih versi koreksi')
  await screen.getByRole('button', 'Setujui', { exact: true }).tap()
  await expect(screen.getByRole('button', 'Kunci', { exact: true })).toBeVisible()
  await screen.getByRole('button', 'Kunci', { exact: true }).tap()
  await expect(screen.getByText(`v${base.version} · arsip digantikan`, { exact: true })).toBeVisible()
  for (const width of [390, 1280]) { await browser.setViewport({ width, height: 844 }); expect(await browser.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true) }
  const preserved = await browser.evaluate(async (id: string) => (await (await fetch(`/api/meal-submissions/${id}`)).json()).submission, base.id)
  expect(preserved.snapshot.months.reduce((sum: number, m: any) => sum + m.netto, 0)).toBe(738150)
  expect(Boolean(preserved.supersededBy)).toBe(true)
  } finally { if (existsSync(backupMarker)) await cleanup() }
})
