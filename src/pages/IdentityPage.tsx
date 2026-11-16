import { useMemo, useState } from 'react'
import { ArrowRight, Check, Fingerprint, GitMerge, Search, Undo2, UploadCloud, UserPlus, X } from 'lucide-react'
import { useHr } from '../state/HrData.tsx'
import { mergeKey, type IdentityItem } from '../engine/roster.ts'
import type { Employee } from '../engine/types.ts'
import { fmt } from '../lib/format.ts'
import { Empty, Kpi, Note, PageHeader, Panel, Seg } from '../components/ui.tsx'
import type { Nav } from '../App.tsx'
import './identity.css'

function SourceList({ sources }: { sources: string[] }) {
  const [open, setOpen] = useState(false)
  const rest = sources.length - 3
  return <span className="src-list">{(open || rest <= 0 ? sources : sources.slice(0, 3)).join(', ')}{rest > 0 && <> <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(v => !v)}>{open ? 'Sembunyikan' : `+${rest} file lainnya`}</button></>}</span>
}

export function IdentityPage({ nav, toast }: { nav: Nav; toast: (m: string) => void }) {
  const hr = useHr()
  const [tab, setTab] = useState<'perlu' | 'tanpa-nip' | 'otomatis'>('perlu')
  const { identity, conflicts, byId, employees } = hr.roster
  const st = identity.filter(i => i.context === 'surat-tugas')
  const needs = st.filter(i => i.status === 'ambiguous' || i.status === 'unmatched').sort((a, b) => Number(a.status === 'unmatched') - Number(b.status === 'unmatched') || b.occurrences - a.occurrences)
  const decided = new Set(hr.decisions.map(d => d.key))
  const noNip = identity.filter(i => i.context === 'absensi' && i.status === 'unmatched' && !decided.has(`konfirmasi|${i.key}`))
  const auto = identity.filter(i => i.status === 'linked' || i.status === 'ignored').sort((a, b) => (a.score ?? 1) - (b.score ?? 1))
  const decisionKeys = new Set(hr.decisions.map(d => d.key))

  if (!hr.files.length) return <div className="page"><Empty icon={UploadCloud} title="Belum ada data untuk dicocokkan" action={<button className="btn primary" onClick={() => nav('import')}>Impor file sumber</button>}>Nama yang perlu dicocokkan muncul setelah file absensi dan Rekap ST diunggah.</Empty></div>

  return <div className="page id-page">
    <PageHeader kicker="Langkah 2 · Satukan identitas" title="Pencocokan identitas pegawai">
      Tidak ada satu ID yang dipakai di semua sumber, jadi sistem mencocokkan nama berjenjang dan meminta HR memutuskan kasus yang meragukan. Keputusan diingat untuk impor berikutnya.
    </PageHeader>

    <details className="id-how"><summary>Cara kerja</summary>
      <p>Mesin pusat dan aplikasi HP memakai NIP, mesin Kanwil II memakai NIKA, Kanwil I &amp; VI hanya nomor mesin, dan rekap surat tugas hanya menulis nama, sering disingkat ("A. Muhari", "Febi N", "Shobi").</p>
      <div className="ladder">
        {[['NIP', '18 digit · mesin pusat & HP'], ['NIKA / ID aplikasi', 'x.yy.zzzz · mesin Kanwil II, nama file foto HP'], ['No. mesin per kantor', 'Nama(1002) · Kanwil I & VI'], ['Nama', 'dibandingkan per token, singkatan & salah ketik ditoleransi'], ['Keputusan HR', 'tersimpan sebagai alias']].map(([t, d], i) => <div key={t}><span>{i + 1}</span><strong>{t}</strong><small>{d}</small></div>)}
      </div>
    </details>

    <div className="kpi-row">
      <Kpi label="Pegawai terbentuk" value={fmt.format(employees.length)} note={`${fmt.format(employees.filter(e => e.nip).length)} dengan NIP · ${fmt.format(employees.filter(e => !e.nip).length)} tanpa NIP`} tone="navy" />
      <Kpi label="Nama di surat tugas tertaut" value={`${fmt.format(st.filter(i => i.status === 'linked').length)} / ${fmt.format(st.length)}`} note={`${fmt.format(st.filter(i => i.status === 'linked' && i.method === 'manual').length)} lewat keputusan HR`} tone="green" />
      <Kpi label="Perlu dipilih" value={fmt.format(needs.filter(i => i.status === 'ambiguous').length)} note="Beberapa kandidat mirip" tone="gold" />
      <Kpi label="Tidak ditemukan" value={fmt.format(needs.filter(i => i.status === 'unmatched').length)} note="Tidak ada di sumber absensi mana pun" tone="red" />
    </div>

    {conflicts.length > 0 && <Panel title={`Konflik identitas (${conflicts.length})`} sub="Pola yang hanya terlihat setelah semua sumber digabung.">
      <div className="conflicts">{conflicts.map(c => {
        const emps = c.employeeIds.map(id => byId.get(id)).filter(Boolean) as Employee[]
        return <div key={c.key} className="conflict">
          <div className="conflict-people">{emps.map(e => <div key={e.id}><strong>{e.nama}</strong><span>{e.nip || 'tanpa NIP'}{e.nika ? ` · NIKA ${e.nika}` : ''}</span><small>{e.kantor} · {e.unit || '—'} · <SourceList sources={e.sources} /></small></div>)}</div>
          <p>{c.detail}</p>
          <div className="row-actions">
            {c.kind === 'nip-berbeda' && emps.length === 2 && <button className="btn primary" onClick={() => { hr.decide(mergeKey(emps[1].id), emps[0].id); toast(`${emps[1].nama} digabung ke NIP ${emps[0].nip || emps[0].id}`) }}><GitMerge size={14} /> Gabungkan (pakai NIP {emps[0].nip ? `…${emps[0].nip.slice(-4)}` : 'pertama'})</button>}
            {c.kind === 'nip-berbeda' && emps.length === 2 && emps[1].nip && <button className="btn secondary" onClick={() => { hr.decide(mergeKey(emps[0].id), emps[1].id); toast('Digabung') }}>Pakai NIP …{emps[1].nip.slice(-4)}</button>}
            <button className="btn secondary" onClick={() => { hr.decide(c.key, null); toast('Ditandai sebagai orang berbeda') }}>Orang berbeda</button>
          </div>
        </div>
      })}</div>
    </Panel>}

    <Panel aside={<Seg label="Daftar" value={tab} onChange={setTab} options={[{ value: 'perlu', label: `Surat tugas perlu keputusan (${needs.length})` }, { value: 'tanpa-nip', label: `Pegawai tanpa NIP (${noNip.length})` }, { value: 'otomatis', label: `Tautan otomatis (${auto.length})` }]} />}>
      {tab === 'perlu' && (needs.length ? <div className="id-list">{needs.map(i => <IdentityRow key={i.key} item={i} toast={toast} decided={decisionKeys.has(i.key)} />)}</div> : <Empty icon={Check} title="Semua nama di surat tugas sudah tertaut">Tidak ada yang perlu diputuskan. Periksa tab "Tautan otomatis" bila ingin memastikan.</Empty>)}
      {tab === 'tanpa-nip' && <>
        <Note>Pegawai ini hanya muncul di sumber Kanwil (nomor mesin/nama) dan tidak cocok dengan pengguna aplikasi HP. Mereka tetap direkap, tetapi daftar nominatif uang makan membutuhkan NIP. Gabungkan bila ternyata orang yang sama, atau lengkapi NIP lewat Data Pegawai atau Impor massal.</Note>
        {noNip.length ? <div className="id-list">{noNip.map(i => <IdentityRow key={i.key} item={i} toast={toast} decided={decisionKeys.has(i.key)} absensi />)}</div> : <Empty icon={Check} title="Semua pegawai di absensi sudah punya NIP atau sudah diputuskan" />}
      </>}
      {tab === 'otomatis' && <>
        <p className="count-line">Diurutkan dari skor terendah. Periksa baris teratas lebih dulu.</p>
        {auto.length ? <div className="id-list compact">{auto.slice(0, 200).map(i => <IdentityRow key={`${i.key}-${i.context}`} item={i} toast={toast} decided={decisionKeys.has(i.key)} compact />)}</div> : <Empty icon={Search} title="Belum ada tautan otomatis">Tautan muncul setelah nama di sumber berhasil dicocokkan ke pegawai.</Empty>}
      </>}
    </Panel>
  </div>
}

function IdentityRow({ item, toast, decided, compact, absensi }: { item: IdentityItem; toast: (m: string) => void; decided: boolean; compact?: boolean; absensi?: boolean }) {
  const hr = useHr()
  const [search, setSearch] = useState(false)
  const linked = item.employeeId ? hr.roster.byId.get(item.employeeId) : undefined
  const pick = (id: string | null) => {
    if (absensi && id && item.employeeId) { hr.decide(mergeKey(item.employeeId), id); toast(`"${item.name}" digabung`) }
    else { hr.decide(item.key, id); toast(id ? `"${item.name}" ditautkan` : `"${item.name}" diabaikan`) }
    setSearch(false)
  }
  return <div className={`id-row ${item.status}`}>
    <div className="id-name">
      <strong>"{item.name}"</strong>
      <small>{item.office} · {item.context === 'surat-tugas' ? `${item.occurrences} penugasan` : `${item.occurrences} hari absensi`} · {item.sampleRefs[0]}</small>
    </div>
    {compact || (item.status === 'linked' && !absensi) ? <div className="id-linked">
      <ArrowRight size={14} />
      {linked ? <div><strong>{linked.nama}</strong><small>{linked.nip || 'tanpa NIP'} · {linked.kantor}{item.score ? ` · skor ${Math.round(item.score * 100)}` : ''}{item.method === 'manual' ? ' · keputusan HR' : ''}{item.reason ? ` · otomatis: ${item.reason}` : ''}</small></div> : <span className="muted">{item.status === 'ignored' ? 'Diabaikan (bukan pegawai)' : '—'}</span>}
      {decided ? <button className="icon-btn" title="Batalkan keputusan" aria-label="Batalkan keputusan" onClick={() => hr.undoDecision(item.key)}><Undo2 size={14} /></button> : <button className="icon-btn" title="Ganti tautan" aria-label="Ganti tautan" onClick={() => setSearch(s => !s)}><Search size={14} /></button>}
    </div> : <div className="id-cands">
      {item.status === 'unmatched' && item.candidates.length > 0 && <small className="cand-hint">Tidak ada nama yang cocok. Usulan dari absensi:</small>}
      {item.candidates.slice(0, 3).map(c => {
        const e = hr.roster.byId.get(c.employeeId)
        return e && <button key={c.employeeId} className="cand" onClick={() => pick(c.employeeId)}>
          <span className="score">{Math.round(c.score * 100)}</span>
          <span><strong>{e.nama}</strong><small>{e.nip ? `NIP …${e.nip.slice(-6)}` : 'tanpa NIP'} · {e.kantor}{e.unit ? ` · ${e.unit.replace(/ - Sekretaris Jenderal$/, '')}` : ''}</small>{c.hint && <small className="cand-hint">{c.hint}</small>}</span>
        </button>
      })}
      <button className="cand ghost" onClick={() => setSearch(s => !s)}><Search size={13} /> Cari lain</button>
      {absensi ? <button className="cand ghost" onClick={() => { hr.decide(`konfirmasi|${item.key}`, item.employeeId ?? null); toast('Ditetapkan sebagai pegawai tersendiri') }}><UserPlus size={13} /> Pegawai tersendiri</button>
        : <button className="cand ghost" onClick={() => pick(null)}><X size={13} /> Bukan pegawai / abaikan</button>}
    </div>}
    {search && <EmployeePicker onPick={id => pick(id)} initial={item.name.split(/\s+/)[0]} />}
  </div>
}

function EmployeePicker({ onPick, initial }: { onPick: (id: string) => void; initial: string }) {
  const hr = useHr()
  const [q, setQ] = useState(initial)
  const results = useMemo(() => hr.roster.employees.filter(e => `${e.nama} ${e.nip} ${e.aliases.map(a => a.value).join(' ')}`.toLowerCase().includes(q.toLowerCase())).slice(0, 8), [q, hr.roster.employees])
  return <div className="picker">
    <label className="search"><Fingerprint size={14} /><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Ketik nama atau NIP…" /></label>
    <div>{results.map(e => <button key={e.id} onClick={() => onPick(e.id)}><strong>{e.nama}</strong><small>{e.nip || 'tanpa NIP'} · {e.kantor}</small></button>)}{!results.length && <p className="muted small">Tidak ada pegawai yang cocok. Coba nama depan atau NIP.</p>}</div>
  </div>
}
