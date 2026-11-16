import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { fmt } from '../../lib/format.ts'
import { orderGroups, share, type AgeBand, type EmployeeGroup, type MonthBucket } from './data.ts'

/* Hand-rolled, accessible charts. Every mark is a real <button> with an aria-label,
   every value is printed (never tooltip-only), and zero-value marks are inert. */

export const SEGMENT_COLORS: Record<string, { bg: string; fg: string }> = {
  'Laki-laki': { bg: '#2a78d6', fg: '#ffffff' },
  Perempuan: { bg: '#eb6834', fg: '#1c2b3a' },
  PNS: { bg: '#6250d6', fg: '#ffffff' },
  PPPK: { bg: '#1baf7a', fg: '#1c2b3a' },
  'Non-ASN': { bg: '#eda100', fg: '#1c2b3a' },
}
const MISSING_COLOR = { bg: '#a9b1b9', fg: '#1c2b3a' }
export const colorOf = (group: EmployeeGroup) => SEGMENT_COLORS[group.name] ?? MISSING_COLOR

/* ---------- ranked horizontal bars ---------- */

type RankedBarsProps = {
  /** Used in aria-labels: "Lihat 12 pegawai dalam X, {title}" */
  title: string
  groups: EmployeeGroup[]
  total: number
  onSelect: (group: EmployeeGroup) => void
  /** Rows shown before "Tampilkan semua"; omit to show every row. */
  initial?: number
  /** Keep every row but put them in a fixed-height scroll area. */
  scroll?: boolean
  noun?: string
  searchable?: boolean
  sortable?: boolean
  selected?: string
  emptyText?: string
}

export function RankedBars({ title, groups, total, onSelect, initial, scroll, noun = 'kelompok', searchable, sortable, selected, emptyText }: RankedBarsProps) {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'count' | 'name'>('count')
  const [expanded, setExpanded] = useState(false)
  const max = Math.max(1, ...groups.map(group => group.employees.length))
  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase('id-ID')
    const matched = needle ? groups.filter(group => group.name.toLocaleLowerCase('id-ID').includes(needle)) : groups
    return mode === 'count' && !needle ? matched : orderGroups(matched, mode)
  }, [groups, query, mode])
  const collapsed = !scroll && initial !== undefined && !expanded && !query.trim()
  const visible = collapsed ? rows.slice(0, initial) : rows
  const hidden = rows.length - visible.length

  if (!groups.length) return <p className="pd-empty">{emptyText ?? 'Belum ada data untuk dikelompokkan.'}</p>
  return <div className="pd-ranked">
    {(searchable || sortable) && <div className="pd-tools">
      {searchable && <label className="pd-search">
        <Search size={15} aria-hidden="true" />
        <input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Cari ${noun}…`} aria-label={`Cari ${noun} pada ${title}`} />
      </label>}
      {sortable && <div className="pd-seg" role="group" aria-label={`Urutan ${title}`}>
        <button type="button" aria-pressed={mode === 'count'} onClick={() => setMode('count')}>Terbanyak</button>
        <button type="button" aria-pressed={mode === 'name'} onClick={() => setMode('name')}>A–Z</button>
      </div>}
    </div>}
    {rows.length ? <ul className={`pd-bars${scroll ? ' is-scroll' : ''}`}>
      {visible.map(group => {
        const count = group.employees.length
        const dim = selected !== undefined && selected !== group.name
        return <li key={group.name}>
          <button type="button" className={`pd-bar-row${group.missing ? ' is-missing' : ''}${dim ? ' is-dim' : ''}`} disabled={!count}
            aria-label={`Lihat ${count} pegawai dalam ${group.name}, ${title}, ${share(count, total)}`}
            title={`${group.name}: ${fmt.format(count)} pegawai (${share(count, total)})`} onClick={() => onSelect(group)}>
            <span className="pd-bar-name">{group.name}</span>
            <span className="pd-bar-track" aria-hidden="true"><span className="pd-bar-fill" style={{ width: `${count ? Math.max(2, (count / max) * 100) : 0}%` }} /></span>
            <span className="pd-bar-val"><strong>{fmt.format(count)}</strong><small>{share(count, total)}</small></span>
          </button>
        </li>
      })}
    </ul> : <p className="pd-empty">Tidak ada {noun} yang cocok dengan “{query}”.</p>}
    {(searchable || scroll) && <p className="pd-foot" aria-live="polite">{query.trim() ? `${rows.length} dari ${groups.length} ${noun} cocok` : `${groups.length} ${noun}`}</p>}
    {!scroll && initial !== undefined && rows.length > initial && !query.trim() &&
      <button type="button" className="pd-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        {expanded ? 'Ringkas daftar' : `Tampilkan ${hidden} ${noun} lainnya`}
      </button>}
  </div>
}

/* ---------- 100% segmented bar + legend (2–4 parts) ---------- */

export function SegmentBar({ title, groups, total, onSelect }: {
  title: string; groups: EmployeeGroup[]; total: number; onSelect: (group: EmployeeGroup) => void
}) {
  const parts = groups.filter(group => group.employees.length)
  if (!parts.length) return <p className="pd-empty">Belum ada data.</p>
  return <div className="pd-segwrap">
    <div className="pd-segbar" role="group" aria-label={`Komposisi ${title}`}>
      {parts.map(group => {
        const count = group.employees.length
        const { bg, fg } = colorOf(group)
        const label = share(count, total)
        return <button type="button" key={group.name} style={{ flex: `${count} 1 0`, background: bg, color: fg }}
          aria-label={`Lihat ${count} pegawai: ${group.name}, ${label}`} title={`${group.name}: ${fmt.format(count)} pegawai (${label})`} onClick={() => onSelect(group)}>
          {(count / total) >= 0.12 && <span aria-hidden="true">{label}</span>}
        </button>
      })}
    </div>
    <ul className="pd-legend">
      {parts.map(group => {
        const count = group.employees.length
        return <li key={group.name}>
          <button type="button" className="pd-legend-row" aria-label={`Lihat ${count} pegawai: ${group.name}, ${share(count, total)}`} onClick={() => onSelect(group)}>
            <i style={{ background: colorOf(group).bg }} aria-hidden="true" />
            <span className="pd-legend-name">{group.name}</span>
            <strong>{fmt.format(count)}</strong>
            <small>{share(count, total)}</small>
          </button>
        </li>
      })}
    </ul>
  </div>
}

/* ---------- population pyramid (age band × gender) ---------- */

export function Pyramid({ bands, onSelect }: {
  bands: AgeBand[]
  onSelect: (band: AgeBand, side: 'all' | 'male' | 'female') => void
}) {
  const max = Math.max(1, ...bands.flatMap(band => [band.male.length, band.female.length]))
  const rows = [...bands].reverse() // oldest on top, like a pyramid
  const side = (band: AgeBand, kind: 'male' | 'female') => {
    const list = kind === 'male' ? band.male : band.female
    const count = list.length
    const width = (count / max) * 82
    const who = kind === 'male' ? 'laki-laki' : 'perempuan'
    return <button type="button" className={`pd-pyr-side is-${kind}`} disabled={!count}
      aria-label={`Lihat ${count} pegawai ${who} usia ${band.label} tahun`} title={`${kind === 'male' ? 'Laki-laki' : 'Perempuan'}, ${band.label}: ${count} pegawai`}
      onClick={() => onSelect(band, kind)}>
      {count > 0 && <>
        <span className="pd-pyr-bar" style={{ width: `${Math.max(1.5, width)}%` }} />
        <span className="pd-pyr-n" style={kind === 'male' ? { right: `calc(${Math.max(1.5, width)}% + 6px)` } : { left: `calc(${Math.max(1.5, width)}% + 6px)` }}>{fmt.format(count)}</span>
      </>}
    </button>
  }
  return <div className="pd-pyr" role="group" aria-label="Piramida usia menurut jenis kelamin">
    <div className="pd-pyr-head" aria-hidden="true">
      <span><i className="is-male" />Laki-laki</span><span>Usia</span><span>Perempuan<i className="is-female" /></span>
    </div>
    {rows.map(band => <div className="pd-pyr-row" key={band.label}>
      {side(band, 'male')}
      <button type="button" className="pd-pyr-age" disabled={!band.employees.length}
        aria-label={`Lihat ${band.employees.length} pegawai usia ${band.label} tahun, semua jenis kelamin`}
        title={`Usia ${band.label}: ${band.employees.length} pegawai`} onClick={() => onSelect(band, 'all')}>{band.label}</button>
      {side(band, 'female')}
    </div>)}
  </div>
}

/* ---------- month timeline ---------- */

export function MonthStrip({ title, buckets, nowKey, onSelect }: {
  title: string; buckets: MonthBucket[]; nowKey: string; onSelect: (bucket: MonthBucket) => void
}) {
  const max = Math.max(1, ...buckets.map(bucket => bucket.employees.length))
  return <div className="pd-months" role="group" aria-label={`Linimasa bulanan ${title}`}>
    {buckets.map(bucket => {
      const count = bucket.employees.length
      return <button type="button" key={bucket.key} className={`pd-month${bucket.key === nowKey ? ' is-now' : ''}`} disabled={!count}
        aria-label={`Lihat ${count} pegawai, ${title}, ${bucket.full}`} title={`${bucket.full}: ${count} pegawai`} onClick={() => onSelect(bucket)}>
        <span className="pd-month-n">{count || ''}</span>
        <span className="pd-month-col"><span style={{ height: `${count ? Math.max(8, (count / max) * 100) : 0}%` }} /></span>
        <span className="pd-month-l">{bucket.label}</span>
      </button>
    })}
  </div>
}
