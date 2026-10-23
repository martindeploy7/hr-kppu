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
const ev = (id: string, change: Partial<Evidence> = {}): Evidence => ({ id, fileId: 'file', kind: 'mesin', office: 'Pusat', name: employee.nama, ids: { nip: employee.nip }, date: '2026-10-05', clockIn: '08:00', clockOut: '16:00', ref: id, ...change })
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
 test('08:00 lengkap eligible only after inclusive boundary is explicit',()=>{const r=runReviewed([ev('a')]);expect(r.mealDays).toBe(1);expect(r.bruto).toBe(37000);expect(r.pph).toBe(1850);expect(r.netto).toBe(35150)})
 test('exact 08:00 remains held while the boundary operator is unknown',()=>{const r=runReviewed([ev('a')],employee,{...policy,arrivalBoundary:undefined});expect(r.days[0].meal.state).toBe('held');expect(r.days[0].meal.reason).toContain('belum ditetapkan');expect(r.mealDays).toBe(0)})
 test('strict boundary excludes exact 08:00 and later time stays late despite a later source schedule',()=>{
  const strict=runReviewed([ev('exact')],employee,{...policy,arrivalBoundary:'exclusive'}),late=runReviewed([ev('late',{clockIn:'08:15',schedule:{start:'08:30',end:'16:00',label:'Jadwal sumber 08:30–16:00'}})])
  expect(strict.days[0].meal.state).toBe('excluded');expect(strict.days[0].meal.reason).toContain('sebelum 08:00');expect(late.days[0].meal.state).toBe('excluded');expect(late.days[0].meal.reason).toContain('Terlambat 15 menit')
 })
 test('detik setelah inclusive 08:00 boundary is not rounded to on time',()=>{expect(parseTime('08:00:01')).toBe('08:00:01');expect(runReviewed([ev('a',{clockIn:parseTime('08:00:01')})]).mealDays).toBe(0);expect(parseTime((8*3600+1)/86400)).toBe('08:00:01')})
 test('telat + lembur tidak eligible meskipun policy legacy longgar',()=>{const r=runReviewed([ev('a',{clockIn:'08:01',clockOut:'20:00',overtimeMin:240})],employee,{...policy,requireOnTime:false,lateToleranceMin:15});expect(r.mealDays).toBe(0)})
 test.each([['PD','dinas-luar'],['DL','dinas-lokal']] as const)('dinas %s tetap gugur', (code,status)=>{expect(runReviewed([ev('a',{code})],employee,{...policy,countLocalDuty:true},[],status).mealDays).toBe(0)})
 test('WFA tetap dihitung meski konfigurasi lama mencoba mematikannya',()=>{const r=runReviewed([ev('wfa',{kind:'daring',mode:'WFA'})],employee,{...policy,countWfa:false},[],'hadir-wfa');expect(r.mealDays).toBe(1);expect(r.bruto).toBe(37000)})
 test('tarif bruto dapat dihitung tanpa mengasumsikan PPh atau netto',()=>{const r=runReviewed([ev('a')],employee,{...policy,taxParametersApproved:false});expect(r.mealDays).toBe(1);expect(r.bruto).toBe(37000);expect(r.pph).toBe(0);expect(r.nettoReady).toBe(false);expect(r.netto).toBe(0);expect(r.days[0].meal.taxPct).toBeUndefined()})
 test('hadir tanpa jam ditahan',()=>{const r=run([ev('a',{clockIn:undefined,clockOut:undefined,present:true})]);expect(r.days[0].complete).toBe(false);expect(r.mealDays).toBe(0)})
 test('dua pasangan bermasalah tidak dirakit menjadi pasangan eligible',()=>{const r=run([ev('a',{clockOut:'12:00'}),ev('b',{clockIn:'09:00'})]);expect(r.mealDays).toBe(0);expect(r.days[0].clockOut).toBeUndefined()})
 test.each(['tugas-belajar','diperbantukan'] as const)('status efektif %s mengalahkan scan lengkap',kind=>{const person={...employee,workStatusPeriods:[{kind,start:'2026-10-05',end:'2026-10-06',basis:'Dokumen uji'}]};const r=runReviewed([ev('a')],person);expect(r.mealDays).toBe(0)})
 test('golongan hilang: hari tetap terpisah dari nominal pending',()=>{const r=runReviewed([ev('a')],{...employee,golongan:''});expect(r.mealDays).toBe(1);expect(r.bruto).toBe(0);expect(r.amountPendingDays).toBe(1)})
 test('parameter belum disahkan tidak menghasilkan nominal',()=>{const r=runReviewed([ev('a')],employee,{...policy,parametersApproved:false});expect(r.netto).toBe(0);expect(r.amountPendingDays).toBe(1)})
 test('missing dan future tidak dianggap TK',()=>{const f=source([]);const roster=buildRoster([f],[employee],{},[]);const r=reconcile([f],roster,{start:'2026-10-05',end:'2026-10-06'},policy,[],'2026-10-05').months[0];expect(r.absent).toBe(0);expect(r.days.map(d=>d.status)).toEqual(['tidak-ada-data','belum-berlangsung'])})
 test('master satu batch NIP sama mempertahankan ID dan field nonempty',()=>{let n=0;const r=upsertEmployees([],[],{},[{nip:employee.nip,nama:'Uji',unit:'A'},{nip:employee.nip,nama:'Uji',unit:''}],()=>`id-${++n}`);expect(r.added).toBe(1);expect(r.updated).toBe(1);expect(r.master[0].id).toBe('id-1');expect(r.overrides['id-1'].unit).toBeUndefined();expect(r.master[0].unit).toBe('A')})
 test('gelar tidak menjadi peserta tambahan',()=>{expect(splitPeople('Ridho Pamungkas, S.I.P., M.H.')).toEqual(['Ridho Pamungkas'])})
})
describe('Validasi keputusan harian setara antar-sumber',()=>{
 test('bukti tunggal dan bukti yang sama dari dua sumber tetap flag sampai admin menetapkan sumber',()=>{
  const one=run([ev('offline')]).days[0]
  expect(one.reviewState).toBe('flag')
  expect(one.meal.state).toBe('held')
  const same=run([ev('offline'),ev('online',{id:'online',fileId:'online-file',kind:'daring',mode:'WFO'})]).days[0]
  expect(same.reviewState).toBe('flag')
  expect(same.meal.state).toBe('held')
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
  expect(missing.meal.state).toBe('held')
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
