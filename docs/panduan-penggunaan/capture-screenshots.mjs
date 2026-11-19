// Mengambil ulang seluruh tangkapan layar Panduan Penggunaan Web SDM KPPU.
//
// Prasyarat
//   1. Web dev server di http://127.0.0.1:5174 (npm run dev:web), /api diteruskan ke port 8790.
//   2. API berjalan terhadap basis data uji bulan April, mis. `.e2e/weekly/restart-api.sh kppu_e2e2_apr`.
//   3. Akun Superadmin khusus panduan. Kata sandinya dibaca dari berkas dan tidak pernah dicetak:
//        GUIDE_EMAIL          (bawaan panduan-docs@example.test)
//        GUIDE_PASSWORD_FILE  (bawaan .e2e/v2/guide-admin-password.txt)
//
// Data uji memuat nama dan NIP asli. Sebelum setiap tangkapan skrip memasang penyamar DOM yang mengganti
// nama menjadi "Pegawai 001", NIP/NIKA menjadi pola x, serta email dan nomor telepon menjadi nilai palsu.
// Skrip lalu memeriksa teks halaman dan berhenti bila nama lengkap asli masih terlihat.
//
// Skrip hanya membuka tab, filter, drawer, dan dialog. Tidak ada tombol simpan, ajukan, batalkan, atau putuskan
// yang ditekan. Formulir Rekap ST hanya diisi, tidak pernah dikirim. Tangkapan daftar Rekap ST (06, 06a) membaca dua
// ST contoh yang sudah ada di basis data uji: 270/ST/2026 (aktif, bercatatan, berlampiran, satu peserta Lainnya bernama Warsito Sutarman) dan
// 271/ST/2026 (sudah dibatalkan dengan alasan). Buat keduanya lebih dulu lewat formulir bila basis datanya baru. Satu pengecualian: memilih periode April pada pemilih periode atas menyimpan nilai periode ke
// ruang kerja, sama seperti saat pengguna memilihnya.
//
// Pakai:  node docs/panduan-penggunaan/capture-screenshots.mjs [--only=id1,id2]
import { chromium } from 'playwright-core'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const outDir = join(here, 'assets')
const BASE = process.env.GUIDE_BASE_URL ?? 'http://127.0.0.1:5174'
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const EMAIL = process.env.GUIDE_EMAIL ?? 'panduan-docs@example.test'
const PASSWORD_FILE = process.env.GUIDE_PASSWORD_FILE ?? join(root, '.e2e/v2/guide-admin-password.txt')
const PERIOD = process.env.GUIDE_PERIOD ?? '2026-04'
const only = (process.argv.find(a => a.startsWith('--only=')) ?? '').replace('--only=', '').split(',').filter(Boolean)
const log = (...a) => console.log('[panduan]', ...a)

/** Dijalankan di dalam halaman. */
function installScrubber(data) {
  if (window.__scrubInstalled) { window.__scrubData = data; return }
  window.__scrubInstalled = true
  window.__scrubData = data
  const nameMap = () => new Map(window.__scrubData.names)
  let map = nameMap(), maxWords = Math.max(1, ...window.__scrubData.names.map(([k]) => k.split(' ').length))
  const WORD = /[\p{L}\p{N}]+/gu
  const scrubText = text => {
    let out = text
    if (/\d/.test(out)) {
      out = out.replace(/(?<![\d.])(?:\+?62|0)8\d{8,12}(?!\d)/g, '08xxxxxxxxxx')
      out = out.replace(/\d{4,6}•{2,}\d{3,4}/g, '628xx•••xxxx')
      out = out.replace(/\d{12,}/g, m => window.__scrubData.ids[m] ?? '1990xxxxxxxxxxx000')
      out = out.replace(/…\d{4,8}/g, '…xxxxxx')
      out = out.replace(/\b\d\.\d{2}\.\d{3,5}\b/g, 'x.xx.xxxx')
    }
    if (out.includes('@')) out = out.replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, m => m.toLowerCase() === window.__scrubData.keepEmail ? m : 'akun@example.test')
    const words = [...out.matchAll(WORD)].map(m => ({ w: m[0].toLowerCase(), s: m.index, e: m.index + m[0].length }))
    if (!words.length) return out
    const pieces = []
    let last = 0, i = 0, changed = false
    while (i < words.length) {
      let hit = null
      for (let n = Math.min(maxWords, words.length - i); n >= 1; n--) {
        const to = map.get(words.slice(i, i + n).map(x => x.w).join(' '))
        if (to) { hit = { n, to }; break }
      }
      if (hit) { pieces.push(out.slice(last, words[i].s), hit.to); last = words[i + hit.n - 1].e; i += hit.n; changed = true } else i++
    }
    if (!changed) return out
    pieces.push(out.slice(last))
    return pieces.join('')
  }
  const walk = () => {
    const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = it.nextNode())) {
      const parent = node.parentElement
      if (!parent || /^(SCRIPT|STYLE)$/.test(parent.tagName)) continue
      const next = scrubText(node.nodeValue)
      if (next !== node.nodeValue) node.nodeValue = next
    }
  }
  let queued = false
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; walk() }) } }).observe(document.body, { childList: true, subtree: true, characterData: true })
  window.__scrubNow = () => { map = nameMap(); maxWords = Math.max(1, ...window.__scrubData.names.map(([k]) => k.split(' ').length)); walk() }
  walk()
}

/** Nama peserta Lainnya fiktif pada ST contoh; boleh tampil apa adanya karena bukan orang sungguhan. */
const DEMO_EXTERNAL = ['warsito sutarman']
const STOP = new Set(['pusat', 'kantor', 'unit', 'nama', 'hadir', 'sakit', 'izin', 'cuti', 'dinas', 'bagian', 'kepala', 'staf', 'staff', 'online', 'offline', 'mesin', 'aktif', 'ditahan', 'dapat', 'valid', 'flag', 'batal', 'semua', 'baru', 'lama', 'tanpa', 'data', 'akun', 'admin', 'super', 'superadmin', 'operator', 'test', 'demo', 'uji', 'april', 'mei', 'maret', 'juni', 'juli', 'agustus', 'september', 'oktober', 'november', 'desember', 'januari', 'februari', 'senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu', 'islam', 'kristen', 'katolik', 'hindu', 'buddha', 'konghucu', 'pegawai', 'pengguna'])
/** Kata yang muncul di kode antarmuka; nama depan sama dengan kata ini tidak disamarkan sendirian. */
async function uiWords() {
  const words = new Set()
  const walk = async dir => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (/\.(tsx|ts)$/.test(entry.name)) for (const m of (await readFile(path, 'utf8')).toLowerCase().matchAll(/[\p{L}]{3,}/gu)) words.add(m[0])
    }
  }
  await walk(join(root, 'src'))
  return words
}
const normName = s => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** Kumpulkan nama dan angka identitas dari API, lalu bentuk peta samaran yang stabil. */
async function buildScrubData(page) {
  const demo = DEMO_EXTERNAL
  const raw = await page.evaluate(async demo => {
    const get = async p => { try { const r = await fetch(p, { credentials: 'same-origin' }); return r.ok ? await r.json() : null } catch { return null } }
    const ws = (await get('/api/workspace'))?.state
    const users = (await get('/api/users'))?.users ?? []
    const names = new Set(), ids = new Set()
    const addId = v => { const s = String(v ?? '').replace(/\s/g, ''); if (/^\d{12,}$/.test(s)) ids.add(s) }
    for (const e of ws?.master ?? []) {
      names.add(e.nama); addId(e.nip); addId(e.nika)
      for (const a of e.aliases ?? []) { if (a.kind === 'nama') names.add(a.value); else addId(a.value) }
    }
    for (const f of ws?.files ?? []) {
      for (const e of f.evidence ?? []) { names.add(e.name); addId(e.ids?.nip); addId(e.ids?.nika); addId(e.ids?.appId) }
      for (const a of f.assignments ?? []) if (!(a.external && demo.includes(String(a.name ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()))) names.add(a.name)
    }
    return { names: [...names].filter(Boolean), ids: [...ids], users: users.map(u => ({ name: u.name, email: u.email })) }
  }, demo)
  const map = new Map()
  const people = [...new Set(raw.names.map(normName))].filter(k => k && (k.includes(' ') ? true : k.length >= 4 && !STOP.has(k))).sort()
  people.forEach((k, i) => map.set(k, `Pegawai ${String(i + 1).padStart(3, '0')}`))
  // Antarmuka kadang menampilkan nama depan atau belakang saja ("UM Messy: ..."); samarkan juga setiap kata nama
  // yang tidak dipakai antarmuka, supaya tidak ada pecahan nama yang lolos.
  const ui = await uiWords()
  let extra = 0
  for (const k of people) for (const t of k.split(' ')) {
    if (t.length >= 4 && /^\p{L}+$/u.test(t) && !STOP.has(t) && !ui.has(t) && !map.has(t)) map.set(t, `Pegawai ${String(900 + ++extra)}`)
  }
  const userNames = raw.users.filter(u => u.email.toLowerCase() !== EMAIL.toLowerCase()).map(u => normName(u.name)).filter(Boolean)
  userNames.forEach((k, i) => map.set(k, `Pengguna ${String(i + 1).padStart(2, '0')}`))
  const ids = {}
  raw.ids.sort().forEach((id, i) => { ids[id] = `1990${'x'.repeat(Math.max(1, id.length - 7))}${String(i + 1).padStart(3, '0')}` })
  const tokens = new Set()
  for (const k of people) for (const t of k.split(' ')) if (t.length >= 5 && /^\p{L}+$/u.test(t) && !STOP.has(t) && !ui.has(t)) tokens.add(t)
  return { names: [...map.entries()], ids, keepEmail: EMAIL.toLowerCase(), realNames: people.filter(k => k.includes(' ')), tokens: [...tokens] }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'id-ID', timezoneId: 'Asia/Jakarta' })
const page = await context.newPage()
await mkdir(outDir, { recursive: true })
const password = (await readFile(PASSWORD_FILE, 'utf8')).trim()
let scrubData = null
const sleep = ms => page.waitForTimeout(ms)

async function scrubAndVerify(p, label) {
  if (!scrubData) return
  await p.evaluate(d => { window.__scrubDataPending = d }, scrubData)
  await p.evaluate(`(${installScrubber.toString()})(window.__scrubDataPending); window.__scrubNow()`)
  await p.waitForTimeout(250)
  await p.evaluate(() => window.__scrubNow())
  await p.waitForTimeout(150)
  const text = await p.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('input, textarea')].map(el => el.value).join('\n'))
  const flat = ' ' + normName(text) + ' '
  const hits = scrubData.realNames.filter(n => flat.includes(` ${n} `))
  const words = new Set(flat.trim().split(' '))
  const loose = scrubData.tokens.filter(t => words.has(t))
  if (loose.length) throw new Error(`Kata dari nama asli masih terlihat pada "${label}": ${loose.join(', ')}`)
  if (hits.length) throw new Error(`Nama asli masih terlihat pada "${label}" (${hits.length} nama). Tangkapan dibatalkan.`)
  if (/\d{15,}/.test(text.replace(/1990x+\d{3}/g, ''))) throw new Error(`Angka mirip NIP masih terlihat pada "${label}".`)
}

const done = []
const pad = (b, n) => { const x = Math.max(0, b.x - n), y = Math.max(0, b.y - n); return { x, y, width: b.width + (b.x - x) + n, height: b.height + (b.y - y) + n } }
/** Kotak gabungan elemen dalam koordinat dokumen (tidak bergantung posisi gulir). */
async function union(p, selectors) {
  const boxes = []
  for (const s of selectors) {
    const loc = p.locator(s).first()
    await loc.waitFor({ state: 'attached', timeout: 8000 })
    boxes.push(await loc.evaluate(el => { const r = el.getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height } }))
  }
  const x1 = Math.min(...boxes.map(b => b.x)), y1 = Math.min(...boxes.map(b => b.y))
  const x2 = Math.max(...boxes.map(b => b.x + b.w)), y2 = Math.max(...boxes.map(b => b.y + b.h))
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}
/** Tangkapan area (gabungan beberapa elemen) atau seluruh viewport. */
async function snap(id, { clip, full = false, p = page, maxH, trimBottom = 0 } = {}) {
  if (only.length && !only.includes(id)) return
  await scrubAndVerify(p, id)
  const path = join(outDir, `${id}.png`)
  if (clip) { const box = pad(await union(p, clip), 8); if (maxH) box.height = Math.min(box.height, maxH); box.height -= trimBottom; await p.screenshot({ path, fullPage: true, clip: box }) }
  else await p.screenshot({ path, fullPage: full })
  done.push(id); log('ok', id)
}
/** Tangkapan satu elemen. */
async function snapEl(id, selector, opts = {}) {
  if (only.length && !only.includes(id)) return
  const p = opts.p ?? page
  await scrubAndVerify(p, id)
  const loc = p.locator(selector).first()
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  await loc.screenshot({ path: join(outDir, `${id}.png`) })
  done.push(id); log('ok', id)
}

/** Drawer samping: potong tinggi sampai akhir isi supaya tidak ada ruang putih di bawahnya. */
async function snapDrawer(id, p = page, maxH) {
  if (only.length && !only.includes(id)) return
  await scrubAndVerify(p, id)
  const box = await p.locator('aside.side-drawer').first().evaluate(el => {
    const r = el.getBoundingClientRect()
    const bottom = Math.max(...[...el.querySelectorAll('*')].map(n => n.getBoundingClientRect().bottom).filter(b => b <= r.bottom + 1))
    return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, bottom + 28 - r.y) }
  })
  if (maxH) box.height = Math.min(box.height, maxH)
  await p.screenshot({ path: join(outDir, `${id}.png`), clip: box })
  done.push(id); log('ok', id)
}

const go = async (route, p = page) => { await p.evaluate(r => { location.hash = '/' + r }, route); await p.waitForTimeout(1800); await p.evaluate(() => window.scrollTo(0, 0)) }
const blur = p => p.evaluate(() => document.activeElement?.blur?.())

// ---------------------------------------------------------------- masuk
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' })
await page.waitForSelector('input[type=email]')
await snapEl('01-masuk', '.auth-panel')
await page.fill('input[type=email]', EMAIL)
await page.fill('input[type=password]', password)
await page.click('button[type=submit]')
await page.waitForSelector('.sidebar', { timeout: 30000 })
await sleep(2500)
scrubData = await buildScrubData(page)
log(`penyamar: ${scrubData.names.length} nama, ${Object.keys(scrubData.ids).length} angka identitas`)
if ((await page.inputValue('.period-pick input')) !== PERIOD) { await page.fill('.period-pick input', PERIOD); await sleep(2500) }
await blur(page)
await page.addStyleTag({ content: '.topbar { position: static !important; backdrop-filter: none !important; }' })

const pickWeek = async (index, p = page) => { await p.selectOption('select[aria-label="Pilih pekan aktif"]', { index }); await p.waitForTimeout(1500) }

// ---------------------------------------------------------------- Setoran & Review
await go('setoran')
await snap('02-setoran-papan', { clip: ['.setoran-page .page-head', '.month-board'] })
await pickWeek(1)
await snap('03-setoran-kartu', { clip: ['.setoran-page .toolbar', '.office-submissions'] })
await page.locator('.office-source-main').first().click()
await sleep(500)
await snapEl('04-setoran-dialog', 'dialog.setoran-dialog')
await page.keyboard.press('Escape'); await sleep(300)

// ---------------------------------------------------------------- Rekap ST
await go('rekap-st')
const search = page.locator('input[aria-label="Cari pegawai"]')
const officeFilter = page.locator('select[aria-label="Saring menurut kantor"]')
const destination = page.locator('#st-destination')
await page.locator('input[placeholder="256/"]').fill('272/ST/2026')
await page.locator('.st-entry-grid input[type=date]').nth(0).fill('2026-04-17')
await page.locator('.st-entry-grid input[type=date]').nth(1).fill('2026-04-20')
await page.locator('.st-entry-grid input[type=date]').nth(2).fill('2026-04-22')
// Tujuan: ketik singkatan provinsi, tangkap daftar pilihan, lalu pilih Kota Bandung.
await destination.click(); await destination.fill('jabar'); await sleep(400)
await snap('05a-rekap-st-tujuan', { clip: ['#st-destination', '.dest-picker__list'], trimBottom: 8 })
await destination.fill('bandung'); await sleep(300)
await page.locator('.dest-picker__opt', { hasText: 'Kota Bandung' }).first().click(); await sleep(200)
await page.locator('textarea').first().fill('Daftar peserta lengkap ada pada lampiran ST.')
// Peserta dari beberapa kantor: Kanwil I, Kanwil III, lalu Pusat lewat pencarian.
for (const kantor of ['Kanwil I', 'Kanwil III']) { await officeFilter.selectOption(kantor); await sleep(250); await page.locator('.st-picker-list li button').first().click(); await sleep(200) }
await officeFilter.selectOption('Pusat'); await search.fill('ade'); await sleep(250); await search.press('Enter'); await sleep(200)
await officeFilter.selectOption('Semua'); await search.fill(''); await sleep(300)
await page.getByRole('button', { name: /Tambah peserta Lainnya/ }).click()
await page.getByLabel('Nama', { exact: true }).fill('Warsito Sutarman')
await page.getByLabel('Keterangan (peran)').fill('Driver Komisi')
await page.getByRole('button', { name: 'Tambahkan', exact: true }).click(); await sleep(200)
await page.locator('input[type=file]').setInputFiles({ name: 'scan-ST-272.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') })
await sleep(300)
await blur(page)
await snapEl('05-rekap-st-form', 'section.panel >> nth=0')

// Tempel daftar peserta: baris dari lampiran ST dicocokkan ke master. Isi kotak teks diganti nilai samaran sebelum ditangkap.
await page.getByRole('button', { name: 'Tempel daftar peserta' }).click(); await sleep(300)
const sample = await page.evaluate(async () => {
  const employees = (await (await fetch('/api/rekap-st/employees')).json()).employees
  const tokens = e => e.nama.trim().split(/\s+/)
  const withNip = employees.filter(e => e.nip && e.kantor !== 'Pusat' && tokens(e).length >= 2)
  const prefixes = new Map()
  for (const e of employees) if (tokens(e).length >= 3) { const k = tokens(e).slice(0, 2).join(' ').toLowerCase(); prefixes.set(k, [...(prefixes.get(k) ?? []), e]) }
  const similar = [...prefixes.entries()].find(([k, list]) => list.length >= 2 && !employees.some(e => e.nama.trim().toLowerCase() === k))
  return { first: withNip[0], second: withNip[1], similar: similar ? tokens(similar[1][0]).slice(0, 2).join(' ') : '' }
})
const lines = [`1. ${sample.first.nama}, S.H.\t${sample.first.nip}`, `2. ${sample.second.nama}`, ...(sample.similar ? [`3. ${sample.similar}`] : []), `${sample.similar ? 4 : 3}. Warsito Sutarman, Driver Komisi`]
await page.locator('.st-bulk textarea').fill(lines.join('\n'))
await page.getByRole('button', { name: 'Cocokkan dengan master' }).click(); await sleep(500)
const lastRow = page.locator('.st-bulk-row.notfound').last()
await lastRow.locator('select').selectOption('external'); await sleep(300)
await blur(page)
// Daftar hasil biasanya bergulir di dalam kotaknya (maks. 420 px); lepas batas itu supaya semua baris tertangkap.
await page.addStyleTag({ content: '.st-bulk-list { max-height: none !important; overflow: visible !important; }' })
await page.locator('.st-bulk textarea').evaluate(el => { el.value = ['1. Pegawai 001, S.H.\t1990xxxxxxxxxxx001', '2. Pegawai 002', '3. Pegawai 003 (nama sebagian)', '4. Warsito Sutarman, Driver Komisi'].join('\n') })
await snapEl('05b-rekap-st-tempel', '.st-bulk')
await page.getByRole('button', { name: 'Tutup', exact: true }).click(); await sleep(200)

// Riwayat: ST contoh dibuka agar peserta (termasuk Lainnya) terlihat; potong tepat setelah ST yang dibatalkan.
await page.locator('tr:has-text("270/ST/2026") .st-group-toggle').click(); await sleep(300)
if (!only.length || only.includes('06-rekap-st-daftar')) {
  await scrubAndVerify(page, '06-rekap-st-daftar')
  const top = await union(page, ['section.panel >> nth=1'])
  const bottom = await page.locator('tr:has-text("271/ST/2026")').first().evaluate(el => { const r = el.getBoundingClientRect(); return r.bottom + scrollY })
  const box = pad({ x: top.x, y: top.y, width: top.width, height: bottom - top.y }, 8)
  await page.screenshot({ path: join(outDir, '06-rekap-st-daftar.png'), fullPage: true, clip: box })
  done.push('06-rekap-st-daftar'); log('ok', '06-rekap-st-daftar')
}
// Ubah ST: ikon pensil membuka formulir berisi data ST, tanpa menyimpan.
await page.locator('tr:has-text("270/ST/2026")').first().getByRole('button', { name: /Ubah ST/ }).click(); await sleep(1500)
await blur(page)
await snapEl('06a-rekap-st-ubah', 'section.panel >> nth=0')
await page.getByRole('button', { name: 'Batal ubah' }).click(); await sleep(300)

// ---------------------------------------------------------------- Pencocokan Identitas
await go('pencocokan')
await page.getByRole('button', { name: /Tautan otomatis/ }).click(); await sleep(500)
await snap('07-pencocokan', { clip: ['.id-page .page-head', '.id-page .panel'], maxH: 1150 })
await page.getByRole('button', { name: /Pegawai tanpa NIP/ }).click(); await sleep(400)
await snapEl('08-pencocokan-tanpa-nip', '.id-page .panel')

// ---------------------------------------------------------------- Rekonsiliasi
await go('rekonsiliasi')
await pickWeek(1)
await snap('09-rekonsiliasi-atas', { clip: ['.rc-tiles', '.rc-next'] })
await page.getByRole('button', { name: 'Menunggu', exact: true }).click().catch(() => {})
await sleep(300)
await snapEl('10-rekonsiliasi-antrean', '.recon .panel')
await page.getByRole('button', { name: 'Matriks harian' }).click(); await sleep(800)
await page.getByRole('button', { name: 'Semua', exact: true }).click(); await sleep(300)
await page.selectOption('select[aria-label="Kantor"]', 'Pusat'); await sleep(800)
await snap('11-rekonsiliasi-matriks', { clip: ['.recon .panel'], maxH: 1180 })
await page.locator('table.matrix button.cell.st-hadir').first().click(); await sleep(900)
await snapDrawer('12-detail-hari')
await page.keyboard.press('Escape'); await sleep(500)

// ---------------------------------------------------------------- Uang Makan
await go('uang-makan')
await pickWeek(1)
await snap('13-uang-makan-pekan', { clip: ['.meal-hero', '.meal-split'] })
await page.locator('.meal-table tbody tr').first().click(); await sleep(900)
await snapDrawer('14-uang-makan-rincian')
await page.keyboard.press('Escape'); await sleep(500)
await page.getByRole('button', { name: 'Akumulasi bulan' }).click(); await sleep(1500)
await snap('15-uang-makan-bulan', { clip: ['.meal-page section.panel >> nth=0', '.meal-hero'] })
await page.getByRole('button', { name: 'Pekan terpilih' }).click(); await sleep(500)

// ---------------------------------------------------------------- Kepegawaian
await go('dashboard')
await snap('16-people-atas', { clip: ['.pd-hero', '.pd-kpis'] })
await snap('17-people-komposisi', { clip: ['.pd-section >> nth=0'] })
await snap('18-people-demografi', { clip: ['.pd-section >> nth=2', '.pd-section >> nth=3'] })
await page.locator('.pd-kpi.is-action').first().click(); await sleep(900)
await snapDrawer('19-people-daftar')
await page.keyboard.press('Escape'); await sleep(500)

await go('pegawai')
await snap('20-pegawai-daftar')
await page.locator('table.data.clickable tbody tr').nth(2).click(); await sleep(900)
// Tanggal lahir, pensiun, dan mulai kerja bisa mengidentifikasi seseorang bila digabung dengan jabatan; ganti dengan nilai contoh.
await page.evaluate(() => {
  const fake = { 'Tanggal lahir': '15 Juni 1980 (46 th)', 'Tanggal pensiun': '1 Juli 2040', 'Tanggal mulai kerja': '2 Januari 2012' }
  document.querySelectorAll('aside.side-drawer .facts > div').forEach(d => {
    const label = d.querySelector('span')?.textContent?.replace(/dari NIP/, '').trim()
    for (const [k, v] of Object.entries(fake)) if (label?.startsWith(k)) { const b = d.querySelector('strong'); if (b && !/Belum/.test(b.textContent)) b.textContent = v }
  })
})
await snapDrawer('21-pegawai-profil', page, 826)
await page.keyboard.press('Escape'); await sleep(500)

await go('tambah-data')
await snap('22-tambah-data-impor', { clip: ['.page .page-head', '.page .panel'] })
await page.getByRole('button', { name: 'Isi manual' }).click(); await sleep(500)
await snap('23-tambah-data-manual', { clip: ['.page .page-head', 'form.form-card'] })

// ---------------------------------------------------------------- Automation Center
await go('automation')
await sleep(1200)
await snap('24-automation-atas', { clip: ['.ac-top', '#ac-upcoming'] })
await snapEl('25-automation-aturan', '#ac-rules')
await snapEl('26-automation-pengaturan', '#ac-settings')

// ---------------------------------------------------------------- Ruang Kerja & Akses
await go('akses')
await snap('27-akses-akun', { clip: ['section.panel >> nth=2', 'section.panel >> nth=3'] })
await snap('28-akses-atas', { clip: ['section.panel >> nth=0', 'section.panel >> nth=1'] })

// ---------------------------------------------------------------- Seluler (390 px)
const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'id-ID', timezoneId: 'Asia/Jakarta', isMobile: true, hasTouch: true, storageState: await context.storageState() })
const mp = await mobile.newPage()
await mp.goto(`${BASE}/#/setoran`, { waitUntil: 'domcontentloaded' })
await mp.waitForSelector('.topbar', { timeout: 30000 }); await mp.waitForTimeout(3000)
await mp.addStyleTag({ content: '.topbar { position: static !important; backdrop-filter: none !important; }' })
await mp.locator('.month-board').evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 8)); await mp.waitForTimeout(400)
await snap('30-seluler-setoran', { p: mp })
await mp.evaluate(() => { location.hash = '/rekonsiliasi' }); await mp.waitForTimeout(2000)
await mp.getByRole('button', { name: 'Matriks harian' }).click(); await mp.waitForTimeout(800)
await mp.getByRole('button', { name: 'Semua', exact: true }).click(); await mp.waitForTimeout(300)
await mp.selectOption('select[aria-label="Kantor"]', 'Pusat'); await mp.waitForTimeout(600)
await mp.locator('table.matrix').evaluate(el => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 120)); await mp.waitForTimeout(400)
await snap('31-seluler-matriks', { p: mp })
await mobile.close()

await browser.close()
log(`selesai: ${done.length} tangkapan di ${outDir}`)
