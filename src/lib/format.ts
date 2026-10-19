export const fmt = new Intl.NumberFormat('id-ID')
export const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 })
export const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0)
export const hours = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} j ${min % 60 ? `${min % 60} m` : ''}`.trim() : `${min} m`)
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase()

export function ageFrom(date: string) {
  if (!date) return 0
  const [y, m, d] = date.split('-').map(Number)
  const now = new Date()
  let age = now.getFullYear() - y
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--
  return Math.max(0, age)
}

export function nextBirthdayDays(date: string) {
  if (!date) return Number.MAX_SAFE_INTEGER
  const [, m, d] = date.split('-').map(Number)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  let next = new Date(today.getFullYear(), m - 1, d)
  if (next < today) next = new Date(today.getFullYear() + 1, m - 1, d)
  return Math.round((next.getTime() - today.getTime()) / 86400000)
}

export function tenureYears(date: string) {
  if (!date) return 0
  return Math.max(0, ageFrom(date))
}
