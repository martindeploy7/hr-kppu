const ZERO_WIDTH = /[​-‍⁠﻿]/g
const PREFIX_TITLES = new Set(['prof', 'dr', 'drs', 'dra', 'ir', 'hj', 'h', 'kh', 'bpk', 'bapak', 'ibu', 'sdr', 'sdri'])
const CANONICAL: Record<string, string> = {
  mhd: 'muhammad', muh: 'muhammad', moh: 'muhammad', mohd: 'muhammad', muhamad: 'muhammad', mohammad: 'muhammad',
  mohamad: 'muhammad', mochammad: 'muhammad', mochamad: 'muhammad', muhammmad: 'muhammad',
  akhmad: 'ahmad', achmad: 'ahmad', ahmat: 'ahmad',
}

export const cleanText = (s: unknown) => String(s ?? '').replace(ZERO_WIDTH, '').replace(/\s+/g, ' ').trim()

/** Splits "Nama(123)" or "Nama\n(123)" coming from attendance machine reports. */
export function splitMachineName(raw: string): { name: string; mesin?: string } {
  const text = cleanText(raw)
  const m = text.match(/^(.*?)\s*\(\s*([\w.-]+)\s*\)\s*$/)
  return m ? { name: m[1].trim(), mesin: m[2] } : { name: text }
}

const isDegree = (token: string) => /^[a-z]{1,3}\.[a-z.]{1,6}$/i.test(token) && !/^[a-z]\.$/i.test(token)

export function nameTokens(raw: string): string[] {
  let text = cleanText(raw).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
  text = text.replace(/\([^)]*\)/g, ' ')
  const words = text.split(/[\s,]+/).filter(Boolean).filter((w, i) => i === 0 || !isDegree(w))
  const tokens: string[] = []
  for (const word of words) {
    for (const piece of word.split(/[.'`’\-]+/).filter(Boolean)) {
      const t = piece.replace(/[^a-z]/g, '')
      if (!t) continue
      if (CANONICAL[t]) tokens.push(CANONICAL[t])
      else if (t.length <= 3 && !/[aiueo]/.test(t) && t.length > 1) tokens.push(...t.split(''))
      else tokens.push(t)
    }
  }
  while (tokens.length > 1 && PREFIX_TITLES.has(tokens[0])) tokens.shift()
  return tokens
}

export const nameKey = (raw: string) => nameTokens(raw).join(' ')

export function isTitleOnly(raw: string) {
  const t = cleanText(raw).toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean)
  return t.length === 0 || t.every(x => PREFIX_TITLES.has(x))
}

function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 3
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return dp[b.length]
}

function tokenScore(q: string, c: string) {
  if (q === c) return 1
  if (q.length === 1) return c.startsWith(q) ? 0.7 : 0
  if (c.length === 1) return q.startsWith(c) ? 0.6 : 0
  if (q.length >= 3 && c.startsWith(q)) return 0.85
  if (c.length >= 4 && q.startsWith(c)) return 0.85
  const d = lev(q, c)
  if (d === 1 && Math.min(q.length, c.length) >= 4) return 0.85
  if (d === 2 && Math.min(q.length, c.length) >= 7) return 0.75
  return 0
}

/** Similarity between a (possibly abbreviated) query name and a full candidate name, 0..1. Every query token must match. */
export function nameScore(query: string | string[], candidate: string | string[]) {
  const q = Array.isArray(query) ? query : nameTokens(query)
  const c = Array.isArray(candidate) ? candidate : nameTokens(candidate)
  if (!q.length || !c.length) return 0
  if (q.join(' ') === c.join(' ')) return 1
  if (q.join('') === c.join('') && q.join('').length >= 6) return 0.97
  const used = new Set<number>()
  let total = 0
  for (const qt of q) {
    let best = 0, bestIdx = -1
    c.forEach((ct, idx) => {
      if (used.has(idx)) return
      const s = tokenScore(qt, ct)
      if (s > best) { best = s; bestIdx = idx }
    })
    if (best === 0) return 0
    used.add(bestIdx)
    total += best
  }
  const base = total / q.length
  const coverage = used.size / c.length
  const firstBonus = tokenScore(q[0], c[0]) > 0 ? 0.04 : 0
  return Math.min(0.99, base * (0.72 + 0.24 * coverage) + firstBonus)
}

/** Splits a cell listing several people ("Manaek, Erika Rovita, M. Dzaki" or newline separated). */
export function splitPeople(raw: string): string[] {
  const text = String(raw ?? '').replace(ZERO_WIDTH, '')
    .replace(/,\s*(?:(?:S|M|A|B|D)\.[A-Za-z.]{1,20}|Ph\.?D\.?)\s*(?=,|;|\n|$)/gi, '')
  return text.split(/\n|;|,|\s+dan\s+|\s&\s/i)
    .map(s => s.replace(/^[\s\d.)•\-–]+(?=[A-Za-z])/, '').replace(/\.{2,}$/, '').trim())
    .filter(s => s.length > 1 && /[A-Za-z]/.test(s) && !isTitleOnly(s))
}

export function titleCase(s: string) {
  return cleanText(s).toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_, p, c) => p + c.toUpperCase())
}
