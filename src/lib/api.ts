export class ApiError extends Error { constructor(message: string, public status: number) { super(message) } }
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { ...init, credentials: 'same-origin', headers: { ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }), ...init.headers } })
  const body = await response.json().catch(() => ({ error: 'Server belum siap. Coba kembali setelah beberapa saat.' }))
  if (!response.ok) throw new ApiError(body.error ?? 'Permintaan gagal', response.status)
  return body as T
}
export function downloadJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url)
}
