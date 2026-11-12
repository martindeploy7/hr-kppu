import { nameTokens } from './names.ts'

/**
 * Pencocokan nama peserta Rekap ST ke master pegawai.
 *
 * Sekretariat menulis nama dengan banyak gaya: nama lengkap ("Martin Marcelino Tarigan"), sebagian ("Martin",
 * "Martin Tarigan"), nama depan + inisial ("Martin MT"), atau akronim ("MMT"). Fungsi di sini hanya menghasilkan
 * kandidat beserta jenis kecocokannya. Penautan otomatis diputuskan di roster: hanya bila tepat satu pegawai
 * memenuhi, atau bukti absensi (kode dinas pada tanggal ST) menunjuk satu orang.
 */
export type StMatchKind = 'lengkap' | 'sebagian' | 'inisial' | 'akronim' | 'ejaan'
export type StPoolEntry = { id: string; tokens: string[] }
export type StCandidate = { employeeId: string; kind: StMatchKind; score: number }

export const ST_KIND_LABEL: Record<StMatchKind, string> = {
  lengkap: 'nama lengkap sama',
  sebagian: 'nama di ST termuat dalam nama lengkap',
  inisial: 'nama depan + inisial cocok',
  akronim: 'akronim nama cocok',
  ejaan: 'ejaan mirip',
}

const SCORE: Record<StMatchKind, number> = { lengkap: 0.98, sebagian: 0.9, inisial: 0.85, akronim: 0.75, ejaan: 0.65 }

/** Token ST: huruf mati 2–5 karakter ("MT", "MMT", "MHPS") diperlakukan sebagai deretan inisial. */
export function stQueryTokens(raw: string): string[] {
  return nameTokens(raw).flatMap(t => t.length >= 2 && t.length <= 5 && !/[aiueo]/.test(t) ? t.split('') : [t])
}

function lev(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]; dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}
const similar = (q: string, t: string) => q === t || (q.length >= 5 && t.length >= 5 && lev(q, t) <= (Math.max(q.length, t.length) >= 8 ? 2 : 1))

/** Inisial dan nama berurutan: setiap token ST cocok dengan token nama (sama atau huruf awal), urutan terjaga. */
function orderedFit(q: string[], t: string[]): number[] | undefined {
  const at: number[] = []
  let next = 0
  for (const token of q) {
    const found = t.findIndex((c, i) => i >= next && (c === token || (token.length === 1 && c.startsWith(token))))
    if (found < 0) return undefined
    at.push(found); next = found + 1
  }
  return at
}

export function matchKind(q: string[], t: string[]): StMatchKind | undefined {
  if (!q.length || !t.length) return undefined
  if (q.join(' ') === t.join(' ')) return 'lengkap'
  const initials = q.filter(x => x.length === 1).length
  if (!initials) {
    if (q.every(x => t.includes(x))) return 'sebagian'
    if (q.every(x => t.some(c => similar(x, c))) && q.some(x => t.includes(x))) return 'ejaan'
    if (q.length >= 2 && q.every(x => t.some(c => similar(x, c)))) return 'ejaan'
    return undefined
  }
  const fit = orderedFit(q, t)
  if (!fit || fit[0] !== 0) return undefined // nama depan (atau inisialnya) wajib cocok dengan nama depan pegawai
  if (initials === q.length) return q.length >= 2 ? 'akronim' : undefined // satu huruf saja terlalu lemah
  return 'inisial'
}

export function stCandidates(raw: string, pool: StPoolEntry[]): StCandidate[] {
  const q = stQueryTokens(raw)
  if (!q.length) return []
  const out: StCandidate[] = []
  for (const e of pool) {
    const kind = matchKind(q, e.tokens)
    if (kind) out.push({ employeeId: e.id, kind, score: SCORE[kind] })
  }
  return out.sort((a, b) => b.score - a.score)
}
