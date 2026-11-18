// Setelah deploy, bundel ber-hash lama hilang dari server. Tab yang masih terbuka (atau index.html yang ter-cache) gagal memuat chunk;
// satu kali muat ulang otomatis mengambil index.html baru. Data yang sudah disimpan ada di server; draf yang belum disimpan
// tetap ditahan oleh dialog beforeunload bila ada.
const KEY = 'kppu-chunk-reload-at'
const WINDOW_MS = 60_000

const CHUNK_ERROR = /dynamically imported module|importing a module script failed|unable to preload|error loading dynamically/i
export const isChunkLoadError = (error: unknown) => CHUNK_ERROR.test(error instanceof Error ? `${error.name} ${error.message}` : String(error))

/** Muat ulang halaman sekali per jendela waktu; false bila sudah dicoba baru-baru ini atau storage tidak tersedia (cegah loop). */
export function reloadOnceForNewDeploy(now = Date.now()): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(KEY))
    if (Number.isFinite(last) && last > 0 && now - last < WINDOW_MS) return false
    window.sessionStorage.setItem(KEY, String(now))
  } catch { return false }
  window.location.reload()
  return true
}

/** Dipakai di catch pemuat halaman lazy: bila galat chunk dan muat ulang dimulai, tahan promise agar skeleton tetap tampil; selain itu lempar ulang. */
export function recoverFromChunkError(error: unknown): Promise<never> {
  if (isChunkLoadError(error) && reloadOnceForNewDeploy()) return new Promise<never>(() => {})
  return Promise.reject(error)
}

export function installChunkReload() {
  window.addEventListener('vite:preloadError', event => {
    if (reloadOnceForNewDeploy()) event.preventDefault()
  })
}
