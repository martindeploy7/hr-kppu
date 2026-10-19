import { describe, test, expect } from 'vitest'
import { reconcile } from '../src/engine/reconcile.ts'
import { blankEmployee, buildRoster } from '../src/engine/roster.ts'
import { DEFAULT_POLICY } from '../src/engine/policy.ts'
import type { Employee, Evidence, SourceFile } from '../src/engine/types.ts'
import { upsertEmployees } from '../shared/workspace.ts'
import { parseTime } from '../src/engine/dates.ts'
import { splitPeople } from '../src/engine/names.ts'
const employee: Employee = { ...blankEmployee('person'), nama: 'Pegawai Uji', nip: '198001012020011001', kantor: 'Pusat', statusKepegawaian: 'PNS', golongan: 'III/a' }
const policy = { ...DEFAULT_POLICY, parametersApproved: true, holidays: [] }
const ev = (id: string, change: Partial<Evidence> = {}): Evidence => ({ id, fileId: 'file', kind: 'mesin', office: 'Pusat', name: employee.nama, ids: { nip: employee.nip }, date: '2026-10-05', clockIn: '08:00', clockOut: '16:00', ref: id, ...change })
const source = (evidence: Evidence[]): SourceFile => ({ id:'file', fileName:'test.xls', kind:'mesin', label:'Test', office:'Pusat', importedAt:'2026-10-19T00:00:00Z', period:{start:'2026-10-05',end:'2026-10-05'}, evidence, assignments:[], warnings:[], stats:{rows:evidence.length,people:1} })
const run = (items: Evidence[], person = employee, config = policy, assignments: SourceFile['assignments'] = []) => {
 const file=source(items), st={...source([]),id:'st',kind:'surat-tugas' as const,assignments}
 const files=[file,st], roster=buildRoster(files,[person],{},[])
 return reconcile(files,roster,{start:'2026-10-05',end:'2026-10-05'},config,[],'2026-10-19').months[0]
}
describe('Aturan wajib UM',()=>{
 test('08:00 lengkap eligible, pajak dihitung secara independen',()=>{const r=run([ev('a')]);expect(r.mealDays).toBe(1);expect(r.bruto).toBe(37000);expect(r.pph).toBe(1850);expect(r.netto).toBe(35150)})
 test('detik setelah batas 08:00 tidak dibulatkan menjadi tepat waktu',()=>{expect(parseTime('08:00:01')).toBe('08:00:01');expect(run([ev('a',{clockIn:parseTime('08:00:01')})]).mealDays).toBe(0);expect(parseTime((8*3600+1)/86400)).toBe('08:00:01')})
 test('telat + lembur tidak eligible meskipun policy legacy longgar',()=>{const r=run([ev('a',{clockIn:'08:01',clockOut:'20:00',overtimeMin:240})],employee,{...policy,requireOnTime:false,lateToleranceMin:15});expect(r.mealDays).toBe(0)})
 test.each(['PD','DL'] as const)('dinas %s tetap gugur',code=>{expect(run([ev('a',{code})],employee,{...policy,countLocalDuty:true}).mealDays).toBe(0)})
 test('hadir tanpa jam ditahan',()=>{const r=run([ev('a',{clockIn:undefined,clockOut:undefined,present:true})]);expect(r.days[0].complete).toBe(false);expect(r.mealDays).toBe(0)})
 test('dua pasangan bermasalah tidak dirakit menjadi pasangan eligible',()=>{const r=run([ev('a',{clockOut:'12:00'}),ev('b',{clockIn:'09:00'})]);expect(r.mealDays).toBe(0);expect(r.days[0].clockOut).toBe('12:00')})
 test.each(['tugas-belajar','diperbantukan'] as const)('status efektif %s mengalahkan scan lengkap',kind=>{const r=run([ev('a')],{...employee,workStatusPeriods:[{kind,start:'2026-10-05',end:'2026-10-06',basis:'Dokumen uji'}]});expect(r.mealDays).toBe(0)})
 test('golongan hilang: hari tetap terpisah dari nominal pending',()=>{const r=run([ev('a')],{...employee,golongan:''});expect(r.mealDays).toBe(1);expect(r.bruto).toBe(0);expect(r.amountPendingDays).toBe(1)})
 test('parameter belum disahkan tidak menghasilkan nominal',()=>{const r=run([ev('a')],employee,{...policy,parametersApproved:false});expect(r.netto).toBe(0);expect(r.amountPendingDays).toBe(1)})
 test('missing dan future tidak dianggap TK',()=>{const f=source([]);const roster=buildRoster([f],[employee],{},[]);const r=reconcile([f],roster,{start:'2026-10-05',end:'2026-10-06'},policy,[],'2026-10-05').months[0];expect(r.absent).toBe(0);expect(r.days.map(d=>d.status)).toEqual(['tidak-ada-data','belum-berlangsung'])})
 test('master satu batch NIP sama mempertahankan ID dan field nonempty',()=>{let n=0;const r=upsertEmployees([],[],{},[{nip:employee.nip,nama:'Uji',unit:'A'},{nip:employee.nip,nama:'Uji',unit:''}],()=>`id-${++n}`);expect(r.added).toBe(1);expect(r.updated).toBe(1);expect(r.master[0].id).toBe('id-1');expect(r.overrides['id-1'].unit).toBeUndefined();expect(r.master[0].unit).toBe('A')})
 test('gelar tidak menjadi peserta tambahan',()=>{expect(splitPeople('Ridho Pamungkas, S.I.P., M.H.')).toEqual(['Ridho Pamungkas'])})
})
test('precision-risk evidence needs an explicit identity mapping before eligibility',()=>{
 const file=source([ev('unsafe',{ids:{},identityPending:true})]),mapping={key:'Pusat|pegawai uji',employeeId:employee.id,reviewer:'HR',at:'2026-10-19T00:00:00Z'}
 const without=buildRoster([file],[employee],{},[])
 expect(reconcile([file],without,{start:'2026-10-05',end:'2026-10-05'},policy,[]).months.reduce((n,m)=>n+m.mealDays,0)).toBe(0)
 const mapped=buildRoster([file],[employee],{},[mapping])
 expect(reconcile([file],mapped,{start:'2026-10-05',end:'2026-10-05'},policy,[]).months.reduce((n,m)=>n+m.mealDays,0)).toBe(1)
})
test('mid-period rates and tax use each day effective profile',()=>{
 const person={...employee,rateHistory:[{start:'2026-10-05',end:'2026-10-05',rate:37000,pph:5,basis:'Synthetic rate A'},{start:'2026-10-06',end:'2026-10-06',rate:40000,pph:10,basis:'Synthetic rate B'}]}
 const file=source([ev('a'),ev('b',{date:'2026-10-06'})]),roster=buildRoster([file],[person],{},[])
 const result=reconcile([file],roster,{start:'2026-10-05',end:'2026-10-06'},policy,[]).months[0]
 expect(result.mealDays).toBe(2);expect(result.bruto).toBe(77000);expect(result.pph).toBe(5850);expect(result.netto).toBe(71150)
})
