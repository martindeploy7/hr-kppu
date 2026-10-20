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
import { groupAssignments } from '../shared/imports.ts'
import { buildRoster } from '../src/engine/roster.ts'
import { sourceRecordState } from '../src/engine/recordReviews.ts'
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
 test('effective status and rate ranges are validated on the server with role-specific edit rights',async()=>{
  const before=await workspace(),state=emptyWorkspace(),person={...blankEmployee('effective-profile'),nama:'Pegawai Periode',nip:'198001012020011099',kantor:'Pusat',statusKepegawaian:'PNS' as const,golongan:'III/a'}
  state.master=[person]
  expect((await request('/backup/restore','POST',{expectedRevision:before.revision,state,reason:'Synthetic effective profile fixture'})).status).toBe(200)
  try {
   let w=await workspace()
   const rateA={start:'2026-10-01',end:'2026-10-15',rate:37000,pph:5,basis:'Keputusan tarif sintetis A'}
   const rateB={start:'2026-10-15',end:'2026-10-31',rate:40000,pph:10,basis:'Keputusan tarif sintetis B'}
   expect((await request('/workspace','PUT',{expectedRevision:w.revision,patch:{overrides:{[person.id]:{rateHistory:[rateA]}}},reason:'Finance adds effective employee rate'},'finance')).status).toBe(200)
   w=await workspace()
   const overlappingRate=await request('/workspace','PUT',{expectedRevision:w.revision,patch:{overrides:{[person.id]:{rateHistory:[rateA,rateB]}}},reason:'Reject overlapping effective rates'},'finance')
   expect(overlappingRate.status).toBe(400);expect((await workspace()).revision).toBe(w.revision)
   expect((await request('/backup/preview','POST',{state:{...w.state,overrides:{[person.id]:{rateHistory:[rateA,rateB]}}}},'admin')).status).toBe(400)

   const overlappingStatus=[{kind:'tugas-belajar' as const,start:'2026-10-05',end:'2026-10-12',basis:'Surat tugas belajar sintetis'},{kind:'diperbantukan' as const,start:'2026-10-12',end:'2026-10-20',basis:'Surat perbantuan sintetis'}]
   const invalidStatus=await request('/workspace','PUT',{expectedRevision:w.revision,patch:{overrides:{[person.id]:{rateHistory:[rateA],workStatusPeriods:overlappingStatus}}},reason:'Reject overlapping work status'},'hr')
   expect(invalidStatus.status).toBe(400);expect((await workspace()).revision).toBe(w.revision)

   const status=[{kind:'tugas-belajar' as const,start:'2026-10-05',end:'2026-10-11',basis:'Surat tugas belajar sintetis'}]
   const currentOverride=w.state.overrides[person.id]??{}
   expect(currentOverride.rateHistory).toEqual([rateA])
   const hrSave=await request('/workspace','PUT',{expectedRevision:w.revision,patch:{overrides:{[person.id]:{...currentOverride,workStatusPeriods:status}}},reason:'HR adds effective work status'},'hr');expect(hrSave.status,await hrSave.clone().text()).toBe(200)
   w=await workspace()
   const savedOverride=w.state.overrides[person.id]??{}
   expect((await request('/workspace','PUT',{expectedRevision:w.revision,patch:{overrides:{[person.id]:{...savedOverride,jabatan:'Tidak berwenang'}}},reason:'Finance profile edit must fail'},'finance')).status).toBe(403)
   expect((await request('/workspace','PUT',{expectedRevision:w.revision,patch:{overrides:{[person.id]:{...savedOverride,rateHistory:[rateB]}}},reason:'HR rate edit must fail'},'hr')).status).toBe(403)
  } finally {
   const current=await workspace();expect((await request('/backup/restore','POST',{expectedRevision:current.revision,state:before.state,reason:'Restore original workspace after effective profile test'})).status).toBe(200)
  }
 })
 test('legacy policy cannot bypass mandatory rules or approve an unknown 08:00 boundary',async()=>{const w=await workspace();const r=await request('/workspace','PUT',{expectedRevision:w.revision,patch:{policy:{...w.state.policy,parametersApproved:true,arrivalBoundary:undefined,requireComplete:false,requireOnTime:false,lateToleranceMin:15,countLocalDuty:true}},reason:'Legacy policy requires boundary review'});expect(r.status).toBe(200);const next=await r.json();expect(next.state.policy).toMatchObject({parametersApproved:false,requireComplete:true,requireOnTime:true,lateToleranceMin:0,countLocalDuty:false});expect(next.state.policy.arrivalBoundary).toBeUndefined()})
 test('preview does not commit, identical hash and renamed file are idempotent',async()=>{
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['NIK','Nama','Tanggal','Scan Masuk','Scan Pulang'],['198001012020011001','Pegawai Uji','15/10/2026','08:00','16:00']]),'Sheet1')
  const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'}), form=new FormData();form.set('file',new File([bytes],'test.xlsx'));const before=await workspace()
  const response=await app.request('http://kppu.test/api/imports/preview',{method:'POST',headers:{origin:'http://kppu.test',cookie:cookies.admin},body:form});expect(response.status).toBe(200);const p=await response.json();expect((await workspace()).revision).toBe(before.revision)
  const intent={uploadId:p.file.id,expectedRevision:before.revision,office:'Pusat',mode:'add',reason:'Adding a source after preview'}
  const impact=await request('/imports/impact','POST',intent);expect(impact.status).toBe(200);const diff=await impact.json();expect(diff.counts.added).toBe(1);expect((await workspace()).revision).toBe(before.revision)
  const commit=await request('/imports/commit','POST',{...intent,confirmedImpact:diff.checksum});expect(commit.status,await commit.clone().text()).toBe(200)
  const next=await workspace();expect(next.state.files).toHaveLength(1)
  const revisedBook=XLSX.utils.book_new();revisedBook.Props={Title:'Second export'};XLSX.utils.book_append_sheet(revisedBook,XLSX.utils.aoa_to_sheet([['NIK','Nama','Tanggal','Scan Masuk','Scan Pulang'],['198001012020011001','Pegawai Uji','15/10/2026','08:00','16:00']]),'Sheet1')
  const secondForm=new FormData();secondForm.set('file',new File([XLSX.write(revisedBook,{type:'buffer',bookType:'xlsx'})],'second-export.xlsx'))
  const secondUpload=await app.request('http://kppu.test/api/imports/preview',{method:'POST',headers:{origin:'http://kppu.test',cookie:cookies.admin},body:secondForm});expect(secondUpload.status).toBe(200);const secondFile=(await secondUpload.json()).file
  const secondIntent={uploadId:secondFile.id,expectedRevision:next.revision,office:'Pusat',mode:'add',reason:'Second export contains a repeated attendance row'}
  const secondImpact=await request('/imports/impact','POST',secondIntent);expect(secondImpact.status).toBe(200);const secondDiff=await secondImpact.json();expect(secondDiff.counts.duplicate).toBe(1);expect(secondDiff.counts.added).toBe(0);expect(secondDiff.source.selectedRows).toBe(0)
  const secondCommit=await request('/imports/commit','POST',{...secondIntent,confirmedImpact:secondDiff.checksum});expect(secondCommit.status).toBe(200)
  const afterSecond=await workspace(),archivedDuplicate=afterSecond.state.files.find((f:any)=>f.id===secondFile.id)!;expect(afterSecond.state.files).toHaveLength(2);expect(archivedDuplicate.evidenceImport.selectedIds).toEqual([]);expect(sourceRecordState(archivedDuplicate,'evidence',archivedDuplicate.evidence[0].id)).toBe('not-selected')
  const renamed=new FormData();renamed.set('file',new File([bytes],'different-name.xlsx'));const duplicate=await app.request('http://kppu.test/api/imports/preview',{method:'POST',headers:{origin:'http://kppu.test',cookie:cookies.admin},body:renamed});expect((await duplicate.json()).duplicate).toBe(true);expect((await workspace()).state.files).toHaveLength(2)
 })
 test('same filename revision is staged, scoped replacement preserves archive, retry commit is idempotent',async()=>{
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['NIK','Nama','Tanggal','Scan Masuk','Scan Pulang'],['198001012020011001','Pegawai Uji','15/10/2026','09:00','16:00'],['198001012020011001','Pegawai Uji','15/10/2026','09:00','16:00']]),'Sheet1')
  const form=new FormData();form.set('file',new File([XLSX.write(wb,{type:'buffer',bookType:'xlsx'})],'test.xlsx'))
  const before=await workspace(),old=before.state.files.find((f:any)=>f.active!==false)
  const preview=await app.request('http://kppu.test/api/imports/preview',{method:'POST',headers:{origin:'http://kppu.test',cookie:cookies.admin},body:form});expect(preview.status).toBe(200);const file=(await preview.json()).file
  expect((await workspace()).state.files.filter((f:any)=>f.active!==false)).toHaveLength(before.state.files.filter((f:any)=>f.active!==false).length)
  const body={uploadId:file.id,expectedRevision:before.revision,office:'Pusat',mode:'replace-file',replaces:old.id,completeSnapshot:true,reason:'Explicit complete snapshot replacement'}
  expect((await request('/imports/impact','POST',{...body,completeSnapshot:false})).status).toBe(400)
  const impact=await request('/imports/impact','POST',body);expect(impact.status).toBe(200);const diff=await impact.json();expect(diff.counts.changed).toBe(1);expect(diff.counts.duplicate).toBe(1);expect(diff.review.computed).toBe(true)
  const commit=await request('/imports/commit','POST',{...body,confirmedImpact:diff.checksum});expect(commit.status).toBe(200)
  expect((await request('/imports/commit','POST',{...body,confirmedImpact:diff.checksum})).status).toBe(200)
  const next=await workspace();expect(next.state.files).toHaveLength(before.state.files.length+1);expect(next.state.files.filter((f:any)=>f.active!==false)).toHaveLength(before.state.files.filter((f:any)=>f.active!==false).length);expect(next.state.files.map((f:any)=>({id:f.id,revision:f.revision,active:f.active,import:f.importCommit?.mode}))).toEqual(expect.arrayContaining([expect.objectContaining({id:file.id,revision:2})]))
  const result=(await (await request('/calculations/2026-10')).json()).calculation;expect(result.months[0].days.find((d:any)=>d.date==='2026-10-15').clockIn).toBe('09:00')
  const imported=next.state.files.find((f:any)=>f.id===file.id)!;expect(imported.evidence).toHaveLength(2);expect(imported.evidenceImport.selectedIds).toHaveLength(1);expect(sourceRecordState(imported,'evidence',imported.evidence.find((e:any)=>!imported.evidenceImport.selectedIds.includes(e.id)).id)).toBe('not-selected')
  await expect(connection.sql.unsafe("UPDATE hr_internal.uploads SET hash='tampered'")).rejects.toThrow('immutable')
 })
 test('register import diff is explicit, partial replacement archives only the selected register, and confirmation is revision-bound',async()=>{
  const before=await workspace(),state=emptyWorkspace(),people=[
   {...blankEmployee('reg-a'),nama:'Pegawai Satu',nip:'198001012020011001',kantor:'Pusat'},
   {...blankEmployee('reg-b'),nama:'Pegawai Dua',nip:'198001012020011002',kantor:'Pusat'},
   {...blankEmployee('reg-c'),nama:'Pegawai Tiga',nip:'198001012020011003',kantor:'Pusat'},
  ]
  const oldId=randomUUID(),assignment=(id:string,name:string,nip:string,letterNo:string)=>({id,fileId:oldId,office:'Pusat',unit:'Kesekjenan',letterNo,letterDate:'2026-10-01',name,nip,start:'2026-10-15',end:'2026-10-15',rawDate:'2026-10-15',destination:'Jakarta',local:false,ref:`ST!A${id}`})
  state.master=people
  state.files=[{id:oldId,fileName:'Kesekjenan ST awal.xlsx',kind:'surat-tugas',label:'Surat tugas',office:'Pusat',importedAt:'2026-10-18T00:00:00.000Z',period:{start:'2026-10-15',end:'2026-10-15'},evidence:[],assignments:[assignment('old-a','Pegawai Satu',people[0].nip,'001/ST/2026'),assignment('old-b','Pegawai Dua',people[1].nip,'001/ST/2026'),assignment('old-c','Pegawai Tiga',people[2].nip,'002/ST/2026')],warnings:[],stats:{rows:3,people:3}}]
  expect((await request('/backup/restore','POST',{expectedRevision:before.revision,state,reason:'Synthetic register scope fixture'})).status).toBe(200)
  try {
   const current=await workspace(),wb=XLSX.utils.book_new()
   XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['No. ST','Nama Pegawai','NIP','Tanggal Kegiatan','Tanggal ST','Tujuan'],['001/ST/2026','Pegawai Satu',people[0].nip,'15/10/2026','01/10/2026','Jakarta'],['001/ST/2026','Pegawai Satu',people[0].nip,'15/10/2026','01/10/2026','Jakarta']]),'Register')
   const form=new FormData();form.set('file',new File([XLSX.write(wb,{type:'buffer',bookType:'xlsx'})],'Kesekjenan ST revisi.xlsx'))
   const upload=await app.request('http://kppu.test/api/imports/preview',{method:'POST',headers:{origin:'http://kppu.test',cookie:cookies.admin},body:form});expect(upload.status,await upload.clone().text()).toBe(200);const file=(await upload.json()).file
   const nextState=await workspace(),old=nextState.state.files.find((f:any)=>f.id===oldId)!,incoming=groupAssignments(file.assignments)[0],target=groupAssignments(old.assignments.filter((a:any)=>a.letterNo==='001/ST/2026'))[0]
   const intent={uploadId:file.id,expectedRevision:nextState.revision,office:'Pusat',mode:'replace-registers',completeSnapshot:true,selections:[{incomingKey:incoming.key,targets:[{sourceId:oldId,registerKey:target.key}]}],reason:'Ganti register lengkap ST 001/2026'}
   expect((await request('/imports/impact','POST',{...intent,expectedRevision:intent.expectedRevision-1})).status).toBe(409)
   const preview=await request('/imports/impact','POST',intent);expect(preview.status).toBe(200);const diff=await preview.json();expect(diff.counts.removed).toBe(1);expect(diff.counts.unchanged).toBe(1);expect(diff.counts.duplicate).toBe(1);expect(diff.review.computed).toBe(true)
   expect((await request('/imports/commit','POST',{...intent,confirmedImpact:'0'.repeat(64)})).status).toBe(409)
   const commit=await request('/imports/commit','POST',{...intent,confirmedImpact:diff.checksum});expect(commit.status).toBe(200)
   const saved=await workspace(),archived=saved.state.files.find((f:any)=>f.id===oldId)!,newSource=saved.state.files.find((f:any)=>f.id===file.id)!
   expect(archived.active).not.toBe(false);expect(archived.assignments).toHaveLength(3)
   expect(sourceRecordState(archived,'assignment','old-a')).toBe('superseded');expect(sourceRecordState(archived,'assignment','old-b')).toBe('superseded');expect(sourceRecordState(archived,'assignment','old-c')).toBe('active')
   expect(newSource.assignments).toHaveLength(2);expect(newSource.assignmentImport.selectedIds).toHaveLength(1);expect(sourceRecordState(newSource,'assignment',newSource.assignments.find((a:any)=>!newSource.assignmentImport.selectedIds.includes(a.id)).id)).toBe('not-selected')
   const roster=buildRoster(saved.state.files,saved.state.master,saved.state.overrides,saved.state.decisions)
   expect(roster.assignmentLink.has('old-a')).toBe(false);expect(roster.assignmentLink.has('old-b')).toBe(false);expect(roster.assignmentLink.has('old-c')).toBe(true);expect(roster.assignmentLink.has(newSource.assignmentImport.selectedIds[0])).toBe(true);expect(newSource.assignments.filter((a:any)=>!newSource.assignmentImport.selectedIds.includes(a.id)).every((a:any)=>!roster.assignmentLink.has(a.id))).toBe(true)
   const events=await connection.db.select().from(auditEvents),event=events.filter((e:any)=>e.action==='import.replace-registers').at(-1)!
   expect((event.details as any).assignmentScopeChanges.some((x:any)=>x.sourceId===oldId&&x.supersessionsAdded[0].recordIds.includes('old-b'))).toBe(true)
  } finally {
   const current=await workspace();expect((await request('/backup/restore','POST',{expectedRevision:current.revision,state:before.state,reason:'Restore original API test workspace'})).status).toBe(200)
  }
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
  state.master=[person];state.policy={...DEFAULT_POLICY,parametersApproved:true,arrivalBoundary:'inclusive',holidays:[]}
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
 test('locked correction reserves new days, cancels safely, reapproves and atomically replaces claims',async()=>{
  const parent=(await(await request('/meal-submissions')).json()).submissions.find((s:any)=>s.status==='locked')
  const original=(await(await request(`/meal-submissions/${parent.id}`)).json()).submission
  let w=await workspace();const state=structuredClone(w.state),oldPerson=state.master[0],newPerson={...oldPerson,id:'correction-added',nama:'Tambahan Koreksi Uji',nip:'198001012020011888'}
  state.master.push(newPerson)
  const source=state.files.find((f:any)=>f.evidence.length),originalEvidence=structuredClone(source.evidence)
  source.evidence[0].clockIn='09:00'
  source.evidence.push(...originalEvidence.map((e:any)=>({...e,id:`new-${e.id}`,name:newPerson.nama,ids:{nip:newPerson.nip}})))
  expect((await request('/backup/restore','POST',{expectedRevision:w.revision,state,reason:'Koreksi fixture: satu hari dicabut, pegawai tambahan'})).status).toBe(200)
  w=await workspace()
  const body={id:randomUUID(),period:parent.period,office:parent.office,supersedesId:parent.id,expectedRevision:w.revision,reason:'Koreksi bukti hadir dan pegawai dengan dokumen pendukung'}
  expect((await request('/meal-submissions','POST',{...body,reason:undefined})).status).toBe(400)
  expect((await request('/meal-submissions','POST',{...body,office:'Kanwil I'})).status).toBe(409)
  expect((await request('/meal-submissions','POST',body,'viewer')).status).toBe(403)
  let response=await request('/meal-submissions','POST',body);expect(response.status).toBe(200)
  const proposed=(await response.json()).submission
  expect(proposed.version).toBe(2);expect(proposed.snapshot.correction.parentChecksum).toBe(original.checksum)
  expect(proposed.snapshot.months.reduce((s:number,m:any)=>s+m.netto,0)).toBe(1634000)
  expect(proposed.snapshot.correction.delta.reduce((s:number,d:any)=>s+d.after.netto-d.before.netto,0)).toBe(860700)
  expect((await request('/meal-submissions','POST',body)).status).toBe(200)
  expect((await request('/meal-submissions','POST',{...body,id:randomUUID()})).status).toBe(409)
  expect((await connection.sql`select count(*)::int n from hr_internal.meal_claimed_days`)[0].n).toBe(44)
  expect((await request(`/meal-submissions/${proposed.id}/cancel`,'POST',{expectedRevision:1,reason:'Batalkan usulan untuk menguji reservasi'})).status).toBe(200)
  expect((await connection.sql`select count(*)::int n from hr_internal.meal_claimed_days`)[0].n).toBe(22)
  body.id=randomUUID();response=await request('/meal-submissions','POST',body);expect(response.status).toBe(200)
  const child=(await response.json()).submission
  expect((await request(`/meal-submissions/${child.id}/approve`,'POST',{expectedRevision:1,reason:'Self approval must fail'})).status).toBe(403)
  expect((await request(`/meal-submissions/${child.id}/approve`,'POST',{expectedRevision:1,reason:'Finance verifies correction delta'},'finance')).status).toBe(200)
  expect((await request(`/meal-submissions/${child.id}/lock`,'POST',{expectedRevision:2,reason:'Finance locks corrected version'},'finance')).status).toBe(200)
  const claims=await connection.sql`select * from hr_internal.meal_claimed_days`
  expect(claims).toHaveLength(43);expect(claims.every(d=>d.submission_id===child.id)).toBe(true)
  expect(claims.some(d=>d.key===`${oldPerson.nip}|2026-09-01`)).toBe(false)
  const preserved=(await(await request(`/meal-submissions/${parent.id}`)).json()).submission
  expect(preserved.snapshot).toEqual(original.snapshot);expect(preserved.checksum).toBe(original.checksum);expect(preserved.supersededBy).toBe(child.id)
  await expect(connection.sql`delete from hr_internal.meal_claimed_days where submission_id=${child.id}`).rejects.toThrow('locked claim')
  const wb=XLSX.read(await(await request(`/meal-submissions/${child.id}/export`)).arrayBuffer())
  expect(wb.Sheets['Selisih Koreksi']).toBeDefined()
  const diff=XLSX.utils.sheet_to_json(wb.Sheets['Selisih Koreksi'],{header:1}) as unknown[][]
  expect(diff.slice(4).reduce((sum,row)=>sum+Number(row[13]),0)).toBe(860700)
  const oldWb=XLSX.read(await(await request(`/meal-submissions/${parent.id}/export`)).arrayBuffer())
  expect(oldWb.Sheets.Nominatif.A1.v).toContain('ARSIP DIGANTIKAN')
 })
 test('correction chains require the latest locked version and fresh workspace approval',async()=>{
  const items=(await(await request('/meal-submissions')).json()).submissions,parent=items.find((s:any)=>s.status==='locked'&&s.version===2)
  let w=await workspace(),body={id:randomUUID(),period:parent.period,office:parent.office,supersedesId:parent.id,expectedRevision:w.revision,reason:'Koreksi lanjutan sesuai verifikasi dokumen terbaru'}
  expect((await request('/meal-submissions','POST',{...body,supersedesId:parent.supersedesId})).status).toBe(409)
  const response=await request('/meal-submissions','POST',body);expect(response.status).toBe(200)
  const child=(await response.json()).submission;expect(child.version).toBe(3)
  expect((await request('/workspace','PUT',{expectedRevision:w.revision,patch:{policy:{...w.state.policy,rates:{...w.state.policy.rates,III:42000}}},reason:'Tarif berubah setelah pengajuan koreksi'})).status).toBe(200)
  expect((await request(`/meal-submissions/${child.id}/approve`,'POST',{expectedRevision:1,reason:'Reject stale correction'},'finance')).status).toBe(409)
  expect((await request(`/meal-submissions/${child.id}/cancel`,'POST',{expectedRevision:1,reason:'Batalkan usulan stale agar dapat diajukan ulang'})).status).toBe(200)
  w=await workspace();body={...body,id:randomUUID(),expectedRevision:w.revision}
  const next=await request('/meal-submissions','POST',body);expect(next.status).toBe(200);const corrected=(await next.json()).submission
  expect(corrected.snapshot.months.reduce((s:number,m:any)=>s+m.netto,0)).toBe(1715700)
  expect((await request(`/meal-submissions/${corrected.id}/approve`,'POST',{expectedRevision:1,reason:'Finance approves version three'},'finance')).status).toBe(200)
  expect((await request(`/meal-submissions/${corrected.id}/lock`,'POST',{expectedRevision:2,reason:'Finance locks version three'},'finance')).status).toBe(200)
  const claims=await connection.sql`select * from hr_internal.meal_claimed_days`
  expect(claims).toHaveLength(43);expect(claims.every(d=>d.submission_id===corrected.id)).toBe(true)
 })
 test('fully withdrawn entitlement can be corrected to zero while preserving prior versions',async()=>{
  const original=await workspace(),items=(await(await request('/meal-submissions')).json()).submissions,parent=items.find((s:any)=>s.status==='locked'&&!s.correctionId)
  const state=emptyWorkspace();state.policy={...original.state.policy,parametersApproved:true,arrivalBoundary:'inclusive'}
  state.files=original.state.files.filter((f:any)=>f.kind==='surat-tugas')
  expect((await request('/backup/restore','POST',{expectedRevision:original.revision,state,reason:'Synthetic correction removes all previously claimed employees'})).status).toBe(200)
  let w=await workspace();const id=randomUUID()
  const response=await request('/meal-submissions','POST',{id,period:parent.period,office:parent.office,supersedesId:parent.id,expectedRevision:w.revision,reason:'Semua hak versi sebelumnya dicabut berdasarkan dokumen koreksi'})
  expect(response.status).toBe(200);const s=(await response.json()).submission
  expect(s.snapshot.months).toHaveLength(0)
  expect(s.snapshot.correction.delta.reduce((n:number,d:any)=>n+d.after.netto-d.before.netto,0)).toBe(-1715700)
  expect((await request(`/meal-submissions/${id}/approve`,'POST',{expectedRevision:1,reason:'Finance verifies total withdrawal'},'finance')).status).toBe(200)
  expect((await request(`/meal-submissions/${id}/lock`,'POST',{expectedRevision:2,reason:'Finance locks zero replacement'},'finance')).status).toBe(200)
  expect(await connection.sql`select * from hr_internal.meal_claimed_days`).toHaveLength(0)
  const preserved=(await(await request(`/meal-submissions/${parent.id}`)).json()).submission
  expect(preserved.status).toBe('locked');expect(preserved.supersededBy).toBe(id)
  w=await workspace();expect((await request('/backup/restore','POST',{expectedRevision:w.revision,state:original.state,reason:'Restore shared synthetic workspace after zero correction test'})).status).toBe(200)
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
 test('record review previews impact, keeps participants separate and audits cancellation/reinstatement',async()=>{
  const original=await workspace(),state=structuredClone(original.state),people=state.master.filter((p:any)=>p.kantor==='Pusat'),id='review-st-source'
  state.files.push({id,fileName:'Synthetic participant review',kind:'surat-tugas',label:'Synthetic',office:'Pusat',importedAt:'2026-10-20T00:00:00Z',period:{start:'2026-09-02',end:'2026-09-02'},evidence:[],assignments:people.map((p:any,i:number)=>({id:`review-st-${i}`,fileId:id,office:'Pusat',name:p.nama,nip:p.nip,start:'2026-09-02',end:'2026-09-02',rawDate:'2 September 2026',letterNo:'Synthetic/1',local:true,ref:`Sheet1 A${i+2}`})),warnings:[],stats:{rows:people.length,people:people.length}})
  expect((await request('/backup/restore','POST',{expectedRevision:original.revision,state,reason:'Synthetic multi-participant ST review fixture'})).status).toBe(200)
  let w=await workspace(),body={id:randomUUID(),expectedRevision:w.revision,kind:'assignment',recordId:'review-st-0',disposition:'excluded',reason:'Pembatalan peserta pertama dikonfirmasi dokumen revisi'}
  const path=`/sources/${id}/record-review`
  expect((await request(path+'/preview','POST',body,'reviewer')).status).toBe(403)
  expect((await request(path+'/preview','POST',body,'officeOne')).status).toBe(403)
  expect((await request(path+'/preview','POST',{...body,actorId:'spoof'})).status).toBe(400)
  expect((await request(path+'/preview','POST',{...body,reason:'short'})).status).toBe(400)
  expect((await request(path,'POST',body)).status).toBe(400)
  const response=await request(path+'/preview','POST',body);expect(response.status).toBe(200);const preview=await response.json()
  expect(preview.affected).toHaveLength(1);expect(preview.affected[0]).toMatchObject({employeeId:people[0].id,before:{mealState:'excluded'},after:{mealState:'eligible',amount:42000}})
  expect((await workspace()).revision).toBe(w.revision)
  expect((await request(path,'POST',{...body,confirmedImpact:'0'.repeat(64)})).status).toBe(409)
  const changed=await request('/workspace','PUT',{expectedRevision:w.revision,patch:{period:'2026-09'},reason:'Concurrent change invalidates preview'});expect(changed.status).toBe(200)
  expect((await request(path,'POST',{...body,confirmedImpact:preview.checksum})).status).toBe(409)
  w=await workspace();body={...body,expectedRevision:w.revision}
  const fresh=await(await request(path+'/preview','POST',body)).json()
  expect((await request(path,'POST',{...body,confirmedImpact:fresh.checksum})).status).toBe(200)
  w=await workspace();const source=w.state.files.find((f:any)=>f.id===id)
  expect(source.assignments).toHaveLength(2);expect(source.recordReviews).toHaveLength(1);expect(source.recordReviews[0].reviewer).toBe('admin Test')
  const calculation=(await(await request('/calculations/2026-09')).json()).calculation
  expect(calculation.months.find((m:any)=>m.employee.id===people[0].id).days.find((d:any)=>d.date==='2026-09-02').meal.state).toBe('eligible')
  expect(calculation.months.find((m:any)=>m.employee.id===people[1].id).days.find((d:any)=>d.date==='2026-09-02').meal.state).toBe('excluded')
  const events=await connection.db.select().from(auditEvents),event=events.find(e=>e.action==='source.record-review')!
  expect((event.details as any).recordReviewChanges[0]).toMatchObject({sourceId:id,after:{recordId:'review-st-0',reviewer:'admin Test'}})
  const head=(await(await request('/meal-submissions')).json()).submissions.find((s:any)=>s.status==='locked'&&!s.correctionId&&s.office==='Pusat'),proposalId=randomUUID()
  const proposal=await request('/meal-submissions','POST',{id:proposalId,period:'2026-09',office:'Pusat',supersedesId:head.id,expectedRevision:w.revision,reason:'Snapshot koreksi menyertakan dasar keputusan peserta ST'})
  expect(proposal.status).toBe(200);expect((await proposal.json()).submission.snapshot.sources.find((f:any)=>f.id===id).recordReviews).toHaveLength(1)
  const exported=XLSX.read(await(await request(`/meal-submissions/${proposalId}/export`)).arrayBuffer());expect(exported.Sheets['Review Sumber']).toBeDefined()
  expect(exported.Sheets['Review Sumber'].F2.v).toBe(body.reason)
  expect((await request(`/meal-submissions/${proposalId}/cancel`,'POST',{expectedRevision:1,reason:'Cancel synthetic review snapshot after export verification'})).status).toBe(200)
  body={...body,id:randomUUID(),expectedRevision:w.revision,disposition:'active',reason:'Peserta diaktifkan kembali berdasarkan dokumen sah'}
  const reactivation=await(await request(path+'/preview','POST',body)).json()
  expect(reactivation.affected[0].after.mealState).toBe('excluded')
  expect((await request(path,'POST',{...body,confirmedImpact:reactivation.checksum})).status).toBe(200)
  w=await workspace();expect(w.state.files.find((f:any)=>f.id===id).recordReviews).toHaveLength(2)
  expect((await request('/backup/restore','POST',{expectedRevision:w.revision,state:original.state,reason:'Restore shared fixture after record review integration test'})).status).toBe(200)
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
