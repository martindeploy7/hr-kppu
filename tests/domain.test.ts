import { describe, test, expect } from 'vitest'
import { reconcile } from '../src/engine/reconcile.ts'
import { blankEmployee, buildRoster } from '../src/engine/roster.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import type { Employee, Evidence, SourceFile } from '../src/engine/types.ts'
import { upsertEmployees } from '../shared/workspace.ts'
import { parseTime } from '../src/engine/dates.ts'
import { splitPeople } from '../src/engine/names.ts'
const employee: Employee = { ...blankEmployee('person'), nama: 'Pegawai Uji', nip: '198001012020011001', kantor: 'Pusat', statusKepegawaian: 'PNS', golongan: 'III/a' }
const policy = { ...DEFAULT_POLICY, parametersApproved: true, taxParametersApproved: true, pph: { ...DEFAULT_POLICY.pph, III: 5 }, arrivalBoundary: 'inclusive' as const, holidays: [] }
const ev = (id: string, change: Partial<Evidence> = {}): Evidence => ({ id, fileId: 'file', kind: 'mesin', office: 'Pusat', name: employee.nama, ids: { nip: employee.nip }, date: '2026-10-05', schedule: { start: '08:00', end: '16:30', label: 'Jadwal resmi fixture' }, clockIn: '08:00', clockOut: '16:30', ref: id, ...change })
const source = (evidence: Evidence[]): SourceFile => ({ id:'file', fileName:'test.xls', kind:'mesin', label:'Test', office:'Pusat', importedAt:'2026-10-19T00:00:00Z', period:{start:'2026-10-05',end:'2026-10-05'}, evidence, assignments:[], warnings:[], stats:{rows:evidence.length,people:1} })
const run = (items: Evidence[], person = employee, config = policy, assignments: SourceFile['assignments'] = [], dayReviews: unknown[] = []) => {
 const file=source(items), st={...source([]),id:'st',kind:'surat-tugas' as const,assignments}
 const files=[file,st], roster=buildRoster(files,[person],{},[])
 return reconcile(files,roster,{start:'2026-10-05',end:'2026-10-05'},config,[],'2026-10-19',dayReviews as never).months[0]
}
const reviewed = (items: Evidence[], person = employee, config = policy, assignments: SourceFile['assignments'] = [], status: string = 'hadir') => {
 const provisional=run(items,person,config,assignments,[]).days[0]
 return {employeeId:person.id,date:'2026-10-05',status,evidenceIds:items.map(e=>e.id),assignmentIds:assignments.map(a=>a.id),note:'Keputusan eksplisit untuk uji domain',reviewer:'Admin uji',actorId:'admin-test',at:'2026-10-19T00:00:00Z',signature:provisional.reviewSignature}
}
const runReviewed = (items: Evidence[], person = employee, config = policy, assignments: SourceFile['assignments'] = [], status?: string) => run(items,person,config,assignments,[reviewed(items,person,config,assignments,status)])
describe('Aturan wajib UM',()=>{
 test('08:00 pas dan pulang 16:30 eligible pada hari Senin',()=>{const r=runReviewed([ev('a')]);expect(r.mealDays).toBe(1);expect(r.bruto).toBe(37000);expect(r.pph).toBe(1850);expect(r.netto).toBe(35150)})
 test('exact 08:00 tetap eligible meski konfigurasi lama bilang exclusive atau belum ditetapkan',()=>{
  for(const arrivalBoundary of ['exclusive',undefined] as const){
   const r=runReviewed([ev('a')],employee,{...policy,arrivalBoundary})
   expect(r.days[0].meal.state).toBe('eligible');expect(r.mealDays).toBe(1)
  }
 })
 test('jam masuk lewat 08:00 tetap terlambat meski jadwal sumber mulai 08:30',()=>{
  const late=runReviewed([ev('late',{clockIn:'08:15',schedule:{start:'08:30',end:'16:30',label:'Jadwal sumber 08:30–16:30'}})])
  expect(late.days[0].meal.state).toBe('excluded');expect(late.days[0].meal.reason).toContain('Terlambat 15 menit')
 })
 test('detik setelah inclusive 08:00 boundary is not rounded to on time',()=>{expect(parseTime('08:00:01')).toBe('08:00:01');expect(runReviewed([ev('a',{clockIn:parseTime('08:00:01')})]).mealDays).toBe(0);expect(parseTime((8*3600+1)/86400)).toBe('08:00:01')})
 test('telat + lembur tidak eligible meskipun policy legacy longgar',()=>{const r=runReviewed([ev('a',{clockIn:'08:01',clockOut:'20:00',overtimeMin:240})],employee,{...policy,requireOnTime:false,lateToleranceMin:15});expect(r.mealDays).toBe(0)})
 test.each([['PD','dinas-luar'],['DL','dinas-lokal']] as const)('dinas %s tetap gugur', (code,status)=>{expect(runReviewed([ev('a',{code})],employee,{...policy,countLocalDuty:true},[],status).mealDays).toBe(0)})
 test('WFA tetap dihitung meski konfigurasi lama mencoba mematikannya',()=>{const r=runReviewed([ev('wfa',{kind:'daring',mode:'WFA'})],employee,{...policy,countWfa:false},[],'hadir-wfa');expect(r.mealDays).toBe(1);expect(r.bruto).toBe(37000)})
 test('tarif bruto dapat dihitung tanpa mengasumsikan PPh atau netto',()=>{const r=runReviewed([ev('a')],employee,{...policy,taxParametersApproved:false});expect(r.mealDays).toBe(1);expect(r.bruto).toBe(37000);expect(r.pph).toBe(0);expect(r.nettoReady).toBe(false);expect(r.netto).toBe(0);expect(r.days[0].meal.taxPct).toBeUndefined()})
 test('hadir tanpa jam ditahan',()=>{const r=run([ev('a',{clockIn:undefined,clockOut:undefined,present:true})]);expect(r.days[0].complete).toBe(false);expect(r.mealDays).toBe(0)})
 test('jadwal sumber (atau jadwal asumsi) tidak dipakai: batas pulang tetap 16:30 setiap hari kerja',()=>{
  // Aturan UM: masuk <= 08:00 dan pulang >= 16:30, Senin–Jumat sama; jadwal di sumber diabaikan.
  const missing=runReviewed([ev('missing',{schedule:undefined})]).days[0]
  expect(missing).toMatchObject({scheduleKnown:true,earlyMin:0,meal:{state:'eligible'}})
  expect(missing.issues.some(issue=>issue.type==='jadwal-tidak-sesuai')).toBe(false)
  const assumed=runReviewed([ev('assumed',{schedule:{start:'08:00',end:'16:00',label:'Senin–Kamis (asumsi)'}})]).days[0]
  expect(assumed).toMatchObject({scheduleKnown:true,meal:{state:'eligible'}})
  const sourceEndsEarly=runReviewed([ev('sched',{schedule:{start:'08:00',end:'16:00',label:'Jadwal sumber 08:00–16:00'},clockOut:'16:10'})]).days[0]
  expect(sourceEndsEarly).toMatchObject({scheduleKnown:true,earlyMin:20,meal:{state:'excluded'}})
  const leftEarly=runReviewed([ev('early',{schedule:undefined,clockOut:'15:30'})]).days[0]
  expect(leftEarly).toMatchObject({earlyMin:60,meal:{state:'excluded'}})
  const oneMinuteEarly=runReviewed([ev('early1',{clockOut:'16:29'})]).days[0]
  expect(oneMinuteEarly).toMatchObject({earlyMin:1,meal:{state:'excluded'}})
 })
 test('dua pasangan bermasalah tidak dirakit menjadi pasangan eligible',()=>{const r=run([ev('a',{clockOut:'12:00'}),ev('b',{clockIn:'09:00'})]);expect(r.mealDays).toBe(0);expect(r.days[0].clockOut).toBeUndefined()})
 test.each(['tugas-belajar','diperbantukan'] as const)('status efektif %s mengalahkan scan lengkap',kind=>{const person={...employee,workStatusPeriods:[{kind,start:'2026-10-05',end:'2026-10-06',basis:'Dokumen uji'}]};const r=runReviewed([ev('a')],person);expect(r.mealDays).toBe(0)})
 test('golongan hilang: hari tetap terpisah dari nominal pending',()=>{const r=runReviewed([ev('a')],{...employee,golongan:''});expect(r.mealDays).toBe(1);expect(r.bruto).toBe(0);expect(r.amountPendingDays).toBe(1)})
 test('parameter belum disahkan tidak menghasilkan nominal',()=>{const r=runReviewed([ev('a')],employee,{...policy,parametersApproved:false});expect(r.netto).toBe(0);expect(r.amountPendingDays).toBe(1)})
 test('missing dan future tidak dianggap TK',()=>{const f=source([]);const roster=buildRoster([f],[employee],{},[]);const r=reconcile([f],roster,{start:'2026-10-05',end:'2026-10-06'},policy,[],'2026-10-05').months[0];expect(r.absent).toBe(0);expect(r.days.map(d=>d.status)).toEqual(['tidak-ada-data','belum-berlangsung'])})
 test('master satu batch NIP sama mempertahankan ID dan field nonempty',()=>{let n=0;const r=upsertEmployees([],[],{},[{nip:employee.nip,nama:'Uji',unit:'A'},{nip:employee.nip,nama:'Uji',unit:''}],()=>`id-${++n}`);expect(r.added).toBe(1);expect(r.updated).toBe(1);expect(r.master[0].id).toBe('id-1');expect(r.overrides['id-1'].unit).toBeUndefined();expect(r.master[0].unit).toBe('A')})
 test('gelar tidak menjadi peserta tambahan',()=>{expect(splitPeople('Ridho Pamungkas, S.I.P., M.H.')).toEqual(['Ridho Pamungkas'])})
})
describe('Validasi keputusan harian setara antar-sumber',()=>{
 test('bukti tanpa clash (tunggal atau sama di dua sumber) valid otomatis; jam berbeda menunggu admin',()=>{
  const one=run([ev('offline')]).days[0]
  expect(one).toMatchObject({reviewState:'valid',autoValidated:true,meal:{state:'eligible'}})
  const same=run([ev('offline'),ev('online',{id:'online',fileId:'online-file',kind:'daring',mode:'WFO'})]).days[0]
  expect(same).toMatchObject({reviewState:'valid',autoValidated:true,meal:{state:'eligible'}})
  // Jam berbeda tipis tetapi sama-sama tepat waktu: putusan UM sama → bukan clash, dipakai pasangan mesin offline.
  const sameVerdict=run([ev('offline',{clockIn:'07:45'}),ev('online',{id:'online',fileId:'online-file',kind:'daring',mode:'WFO',clockIn:'07:55'})]).days[0]
  expect(sameVerdict).toMatchObject({reviewState:'valid',autoValidated:true,clockIn:'07:45',meal:{state:'eligible'}})
  expect(sameVerdict.issues.find(i=>i.type==='scan-berbeda')).toMatchObject({blocksMeal:false})
  // Putusan berbeda (offline terlambat, online tepat waktu) → clash menunggu admin.
  const different=run([ev('offline',{clockIn:'08:10'}),ev('online',{id:'online',fileId:'online-file',kind:'daring',mode:'WFO',clockIn:'07:55'})]).days[0]
  expect(different).toMatchObject({reviewState:'flag',autoValidated:false,meal:{state:'held'}})
 })
 test('jam berbeda dengan putusan berbeda: keputusan "pakai jam mesin offline" memakai pasangan mesin',()=>{
  const items=[ev('offline',{clockIn:'06:36',clockOut:'16:43'}),ev('online',{id:'online',fileId:'online-file',kind:'daring',mode:'WFA',clockIn:'14:35',clockOut:'14:35',schedule:undefined})]
  const files=[source(items),{...source([]),id:'st',kind:'surat-tugas' as const,assignments:[]}]
  const roster=buildRoster(files,[employee],{},[])
  const at=(res:Parameters<typeof reconcile>[4])=>reconcile(files,roster,{start:'2026-10-05',end:'2026-10-05'},policy,res,'2026-10-19').months[0].days[0]
  const clash=at([])
  expect(clash).toMatchObject({reviewState:'flag',meal:{state:'held'}})
  const decided=at(clash.issues.filter(i=>i.blocksMeal).map(i=>({issueId:i.id,decision:'akui-hadir' as const,note:'Jam mesin dipakai',reviewer:'Admin',at:'2026-10-19T00:00:00Z',signature:i.signature})))
  expect(decided).toMatchObject({reviewState:'valid',status:'hadir',clockIn:'06:36',clockOut:'16:43',meal:{state:'eligible'}})
 })
 test('mesin berkode WFA dengan scan parsial + online WFA lengkap: jam online dipakai tanpa clash',()=>{
  const day=run([ev('offline',{code:'WFA',mode:'WFA',present:true,clockIn:'08:06',clockOut:undefined}),ev('online',{id:'online',fileId:'online-file',kind:'daring',mode:'WFA',approved:true,approvalStatus:'approved',clockIn:'07:15',clockOut:'17:38'})]).days[0]
  expect(day).toMatchObject({reviewState:'valid',status:'hadir-wfa',clockIn:'07:15',clockOut:'17:38',meal:{state:'eligible'}})
 })
 test('scan parsial yang sejalan dengan pasangan lengkap di sumber lain bukan clash; yang bertentangan tetap clash',()=>{
  const ok=run([ev('offline',{clockIn:'06:43',clockOut:undefined}),ev('online',{id:'online',fileId:'online-file',kind:'daring',mode:'WFO',clockIn:'06:42',clockOut:'16:34'})]).days[0]
  expect(ok).toMatchObject({reviewState:'valid',clockIn:'06:42',clockOut:'16:34',meal:{state:'eligible'}})
  const conflict=run([ev('offline',{clockIn:'08:20',clockOut:undefined}),ev('online',{id:'online',fileId:'online-file',kind:'daring',mode:'WFO',clockIn:'07:42',clockOut:'16:34'})]).days[0]
  expect(conflict).toMatchObject({reviewState:'flag',meal:{state:'held'}})
 })
 test('jam bertentangan yang tidak satu pun bisa mendapat UM tidak menunggu admin',()=>{
  const day=run([ev('offline',{clockIn:'07:47',clockOut:undefined}),ev('online',{id:'online',fileId:'online-file',kind:'daring',mode:'WFA',clockIn:'18:49',clockOut:'18:50'})]).days[0]
  expect(day.reviewState).toBe('valid')
  expect(day.meal.state).toBe('excluded')
 })
 test('online Ditolak bukan clash bila mesin offline sudah membuktikan hadir lengkap',()=>{
  const day=run([ev('offline'),ev('online',{id:'online',fileId:'online-file',kind:'daring',mode:'WFO',approved:false,approvalStatus:'rejected',clockIn:'17:16',clockOut:undefined})]).days[0]
  expect(day).toMatchObject({reviewState:'valid',autoValidated:true,status:'hadir',meal:{state:'eligible'}})
 })
 test('beda status yang sama-sama tanpa UM (kode DL + scan masuk saja) tidak menunggu admin',()=>{
  const day=run([ev('offline',{code:'DL',clockOut:undefined})]).days[0]
  expect(day).toMatchObject({reviewState:'valid',autoValidated:true,status:'dinas-lokal',meal:{state:'excluded'}})
  expect(day.issues.find(i=>i.type==='status-berbeda')).toMatchObject({blocksMeal:false})
  const st={id:'st-2',fileId:'st',office:'Pusat',name:employee.nama,nip:employee.nip,start:'2026-10-05',end:'2026-10-06',rawDate:'5-6 Oktober 2026',letterNo:'720/',destination:'Bekasi',local:false,ref:'A3'}
  const partialScanOnDuty=run([ev('offline',{clockOut:undefined})],employee,policy,[st]).days[0]
  expect(partialScanOnDuty).toMatchObject({reviewState:'valid',status:'dinas-luar',meal:{state:'excluded'}})
  const fullScanOnDuty=run([ev('offline')],employee,policy,[st]).days[0]
  expect(fullScanOnDuty).toMatchObject({reviewState:'flag',meal:{state:'held'}})
 })
 test('clash ST vs presensi online: menunggu admin, lalu mengikuti bukti yang dipilih',()=>{
  const items=[ev('online',{id:'online',fileId:'file',kind:'daring',mode:'WFA',schedule:undefined})]
  const st={id:'st-1',fileId:'st',office:'Pusat',name:employee.nama,nip:employee.nip,start:'2026-10-05',end:'2026-10-07',rawDate:'5-7 Oktober 2026',letterNo:'715/',destination:'Malang',local:false,ref:'A2'}
  const files=[source(items),{...source([]),id:'st',kind:'surat-tugas' as const,assignments:[st]}]
  const roster=buildRoster(files,[employee],{},[])
  const at=(resolutions:Parameters<typeof reconcile>[4])=>reconcile(files,roster,{start:'2026-10-05',end:'2026-10-05'},policy,resolutions,'2026-10-19').months[0].days[0]
  const clash=at([])
  expect(clash).toMatchObject({reviewState:'flag',meal:{state:'held'}})
  const decide=(decision:'akui-dinas'|'akui-hadir')=>at(clash.issues.map(i=>({issueId:i.id,decision,note:'Keputusan uji',reviewer:'Admin',at:'2026-10-19T00:00:00Z',signature:i.signature})))
  expect(decide('akui-dinas')).toMatchObject({reviewState:'valid',status:'dinas-luar',meal:{state:'excluded'}})
  expect(decide('akui-hadir')).toMatchObject({reviewState:'valid',status:'hadir-wfa',meal:{state:'eligible'}})
 })
 test('keputusan admin memakai bukti yang dipilih tanpa prioritas mesin offline',()=>{
  const items=[ev('offline',{clockIn:'07:45'}),ev('online',{id:'online',fileId:'online-file',kind:'daring',mode:'WFO',clockIn:'07:55'})]
  const provisional=run(items).days[0]
  const review={employeeId:employee.id,date:'2026-10-05',status:'hadir',evidenceIds:['online'],assignmentIds:[],note:'Dikonfirmasi dari catatan mesin online',reviewer:'Admin',actorId:'admin-id',at:'2026-10-19T00:00:00Z',signature:provisional.reviewSignature}
  const decided=run(items,employee,policy,[],[review]).days[0]
  expect(decided.reviewState).toBe('valid')
  expect(decided.clockIn).toBe('07:55')
  expect(decided.meal.state).toBe('eligible')
 })
 test('hari tanpa bukti dilaporkan tidak ditemukan, bukan dianggap tanpa keterangan',()=>{
  const missing=run([]).days[0]
  expect(missing.reviewState).toBe('not-found')
  expect(missing.status).toBe('tidak-ada-data')
  expect(missing.meal.state).toBe('excluded')
 })
 test('WFA tetap berhak UM setelah hari itu divalidasi admin',()=>{
  const items=[ev('wfa',{kind:'daring',mode:'WFA'})]
  const provisional=run(items).days[0]
  const review={employeeId:employee.id,date:'2026-10-05',status:'hadir-wfa',evidenceIds:['wfa'],assignmentIds:[],note:'WFA disahkan sesuai aturan KPPU',reviewer:'Admin',actorId:'admin-id',at:'2026-10-19T00:00:00Z',signature:provisional.reviewSignature}
  const decided=run(items,employee,policy,[],[review]).days[0]
  expect(decided.reviewState).toBe('valid')
  expect(decided.meal.state).toBe('eligible')
 })
})
test('golongan PPPK di luar rentang I-XVII tidak memperoleh kelompok tarif tebakan',()=>{
 const result=runReviewed([ev('valid')],{...employee,statusKepegawaian:'PPPK',golongan:'99'})
 expect(result.groupAssumed).toBe(true)
 expect(result.amountPendingDays).toBe(1)
 expect(result.bruto).toBe(0)
})
test.each([
 ['PNS','I','I',35000], ['PNS','II','II',35000], ['PNS','III/a','III',37000], ['PNS','IV/e','IV',41000],
 ['PPPK','I','I',35000], ['PPPK','VIII','II',35000], ['PPPK','IX','III',37000], ['PPPK','XII','III',37000], ['PPPK','XIII','IV',41000], ['PPPK','XVII','IV',41000],
] as const)('tarif %s golongan %s masuk kelompok %s sebesar %s', (status,golongan,group,rate)=>{
 const result=runReviewed([ev('rate')],{...employee,statusKepegawaian:status,golongan})
 expect(result.group).toBe(group)
 expect(result.bruto).toBe(rate)
})
test('precision-risk evidence needs an explicit identity mapping before eligibility',()=>{
 const file=source([ev('unsafe',{ids:{},identityPending:true})]),mapping={key:'Pusat|pegawai uji',employeeId:employee.id,reviewer:'HR',at:'2026-10-19T00:00:00Z'}
 const without=buildRoster([file],[employee],{},[])
 expect(reconcile([file],without,{start:'2026-10-05',end:'2026-10-05'},policy,[]).months.reduce((n,m)=>n+m.mealDays,0)).toBe(0)
 const mapped=buildRoster([file],[employee],{},[mapping])
 const provisional=reconcile([file],mapped,{start:'2026-10-05',end:'2026-10-05'},policy,[],'2026-10-19')
 const decision={...reviewed([file.evidence[0]]),signature:provisional.months[0].days[0].reviewSignature}
 expect(reconcile([file],mapped,{start:'2026-10-05',end:'2026-10-05'},policy,[],'2026-10-19',[decision as never]).months.reduce((n,m)=>n+m.mealDays,0)).toBe(1)
})
test('mid-period rates and tax use each day effective profile',()=>{
 const person={...employee,rateHistory:[{start:'2026-10-05',end:'2026-10-05',rate:37000,pph:5,basis:'Synthetic rate A'},{start:'2026-10-06',end:'2026-10-06',rate:40000,pph:10,basis:'Synthetic rate B'}]}
 const file=source([ev('a'),ev('b',{date:'2026-10-06'})]),roster=buildRoster([file],[person],{},[])
 const provisional=reconcile([file],roster,{start:'2026-10-05',end:'2026-10-06'},policy,[],'2026-10-19')
 const reviews=provisional.months[0].days.map(d=>({employeeId:person.id,date:d.date,status:'hadir' as const,evidenceIds:d.evidence.map(e=>e.id),assignmentIds:[],note:'Keputusan eksplisit untuk uji domain',reviewer:'Admin uji',actorId:'admin-test',at:'2026-10-19T00:00:00Z',signature:d.reviewSignature}))
 const result=reconcile([file],roster,{start:'2026-10-05',end:'2026-10-06'},policy,[],'2026-10-19',reviews).months[0]
 expect(result.mealDays).toBe(2);expect(result.bruto).toBe(77000);expect(result.pph).toBe(5850);expect(result.netto).toBe(71150)
})
