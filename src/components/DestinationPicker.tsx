import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown, X } from 'lucide-react'
import { parseDestination, searchWilayah, type DestinationOption } from '../lib/wilayah.ts'
import './destination-picker.css'

type Props = {
  /** Teks tujuan tersimpan: "Kota Bogor, Jawa Barat", "Jawa Barat", atau teks bebas. */
  value: string
  onChange: (value: string) => void
  /** Dipasang pada kolom isian (combobox atau teks bebas), supaya `<label htmlFor>` berfungsi. */
  id?: string
  disabled?: boolean
  required?: boolean
  maxLength?: number
}

const OTHER_LABEL = 'Lainnya / luar negeri'
const NEED_PICK = 'Pilih tujuan dari daftar, atau pilih "Lainnya / luar negeri" untuk menulis sendiri.'

/**
 * Pemilih tujuan: ketik untuk mencari kabupaten/kota atau provinsi, atau pilih "Lainnya / luar negeri" untuk teks bebas.
 * Nilainya tetap teks biasa. Nilai lama yang tidak ada di daftar otomatis tampil sebagai teks bebas.
 * Jangan dibungkus `<label>`: komponen ini berisi beberapa kontrol. Pakai `<label htmlFor={id}>` atau `aria-labelledby` pada pembungkus.
 */
export function DestinationPicker({ value, onChange, id, disabled, required, maxLength = 250 }: Props) {
  const parsed = useMemo(() => parseDestination(value), [value])
  const listId = useId(), optionId = (i: number) => `${listId}-o${i}`
  const [customMode, setCustomMode] = useState(parsed.kind === 'custom')
  const [query, setQuery] = useState<string | null>(null) // null = tidak sedang mengetik, kolom menampilkan nilai tersimpan
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1) // -1 = belum ada sorotan: Enter tidak diam-diam memilih opsi pertama
  const root = useRef<HTMLDivElement>(null)
  const comboRef = useRef<HTMLInputElement>(null)
  const freeRef = useRef<HTMLInputElement>(null)
  const emitted = useRef(value)
  const focusNext = useRef<'combo' | 'free' | null>(null)

  const options = useMemo(() => open ? searchWilayah(query ?? '') : [], [open, query])
  const rowCount = options.length + 1 // opsi terakhir selalu "Lainnya / luar negeri"

  // Nilai berubah dari luar (mis. form dikosongkan setelah simpan): sesuaikan mode. Perubahan dari kolom ini sendiri diabaikan.
  useEffect(() => {
    if (value === emitted.current) return
    emitted.current = value
    setCustomMode(parseDestination(value).kind === 'custom')
    setQuery(null)
    setOpen(false)
  }, [value])

  const emit = (next: string) => { emitted.current = next; onChange(next) }

  useEffect(() => {
    if (!focusNext.current) return
    ;(focusNext.current === 'combo' ? comboRef : freeRef).current?.focus()
    focusNext.current = null
  }, [customMode])

  // Pesan Indonesia untuk validasi bawaan: kolom berisi ketikan setengah jalan tidak boleh lolos `required`.
  useEffect(() => {
    comboRef.current?.setCustomValidity(required && !value.trim() ? NEED_PICK : '')
  }, [required, value, customMode, query])

  useEffect(() => {
    if (open && active >= 0) document.getElementById(`${listId}-o${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, listId])

  const close = () => { setOpen(false); setQuery(null) }

  const pick = (option: DestinationOption) => { emit(option.value); close() }

  const pickOther = () => {
    const typed = (query ?? '').trim()
    if (typed) emit(typed.slice(0, maxLength))
    else if (parsed.kind !== 'custom') emit('')
    focusNext.current = 'free'
    setCustomMode(true)
    close()
  }

  const backToList = () => {
    if (parsed.kind === 'custom') emit('')
    focusNext.current = 'combo'
    setCustomMode(false)
  }

  const choose = (index: number) => index < options.length ? pick(options[index]) : pickOther()

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) { setOpen(true); setActive(e.key === 'ArrowDown' ? 0 : -1); return }
      setActive(i => e.key === 'ArrowDown' ? (i + 1) % rowCount : i <= 0 ? rowCount - 1 : i - 1)
    } else if (e.key === 'Enter') {
      if (!open) return // daftar tertutup: Enter mengirim form seperti biasa
      if (active < 0) { close(); return } // belum memilih apa pun: tutup daftar, form tetap bisa terkirim
      e.preventDefault()
      choose(Math.min(active, rowCount - 1))
    } else if (e.key === 'Escape') {
      if (!open && query === null) return
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'Home' && open && e.ctrlKey) {
      e.preventDefault(); setActive(0)
    } else if (e.key === 'End' && open && e.ctrlKey) {
      e.preventDefault(); setActive(rowCount - 1)
    }
  }

  if (customMode) {
    return <div className="dest-picker" ref={root}>
      <input ref={freeRef} id={id} type="text" className="dest-picker__input" autoComplete="off" maxLength={maxLength}
        value={value} onChange={e => emit(e.target.value)} disabled={disabled} required={required}
        placeholder="Tulis kota atau negara tujuan" aria-describedby={`${listId}-hint`} />
      <div className="dest-picker__foot">
        <span id={`${listId}-hint`}>Teks bebas, ditulis apa adanya (misalnya kota di luar negeri).</span>
        <button type="button" className="dest-picker__link" onClick={backToList} disabled={disabled}>Pilih dari daftar wilayah</button>
      </div>
    </div>
  }

  const shown = query ?? (parsed.kind === 'regency' || parsed.kind === 'province' ? parsed.value : value)
  const hasValue = value.trim().length > 0
  const noMatch = open && (query ?? '').trim() !== '' && options.length === 0

  return <div className="dest-picker" ref={root}
    onBlur={e => { if (!root.current?.contains(e.relatedTarget as Node | null)) close() }}>
    <div className="dest-picker__field">
      <input ref={comboRef} id={id} type="text" className="dest-picker__input" role="combobox" autoComplete="off" spellCheck={false}
        aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-haspopup="listbox"
        aria-activedescendant={open && active >= 0 ? optionId(Math.min(active, rowCount - 1)) : undefined}
        value={shown} disabled={disabled} required={required} maxLength={maxLength}
        placeholder="Cari kota, kabupaten, atau provinsi"
        onFocus={e => { setOpen(true); setActive(-1); if (query === null) e.currentTarget.select() }}
        onClick={() => { if (!open) { setOpen(true); setActive(-1) } }}
        onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0) }}
        onKeyDown={onKeyDown} />
      {hasValue && !disabled
        ? <button type="button" className="dest-picker__btn" aria-label="Hapus tujuan" onClick={() => { emit(''); close(); comboRef.current?.focus() }}><X size={16} aria-hidden="true" /></button>
        : <span className="dest-picker__chev" aria-hidden="true"><ChevronDown size={16} /></span>}
    </div>
    {open && <ul id={listId} role="listbox" aria-label="Pilihan tujuan" className="dest-picker__list" onMouseDown={e => e.preventDefault()}>
      {options.map((option, i) => <li key={option.code} id={optionId(i)} role="option" aria-selected={i === active} className="dest-picker__opt"
        data-active={i === active || undefined} onMouseMove={() => setActive(i)} onClick={() => pick(option)}>
        {option.type === 'province'
          ? <><strong>{option.primary}</strong><small>Provinsi saja</small></>
          : <><strong>{option.primary}</strong><small>{option.secondary}</small></>}
      </li>)}
      {noMatch && <li role="presentation" className="dest-picker__empty">Tidak ada wilayah yang cocok.</li>}
      <li id={optionId(options.length)} role="option" aria-selected={active === options.length} className="dest-picker__opt dest-picker__other"
        data-active={active === options.length || undefined} onMouseMove={() => setActive(options.length)} onClick={pickOther}>
        <strong>{OTHER_LABEL}</strong><small>{(query ?? '').trim() ? `Tulis sendiri: ${(query ?? '').trim()}` : 'Tulis tujuan sendiri'}</small>
      </li>
    </ul>}
    <span className="dest-picker__sr" role="status" aria-live="polite">{open ? (noMatch ? 'Tidak ada wilayah yang cocok.' : `${options.length} pilihan wilayah tersedia.`) : ''}</span>
  </div>
}
