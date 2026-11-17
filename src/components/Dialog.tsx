import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, useCallback, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Pengganti window.prompt / window.confirm: dialog modal dalam aplikasi.
 * Label dan pesan terbaca pembaca layar, validasi panjang minimum tampil di tempat, Escape menutup,
 * fokus terkunci di dalam dialog lalu dikembalikan ke pemicu. Dipakai lewat useDialog().confirm / .prompt.
 */
type Tone = 'primary' | 'danger'
export type ConfirmOptions = { title: string; message?: ReactNode; confirmLabel?: string; cancelLabel?: string; tone?: Tone }
export type PromptOptions = ConfirmOptions & { label: string; minLength?: number; maxLength?: number; placeholder?: string }
type Api = { confirm: (options: ConfirmOptions) => Promise<boolean>; prompt: (options: PromptOptions) => Promise<string | null> }
type Request = { kind: 'confirm'; options: ConfirmOptions; opener: HTMLElement | null; settle: (value: boolean) => void }
  | { kind: 'prompt'; options: PromptOptions; opener: HTMLElement | null; settle: (value: string | null) => void }

const DialogContext = createContext<Api | null>(null)
export function useDialog(): Api { const api = useContext(DialogContext); if (!api) throw new Error('useDialog outside DialogProvider'); return api }

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([])
  const enqueue = useCallback((make: (opener: HTMLElement | null) => Request) => {
    const active = document.activeElement
    const opener = active instanceof HTMLElement && active !== document.body ? active : null
    setQueue(items => [...items, make(opener)])
  }, [])
  const api = useMemo<Api>(() => ({
    confirm: options => new Promise<boolean>(resolve => enqueue(opener => ({ kind: 'confirm', options, opener, settle: resolve }))),
    prompt: options => new Promise<string | null>(resolve => enqueue(opener => ({ kind: 'prompt', options, opener, settle: resolve }))),
  }), [enqueue])
  const current = queue[0]
  const close = (value: boolean | string | null) => {
    if (!current) return
    if (current.kind === 'confirm') current.settle(value === true)
    else current.settle(typeof value === 'string' ? value : null)
    setQueue(items => items.slice(1))
  }
  return <DialogContext.Provider value={api}>
    {children}
    {current && createPortal(<DialogView key={queue.length + (current.options.title)} request={current} onClose={close} />, document.body)}
  </DialogContext.Provider>
}

function DialogView({ request, onClose }: { request: Request; onClose: (value: boolean | string | null) => void }) {
  const { options } = request
  const panel = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const cancelButton = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const [text, setText] = useState('')
  const [touched, setTouched] = useState(false)
  const id = useId()
  const isPrompt = request.kind === 'prompt'
  const minLength = isPrompt ? (request.options as PromptOptions).minLength ?? 1 : 0
  const missing = isPrompt ? Math.max(0, minLength - text.trim().length) : 0
  const tone = options.tone ?? 'primary'

  useEffect(() => {
    // Latar dikunci selama dialog terbuka: tidak bisa difokus atau dibaca pembaca layar.
    const app = document.getElementById('root')
    app?.setAttribute('inert', '')
    ;(isPrompt ? field.current : tone === 'danger' ? cancelButton.current : confirmButton.current)?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeRef.current(isPrompt ? null : false); return }
      if (e.key !== 'Tab') return
      const el = panel.current
      if (!el) return
      e.stopPropagation()
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)]
      if (!items.length) { e.preventDefault(); return }
      const first = items[0], last = items[items.length - 1], active = document.activeElement
      if (e.shiftKey && (active === first || !el.contains(active))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (active === last || !el.contains(active))) { e.preventDefault(); first.focus() }
    }
    // Fase capture agar Escape/Tab tidak ikut diproses drawer di belakang dialog.
    document.addEventListener('keydown', onKey, true)
    const opener = request.opener
    return () => {
      document.removeEventListener('keydown', onKey, true)
      app?.removeAttribute('inert')
      if (opener?.isConnected) opener.focus({ preventScroll: true })
    }
  }, [isPrompt, tone, request.opener])

  const submit = () => {
    if (isPrompt) {
      if (missing > 0) { setTouched(true); field.current?.focus(); return }
      onClose(text.trim())
    } else onClose(true)
  }
  const showError = isPrompt && touched && missing > 0
  const promptOptions = isPrompt ? request.options as PromptOptions : undefined

  return <div className="dlg-scrim" onMouseDown={e => { if (e.target === e.currentTarget) onClose(isPrompt ? null : false) }}>
    <div ref={panel} className="dlg" role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} aria-describedby={options.message ? `${id}-m` : undefined}>
      <h2 id={`${id}-t`}>{options.title}</h2>
      {options.message && <div id={`${id}-m`} className="dlg-message">{options.message}</div>}
      {promptOptions && <div className="dlg-field">
        <label htmlFor={`${id}-f`}>{promptOptions.label}</label>
        <textarea id={`${id}-f`} ref={field} rows={3} value={text} maxLength={promptOptions.maxLength ?? 2000} placeholder={promptOptions.placeholder}
          aria-invalid={showError} aria-describedby={`${id}-h`}
          onChange={e => setText(e.target.value)} onBlur={() => { if (text) setTouched(true) }}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }} />
        <p id={`${id}-h`} className={`dlg-hint ${showError ? 'is-error' : ''}`} role={showError ? 'alert' : undefined}>
          {showError ? `Tulis minimal ${minLength} karakter. Kurang ${missing} karakter lagi.` : minLength > 1 ? `Minimal ${minLength} karakter. Ctrl atau Cmd + Enter untuk menyimpan.` : 'Ctrl atau Cmd + Enter untuk menyimpan.'}
          {minLength > 1 && <span className="dlg-count">{Math.min(text.trim().length, minLength)}/{minLength}</span>}
        </p>
      </div>}
      <div className="dlg-actions">
        <button ref={cancelButton} type="button" className="btn secondary" onClick={() => onClose(isPrompt ? null : false)}>{options.cancelLabel ?? 'Batal'}</button>
        <button ref={confirmButton} type="button" className={`btn ${tone === 'danger' ? 'danger solid' : 'primary'}`} onClick={submit}>{options.confirmLabel ?? 'Lanjutkan'}</button>
      </div>
    </div>
  </div>
}
