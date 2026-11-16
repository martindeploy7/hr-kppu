import type { CSSProperties, ReactNode } from 'react'
import './skeleton.css'

/** Balok placeholder berkilau. Dekoratif: pembaca layar mendapat label dari wadah PageSkeleton. */
export function Bone({ w = '100%', h = 12, r = 6, style }: { w?: number | string; h?: number | string; r?: number; style?: CSSProperties }) {
  return <span className="sk-bone" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />
}

export type SkeletonVariant = 'board' | 'cards' | 'meal' | 'identity' | 'table' | 'dashboard' | 'form' | 'grid' | 'automation' | 'features' | 'employees' | 'rekap' | 'settings'

type Tint = 'ok' | 'warn' | 'info' | undefined
const arr = (n: number) => Array.from({ length: n }, (_, i) => i)
const pct = (r: number, c: number, base = 40, span = 45) => `${base + ((r * 7 + c * 13) % span)}%`

/** Judul halaman. `kicker` = baris kecil di atas judul (hanya sebagian halaman memakainya). */
function Head({ kicker = false, lines = 1, actions = 0, details = false }: { kicker?: boolean; lines?: number; actions?: number; details?: boolean }) {
  return <div className="sk-head">
    <div className="sk-stack">
      {kicker && <Bone w={110} h={10} />}
      <Bone w={240} h={22} r={8} />
      {arr(lines).map(i => <Bone key={i} w={i === lines - 1 && lines > 1 ? 'min(380px, 60%)' : 'min(620px, 92%)'} h={12} />)}
      {details && <Bone w={74} h={11} />}
    </div>
    {actions > 0 && <div className="sk-row">{arr(actions).map(i => <Bone key={i} w={i === 0 ? 150 : 130} h={34} r={9} />)}</div>}
  </div>
}

const Tiles = ({ tints = [], n = 4, h = 92, icon = false }: { tints?: Tint[]; n?: number; h?: number; icon?: boolean }) => <div className="sk-tiles">{arr(n).map(i => <div key={i} className={`sk-card sk-tile${tints[i] ? ` sk-${tints[i]}` : ''}`} style={{ minHeight: h }}>
  <div className="sk-row">{icon && <Bone w={15} h={15} r={4} />}<Bone w="45%" h={10} /></div><Bone w="55%" h={24} r={8} /><Bone w="78%" h={10} />
</div>)}</div>

/** Kotak panel dengan judul + keterangan (+ aksi di kanan). */
function Panel({ title = 150, sub = 240, aside, children, className = '' }: { title?: number; sub?: number | null; aside?: ReactNode; children?: ReactNode; className?: string }) {
  return <div className={`sk-card sk-panel ${className}`}>
    <div className="sk-row sk-between sk-nowrap"><div className="sk-stack sk-tight"><Bone w={title} h={14} />{sub && <Bone w={`min(${sub}px, 100%)`} h={10} />}</div>{aside}</div>
    {children}
  </div>
}

const Pills = ({ ws, h = 28 }: { ws: number[]; h?: number }) => <div className="sk-row sk-wrap">{ws.map((w, i) => <Bone key={i} w={w} h={h} r={999} />)}</div>
const Field = ({ label = 90, h = 38 }: { label?: number; h?: number }) => <div className="sk-stack sk-tight"><Bone w={label} h={10} /><Bone h={h} r={9} /></div>
const Banner = () => <div className="sk-card sk-banner"><Bone w={22} h={22} r={22} /><div className="sk-stack sk-tight" style={{ flex: 1 }}><Bone w={110} h={9} /><Bone w="min(360px, 60%)" h={15} /><Bone w="min(460px, 80%)" h={10} /></div><Bone w={150} h={36} r={9} /></div>

const Rows = ({ n = 8, cols = 5, dots = false }: { n?: number; cols?: number; dots?: boolean }) => <div className="sk-card sk-table">
  <div className="sk-trow sk-thead" style={{ gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)` }}>{arr(cols).map(i => <Bone key={i} w={i === 0 ? '70%' : '50%'} h={9} />)}</div>
  {arr(n).map(r => <div key={r} className="sk-trow" style={{ gridTemplateColumns: `2fr repeat(${cols - 1}, 1fr)` }}>{arr(cols).map(c => c === 2 && dots
    ? <span key={c} className="sk-dots">{arr(12).map(d => <Bone key={d} w={9} h={9} r={9} />)}</span>
    : <span key={c} className="sk-stack sk-tight"><Bone w={c === 0 ? '85%' : pct(r, c)} h={11} />{c === 0 && <Bone w="55%" h={8} />}</span>)}</div>)}
</div>

/** Daftar batang horizontal: label | batang | angka (Komposisi, Struktur organisasi). */
const BarList = ({ n = 6, seed = 0, search = false }: { n?: number; seed?: number; search?: boolean }) => <div className="sk-stack" style={{ gap: 11 }}>
  {search && <Bone h={34} r={9} />}
  {arr(n).map(i => <div key={i} className="sk-bar-row"><Bone w="70%" h={10} /><span className="sk-track"><Bone w={`${92 - ((i * 17 + seed * 11) % 70)}%`} h={8} r={999} /></span><Bone w={34} h={10} /></div>)}
</div>

/** Batang 100% bertumpuk + legenda, seperti status kepegawaian dan jenis kelamin. */
const Stacked = ({ parts }: { parts: number[] }) => <div className="sk-stack" style={{ gap: 12 }}>
  <div className="sk-row" style={{ gap: 3 }}>{parts.map((p, i) => <Bone key={i} w={`${p}%`} h={24} r={6} />)}</div>
  {parts.slice(0, 3).map((_, i) => <div key={i} className="sk-between sk-row sk-nowrap"><Bone w="38%" h={10} /><Bone w={64} h={10} /></div>)}
</div>

function Body({ variant }: { variant: SkeletonVariant }) {
  switch (variant) {
    case 'board': return <>
      <Tiles tints={['info', 'ok', 'ok', 'warn']} icon h={110} />
      <Banner />
      <div className="sk-card sk-table sk-board">
        <div className="sk-row sk-between sk-nowrap sk-board-head"><Bone w={150} h={15} /><Bone w="min(260px, 40%)" h={10} /></div>
        <div className="sk-trow sk-board-row sk-thead">{arr(6).map(i => <Bone key={i} w={i === 0 ? 40 : '45%'} h={9} />)}</div>
        {arr(5).map(r => <div key={r} className="sk-trow sk-board-row">
          <span className="sk-stack sk-tight"><Bone w={64} h={13} /><Bone w="80%" h={9} /><Bone w={58} h={20} r={999} /></span>
          {arr(3).map(c => <Bone key={c} w="min(110px, 100%)" h={24} r={999} />)}
          <Bone w={56} h={22} r={999} />
          <span className="sk-stack sk-tight"><Bone w={80} h={13} /><Bone w={64} h={9} /></span>
        </div>)}
      </div>
      <div className="sk-row sk-wrap"><Bone w={230} h={34} r={9} /><Bone w={210} h={32} r={999} /></div>
    </>
    case 'cards': return <>
      <div className="sk-row sk-wrap"><Bone w={70} h={12} /><Bone w={230} h={34} r={9} /><Bone w={170} h={32} r={999} /></div>
      <Tiles tints={['ok', undefined, 'info', undefined]} icon h={86} />
      <div className="sk-card sk-stack" style={{ padding: 14, gap: 10 }}><div className="sk-between sk-row sk-nowrap"><Bone w="30%" h={11} /><Bone w={40} h={11} /></div><Bone h={10} r={999} /></div>
      <Banner />
      <div className="sk-card sk-row sk-wrap" style={{ padding: 12 }}><Bone w="min(260px, 100%)" h={34} r={9} /><Bone w={80} h={34} r={9} /><Bone w={210} h={32} r={999} /><Bone w={170} h={32} r={999} /></div>
      {arr(3).map(i => <div key={i} className="sk-card sk-clash">
        <div className="sk-row sk-between"><div className="sk-stack"><Bone w={180} h={15} /><Bone w={260} h={9} /></div><div className="sk-row"><Bone w={150} h={22} r={999} /><Bone w={80} h={22} r={999} /></div></div>
        <div className="sk-cols">{arr(3).map(c => <div key={c} className="sk-src"><Bone w="50%" h={9} /><Bone w="80%" h={12} /></div>)}</div>
        <div className="sk-row sk-wrap">{arr(3).map(b => <Bone key={b} w={170} h={40} r={9} />)}</div>
      </div>)}
    </>
    case 'meal': return <>
      <div className="sk-row sk-between sk-wrap"><div className="sk-row sk-wrap"><Bone w={70} h={12} /><Bone w={230} h={34} r={9} /><Bone w={160} h={32} r={999} /></div><div className="sk-row"><Bone w={130} h={34} r={9} /><Bone w={170} h={36} r={9} /></div></div>
      <Bone h={38} r={9} />
      <Tiles tints={['ok', 'warn', undefined, undefined]} h={104} />
      <div className="sk-grid-wide">
        <Panel title={150} sub={280}>
          <div className="sk-row" style={{ gap: 3 }}>{[24, 12, 4, 20, 22, 18].map((p, i) => <Bone key={i} w={`${p}%`} h={24} r={6} />)}</div>
          <Pills ws={[104, 96, 112, 88, 96, 104]} h={22} />
        </Panel>
        <Panel title={110} sub={null} aside={<Bone w={130} h={34} r={9} />}>
          <Pills ws={[90, 120, 140, 130, 110, 150]} h={22} />
          <div className="sk-tiles sk-tiles4">{arr(4).map(i => <div key={i} className="sk-src"><Bone w="50%" h={9} /><Bone w="75%" h={13} /></div>)}</div>
        </Panel>
      </div>
      <Panel title={170} sub={340}><div className="sk-cols">{arr(3).map(i => <div key={i} className="sk-src"><Bone w="55%" h={10} /><Bone w="80%" h={18} r={8} /><Bone w="65%" h={9} /></div>)}</div></Panel>
      <Rows n={7} cols={5} dots />
    </>
    case 'identity': return <>
      <Tiles n={4} h={96} />
      <div className="sk-card sk-panel">
        <Bone w={170} h={15} /><Bone w="min(300px, 70%)" h={10} />
        {arr(2).map(i => <div key={i} className="sk-conflict">
          <div className="sk-cols sk-cols2">{arr(2).map(c => <div key={c} className="sk-src sk-plain"><Bone w="55%" h={13} /><Bone w="70%" h={9} /><Bone w="90%" h={9} /><Bone w="35%" h={9} /></div>)}</div>
          <Bone w="min(520px, 90%)" h={10} />
          <div className="sk-row sk-wrap"><Bone w={190} h={34} r={9} /><Bone w={120} h={34} r={9} /><Bone w={110} h={34} r={9} /></div>
        </div>)}
      </div>
      <div className="sk-card sk-panel">
        <div className="sk-row sk-between sk-wrap"><span /><div className="sk-row sk-wrap"><Bone w={220} h={32} r={999} /><Bone w={160} h={32} r={999} /><Bone w={120} h={32} r={999} /></div></div>
        {arr(2).map(r => <div key={r} className="sk-trow sk-id-row"><span className="sk-stack sk-tight"><Bone w={110} h={14} /><Bone w="80%" h={9} /></span><span className="sk-stack">{arr(2).map(c => <Bone key={c} w="min(300px, 100%)" h={48} r={9} />)}</span></div>)}
      </div>
    </>
    case 'dashboard': return <>
      <div className="sk-card sk-hero sk-dark">
        <div className="sk-stack" style={{ gap: 10, flex: 1 }}><Bone w={150} h={11} /><Bone w={260} h={26} r={8} /><Bone w="min(560px, 90%)" h={12} /><Bone w="min(420px, 70%)" h={12} /><Bone w={260} h={10} style={{ marginTop: 6 }} /></div>
        <div className="sk-row sk-hero-actions"><Bone w={150} h={42} r={9} /><Bone w={170} h={42} r={9} /></div>
      </div>
      <div className="sk-row sk-wrap"><Bone w={44} h={11} />{[78, 62, 58, 62, 66, 54, 60, 54].map((w, i) => <Bone key={i} w={w} h={30} r={999} />)}</div>
      <Tiles n={4} h={92} />
      <SectionHead t={110} h={260} />
      <div className="sk-grid-comp">
        <Panel title={110} sub={260} aside={<Bone w={56} h={11} />}><BarList n={8} /></Panel>
        <div className="sk-stack" style={{ gap: 14 }}>
          <Panel title={140} sub={110}><Stacked parts={[13, 87]} /></Panel>
          <Panel title={120} sub={190}><Stacked parts={[48, 52]} /></Panel>
        </div>
      </div>
      <SectionHead t={160} h={380} />
      <div className="sk-grid2">{arr(4).map(i => <Panel key={i} title={110 + i * 12} sub={200} aside={<Bone w={56} h={11} />}><BarList n={5} seed={i} search={i < 2} /></Panel>)}</div>
      <SectionHead t={90} h={300} />
      <div className="sk-grid-demo">
        <Panel title={110} sub={320} aside={<Bone w={90} h={11} />}>
          <div className="sk-stack" style={{ gap: 7 }}>{arr(9).map(i => <div key={i} className="sk-pyr"><span className="sk-pyr-l"><Bone w={`${95 - ((i * 19) % 70)}%`} h={11} r={3} /></span><Bone w={34} h={9} /><span><Bone w={`${90 - ((i * 23) % 65)}%`} h={11} r={3} /></span></div>)}</div>
          <Pills ws={[76, 76, 76, 76, 76]} h={26} />
        </Panel>
        <Panel title={150} sub={160} aside={<Bone w={60} h={11} />}>
          {arr(5).map(i => <div key={i} className="sk-row sk-nowrap" style={{ gap: 12 }}><Bone w={40} h={40} r={9} /><div className="sk-stack sk-tight" style={{ flex: 1 }}><Bone w="60%" h={12} /><Bone w="40%" h={9} /></div><Bone w={54} h={10} /></div>)}
        </Panel>
      </div>
      <SectionHead t={140} h={330} aside={<Bone w={150} h={30} r={999} />} />
      <div className="sk-grid3">{arr(3).map(i => <Panel key={i} title={110} sub={170}>
        <div className="sk-bars sk-mini">{arr(6).map(b => <Bone key={b} w="12%" h={`${25 + ((b * 29 + i * 17) % 70)}%`} r={3} />)}</div>
        {arr(3).map(r => <div key={r} className="sk-row sk-nowrap"><Bone w={32} h={32} r={999} /><div className="sk-stack sk-tight" style={{ flex: 1 }}><Bone w="65%" h={11} /><Bone w="40%" h={9} /></div></div>)}
      </Panel>)}</div>
      <SectionHead t={110} h={320} />
      <div className="sk-card sk-panel sk-comp">{arr(8).map(i => <div key={i} className="sk-bar-row"><Bone w="75%" h={10} /><span className="sk-track"><Bone w={`${95 - ((i * 13) % 55)}%`} h={8} r={999} /></span><Bone w={34} h={10} /></div>)}</div>
    </>
    case 'form': return <div className="sk-card sk-stack" style={{ padding: 20, gap: 16 }}>
      {arr(5).map(i => <Field key={i} label={140} />)}
      <Bone w={160} h={38} r={9} />
    </div>
    case 'automation': return <>
      <div className="sk-grid-wide sk-auto-top">
        <Panel title={170} sub={230} aside={<Bone w={150} h={34} r={9} />}>
          <Bone h={52} r={9} />
          <div className="sk-cols">{arr(6).map(i => <div key={i} className="sk-src sk-plain"><Bone w="55%" h={9} /><Bone w={i < 3 ? '70%' : 34} h={i < 3 ? 20 : 24} r={i < 3 ? 999 : 8} /></div>)}</div>
        </Panel>
        <Panel title={140} sub={200}>
          <Bone w="min(190px, 70%)" h={190} r={12} style={{ alignSelf: 'center' }} />
          <Bone w="60%" h={11} style={{ alignSelf: 'center' }} /><Bone h={34} r={9} />
        </Panel>
      </div>
      <Panel title={190} sub={240} aside={<Bone w={22} h={22} r={6} />}>
        {arr(3).map(i => <div key={i} className="sk-src sk-plain sk-agenda"><Bone w={64} h={22} r={999} /><div className="sk-stack sk-tight" style={{ flex: 1 }}><Bone w="45%" h={13} /><Bone w="30%" h={9} /></div><Bone w={70} h={12} /></div>)}
      </Panel>
      <div className="sk-row sk-wrap"><Bone w={120} h={32} r={999} /><Bone w={110} h={32} r={999} /><Bone w={130} h={32} r={999} /><Bone w={100} h={32} r={999} /></div>
      <Rows n={5} cols={4} />
    </>
    case 'features': return <div className="sk-card sk-panel">
      <div className="sk-stack sk-tight"><Bone w={260} h={15} /><Bone w="min(420px, 70%)" h={10} /></div>
      <div className="sk-feat sk-feat-head">{arr(3).map(i => <Bone key={i} w={i === 0 ? 150 : 110} h={9} />)}</div>
      {arr(6).map(r => <div key={r} className="sk-feat">{arr(3).map(c => <div key={c} className="sk-stack sk-tight">{arr(2 + ((r + c) % 3)).map(l => <Bone key={l} w={l === 0 ? '96%' : `${55 + ((r * 11 + c * 17 + l * 23) % 40)}%`} h={10} />)}</div>)}</div>)}
    </div>
    case 'employees': return <>
      <Bone w={160} h={36} r={9} />
      <div className="sk-card sk-table sk-emp">
        <div className="sk-row sk-nowrap sk-emp-bar"><Bone h={36} r={9} style={{ flex: 1 }} /><Bone w={70} h={36} r={9} /><Bone w={96} h={36} r={9} /><Bone w={60} h={11} /></div>
        <div className="sk-trow sk-emp-row sk-thead">{[70, 60, 80, 40, 50].map((w, i) => <Bone key={i} w={w} h={9} />)}<span /></div>
        {arr(9).map(r => <div key={r} className="sk-trow sk-emp-row">
          <span className="sk-row sk-nowrap"><Bone w={32} h={32} r={999} /><span className="sk-stack sk-tight" style={{ flex: 1 }}><Bone w={pct(r, 1, 55, 40)} h={12} /><Bone w="55%" h={9} /></span></span>
          <span className="sk-stack sk-tight"><Bone w="80%" h={11} /><Bone w="55%" h={9} /></span>
          <span className="sk-stack sk-tight"><Bone w="40%" h={11} /><Bone w={pct(r, 2, 45, 40)} h={9} /></span>
          <Bone w={46} h={20} r={999} />
          <span className="sk-row sk-nowrap sk-chips"><Bone w={70} h={20} r={999} /><Bone w={76} h={20} r={999} /><Bone w={26} h={20} r={999} /></span>
          <Bone w={10} h={14} />
        </div>)}
      </div>
    </>
    case 'rekap': return <>
      <div className="sk-row"><Bone w={50} h={12} /><Bone w={150} h={34} r={9} /></div>
      <div className="sk-card sk-panel">
        <div className="sk-stack sk-tight"><Bone w={150} h={14} /><Bone w="min(340px, 80%)" h={10} /></div>
        <div className="sk-form2"><Field label={110} /><Field label={50} /><Field label={80} /><span /><Field label={100} /><Field label={100} /></div>
        <Field label={44} />
        <Field label={150} h={34} />
        <div className="sk-between sk-row sk-nowrap"><Bone w="min(300px, 60%)" h={10} /><Bone w={120} h={36} r={9} /></div>
      </div>
      <div className="sk-card sk-panel">
        <div className="sk-stack sk-tight"><Bone w={140} h={14} /><Bone w="min(380px, 80%)" h={10} /></div>
        <div className="sk-row sk-wrap"><Field label={90} h={36} /><Bone w={80} h={20} r={999} /><Bone w={120} h={36} r={9} style={{ marginLeft: 'auto' }} /></div>
      </div>
      <div className="sk-card sk-table">
        {arr(2).map(g => <div key={g}>
          <div className="sk-trow sk-group"><Bone w={180} h={12} /><Bone w={90} h={20} r={999} /></div>
          {arr(3).map(r => <div key={r} className="sk-trow sk-rekap-row"><Bone w="60%" h={11} /><Bone w="70%" h={11} /><Bone w={pct(r, g, 50, 40)} h={11} /><Bone w={36} h={11} /><Bone w={60} h={20} r={999} /></div>)}
        </div>)}
      </div>
    </>
    case 'settings': return <>
      <div className="sk-card sk-panel"><div className="sk-stack sk-tight"><Bone w={110} h={14} /><Bone w={220} h={10} /></div>
        <div className="sk-cols sk-cols2"><Field label={110} /><Field label={90} /></div><Bone w={130} h={36} r={9} /></div>
      <div className="sk-card sk-panel"><div className="sk-stack sk-tight"><Bone w={180} h={14} /><Bone w={230} h={10} /></div>
        <Bone w={74} h={11} /><Bone w={170} h={34} r={9} /><Field label={110} h={34} /><Bone w={190} h={34} r={9} /></div>
      <div className="sk-card sk-panel"><div className="sk-stack sk-tight"><Bone w={110} h={14} /><Bone w={230} h={10} /></div>
        <Bone w={74} h={11} />
        <div className="sk-cols sk-cols4">{arr(4).map(i => <Field key={i} label={70} />)}</div><Bone w={130} h={36} r={9} />
        <div className="sk-table sk-inner">{arr(4).map(r => <div key={r} className="sk-trow" style={{ gridTemplateColumns: '2fr 1.4fr 1fr 1fr 1fr' }}>{arr(5).map(c => <Bone key={c} w={pct(r, c, 40, 45)} h={11} />)}</div>)}</div>
      </div>
    </>
    case 'grid': return <div className="sk-grid3">{arr(6).map(i => <div key={i} className="sk-card sk-stack" style={{ padding: 16, minHeight: 140 }}><Bone w={34} h={34} r={9} /><Bone w="70%" h={14} /><Bone w="95%" h={9} /><Bone w="80%" h={9} /></div>)}</div>
    default: return <><div className="sk-row"><Bone w="min(320px, 100%)" h={38} r={9} /><Bone w={140} h={38} r={9} /></div><Rows /></>
  }
}

function SectionHead({ t, h, aside }: { t: number; h: number; aside?: ReactNode }) {
  return <div className="sk-row sk-between sk-nowrap sk-sec"><div className="sk-stack sk-tight"><Bone w={t} h={15} /><Bone w={`min(${h}px, 90%)`} h={10} /></div>{aside}</div>
}

/** Judul tiap halaman mengikuti halaman aslinya (kicker, jumlah baris keterangan, tombol). */
const HEAD: Record<SkeletonVariant, { kicker?: boolean; lines?: number; actions?: number; details?: boolean } | null> = {
  board: { kicker: true, lines: 1, actions: 1 },
  cards: { kicker: true, lines: 2 },
  meal: { kicker: true, lines: 2 },
  identity: { kicker: true, lines: 2, details: true },
  table: { lines: 1 },
  dashboard: null,
  form: { lines: 1 },
  grid: { lines: 1 },
  automation: { lines: 1, details: true },
  features: { lines: 1, details: true },
  employees: { lines: 2 },
  rekap: { lines: 1 },
  settings: { lines: 1 },
}

/** Placeholder untuk daftar/tabel di dalam halaman yang datanya dimuat terpisah. */
export function ListSkeleton({ rows = 4, cols = 4, label = 'Memuat data…' }: { rows?: number; cols?: number; label?: string }) {
  return <div className="sk-fade" role="status" aria-busy="true"><span className="sk-sr">{label}</span><Rows n={rows} cols={cols} /></div>
}

/** Kerangka halaman selama data/halaman dimuat; bentuknya mengikuti tata letak halaman tujuan. */
export function PageSkeleton({ variant = 'table', label = 'Memuat halaman…' }: { variant?: SkeletonVariant; label?: string }) {
  const head = HEAD[variant] ?? (variant in HEAD ? null : { lines: 1 })
  return <div className="page sk-page" role="status" aria-live="polite" aria-busy="true">
    <span className="sk-sr">{label}</span>
    {head && <Head {...head} />}
    <Body variant={variant} />
  </div>
}

/** Kerangka seluruh aplikasi (sidebar + konten) selama sesi diperiksa. */
export function AppSkeleton() {
  return <div className="sk-app" role="status" aria-busy="true">
    <span className="sk-sr">Memeriksa sesi…</span>
    <aside className="sk-side"><div className="sk-row"><Bone w={40} h={40} r={10} /><div className="sk-stack"><Bone w={90} h={13} /><Bone w={130} h={9} /></div></div>
      {arr(9).map(i => <Bone key={i} w={`${55 + (i * 9) % 35}%`} h={13} style={{ marginTop: i === 0 ? 26 : 14 }} />)}</aside>
    <div className="sk-main"><PageSkeleton variant="board" label="Memeriksa sesi…" /></div>
  </div>
}
