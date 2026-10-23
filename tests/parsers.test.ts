import { test, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { readSheets } from '../src/lib/xlsx.ts'
import { parseWorkbook } from '../src/engine/parse.ts'
import { buildRoster, blankEmployee } from '../src/engine/roster.ts'
import { reconcile } from '../src/engine/reconcile.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
function workbook(sheets: {name:string;rows:unknown[][]}[]) {const wb=XLSX.utils.book_new();for(const s of sheets)XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(s.rows),s.name);return XLSX.write(wb,{type:'buffer',bookType:'xlsx'})}
test('numeric XML identifier retains lexical digits and a precision warning',async()=>{
 const bytes=workbook([{name:'Laporan',rows:[['STATUS HARIAN OCTOBER 2026'],['NIP','Nama Pegawai','01 Km'],[1,'Uji','WFO']]}]),zip=unzipSync(bytes)
 const xml=strFromU8(zip['xl/worksheets/sheet1.xml']).replace('<v>1</v>','<v>198908242025211126</v>');zip['xl/worksheets/sheet1.xml']=strToU8(xml)
 const sheets=await readSheets(new File([zipSync(zip)],'online.xlsx'))
 expect(sheets[0].rows[2][0]).toBe('198908242025211126');expect(sheets[0].identifierRisks).toHaveLength(1)
 const parsed=parseWorkbook('online.xlsx',sheets,'file');expect(parsed.evidence).toHaveLength(1);expect(parsed.evidence[0].identityPending).toBe(true);expect(parsed.quarantined).toHaveLength(1)
})
test('DPH reads master and two-level assignment header, does not substitute letter date',async()=>{
 const bytes=workbook([{name:'Data Pegawai',rows:[['NAMA','NI PPPK','JABATAN','UNIT KERJA'],['Pegawai A','198001012020011001','Uji','DPH'],['Pegawai A','198001012020011001','','']]},{name:'ST',rows:[['Nama Pegawai','NIP PPPK','SURAT TUGAS','','TANGGAL TUGAS','TUJUAN'],['','','TANGGAL ST','NO SURAT','',''],['Pegawai A','198001012020011001',46302,'58','8 Oktober 2026','Bandung'],['Pegawai B','',46302,'58','8 Oktober 2026','Bandung']]}])
 const parsed=parseWorkbook('Rekap ST_DPH.xlsx',await readSheets(new File([bytes],'dph.xlsx')),'file')
 expect(parsed.master).toHaveLength(1);expect(parsed.assignments).toHaveLength(2);expect(parsed.assignments[1].nip).toBeUndefined();expect(parsed.assignments[0].start).toBe('2026-10-08');expect(parsed.assignments[0].letterNo).toBe('58');expect(parsed.quarantined?.some(r=>r.reason.includes('berulang'))).toBe(true)
})
test('leading-zero text IDs survive Excel round trip',async()=>{
 const original='000012345678901234', bytes=workbook([{name:'Master',rows:[['NIP'],[original]]}]);const sheets=await readSheets(new File([bytes],'master.xlsx'));expect(sheets[0].rows[1][0]).toBe(original);expect(sheets[0].identifierRisks).toHaveLength(0)
})
test('day decision survives unrelated data but expires after source evidence changes',()=>{
 const employee={...blankEmployee('person'),nama:'Uji',nip:'198001012020011001',kantor:'Pusat',golongan:'III/a',statusKepegawaian:'PNS' as const}
 const file={id:'file',fileName:'test',kind:'mesin' as const,label:'Test',office:'Pusat',importedAt:'2026-10-19T00:00:00Z',period:{start:'2026-10-05',end:'2026-10-05'},evidence:[{id:'ev',fileId:'file',kind:'mesin' as const,office:'Pusat',name:'Uji',ids:{nip:employee.nip},date:'2026-10-05',clockIn:'08:00',clockOut:'16:00',notes:['jam-manual-absen-error' as const],ref:'row 1'}],assignments:[],warnings:[],stats:{rows:1,people:1}}
 const policy={...DEFAULT_POLICY,parametersApproved:true,arrivalBoundary:'inclusive' as const}, roster=buildRoster([file],[employee],{},[]), scope={start:'2026-10-05',end:'2026-10-05'}
 const initial=reconcile([file],roster,scope,policy,[],'2026-10-19'), day=initial.months[0].days[0], issue=initial.issues[0]
 const resolution={issueId:issue.id,signature:issue.signature,decision:'valid' as const,note:'Bukti dikonfirmasi',reviewer:'HR',at:'2026-10-19T00:00:00Z'}
 const review={employeeId:employee.id,date:'2026-10-05',status:'hadir' as const,evidenceIds:['ev'],assignmentIds:[],note:'Bukti dikonfirmasi oleh admin',reviewer:'HR',actorId:'hr-test',at:'2026-10-19T00:00:00Z',signature:day.reviewSignature}
 expect(reconcile([file],roster,scope,policy,[resolution],'2026-10-19',[review]).months[0].mealDays).toBe(1)
 const unrelated={...file,id:'other',evidence:[],assignments:[]};expect(reconcile([file,unrelated],roster,scope,policy,[resolution],'2026-10-19',[review]).months[0].mealDays).toBe(1)
 const changed=structuredClone(file);changed.evidence[0].clockIn='07:59';expect(reconcile([changed],roster,scope,policy,[resolution],'2026-10-19',[review]).months[0].mealDays).toBe(0)
})
test('legacy workspace migration retains data and locks unsafe policy',async()=>{
 const {migrateWorkspace}=await import('../shared/validation.ts'); const {emptyWorkspace}=await import('../shared/workspace.ts')
 const legacy={...emptyWorkspace(),version:1,master:[{...blankEmployee('old-id'),nama:'Legacy Uji',nip:'000012345678901234'}],policy:{...DEFAULT_POLICY,requireOnTime:false,countLocalDuty:true,lateToleranceMin:15}}
 const result=migrateWorkspace(legacy);expect(result.version).toBe(2);expect(result.master[0].id).toBe('old-id');expect(result.master[0].nip).toBe('000012345678901234');expect(result.policy.requireOnTime).toBe(true);expect(result.policy.countLocalDuty).toBe(false)
 expect(()=>migrateWorkspace({version:999,files:[],master:[]})).toThrow()
})
test('ambiguous slash dates require an explicit profile; invalid rows remain quarantined',()=>{
 const sheets=[{name:'Sheet1',rows:[['NIK','Nama','Tanggal','Scan Masuk','Scan Pulang'],['198001012020011001','Uji','05/10/2026','08:00','16:00']]}]
 expect(()=>parseWorkbook('Pusat.xls',sheets,'file')).toThrow('ambigu')
 const parsed=parseWorkbook('Pusat.xls',sheets,'file',{dateOrder:'DMY'});expect(parsed.evidence[0].date).toBe('2026-10-05')
 const invalid=parseWorkbook('Pusat.xls',[{name:'Sheet1',rows:[sheets[0].rows[0],['198001012020011001','Uji','31/02/2026','08:00','16:00']]}],'bad')
 expect(invalid.evidence).toHaveLength(0);expect(invalid.quarantined).toHaveLength(1)
})
test('all recognized sheets are parsed with distinct evidence IDs',()=>{
 const header=['NIK','Nama','Tanggal','Scan Masuk','Scan Pulang'],row=['198001012020011001','Uji','15/10/2026','08:00','16:00']
 const parsed=parseWorkbook('Pusat.xls',[{name:'A',rows:[header,row]},{name:'B',rows:[header,row]}],'file')
 expect(parsed.evidence).toHaveLength(2);expect(new Set(parsed.evidence.map(e=>e.id)).size).toBe(2)
})
test('excessive worksheet dimensions are rejected before expansion',async()=>{
 const zip=unzipSync(workbook([{name:'Test',rows:[['NIP'],['198001012020011001']]}]))
 const xml=strFromU8(zip['xl/worksheets/sheet1.xml']).replace(/<dimension ref="[^"]+"\/>/,'<dimension ref="A1:XFD1048576"/>');zip['xl/worksheets/sheet1.xml']=strToU8(xml)
 await expect(readSheets(new File([zipSync(zip)],'oversized.xlsx'))).rejects.toThrow('terlalu besar')
})
