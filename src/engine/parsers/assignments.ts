import type { Assignment, Cell, Sheet } from '../types.ts'
import { formatID, parseDateRange, parseSingleDate } from '../dates.ts'
import { splitPeople, cleanText } from '../names.ts'
import { columnIndex, low, rowRef, str } from './common.ts'
const NAME = /^nama(?: pegawai| pelaksana)?$|pegawai yang tugas/
const LETTER = /^(?:no\.?\s*(?:st|surat(?: tugas)?)|nomor (?:st|surat tugas))(?:\b|[- ])/i
function headers(s: Sheet, r: number): Cell[] {
 const row = s.rows[r], next = s.rows[r + 1] ?? []
 // Two-level headers: subheader identifies the actual ST number, not SPD.
 return row.map((v, i) => /^(?:no\.?\s*surat(?: tugas)?|tanggal st)$/i.test(str(next[i])) ? next[i] : v)
}
export function findAssignmentHeader(sheet: Sheet): number {
 for(let r=0;r<Math.min(15,sheet.rows.length);r++) {const h=headers(sheet,r).map(low);if(h.some(c=>NAME.test(c))&&h.some(c=>LETTER.test(c)))return r}
 return -1
}
export function parseAssignmentSheet(sheet: Sheet, fileId: string, office: string, unit: string | undefined, warnings: string[], quarantine: {ref:string;reason:string;raw:string}[] = []): Assignment[] {
 const h=findAssignmentHeader(sheet);if(h<0)return []
 const header=headers(sheet,h)
 const col={name:columnIndex(header,NAME),letter:columnIndex(header,LETTER),nip:columnIndex(header,/^(?:nip|nik|ni|ini)\s*(?:pppk)?$/),activity:columnIndex(header,/tanggal (?:tugas|kegiatan|dinas|pelaksanaan|penugasan)|^kegiatan$|tujuan dan tanggal/),uraian:columnIndex(header,/^uraian$/),date:columnIndex(header,/^tanggal$/),letterDate:columnIndex(header,/tanggal (?:st|surat)/),dest:columnIndex(header,/tujuan|^lokasi|kota/)}
 const activity=col.activity>=0?col.activity:col.uraian>=0?col.uraian:col.date
 const letterDateCol=col.letterDate>=0?col.letterDate:col.uraian>=0?col.date:-1
 const years=sheet.rows.flatMap(r=>r.map(c=>str(c).match(/\b(20\d{2})\b/)?.[1])).filter(Boolean).map(Number)
 const year=years.length?mode(years):undefined
 const local=/lokal/i.test(`${sheet.name} ${str(header[col.letter])}`)
 const continuation=/penugasan/i.test(str(header[activity])) && /(?:ini|ni) pppk/i.test(header.map(str).join(' '))
 const participantBlock = columnIndex(header, /^nomor blanko$/) >= 0 && col.letterDate >= 0 && col.dest >= 0
 const out:Assignment[]=[]
 let block:{date?:Cell;dateRef?:string;letter?:string;dest?:string;name?:string;nip?:string;letterDate?:string}={}
 for(let r=h+1;r<sheet.rows.length;r++){
  const row=sheet.rows[r];if(row.every(c=>!str(c))){block={};continue}
  const explicitName = str(row[col.name])
  const rawName=explicitName || (continuation?block.name??'':'')
  if(!rawName || NAME.test(low(rawName)))continue
  const rawDate=row[activity], hasDate=!!str(rawDate)
  let letter=str(row[col.letter]).replace(/^nomor\s*:\s*/i,'').replace(/\s+/g,'')
  const suffix=str(row[col.letter+1]).replace(/\s+/g,'')
  if(suffix.startsWith('/'))letter+=suffix
  else if(/^\d+\//.test(suffix))letter=suffix
  if(!letter && !hasDate)letter=block.letter??''
  const mergedDate = sheet.merges?.some(m => m.s.r < r && m.e.r >= r && m.s.c <= activity && m.e.c >= activity)
  if (/nip pppk/i.test(sheet.name) && !hasDate) continue // identity row, not an assignment
  const dateCell=hasDate?rawDate:mergedDate||participantBlock?block.date:undefined
  const dateRef=hasDate?rowRef(sheet,r):block.dateRef
  const letterDate=parseSingleDate(row[letterDateCol],year)??block.letterDate
  const destination=cleanText(row[col.dest]) || (col.dest<0 && typeof dateCell==='string'?dateCell.replace(/\d[\s\S]*$/,'').replace(/[, ]+$/,''):block.dest)
  const names=splitPeople(rawName), range=parseDateRange(dateCell??null,year)
  const participantNip = str(row[col.nip]) || (!explicitName && continuation ? block.nip : undefined)
  block={date:dateCell,dateRef,letter,dest:destination,name:rawName,nip:participantNip,letterDate}
  if(!range){quarantine.push({ref:rowRef(sheet,r),reason:'Tanggal pelaksanaan tidak terbaca; tidak memakai tanggal surat sebagai pengganti',raw:str(dateCell)});continue}
  const nipRisk=sheet.identifierRisks?.some(x=>x.row===r&&x.col===col.nip)
  const nip=names.length===1&&!nipRisk&&/^\d{18}$/.test(block.nip??'')?block.nip:undefined
  names.forEach((name,i)=>out.push({id:`${fileId}:${sheet.name}:${r}:${i}`,fileId,office,unit,letterNo:letter&&letter!=='-'&&!letter.startsWith('/')?letter:undefined,letterDate,nip,name,start:range.start,end:range.end,rawDate:typeof dateCell==='number'?formatID(range.start):str(dateCell),dateRef,destination:destination||undefined,local,ref:rowRef(sheet,r)}))
 }
 const noNumber=out.filter(a=>!a.letterNo).length
 if(noNumber)warnings.push(`${sheet.name}: ${noNumber} penugasan tanpa nomor ST lengkap.`)
 if(/ooktober/i.test(sheet.rows.flat().map(str).join(' ')))warnings.push(`${sheet.name}: typo Ooktober dinormalisasi ke Oktober; nilai asal disimpan.`)
 return out
}
function mode(xs:number[]){const n=new Map<number,number>();xs.forEach(x=>n.set(x,(n.get(x)??0)+1));return [...n].sort((a,b)=>b[1]-a[1])[0][0]}
