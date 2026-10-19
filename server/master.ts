import type { Workspace } from '../shared/workspace.ts'
import { buildRoster } from '../src/engine/roster.ts'
import { validateMasterRow } from '../src/lib/masterImport.ts'
import { OFFICES } from '../src/engine/ids.ts'

/** Enforce master integrity for direct API edits as well as the browser import. */
export function validateMasterChange(before: Workspace, after: Workspace) {
  const ids = new Set<string>(), nip = new Set<string>(), nika = new Set<string>()
  for (const person of after.master) {
    if (ids.has(person.id) || (person.nip && nip.has(person.nip)) || (person.nika && nika.has(person.nika))) throw new Error('Master memuat ID/NIP/NIKA ganda; gabungkan baris yang cocok atau perbaiki konflik')
    ids.add(person.id); if (person.nip) nip.add(person.nip); if (person.nika) nika.add(person.nika)
  }
  const previous = buildRoster(before.files, before.master, before.overrides, before.decisions).byId
  const current = buildRoster(after.files, after.master, after.overrides, after.decisions)
  const byNip = new Map<string, string>(), byNika = new Map<string, string>()
  for (const person of current.employees) {
    const old = previous.get(person.id)
    if (JSON.stringify(old) !== JSON.stringify(person)) {
      const errors = validateMasterRow(person, OFFICES)
      if (!old && !person.kantor) errors.push('Kantor wajib untuk pegawai baru')
      if (errors.length) throw new Error(`${person.nama}: ${errors.join(' · ')}`)
    }
    if ((person.nip && byNip.has(person.nip)) || (person.nika && byNika.has(person.nika))) throw new Error('NIP/NIKA mengacu ke beberapa pegawai; selesaikan konflik identitas')
    if (person.nip) byNip.set(person.nip, person.id)
    if (person.nika) byNika.set(person.nika, person.id)
  }
}
