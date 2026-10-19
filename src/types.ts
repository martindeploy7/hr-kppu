export type { Employee, Religion, StatusKepegawaian } from './engine/types.ts'

export type AutomationRule = {
  id: string
  title: string
  description: string
  trigger: string
  audience: string
  enabled: boolean
  category: 'Celebration' | 'Lifecycle' | 'Data Quality' | 'Learning' | 'Change Event' | 'Informasi Publik' | 'Keselamatan' | 'Kinerja' | 'Peristiwa Pegawai' | 'Hak & Benefit' | 'Absensi'
  scope: 'public' | 'segmented' | 'personal'
  privacy: 'standard' | 'sensitive'
}
