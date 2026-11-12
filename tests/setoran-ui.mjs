import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const checks = []
async function fixture(role) {
  console.log('Fixture', role)
  const page = await browser.newPage()
  page.setDefaultTimeout(10000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(role => {
    let implementation = window.fetch.bind(window)
    Object.defineProperty(window, 'fetch', {
      configurable: true,
      get() {
        const current = implementation
        return async (input, init) => {
          const url = new URL(typeof input === 'string' ? input : input.url ?? String(input), location.href)
          const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
          if (url.pathname === '/api/auth/me') return json({ user: { id: 'ui-fixture', email: 'fixture@example.test', name: 'UI fixture', role, offices: role === 'operator_st' ? ['Kanwil I'] : null } })
          if (url.pathname === '/api/rekap-st/employees') return json({ employees: [] })
          if (url.pathname === '/api/rekap-st') return json({ revision: 0, records: [], sourceIds: [] })
          return current(input, init)
        }
      },
      set(value) { implementation = value },
    })
  }, role)
  await page.goto('http://127.0.0.1:5174/')
  await page.getByRole('button', { name: 'Tutup panduan', exact: true }).click()
  return page
}
try {
  const page = await fixture('superadmin')
  await page.getByRole('heading', { name: 'Setoran minggu ini', exact: true }).waitFor()
  assert.equal(await page.locator('.weekly-upload-cards button').count(), 3)
  assert.equal(await page.getByRole('button', { name: 'Impor Sumber', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Unggah Mesin Offline', exact: true }).click()
  await page.getByRole('dialog', { name: 'Mesin Offline · Pusat', exact: true }).waitFor()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Pilih file', exact: true }).click()
  assert.equal((await chooser).isMultiple(), true)
  await page.locator('input[type=file]').setInputFiles({ name: 'DUMMY_Mesin_Online.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('synthetic filename fixture') })
  await page.getByText(/File terdeteksi sebagai Mesin Online/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Konfirmasi impor', exact: true }).count(), 0)
  checks.push('Three weekly cards; card opens modal; modal opens native file chooser; wrong source blocked')
  await page.getByRole('button', { name: 'Unggah Mesin Offline', exact: true }).click()
  await page.getByRole('dialog', { name: 'Mesin Offline · Kanwil I', exact: true }).waitFor()
  await page.locator('input[type=file]').setInputFiles({ name: 'DUMMY_Mesin_Offline_Kanwil_I.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('synthetic filename fixture') })
  await page.getByText(/Tanggal file berada di luar pekan terpilih/).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Konfirmasi impor', exact: true }).count(), 0)
  await page.getByRole('combobox', { name: 'Pilih pekan aktif', exact: true }).selectOption('2026-09-07')
  await page.getByRole('button', { name: 'Buka Rekap ST', exact: true }).click()
  await page.locator('.st-entry-grid select').waitFor()
  assert.equal(await page.locator('.st-entry-grid select').inputValue(), 'Pusat')
  assert.equal(await page.getByLabel('Tanggal Kegiatan', { exact: true }).inputValue(), '2026-09-07')
  checks.push('Out-of-week file is rejected without commit; ST opens selected week')
  await page.getByRole('button', { name: 'Setoran & Review', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('heading', { name: 'Setoran minggu ini', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Unggah Mesin Online', exact: true }).click()
  await page.getByRole('dialog', { name: 'Mesin Online · Pusat', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Pilih file', exact: true }).evaluate(el => el === document.activeElement), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: '/private/tmp/setoran-modal-mobile.png' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('dialog').screenshot({ path: '/private/tmp/setoran-modal-desktop.png', animations: 'disabled' })
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({state:'hidden'})
  await page.getByRole('button', { name: 'Unggah Mesin Online', exact: true }).click()
  await page.getByRole('button', { name: 'Tutup modal setoran', exact: true }).click()
  await page.getByRole('dialog').waitFor({state:'hidden'})
  checks.push('390px modal fits; initial keyboard focus; Escape, close and reopening work')
  const admin = await fixture('admin')
  await admin.getByRole('heading', { name: 'Setoran minggu ini', exact: true }).waitFor()
  assert.equal(await admin.locator('input[type=file]').count(), 0)
  await admin.getByRole('button', { name: 'Lihat Mesin Offline', exact: true }).click()
  await admin.getByRole('dialog').waitFor()
  assert.equal(await admin.getByRole('button',{name:'Pilih file',exact:true}).count(),0)
  await admin.getByRole('button',{name:'Lihat sumber',exact:true}).click()
  assert.equal(await admin.locator('details[open]').filter({ hasText: 'File sumber (0)' }).count(), 1)
  await admin.getByRole('button', { name: 'Buka Rekap ST', exact: true }).click()
  await admin.getByRole('heading', { name: 'Rekap ST', exact: true }).waitFor()
  assert.equal(await admin.getByRole('button', { name: 'Simpan rekap ST', exact: true }).count(), 0)
  checks.push('Admin can inspect sources/ST but has no uploader or ST submit')
  const operator = await fixture('operator_st')
  await operator.getByLabel('Tanggal Kegiatan', { exact: true }).waitFor()
  assert.equal(await operator.locator('input[type=file]').count(), 0)
  assert.equal(await operator.locator('.st-entry-grid select').count(), 0)
  assert.equal(await operator.getByRole('button', { name: 'Setoran & Review', exact: true }).count(), 0)
  checks.push('Operator retains ST-only screen and cannot select another register')
  console.log(JSON.stringify({ passed: checks }, null, 2))
} catch(error) {
  for (const context of browser.contexts()) for (const page of context.pages()) { console.log((await page.locator('body').innerText()).slice(-3500)); await page.screenshot({path:'/private/tmp/setoran-error.png',fullPage:true}) }
  throw error
} finally { await browser.close() }
