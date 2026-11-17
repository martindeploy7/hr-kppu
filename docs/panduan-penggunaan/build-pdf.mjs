// Membuat PDF Panduan Penggunaan Web SDM KPPU dari berkas HTML-nya.
// Pakai:  npm run docs:pdf
// Memakai Google Chrome lokal lewat playwright-core (tanpa mengunduh browser).
import { chromium } from 'playwright-core'
import { stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const docs = join(here, '..')
const input = join(docs, 'PANDUAN-PENGGUNAAN-WEB-SDM-KPPU.html')
const output = join(docs, 'PANDUAN-PENGGUNAAN-WEB-SDM-KPPU.pdf')
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

await stat(input) // gagal lebih awal bila HTML belum ada
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
try {
  const page = await browser.newPage()
  await page.goto(pathToFileURL(input).href, { waitUntil: 'load' })
  await page.emulateMedia({ media: 'print' })
  // Pastikan semua gambar sudah terdekode sebelum dicetak.
  const broken = await page.evaluate(async () => {
    const images = [...document.images]
    await Promise.all(images.map(img => img.decode().catch(() => {})))
    return images.filter(img => !img.naturalWidth).map(img => img.getAttribute('src'))
  })
  if (broken.length) throw new Error(`Gambar tidak termuat: ${broken.join(', ')}`)
  await page.evaluate(() => document.fonts.ready)
  // Margin, ukuran kertas, dan nomor halaman diatur oleh aturan @page di HTML.
  await page.pdf({ path: output, format: 'A4', printBackground: true, preferCSSPageSize: true })
  console.log(`PDF dibuat: ${output}`)
} finally {
  await browser.close()
}
