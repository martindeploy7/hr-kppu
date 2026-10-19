import EmbeddedPostgres from 'embedded-postgres'
import { existsSync } from 'node:fs'
const pg = new EmbeddedPostgres({ databaseDir: '.devdata/postgres', user: 'kppu', password: 'kppu-local', port: 5544, persistent: true, onLog: () => {}, onError: message => { if (!String(message).includes('NOTICE')) console.error(String(message)) } })
if (!existsSync('.devdata/postgres/PG_VERSION')) await pg.initialise()
await pg.start()
try { await pg.createDatabase('kppu') } catch (e) { if (!String(e).includes('already exists')) throw e }
console.log('Local PostgreSQL ready on 127.0.0.1:5544')
let stopping = false
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => { if (stopping) return; stopping = true; await pg.stop(); process.exit(0) })
await new Promise(() => {})
