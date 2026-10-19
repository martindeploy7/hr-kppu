import { defineConfig } from 'tsup'
export default defineConfig({ entry: ['server/index.ts', 'server/migrate.ts', 'server/create-user.ts'], format: ['esm'], target: 'node22', outDir: 'dist-server', clean: true, sourcemap: true })
