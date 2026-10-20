import { describe, expect, test } from 'vitest'
import { decryptWhatsAppState, encryptWhatsAppState } from '../server/whatsapp.ts'

describe('WhatsApp session encryption', () => {
  test('encrypts the session payload and authenticates it against tampering or a wrong key', () => {
    const key = Buffer.alloc(32, 42)
    const payload = encryptWhatsAppState('private-device-credentials', key)
    expect(payload.includes(Buffer.from('private-device-credentials'))).toBe(false)
    expect(decryptWhatsAppState(payload, key)).toBe('private-device-credentials')
    const tampered = Buffer.from(payload)
    tampered[tampered.length - 1] ^= 1
    expect(() => decryptWhatsAppState(tampered, key)).toThrow()
    expect(() => decryptWhatsAppState(payload, Buffer.alloc(32, 24))).toThrow()
  })
})
