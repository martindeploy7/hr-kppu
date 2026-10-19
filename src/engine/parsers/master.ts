import type { Employee, Sheet } from '../types.ts'
import { columnIndex, findHeaderRow, rowRef, str } from './common.ts'
export function parseMasterSheet(sheet: Sheet, office: string, quarantine: { ref: string; reason: string; raw: string }[]): Partial<Employee>[] {
 const h = findHeaderRow(sheet, [/^nama(?: pegawai)?$/, /^(?:ni|nip|nik) pppk$/])
 if (h < 0 || !/data pegawai|nip pppk/i.test(sheet.name)) return []
 const head=sheet.rows[h], name=columnIndex(head,/^nama(?: pegawai)?$/), nip=columnIndex(head,/^(?:ni|nip|nik) pppk$/), unit=columnIndex(head,/unit/), job=columnIndex(head,/jabatan/)
 const seen = new Set<string>(), out: Partial<Employee>[] = []
 for(let r=h+1;r<sheet.rows.length;r++){
  const row=sheet.rows[r], nama=str(row[name]); if(!nama)continue
  const identifier=str(row[nip]), risk=sheet.identifierRisks?.some(x=>x.row===r && x.col===nip)
  if(!identifier || risk || (!!identifier && seen.has(identifier))) {quarantine.push({ref:rowRef(sheet,r),reason:risk?'IDENTIFIER_PRECISION_RISK':!identifier?'NIP kosong':'NIP berulang dalam master',raw:identifier}); if((!!identifier && seen.has(identifier))||risk)continue}
  if(identifier) seen.add(identifier)
  out.push({nama,nip:identifier,kantor:office,unit:str(row[unit]),jabatan:str(row[job])})
 }
 return out
}
