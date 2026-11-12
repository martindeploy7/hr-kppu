import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const demoRoot = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(demoRoot, '..')

export default defineConfig({
  root: demoRoot,
  plugins: [react()],
  publicDir: resolve(demoRoot, '../public'),
  server: { host: '0.0.0.0', fs: { allow: [repoRoot] } },
  build: {
    outDir: resolve(repoRoot, 'dist-demo'),
    emptyOutDir: true,
    rollupOptions: { output: { manualChunks: (id: string) => id.includes('/xlsx/') ? 'excel' : id.includes('/recharts/') ? 'charts' : undefined } },
  },
})
