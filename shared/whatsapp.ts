export type WhatsAppStatusName = 'not_configured' | 'disconnected' | 'connecting' | 'qr' | 'connected' | 'reconnecting' | 'logged_out' | 'error'
export type WhatsAppStatus = {
  configured: boolean
  status: WhatsAppStatusName
  qr?: string
  phoneNumber?: string
  connectedAt?: string
  message?: string
}
