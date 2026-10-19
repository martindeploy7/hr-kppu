import { beforeAll, afterAll, describe, test, expect } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { connect } from '../server/db.ts'
import { migrateDatabase } from '../server/migrate.ts'
import { createApp } from '../server/app.ts'
import { createUser } from '../server/create-user.ts'
import { eachDay, isWeekend } from '../src/engine/dates.ts'
import { emptyWorkspace } from '../shared/workspace.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import { blankEmployee } from '../src/engine/roster.ts'
import { users, auditEvents } from '../server/schema.ts'
import * as XLSX from 'xlsx'
const URL = process.env.TEST_DATABASE_URL ?? 'postgres://kppu:kppu-local@127.0.0.1:5544/kppu_test'
const parsed = new globalThis.URL(URL)
if (!parsed.pathname.endsWith('_test') || !['localhost','127.0.0.1'].includes(parsed.hostname)) throw new Error('Integration tests require a local database ending in _test')
const connection=connect(URL), app=createApp(connection.db,{origin:'http://kppu.test',production:false})
const password=randomBytes(24).toString('hex'), cookies:Record<string,string>={}
const request=(path:string,method='GET',body?:unknown,role='admin',origin='http://kppu.test')=>app.request(`http://kppu.test/api${path}`,{method,headers:{origin,cookie:cookies[role]??'','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)})
const workspace=async()=>await (await request('/workspace')).json()
beforeAll(async()=>{
 const base=postgres('postgres://kppu:kppu-local@127.0.0.1:5544/postgres')
 try{const exists=await base`select 1 from pg_database where datname='kppu_test'`;if(!exists.length)await base.unsafe('create database kppu_test')}finally{await base.end()}
 await migrateDatabase(URL)
 await connection.sql.unsafe('TRUNCATE hr_internal.audit_events, hr_internal.sessions, hr_internal.uploads, hr_internal.users, hr_internal.workspaces, hr_internal.login_attempts CASCADE')
 for(const role of ['admin','hr','reviewer','finance','viewer'] as const){await createUser(connection.db,`${role}@kppu.test`,`${role} Test`,password,role);const response=await request('/auth/login','POST',{email:`${role}@kppu.test`,password});expect(response.status).toBe(200);cookies[role]=response.headers.get('set-cookie')!.split(';')[0]}
})
afterAll(async()=>{await connection.sql.end()})
describe('Authenticated PostgreSQL API',()=>{
 test('public API cannot read personnel data',async()=>{const r=await app.request('http://kppu.test/api/workspace');expect(r.status).toBe(401)})
 test('CSRF/foreign origin rejected even with session',async()=>{const w=await workspace();expect((await request('/workspace','PUT',{expectedRevision:w.revision,patch:{},reason:'attempt'},'admin','https://other.test')).status).toBe(403)})
 test('viewer and reviewer cannot edit master, HR cannot approve policy',async()=>{const w=await workspace();for(const role of ['viewer','reviewer'])expect((await request('/workspace','PUT',{expectedRevision:w.revision,patch:{master:[]},reason:'test role'},role)).status).toBe(403);expect((await request('/workspace','PUT',{expectedRevision:w.revision,patch:{policy:w.state.policy},reason:'test role'},'hr')).status).toBe(403)})
 test('invalid values rejected server-side',async()=>{const w=await workspace();expect((await request('/workspace','PUT',{expectedRevision:w.revision,patch:{master:[{nama:'Only name'}]},reason:'invalid data'})).status).toBe(400)})
 test('CAS transaction prevents second admin overwrite',async()=>{const w=await workspace(),body={expectedRevision:w.revision,patch:{master:[{...blankEmployee('person-test'),nama:'Pegawai Uji',nip:'198001012020011001',kantor:'Pusat'}]},reason:'Master sintetis'};const replies=await Promise.all([request('/workspace','PUT',body),request('/workspace','PUT',body)]);expect(replies.map(r=>r.status).sort()).toEqual([200,409]);const next=await workspace();expect(next.revision).toBe(w.revision+1);expect(next.state.master).toHaveLength(1)})
 test('direct API master edits reject duplicate identifiers and invalid fields atomically',async()=>{
  const w=await workspace(),person=w.state.master[0]
  const duplicate=await request('/workspace','PUT',{expectedRevision:w.revision,patch:{master:[person,{...person,id:'duplicate-person'}]},reason:'Duplicate batch must fail'})
  expect(duplicate.status).toBe(400)
  const invalid=await request('/workspace','PUT',{expectedRevision:w.revision,patch:{overrides:{[person.id]:{tanggalLahir:'2026-02-30',email:'bad-address'}}},reason:'Invalid override must fail'})
  expect(invalid.status).toBe(400);expect((await invalid.json()).error).toContain('tanggal')
  expect((await workspace()).revision).toBe(w.revision);expect((await workspace()).state.master).toHaveLength(1)
 })
 test('legacy policy cannot bypass mandatory rules',async()=>{const w=await workspace();const r=await request('/workspace','PUT',{expectedRevision:w.revision,patch:{policy:{...w.state.policy,requireComplete:false,requireOnTime:false,lateToleranceMin:15,countLocalDuty:true}},reason:'Legacy migration'});expect(r.status).toBe(200);const next=await r.json();expect(next.state.policy).toMatchObject({requireComplete:true,requireOnTime:true,lateToleranceMin:0,countLocalDuty:false})})
 test('preview does not commit, identical hash and renamed file are idempotent',async()=>{
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['NIK','Nama','Tanggal','Scan Masuk','Scan Pulang'],['198001012020011001','Pegawai Uji','15/10/2026','08:00','16:00']]),'Sheet1')
  const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}), form=new FormData();form.set('file',new File([bytes],'test.xlsx'));const before=await workspace()
  const response=await app.request('http://kppu.test/api/imports/preview',{method:'POST',headers:{origin:'http://kppu.test',cookie:cookies.admin},body:form});expect(response.status).toBe(200);const p=await response.json();expect((await workspace()).revision).toBe(before.revision)
  const commit=await request('/imports/commit','POST',{uploadId:p.file.id,expectedRevision:before.revision,office:'Pusat',reason:'Confirm source'});expect(commit.status).toBe(200)
  const next=await workspace();expect(next.state.files).toHaveLength(1)
  const renamed=new FormData();renamed.set('file',new File([bytes],'different-name.xlsx'));const duplicate=await app.request('http://kppu.test/api/imports/preview',{method:'POST',headers:{origin:'http://kppu.test',cookie:cookies.admin},body:renamed});expect((await duplicate.json()).duplicate).toBe(true);expect((await workspace()).state.files).toHaveLength(1)
 })
 test('same filename revision is staged, scoped replacement preserves archive, retry commit is idempotent',async()=>{
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['NIK','Nama','Tanggal','Scan Masuk','Scan Pulang'],['198001012020011001','Pegawai Uji','15/10/2026','09:00','16:00']]),'Sheet1')
  const form=new FormData();form.set('file',new File([XLSX.write(wb,{type:'buffer',bookType:'xlsx'})],'test.xlsx'))
  const before=await workspace(),old=before.state.files.find((f:any)=>f.active!==false)
  const preview=await app.request('http://kppu.test/api/imports/preview',{method:'POST',headers:{origin:'http://kppu.test',cookie:cookies.admin},body:form});expect(preview.status).toBe(200);const file=(await preview.json()).file
  expect((await workspace()).state.files.filter((f:any)=>f.active!==false)).toHaveLength(1)
  const body={uploadId:file.id,expectedRevision:before.revision,office:'Pusat',replaces:old.id,reason:'Explicit replacement test'}
  const commit=await request('/imports/commit','POST',body);expect(commit.status).toBe(200)
  expect((await request('/imports/commit','POST',body)).status).toBe(200)
  const next=await workspace();expect(next.state.files).toHaveLength(2);expect(next.state.files.filter((f:any)=>f.active!==false)).toHaveLength(1);expect(next.state.files.find((f:any)=>f.id===file.id).revision).toBe(2)
  const result=(await (await request('/calculations/2026-10')).json()).calculation;expect(result.months[0].days.find((d:any)=>d.date==='2026-10-15').clockIn).toBe('09:00')
  await expect(connection.sql.unsafe("UPDATE hr_internal.uploads SET hash='tampered'")).rejects.toThrow('immutable')
 })
 test('actor attributed by session; audit and calculation backed by database',async()=>{const result=await (await request('/calculations/2026-10')).json();expect(result.calculation.months[0].employee.nama).toBe('Pegawai Uji');const events=await connection.db.select().from(auditEvents);const accounts=await connection.db.select().from(users);expect(events.length).toBeGreaterThanOrEqual(3);expect(events.every(e=>accounts.some(a=>a.id===e.actorId))).toBe(true)})
 test('restore rejects incompatible input and preserves previous server state',async()=>{
  const before=await workspace();expect((await request('/backup/preview','POST',{state:{version:99}})).status).toBe(400);expect((await workspace()).revision).toBe(before.revision)
  const r=await request('/backup/restore','POST',{expectedRevision:before.revision,state:before.state,reason:'Restore test backup'});expect(r.status).toBe(200)
  const records=await connection.db.select().from(auditEvents);const restore=records.find(e=>e.action==='workspace.restore')!;expect((restore.details as any).restorePoint).toBeDefined()
  expect((await request(`/backup/restore-points/${restore.id}`)).status).toBe(200)
 })
 test('audit events cannot be edited at database layer',async()=>{
  await expect(connection.sql.unsafe("UPDATE hr_internal.audit_events SET reason='tampered'")).rejects.toThrow('append-only')
 })
 test('complete period submits once, requires another finance actor, freezes snapshot and exports matching totals',async()=>{
  const before=await workspace(),state=emptyWorkspace(),person={...blankEmployee('snapshot-person'),nama:'Snapshot Uji',nip:'198001012020011001',kantor:'Pusat',statusKepegawaian:'PNS' as const,golongan:'III/a'}
  state.master=[person];state.policy={...DEFAULT_POLICY,parametersApproved:true,holidays:[]}
  const evidence=eachDay('2026-09-01','2026-09-30').filter(d=>!isWeekend(d)).map(date=>({id:`e-${date}`,fileId:'synthetic-attendance',kind:'mesin' as const,office:'Pusat',name:person.nama,ids:{nip:person.nip},date,clockIn:'08:00',clockOut:new Date(`${date}T00:00:00Z`).getUTCDay()===5?'16:30':'16:00',ref:`synthetic ${date}`}))
  state.files=[{id:'synthetic-attendance',fileName:'Synthetic fixture',kind:'mesin',label:'Synthetic',office:'Pusat',importedAt:'2026-10-19T00:00:00Z',period:{start:'2026-09-01',end:'2026-09-30'},completeThrough:'2026-09-30',evidence,assignments:[],warnings:[],stats:{rows:evidence.length,people:1}}]
  expect((await request('/backup/restore','POST',{expectedRevision:before.revision,state,reason:'Synthetic complete September fixture'})).status).toBe(200)
  let current=await workspace();expect((await request('/coverage/nil-st','POST',{expectedRevision:current.revision,office:'Pusat',period:'2026-09',basis:'Synthetic nil statement confirmed by HR test'})).status).toBe(200)
  current=await workspace();const id=randomUUID(),body={id,period:'2026-09',office:'Pusat',expectedRevision:current.revision}
  const submit=await request('/meal-submissions','POST',body);expect(submit.status).toBe(200);const s=(await submit.json()).submission;expect(s.snapshot.months[0]).toMatchObject({mealDays:22,bruto:814000,pph:40700,netto:773300})
  expect((await request('/meal-submissions','POST',body)).status).toBe(200)
  expect((await request('/meal-submissions','POST',{...body,id:randomUUID()})).status).toBe(409)
  expect((await request(`/meal-submissions/${id}/approve`,'POST',{expectedRevision:1,reason:'Self approval rejected'})).status).toBe(403)
  expect((await request(`/meal-submissions/${id}/approve`,'POST',{expectedRevision:1,reason:'Finance verified snapshot'},'finance')).status).toBe(200)
  expect((await request(`/meal-submissions/${id}/lock`,'POST',{expectedRevision:2,reason:'Finance locks verified snapshot'},'finance')).status).toBe(200)
  current=await workspace();expect((await request('/workspace','PUT',{expectedRevision:current.revision,patch:{policy:{...current.state.policy,rates:{I:35000,II:35000,III:40000,IV:41000}}},reason:'Later rate revision'})).status).toBe(200)
  const fixed=(await (await request(`/meal-submissions/${id}`)).json()).submission;expect(fixed.snapshot.months[0].netto).toBe(773300)
  expect((await request(`/meal-submissions/${id}/cancel`,'POST',{expectedRevision:3,reason:'Locked cancel rejected'})).status).toBe(409)
  const exported=await request(`/meal-submissions/${id}/export`);expect(exported.status).toBe(200);const wb=XLSX.read(await exported.arrayBuffer());const rows=XLSX.utils.sheet_to_json(wb.Sheets.Nominatif,{header:1}) as unknown[][];expect(rows[3][1]).toBe(person.nip);expect(rows[3][8]).toBe(773300)
  await expect(connection.sql.unsafe("UPDATE hr_internal.meal_submissions SET checksum='changed'")).rejects.toThrow('immutable')
 })
 test('office-scoped account cannot read, edit or submit another office',async()=>{
  const before=await workspace(),p={...blankEmployee('other-office-person'),nama:'Kanwil I Uji',nip:'199001012020011001',kantor:'Kanwil I'}
  expect((await request('/workspace','PUT',{expectedRevision:before.revision,patch:{master:[...before.state.master,p]},reason:'Additional office test'})).status).toBe(200)
  await createUser(connection.db,'office-one@kppu.test','Office One',password,'hr',['Kanwil I'])
  const login=await request('/auth/login','POST',{email:'office-one@kppu.test',password});cookies.officeOne=login.headers.get('set-cookie')!.split(';')[0]
  const scoped=await (await request('/workspace','GET',undefined,'officeOne')).json();expect(scoped.state.master.map((e:any)=>e.id)).toEqual(['other-office-person']);expect(scoped.state.files).toHaveLength(0)
  const reject=await request('/workspace','PUT',{expectedRevision:scoped.revision,patch:{overrides:{'snapshot-person':{nama:'Unauthorized'}}},reason:'Cross office rejected'},'officeOne');expect(reject.status).toBe(403)
  const update=await request('/workspace','PUT',{expectedRevision:scoped.revision,patch:{master:[{...p,jabatan:'Updated own office'}]},reason:'Own office update'},'officeOne');expect(update.status).toBe(200)
  const global=await workspace();expect(global.state.master.some((e:any)=>e.id==='snapshot-person')).toBe(true);expect(global.state.master.find((e:any)=>e.id===p.id).jabatan).toBe('Updated own office')
  expect((await request('/coverage/nil-st','POST',{expectedRevision:global.revision,office:'Pusat',period:'2026-09',basis:'Outside scope test should fail'},'officeOne')).status).toBe(403)
  expect((await request('/meal-submissions','POST',{id:randomUUID(),period:'2026-09',office:'Pusat',expectedRevision:global.revision},'officeOne')).status).toBe(403)
  const hidden=(await (await request('/meal-submissions','GET',undefined,'officeOne')).json()).submissions;expect(hidden).toHaveLength(0)
  const snapshots=(await (await request('/meal-submissions')).json()).submissions
  expect((await request(`/meal-submissions/${snapshots[0].id}`,'GET',undefined,'officeOne')).status).toBe(403)
  expect((await request(`/meal-submissions/${snapshots[0].id}/export`,'GET',undefined,'officeOne')).status).toBe(403)
  const calculation=await (await request('/calculations/2026-09','GET',undefined,'officeOne')).json();expect(calculation.calculation.months.every((m:any)=>m.employee.kantor==='Kanwil I')).toBe(true)
  const backup=await (await request('/backup','GET',undefined,'officeOne')).json();expect(backup.state.master).toHaveLength(1)
 })
 test('password change reauthenticates and revokes other sessions',async()=>{
  const oldCookie=cookies.reviewer
  const login=await request('/auth/login','POST',{email:'reviewer@kppu.test',password});cookies.reviewer=login.headers.get('set-cookie')!.split(';')[0]
  expect((await request('/auth/password','POST',{currentPassword:'incorrect',newPassword:password+'-new'},'reviewer')).status).toBe(401)
  expect((await request('/auth/password','POST',{currentPassword:password,newPassword:password+'-new'},'reviewer')).status).toBe(200)
  expect((await app.request('http://kppu.test/api/auth/me',{headers:{cookie:oldCookie}})).status).toBe(401)
  expect((await request('/auth/me','GET',undefined,'reviewer')).status).toBe(200)
 })
 test('logout revokes session on server',async()=>{expect((await request('/auth/logout','POST',{},'viewer')).status).toBe(200);expect((await request('/workspace','GET',undefined,'viewer')).status).toBe(401)})
})
