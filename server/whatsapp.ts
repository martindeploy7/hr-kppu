import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import makeWASocket, { Browsers, BufferJSON, DisconnectReason, initAuthCreds, proto, type AuthenticationState, type SignalDataSet, type SignalDataTypeMap, type SignalKeyStore } from '@whiskeysockets/baileys'
import pino from 'pino'
import { eq } from 'drizzle-orm'
import type { Database } from './db.ts'
import { whatsappAuthState } from './schema.ts'
import type { WhatsAppStatus } from '../shared/whatsapp.ts'

type StoredAuth = { creds: AuthenticationState['creds']; keys: Record<string, Record<string, unknown>> }

export interface WhatsAppConnector {
  status(): WhatsAppStatus
  connect(): Promise<void>
  disconnect(): Promise<void>
  close(): Promise<void>
}

const sessionId = 'primary'
const stateKey = (configured: string | undefined): Buffer | undefined => {
  if (!configured?.trim()) return undefined
  const key = Buffer.from(configured.trim(), 'base64')
  if (key.length !== 32 || key.toString('base64') !== configured.trim()) throw new Error('WHATSAPP_SESSION_ENCRYPTION_KEY harus berupa Base64 dari tepat 32 byte')
  return key
}

export function encryptWhatsAppState(value: string, key: Buffer): Buffer {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), ciphertext])
}

export function decryptWhatsAppState(payload: Buffer, key: Buffer): string {
  if (payload.length < 29 || payload[0] !== 1) throw new Error('Format sesi WhatsApp tidak valid')
  const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(1, 13))
  decipher.setAuthTag(payload.subarray(13, 29))
  return Buffer.concat([decipher.update(payload.subarray(29)), decipher.final()]).toString('utf8')
}

export class WhatsAppService implements WhatsAppConnector {
  private readonly encryptionKey: Buffer | undefined
  private current: WhatsAppStatus
  private socket: ReturnType<typeof makeWASocket> | undefined
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private persistenceQueue: Promise<void> = Promise.resolve()
  private stopping = false
  private opening = false

  constructor(private readonly db: Database, encryptionSecret = process.env.WHATSAPP_SESSION_ENCRYPTION_KEY) {
    try {
      this.encryptionKey = stateKey(encryptionSecret)
      this.current = this.encryptionKey
        ? { configured: true, status: 'disconnected' }
        : { configured: false, status: 'not_configured', message: 'Atur WHATSAPP_SESSION_ENCRYPTION_KEY di environment server untuk mengaktifkan login.' }
    } catch {
      this.encryptionKey = undefined
      this.current = { configured: false, status: 'not_configured', message: 'WHATSAPP_SESSION_ENCRYPTION_KEY tidak valid. Isi dengan Base64 dari tepat 32 byte.' }
    }
  }

  status(): WhatsAppStatus { return { ...this.current } }

  async restore(): Promise<void> {
    if (!this.encryptionKey) return
    try {
      const [saved] = await this.db.select({ encryptedState: whatsappAuthState.encryptedState }).from(whatsappAuthState).where(eq(whatsappAuthState.id, sessionId))
      if (!saved) return
      const state = this.decrypt(saved.encryptedState)
      await this.openSocket(state)
    } catch {
      this.current = { configured: true, status: 'error', message: 'Sesi tersimpan tidak dapat dipulihkan. Periksa kunci enkripsi atau reset sesi untuk login ulang.' }
    }
  }

  async connect(): Promise<void> {
    if (!this.encryptionKey) throw new Error(this.current.message ?? 'Konfigurasi WhatsApp belum lengkap.')
    if (this.socket || this.current.status === 'connected' || this.current.status === 'connecting' || this.current.status === 'qr' || this.current.status === 'reconnecting') return
    this.stopping = false
    let saved: { encryptedState: Buffer } | undefined
    try { [saved] = await this.db.select({ encryptedState: whatsappAuthState.encryptedState }).from(whatsappAuthState).where(eq(whatsappAuthState.id, sessionId)) }
    catch { throw new Error('Penyimpanan sesi WhatsApp tidak tersedia. Periksa koneksi database.') }
    let state: StoredAuth | undefined
    try { state = saved ? this.decrypt(saved.encryptedState) : undefined }
    catch {
      this.current = { configured: true, status: 'error', message: 'Sesi tersimpan tidak dapat dibuka. Periksa kunci enkripsi atau hapus sesi untuk login ulang.' }
      throw new Error(this.current.message)
    }
    await this.openSocket(state)
  }

  async disconnect(): Promise<void> {
    this.stopping = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    const socket = this.socket
    this.socket = undefined
    if (socket) {
      let timeout: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          socket.logout(),
          new Promise<void>(resolve => { timeout = setTimeout(() => { socket.end(undefined); resolve() }, 5000) }),
        ])
      } catch { socket.end(undefined) }
      finally { if (timeout) clearTimeout(timeout) }
    }
    await this.persistenceQueue.catch(() => undefined)
    await this.db.delete(whatsappAuthState).where(eq(whatsappAuthState.id, sessionId))
    this.current = this.encryptionKey
      ? { configured: true, status: 'disconnected', message: 'Sesi dihapus. Hubungkan kembali untuk menampilkan QR baru.' }
      : this.current
  }

  async close(): Promise<void> {
    this.stopping = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.socket?.end(undefined)
    this.socket = undefined
    await this.persistenceQueue.catch(() => undefined)
  }

  private encrypt(value: string): Buffer {
    if (!this.encryptionKey) throw new Error('Kunci enkripsi sesi WhatsApp belum tersedia')
    return encryptWhatsAppState(value, this.encryptionKey)
  }

  private decrypt(payload: Buffer): StoredAuth {
    if (!this.encryptionKey) throw new Error('Kunci enkripsi sesi WhatsApp belum tersedia')
    const cleartext = decryptWhatsAppState(payload, this.encryptionKey)
    const parsed = JSON.parse(cleartext, BufferJSON.reviver) as StoredAuth
    if (!parsed?.creds || !parsed?.keys || typeof parsed.keys !== 'object') throw new Error('Isi sesi WhatsApp tidak valid')
    return parsed
  }

  private persist(state: StoredAuth): Promise<void> {
    const save = this.persistenceQueue.then(async () => {
      const encryptedState = this.encrypt(JSON.stringify(state, BufferJSON.replacer))
      await this.db.insert(whatsappAuthState).values({ id: sessionId, encryptedState, updatedAt: new Date() }).onConflictDoUpdate({
        target: whatsappAuthState.id,
        set: { encryptedState, updatedAt: new Date() },
      })
    })
    this.persistenceQueue = save.catch(() => undefined)
    return save
  }

  private async openSocket(saved?: StoredAuth): Promise<void> {
    if (this.opening) return
    this.opening = true
    this.stopping = false
    this.current = { configured: true, status: 'connecting', message: 'Menghubungkan ke WhatsApp…' }
    const auth = saved ?? { creds: initAuthCreds(), keys: {} }
    const keys: SignalKeyStore = {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const result: Record<string, SignalDataTypeMap[T]> = {}
        for (const id of ids) {
          let value = auth.keys[type]?.[id]
          if (type === 'app-state-sync-key' && value) value = proto.Message.AppStateSyncKeyData.fromObject(value as proto.Message.IAppStateSyncKeyData)
          if (value !== undefined && value !== null) result[id] = value as SignalDataTypeMap[T]
        }
        return result
      },
      set: async (data: SignalDataSet) => {
        if (this.stopping) return
        for (const [category, entries] of Object.entries(data)) {
          if (!entries) continue
          auth.keys[category] ??= {}
          for (const [id, value] of Object.entries(entries)) {
            if (value == null) delete auth.keys[category][id]
            else auth.keys[category][id] = value
          }
        }
        try { await this.persist(auth) }
        catch {
          this.current = { configured: true, status: 'error', message: 'Sesi tidak dapat disimpan dengan aman. Periksa koneksi database.' }
        }
      },
    }
    const state: AuthenticationState = { creds: auth.creds, keys }
    try {
      const socket = makeWASocket({
        auth: state,
        browser: Browsers.ubuntu('KPPU HR'),
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        syncFullHistory: false,
        markOnlineOnConnect: false,
      })
      this.socket = socket
      socket.ev.on('creds.update', () => {
        if (this.stopping) return
        void this.persist(auth).catch(() => {
          this.current = { configured: true, status: 'error', message: 'Sesi WhatsApp tidak tersimpan. Periksa koneksi database.' }
        })
      })
      socket.ev.on('connection.update', update => {
        if (update.qr) this.current = { configured: true, status: 'qr', qr: update.qr, message: 'Pindai QR dari WhatsApp di ponsel admin.' }
        if (update.connection === 'open') {
          const phoneNumber = socket.user?.id?.split(':')[0]?.split('@')[0]
          this.current = { configured: true, status: 'connected', phoneNumber, connectedAt: new Date().toISOString(), message: 'WhatsApp berhasil terhubung.' }
        }
        if (update.connection === 'close') {
          if (this.socket === socket) this.socket = undefined
          if (this.stopping) return
          const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode
          if (code === DisconnectReason.loggedOut) {
            this.current = { configured: true, status: 'logged_out', message: 'Sesi keluar dari WhatsApp. Hubungkan ulang untuk login.' }
            void this.db.delete(whatsappAuthState).where(eq(whatsappAuthState.id, sessionId)).catch(() => undefined)
          } else this.scheduleReconnect()
        }
      })
    } catch {
      this.current = { configured: true, status: 'error', message: 'Koneksi WhatsApp gagal dimulai. Coba ulang beberapa saat lagi.' }
    } finally {
      this.opening = false
    }
  }

  private scheduleReconnect(): void {
    if (this.stopping || this.reconnectTimer) return
    this.current = { configured: true, status: 'reconnecting', message: 'Koneksi terputus; mencoba menyambung kembali…' }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.current = { configured: true, status: 'disconnected' }
      void this.connect().catch(() => {
        this.current = { configured: true, status: 'error', message: 'Koneksi ulang gagal. Coba hubungkan kembali dari halaman ini.' }
      })
    }, 3000)
  }
}
