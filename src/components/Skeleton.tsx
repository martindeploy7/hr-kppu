import type { CSSProperties } from 'react'
import './skeleton.css'

/** Balok placeholder berkilau. Dekoratif: pembaca layar mendapat label dari wadah PageSkeleton. */
export function Bone({ w = '100%', h = 12, r = 6, style }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties }) {
  return <span className="sk-bone" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />
}

export type SkeletonVariant = 'board' | 'cards' | 'meal' | 'identity' | 'table' | 'dashboard' | 'form' | 'grid'

function Head({ actions = 1 }: { actions?: number }) {
  return <div className="sk-head">
    <div className="sk-stack"><Bone w={110} h={10} /><Bone w={260} h={22} r={8} /><Bone w="min(560px, 90%)" h={12} /></div>
    <div className="sk-row">{Array.from({ length: actions }, (_, i) => <Bone key={i} w={140} h={34} r={9} />)}</div>
  </div>
}
const Tiles = ({ n = 4, h = 92 }: { n?: number; h?: number }) => <div className="sk-tiles">{Array.from({ length: n }, (_, i) => <div key={i} className="sk-card sk-tile" style={{ height: h }}><Bone w="45%" h={10} /><Bone w="60%" h={24} r={8} /><Bone w="75%" h={10} /></div>)}</div>
const Rows = ({ n = 8, cols = 5, dots = false }: { n?: number; cols?: number; dots?: boolean }) => <div className="sk-card sk-table">
  <div className="sk-trow sk-thead" style={{ gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)` }}>{Array.from({ length: cols }, (_, i) => <Bone key={i} w={i === 0 ? '70%' : '50%'} h={9} />)}</div>
  {Array.from({ length: n }, (_, r) => <div key={r} className="sk-trow" style={{ gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)` }}>{Array.from({ length: cols }, (_, c) => c === 2 && dots
    ? <span key={c} className="sk-dots">{Array.from({ length: 12 }, (_, d) => <Bone key={d} w={9} h={9} r={9} />)}</span>
    : <span key={c} className="sk-stack sk-tight"><Bone w={c === 0 ? '85%' : `${45 + ((r * 7 + c * 13) % 40)}%`} h={11} />{c === 0 && <Bone w="55%" h={8} />}</span>)}</div>)}
</div>

function Body({ variant }: { variant: SkeletonVariant }) {
  switch (variant) {
    case 'board': return <>
      <Tiles n={4} />
      <div className="sk-card sk-banner"><Bone w={28} h={28} r={28} /><div className="sk-stack" style={{ flex: 1 }}><Bone w={120} h={9} /><Bone w="50%" h={16} /></div><Bone w={150} h={36} r={9} /></div>
      <div className="sk-card sk-table">{Array.from({ length: 5 }, (_, r) => <div key={r} className="sk-trow sk-board-row"><span className="sk-stack sk-tight"><Bone w={70} h={14} /><Bone w={120} h={9} /></span>{Array.from({ length: 3 }, (_, c) => <Bone key={c} w={78} h={34} r={999} />)}<Bone w={70} h={24} r={999} /><Bone w={90} h={14} /></div>)}</div>
    </>
    case 'cards': return <>
      <Bone w={340} h={34} r={9} />
      <Tiles n={4} h={78} />
      <div className="sk-card sk-stack" style={{ padding: 14 }}><Bone w="30%" h={11} /><Bone h={10} r={999} /></div>
      {Array.from({ length: 3 }, (_, i) => <div key={i} className="sk-card sk-clash">
        <div className="sk-row sk-between"><div className="sk-stack"><Bone w={180} h={15} /><Bone w={260} h={9} /></div><div className="sk-row"><Bone w={150} h={22} r={999} /><Bone w={80} h={22} r={999} /></div></div>
        <div className="sk-cols">{Array.from({ length: 3 }, (_, c) => <div key={c} className="sk-src"><Bone w="50%" h={9} /><Bone w="80%" h={12} /></div>)}</div>
        <div className="sk-row">{Array.from({ length: 3 }, (_, b) => <Bone key={b} w={170} h={40} r={9} />)}</div>
      </div>)}
    </>
    case 'meal': return <>
      <Tiles n={4} h={104} />
      <div className="sk-card sk-stack" style={{ padding: 16 }}><Bone w={190} h={14} /><Bone h={22} r={7} /><div className="sk-row sk-wrap">{Array.from({ length: 7 }, (_, i) => <Bone key={i} w={96} h={24} r={999} />)}</div></div>
      <Rows n={7} cols={5} dots />
    </>
    case 'identity': return <>
      <div className="sk-card sk-ladder">{Array.from({ length: 5 }, (_, i) => <div key={i} className="sk-stack"><Bone w={22} h={22} r={6} /><Bone w="60%" h={12} /><Bone w="80%" h={9} /></div>)}</div>
      <Tiles n={4} h={86} />
      <div className="sk-card sk-table">{Array.from({ length: 4 }, (_, r) => <div key={r} className="sk-trow sk-id-row"><span className="sk-stack sk-tight"><Bone w={90} h={14} /><Bone w={200} h={9} /></span><span className="sk-stack">{Array.from({ length: 2 }, (_, c) => <Bone key={c} w="min(260px, 100%)" h={52} r={9} />)}</span></div>)}</div>
    </>
    case 'dashboard': return <>
      <Tiles n={4} />
      <div className="sk-grid2">{Array.from({ length: 4 }, (_, i) => <div key={i} className="sk-card sk-chart"><Bone w="40%" h={13} /><div className="sk-bars">{Array.from({ length: 8 }, (_, b) => <Bone key={b} w="9%" h={`${30 + ((b * 17 + i * 11) % 60)}%`} r={4} />)}</div></div>)}</div>
    </>
    case 'form': return <div className="sk-card sk-stack" style={{ padding: 20, gap: 16 }}>
      {Array.from({ length: 5 }, (_, i) => <div key={i} className="sk-stack sk-tight"><Bone w={140} h={10} /><Bone h={38} r={9} /></div>)}
      <Bone w={160} h={38} r={9} />
    </div>
    case 'grid': return <div className="sk-grid3">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sk-card sk-stack" style={{ padding: 16, minHeight: 140 }}><Bone w={34} h={34} r={9} /><Bone w="70%" h={14} /><Bone w="95%" h={9} /><Bone w="80%" h={9} /></div>)}</div>
    default: return <><div className="sk-row"><Bone w="min(320px, 100%)" h={38} r={9} /><Bone w={140} h={38} r={9} /></div><Rows /></>
  }
}

/** Placeholder untuk daftar/tabel di dalam halaman yang datanya dimuat terpisah. */
export function ListSkeleton({ rows = 4, cols = 4, label = 'Memuat data…' }: { rows?: number; cols?: number; label?: string }) {
  return <div role="status" aria-busy="true"><span className="sk-sr">{label}</span><Rows n={rows} cols={cols} /></div>
}

/** Kerangka halaman selama data/halaman dimuat; bentuknya mengikuti tata letak halaman tujuan. */
export function PageSkeleton({ variant = 'table', label = 'Memuat halaman…' }: { variant?: SkeletonVariant; label?: string }) {
  return <div className="page sk-page" role="status" aria-live="polite" aria-busy="true">
    <span className="sk-sr">{label}</span>
    <Head actions={variant === 'meal' ? 2 : 1} />
    <Body variant={variant} />
  </div>
}

/** Kerangka seluruh aplikasi (sidebar + konten) selama sesi diperiksa. */
export function AppSkeleton() {
  return <div className="sk-app" role="status" aria-busy="true">
    <span className="sk-sr">Memeriksa sesi…</span>
    <aside className="sk-side"><div className="sk-row"><Bone w={40} h={40} r={10} style={{ opacity: .35 }} /><div className="sk-stack"><Bone w={90} h={13} style={{ opacity: .35 }} /><Bone w={130} h={9} style={{ opacity: .25 }} /></div></div>
      {Array.from({ length: 9 }, (_, i) => <Bone key={i} w={`${55 + (i * 9) % 35}%`} h={13} style={{ opacity: .25, marginTop: i === 0 ? 26 : 14 }} />)}</aside>
    <div className="sk-main"><PageSkeleton variant="board" label="Memeriksa sesi…" /></div>
  </div>
}
