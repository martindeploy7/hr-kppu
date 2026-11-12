import { type User, type Workspace, type WorkspaceResponse } from '../shared/workspace.ts'
import { demoEmployees, demoSourceFiles, demoSourceForFilename, freshDemoWorkspace } from './demoData.ts'
import { buildRoster } from '../src/engine/roster.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { monthBounds } from '../src/engine/dates.ts'
import type { DayReview, RecordReview, SourceFile } from '../src/engine/types.ts'
import { createCoverageLookup, inspectMonthlyPackage } from '../src/engine/monthlyFlow.ts'
import { dayReviewProblem } from '../src/engine/dayReview.ts'

const STORAGE_KEY = 'kppu-hr-netlify-demo-v2'
const START = '2026-09-01'
const END = '2026-09-30'
const demoUser: User = { id: 'user-demo-admin', email: 'admin.demo@example.test', name: 'Superadmin Demo', role: 'superadmin', offices: null }
type SavedDemo = { state: Workspace; revision: number; submissions: Record<string, unknown>[]; audit: Record<string, unknown>[] }
type PreviewRecord = { file: SourceFile; duplicate: boolean }
const previews = new Map<string, PreviewRecord>()

function newStore(): SavedDemo {
  return { state: freshDemoWorkspace(), revision: 0, submissions: [], audit: [] }
}

function store(): SavedDemo {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as SavedDemo
      if (parsed?.state?.version === 2 && Array.isArray(parsed.state.master)) return parsed
    }
  } catch { /* Reset to a clean synthetic workspace if browser storage is unavailable. */ }
  const created = newStore()
  persist(created)
  return created
}

function persist(next: SavedDemo) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
}

function response(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers } })
}

function fail(message: string, status = 400) { return response({ error: message }, status) }
function workspaceResponse(saved = store()): WorkspaceResponse { return { state: structuredClone(saved.state), revision: saved.revision } }

function publishRefresh() {
  return new Promise<void>(resolve => window.dispatchEvent(new CustomEvent('kppu-demo-refresh', { detail: { done: resolve } })))
}

function mutateState(mutator: (saved: SavedDemo) => void, reason: string) {
  const saved = store()
  mutator(saved)
  saved.revision += 1
  saved.audit.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), actorName: demoUser.name, action: reason, revision: saved.revision, reason: 'Simulasi demo lokal' })
  persist(saved)
}

function makeNilSt(office: string, start: string, end: string, basis: string): SourceFile {
  const bounds = { start, end }
  const slug = office.replaceAll(' ', '_')
  const period = start.slice(0, 7)
  return {
    id: `demo-nil-${slug}-${period}`, fileName: `DUMMY_ST_Nihil_${slug}_${period}.xlsx`, kind: 'surat-tugas', label: 'Pernyataan ST nihil · data simulasi', office,
    importedAt: new Date().toISOString(), period: bounds, evidence: [], assignments: [], warnings: ['Pernyataan nihil sintetis untuk demo lokal.'],
    stats: { rows: 0, people: 0 }, hash: 'DEMO-SYNTHETIC', parserVersion: 'demo-scripted-v1', completeThrough: bounds.end,
    coverageDeclarations: [{ ...bounds, status: 'nil', basis, actorId: demoUser.id, at: new Date().toISOString() }],
    declaration: { actorId: demoUser.id, basis, at: new Date().toISOString() }, active: true,
  }
}

function computed(saved = store()) {
  const state = saved.state
  const period = state.period || '2026-09'
  const roster = buildRoster(state.files, state.master, state.overrides, state.decisions)
  return { roster, recon: reconcile(state.files, roster, monthBounds(period), state.policy, state.resolutions, undefined, state.dayReviews, createCoverageLookup(state.files)) }
}

function addOnce(target: Workspace, files: SourceFile[]) {
  const ids = new Set(target.files.map(file => file.id))
  for (const file of files) if (!ids.has(file.id)) target.files.push(structuredClone(file))
}

export const demoActions = {
  async setPeriod(period = '2026-09') {
    mutateState(saved => { saved.state.period = period }, 'Ubah periode demo')
    await publishRefresh()
  },
  async addSources(kind: 'offline' | 'online' | 'st') {
    mutateState(saved => addOnce(saved.state, demoSourceFiles(kind)), `Tambahkan sumber contoh ${kind}`)
    await publishRefresh()
  },
  async reviewSafeDays() {
    let reviewed = 0
    mutateState(saved => {
      const { roster, recon } = computed(saved)
      const existing = new Set(saved.state.dayReviews.map(row => `${row.employeeId}|${row.date}`))
      for (const month of recon.months) for (const day of month.days) {
        if (!day.workday || day.issues.length || day.reviewState === 'valid' || !['hadir', 'hadir-wfa', 'dinas-luar', 'dinas-lokal', 'diklat', 'cuti', 'sakit', 'izin', 'tanpa-keterangan'].includes(day.status)) continue
        const key = `${month.employee.id}|${day.date}`
        if (existing.has(key)) continue
        const review: DayReview = {
          employeeId: month.employee.id, date: day.date, status: day.status as DayReview['status'],
          evidenceIds: day.evidence.map(record => record.id), assignmentIds: day.assignments.map(record => record.id),
          note: 'Bukti demo cocok; ditetapkan untuk memperlihatkan hitung progresif.', reviewer: demoUser.name,
          actorId: demoUser.id, at: new Date().toISOString(), signature: day.reviewSignature,
        }
        if (dayReviewProblem(review, day.evidence, day.assignments)) continue
        saved.state.dayReviews.push(review)
        existing.add(key)
        reviewed += 1
      }
      void roster
    }, 'Sahkan hari demo yang tidak berflag')
    await publishRefresh()
    return reviewed
  },
  async reviewFlag() {
    let selected = ''
    mutateState(saved => {
      const { recon } = computed(saved)
      const target = recon.months.flatMap(month => month.days.map(day => ({ month, day })))
        .find(({ month, day }) => month.employee.id === demoEmployees[0].id && day.date === '2026-09-02' && day.reviewState !== 'valid')
      if (!target) return
      const offline = target.day.evidence.find(record => record.kind === 'mesin')
      if (!offline) return
      const review: DayReview = {
        employeeId: target.month.employee.id, date: target.day.date, status: 'hadir', evidenceIds: [offline.id], assignmentIds: [],
        note: 'Dalam skenario demo, admin memilih pasangan scan Mesin Offline sebagai bukti yang berlaku.', reviewer: demoUser.name,
        actorId: demoUser.id, at: new Date().toISOString(), signature: target.day.reviewSignature,
      }
      const problem = dayReviewProblem(review, target.day.evidence, target.day.assignments)
      if (problem) throw new Error(problem)
      saved.state.dayReviews = saved.state.dayReviews.filter(row => row.employeeId !== review.employeeId || row.date !== review.date)
      saved.state.dayReviews.push(review)
      selected = `${target.month.employee.nama} · ${target.day.date}`
    }, 'Pilih bukti valid untuk flag demo')
    await publishRefresh()
    return selected
  },
  async reset() {
    const fresh = newStore()
    persist(fresh)
    previews.clear()
    await publishRefresh()
  },
}

function parseBody(init?: RequestInit) {
  if (typeof init?.body !== 'string') return {}
  try { return JSON.parse(init.body) as Record<string, any> } catch { return {} }
}

function inferSource(fileName: string, uploadId: string): SourceFile | undefined {
  const source = demoSourceForFilename(fileName)
  if (!source) return undefined
  return { ...source, id: uploadId, fileName, hash: 'DEMO-SYNTHETIC', warnings: ['Data contoh sintetis; berkas asli tidak dibaca pada demo lokal.'] }
}

async function handleApi(url: URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()
  const path = url.pathname.replace(/^\/api/, '') || '/'
  const body = parseBody(init)
  const saved = store()

  if (path === '/auth/me' || path === '/auth/login') return response({ user: demoUser })
  if (path === '/auth/logout' || path === '/auth/password' || path === '/users') return response({ ok: true, user: demoUser })
  if (path === '/workspace' && method === 'GET') return response(workspaceResponse(saved))
  if (path === '/workspace/revision') return response({ revision: saved.revision })
  if (path === '/workspace' && method === 'PUT') {
    if (Number(body.expectedRevision) !== saved.revision) return fail('Revisi demo berubah. Muat ulang data lalu ulangi.', 409)
    saved.state = { ...saved.state, ...(body.patch ?? {}) }
    saved.revision += 1
    persist(saved)
    return response(workspaceResponse(saved))
  }
  if (path === '/monthly-package') return response({ package: inspectMonthlyPackage(saved.state.files, url.searchParams.get('period') || saved.state.period || '2026-09') })
  if (path === '/imports/preview' && method === 'POST') {
    const form = init?.body instanceof FormData ? init.body : undefined
    const file = form?.get('file') as File | null
    if (!file) return fail('Pilih file contoh dari paket demo.', 422)
    const id = `upload-demo-${crypto.randomUUID()}`
    const parsed = inferSource(file.name, id)
    if (!parsed) return fail('Untuk preview scripted, gunakan nama file contoh Mesin Offline, Mesin Online, atau ST per kantor.', 422)
    parsed.stats = { ...parsed.stats, rows: parsed.stats.rows }
    const duplicate = saved.state.files.some(item => item.fileName === file.name && item.active !== false)
    previews.set(id, { file: parsed, duplicate })
    return response({ duplicate, file: parsed })
  }
  if (path === '/imports/impact' && method === 'POST') {
    const preview = previews.get(String(body.uploadId))
    if (!preview) return fail('Preview demo kedaluwarsa. Pilih ulang file contoh.', 409)
    const file = preview.file
    const total = file.stats.rows
    return response({
      checksum: `DEMO-${file.id}-${saved.revision}`, revision: saved.revision, mode: body.mode ?? 'add',
      source: { id: file.id, kind: file.kind, office: body.office ?? file.office, parsedRows: total, selectedRows: total, omittedMasterCount: 0 },
      counts: { added: preview.duplicate ? 0 : total, changed: 0, removed: 0, ambiguous: 0, duplicate: preview.duplicate ? total : 0, unchanged: 0 },
      changes: [], offset: body.offset ?? 0, limit: body.limit ?? 50, totalChanges: 0, hasMore: false, replacedScopes: [],
      review: { computed: true, touchedDates: 0, changedDays: 0, newlyHeld: 0, changedAmounts: 0, issuesBefore: 0, issuesAfter: 0, examples: [], note: 'Preview bersifat simulasi; tidak ada data produksi yang dibaca.' },
    })
  }
  if (path === '/imports/commit' && method === 'POST') {
    if (Number(body.expectedRevision) !== saved.revision) return fail('Revisi demo berubah. Hitung ulang diff sebelum menyimpan.', 409)
    const preview = previews.get(String(body.uploadId))
    if (!preview) return fail('Preview demo kedaluwarsa. Pilih ulang file contoh.', 409)
    const file = { ...structuredClone(preview.file), office: body.office ?? preview.file.office, completeThrough: body.completeThrough ?? preview.file.completeThrough }
    if (!preview.duplicate) addOnce(saved.state, [file])
    saved.revision += 1
    saved.audit.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), actorName: demoUser.name, action: 'Impor contoh demo', revision: saved.revision, reason: String(body.reason ?? 'Simulasi lokal') })
    persist(saved)
    previews.delete(String(body.uploadId))
    return response(workspaceResponse(saved))
  }
  if (path === '/coverage/nil-st' && method === 'POST') {
    const bounds = body.start && body.end ? { start: String(body.start), end: String(body.end) } : monthBounds(String(body.period))
    const file = makeNilSt(String(body.office), bounds.start, bounds.end, String(body.basis))
    addOnce(saved.state, [file]); saved.revision += 1; persist(saved)
    return response(workspaceResponse(saved))
  }
  if (path === '/coverage/not-applicable' && method === 'POST') {
    const source = String(body.source)
    const kind = source === 'online' ? 'daring' : source === 'surat-tugas' ? 'surat-tugas' : 'mesin'
    const office = String(body.office), start = String(body.start), end = String(body.end), basis = String(body.basis)
    const id = `demo-na-${source}-${office.replaceAll(' ', '_')}-${start}-${end}`
    const file: SourceFile = { id, fileName: `DUMMY_Tidak_Berlaku_${source}_${office}_${start}_${end}.xlsx`, kind, label: 'Konfirmasi cakupan · demo sintetis', office, importedAt: new Date().toISOString(), period: { start, end }, evidence: [], assignments: [], warnings: ['Konfirmasi sintetis untuk demo lokal.'], stats: { rows: 0, people: 0 }, coverageDeclarations: [{ start, end, status: 'not-applicable', basis, actorId: demoUser.id, at: new Date().toISOString() }], active: true }
    addOnce(saved.state, [file]); saved.revision += 1; persist(saved)
    return response(workspaceResponse(saved))
  }
  const coverageMatch = path.match(/^\/sources\/([^/]+)\/coverage$/)
  if (coverageMatch && method === 'POST') {
    const file = saved.state.files.find(item => item.id === coverageMatch[1])
    if (!file) return fail('Sumber demo tidak ditemukan.', 404)
    const { start, end, status, basis } = body as { start?: string; end?: string; status?: 'complete' | 'partial' | 'not-applicable'; basis?: string }
    if (!start || !end || !status || !basis) return fail('Rentang, status, dan dasar cakupan wajib diisi.', 422)
    file.coverageDeclarations = [...(file.coverageDeclarations ?? []), { start, end, status, basis, actorId: demoUser.id, at: new Date().toISOString() }]
    saved.revision += 1; persist(saved)
    return response(workspaceResponse(saved))
  }
  if (path === '/backup/preview' && method === 'POST') {
    const state = body.state as Workspace | undefined
    if (!state || state.version !== 2) return fail('Format backup tidak didukung.', 422)
    return response({ state, files: state.files?.length ?? 0, master: state.master?.length ?? 0, reviews: state.dayReviews?.length ?? 0, warnings: ['Preview backup ini hanya menggunakan data sintetis di browser.'] })
  }
  if (path === '/backup/restore' && method === 'POST') {
    if (!body.state || body.state.version !== 2) return fail('Format backup tidak didukung.', 422)
    saved.state = body.state as Workspace; saved.revision += 1; persist(saved)
    return response(workspaceResponse(saved))
  }
  if (path === '/audit') return response({ events: saved.audit.slice(0, 100) })
  if (path === '/meal-submissions' && method === 'GET') return response({ submissions: saved.submissions })
  if (path.startsWith('/meal-submissions/')) {
    const id = path.split('/')[2]
    const item = saved.submissions.find(submission => submission.id === id)
    return item ? response({ submission: item }) : fail('Belum ada snapshot demo untuk periode ini.', 404)
  }
  if (path === '/meal-submissions' && method === 'POST') return fail('Pengajuan keuangan dinonaktifkan di demo lokal.', 409)
  if (path === '/whatsapp/status') return response({ configured: false, status: 'not_configured', message: 'Mode demo lokal. WhatsApp tidak terhubung dan pesan tidak dikirim.' })
  if (path === '/whatsapp/connect' || path === '/whatsapp/disconnect') return response({ configured: false, status: 'not_configured', message: 'WhatsApp tidak tersedia di demo lokal.' })

  const sourceMatch = path.match(/^\/sources\/([^/]+)\/(withdraw|office|record-review|record-review\/preview)$/)
  if (sourceMatch) {
    const [, sourceId, action] = sourceMatch
    const file = saved.state.files.find(item => item.id === sourceId)
    if (!file) return fail('Sumber demo tidak ditemukan.', 404)
    if (action === 'record-review/preview') return response({ checksum: `DEMO-${sourceId}-${body.recordId}`, revision: saved.revision, record: { start: START, end: END }, affected: [] })
    if (action === 'withdraw') file.active = false
    if (action === 'office') {
      file.office = String(body.office)
      file.evidence.forEach(record => { record.office = String(body.office) })
      file.assignments.forEach(record => { record.office = String(body.office) })
    }
    if (action === 'record-review') {
      const review = { ...body, actorId: demoUser.id, reviewer: demoUser.name, at: new Date().toISOString() } as RecordReview
      file.recordReviews = [...(file.recordReviews ?? []).filter(row => row.id !== review.id), review]
    }
    saved.revision += 1; persist(saved)
    return response(workspaceResponse(saved))
  }

  if (path === '/sources') return fail('Daftar sumber demo tidak tersedia.', 404)
  return fail(`Endpoint ${path} tidak tersedia di mode demo.`, 501)
}

export function installDemoApi() {
  if (window.location.search.includes('demo=1')) {
    store()
    const realFetch = window.fetch.bind(window)
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const rawUrl = input instanceof Request ? input.url : String(input)
      const url = new URL(rawUrl, window.location.origin)
      if (!url.pathname.startsWith('/api/')) return realFetch(input, init)
      return handleApi(url, init)
    }
  }
}
