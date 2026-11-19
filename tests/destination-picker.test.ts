import { describe, expect, test } from 'vitest'
import { PROVINCE_DATA, REGENCY_DATA } from '../src/lib/wilayah-data.ts'
import {
  PROVINCES, REGENCIES, SEARCH_LIMIT, destinationValue, getProvince, getRegency, normalizeText, parseDestination, regenciesOf, searchWilayah,
} from '../src/lib/wilayah.ts'

const values = (q: string, limit?: number) => searchWilayah(q, limit).map(o => o.value)

describe('data wilayah', () => {
  test('jumlah sesuai sumber: 38 provinsi, 514 kabupaten/kota (416 kabupaten + 98 kota)', () => {
    expect(PROVINCES).toHaveLength(38)
    expect(REGENCIES).toHaveLength(514)
    expect(REGENCIES.filter(r => r.kind === 'kabupaten')).toHaveLength(416)
    expect(REGENCIES.filter(r => r.kind === 'kota')).toHaveLength(98)
  })

  test('kode unik, setiap kabupaten/kota punya provinsi, setiap provinsi punya kabupaten/kota', () => {
    expect(new Set(PROVINCES.map(p => p.code)).size).toBe(38)
    expect(new Set(REGENCIES.map(r => r.code)).size).toBe(514)
    for (const r of REGENCIES) {
      expect(r.code).toMatch(/^\d{2}\.\d{2}$/)
      expect(getProvince(r.provinceCode), r.code).toBeDefined()
      expect(r.code.startsWith(`${r.provinceCode}.`)).toBe(true)
    }
    for (const p of PROVINCES) expect(regenciesOf(p.code).length, p.name).toBeGreaterThan(0)
  })

  test('nama tampilan unik dan tidak ada nama kosong atau berspasi ganda', () => {
    const labels = [...PROVINCES.map(p => p.label), ...REGENCIES.map(r => r.label)]
    expect(new Set(labels.map(normalizeText)).size).toBe(labels.length)
    for (const l of labels) expect(l).toBe(l.trim().replace(/\s+/g, ' '))
  })

  test('data mentah tetap ringkas (< 40 KB)', () => {
    expect(PROVINCE_DATA.length + REGENCY_DATA.length).toBeLessThan(40 * 1024)
  })

  test('nama resmi: Bogor, DKI Jakarta, Papua baru', () => {
    expect(getRegency('32.71')?.label).toBe('Kota Bogor, Jawa Barat')
    expect(getRegency('32.01')?.label).toBe('Kabupaten Bogor, Jawa Barat')
    const jakarta = regenciesOf('31').map(r => r.name)
    expect(jakarta).toHaveLength(6)
    expect(jakarta).toEqual(expect.arrayContaining([
      'Kota Administrasi Jakarta Pusat', 'Kota Administrasi Jakarta Utara', 'Kota Administrasi Jakarta Barat',
      'Kota Administrasi Jakarta Selatan', 'Kota Administrasi Jakarta Timur', 'Kabupaten Administrasi Kepulauan Seribu',
    ]))
    expect(getProvince('31')).toMatchObject({ name: 'Daerah Khusus Ibukota Jakarta', label: 'DKI Jakarta' })
    expect(PROVINCES.map(p => p.name)).toEqual(expect.arrayContaining(['Papua Selatan', 'Papua Tengah', 'Papua Pegunungan', 'Papua Barat Daya']))
  })
})

describe('normalizeText', () => {
  test('huruf kecil, tanpa aksen, tanda baca dan spasi dirapikan', () => {
    expect(normalizeText('  Kota   BOGOR,  Jawa-Barat ')).toBe('kota bogor jawa barat')
    expect(normalizeText('Yogyakárta')).toBe('yogyakarta')
    expect(normalizeText('')).toBe('')
    expect(normalizeText('...')).toBe('')
  })
})

describe('searchWilayah', () => {
  test('"bogor" menemukan Kota dan Kabupaten Bogor di urutan teratas', () => {
    expect(values('bogor').slice(0, 2)).toEqual(['Kota Bogor, Jawa Barat', 'Kabupaten Bogor, Jawa Barat'])
    expect(values('BOGOR')).toEqual(values('bogor'))
  })

  test('tanpa memandang huruf besar/kecil, aksen, dan spasi berlebih', () => {
    expect(values('  KOTA   bogor ')[0]).toBe('Kota Bogor, Jawa Barat')
    expect(values('yogyakárta')).toContain('Kota Yogyakarta, Daerah Istimewa Yogyakarta')
    expect(values('kab. bogor')[0]).toBe('Kabupaten Bogor, Jawa Barat')
  })

  test('"jakarta" menemukan kota administrasi, Kepulauan Seribu, dan provinsinya', () => {
    const v = values('jakarta')
    expect(v.slice(0, 5).sort()).toEqual([
      'Kota Administrasi Jakarta Barat, DKI Jakarta', 'Kota Administrasi Jakarta Pusat, DKI Jakarta', 'Kota Administrasi Jakarta Selatan, DKI Jakarta',
      'Kota Administrasi Jakarta Timur, DKI Jakarta', 'Kota Administrasi Jakarta Utara, DKI Jakarta',
    ])
    expect(v).toContain('DKI Jakarta')
    expect(v).toContain('Kabupaten Administrasi Kepulauan Seribu, DKI Jakarta')
  })

  test('nama provinsi asli dari sumber dan singkatan umum ikut dikenali', () => {
    expect(values('ibukota')).toContain('DKI Jakarta')
    expect(values('jabar')[0]).toBe('Jawa Barat')
    expect(values('jabar')).toContain('Kota Bogor, Jawa Barat')
    expect(values('jabar bogor')[0]).toBe('Kota Bogor, Jawa Barat')
    expect(values('dki')[0]).toBe('DKI Jakarta')
    expect(values('diy')[0]).toBe('Daerah Istimewa Yogyakarta')
    expect(values('ntt')[0]).toBe('Nusa Tenggara Timur')
  })

  test('mengetik nama provinsi menaruh provinsi di atas, disusul kabupaten/kota-nya', () => {
    const v = values('jawa barat')
    expect(v[0]).toBe('Jawa Barat')
    expect(v.slice(1)).toContain('Kota Bandung, Jawa Barat')
  })

  test('beberapa kata: semua kata harus cocok', () => {
    expect(values('kota gorontalo')[0]).toBe('Kota Gorontalo, Gorontalo')
    expect(values('bogor sumatera')).toEqual([])
  })

  test('awalan nama didahulukan daripada kecocokan di tengah kata', () => {
    const top = searchWilayah('ban').slice(0, 5)
    for (const o of top) expect(normalizeText(o.primary).replace(/^(kabupaten|kota) (administrasi )?/, '')).toMatch(/^ban/)
  })

  test('tanpa kata kunci menampilkan seluruh provinsi; hasil dibatasi limit', () => {
    expect(searchWilayah('')).toHaveLength(38)
    expect(searchWilayah('   ')[0]).toMatchObject({ type: 'province' })
    expect(searchWilayah('kab', 7)).toHaveLength(7)
    expect(searchWilayah('a').length).toBeLessThanOrEqual(SEARCH_LIMIT)
  })

  test('tidak ada kecocokan memberi daftar kosong', () => {
    expect(searchWilayah('zzzxqv')).toEqual([])
    expect(searchWilayah('kuala lumpur')).toEqual([])
  })

  test('setiap hasil membawa nilai yang bisa dibaca balik', () => {
    for (const q of ['bogor', 'jakarta', 'papua', 'kepulauan', 'kota']) {
      for (const o of searchWilayah(q)) expect(parseDestination(o.value), o.value).toMatchObject({ kind: o.type, value: o.value })
    }
  })
})

describe('format dan parse nilai tujuan', () => {
  test('kabupaten/kota dan provinsi memakai bentuk baku', () => {
    expect(destinationValue('32.71')).toBe('Kota Bogor, Jawa Barat')
    expect(destinationValue('32')).toBe('Jawa Barat')
    expect(destinationValue('31')).toBe('DKI Jakarta')
    expect(destinationValue('31.71')).toBe('Kota Administrasi Jakarta Pusat, DKI Jakarta')
    expect(destinationValue('00.00')).toBeUndefined()
  })

  test('nilai baku dibaca balik menjadi kabupaten/kota atau provinsi', () => {
    const city = parseDestination('Kota Bogor, Jawa Barat')
    expect(city).toMatchObject({ kind: 'regency', value: 'Kota Bogor, Jawa Barat' })
    if (city.kind === 'regency') expect(city.regency.code).toBe('32.71')
    const province = parseDestination('Jawa Barat')
    expect(province).toMatchObject({ kind: 'province', value: 'Jawa Barat' })
    if (province.kind === 'province') expect(province.province.code).toBe('32')
  })

  test('semua 514 kabupaten/kota dan 38 provinsi bulat-pulang (format lalu parse)', () => {
    for (const r of REGENCIES) expect(parseDestination(r.label)).toMatchObject({ kind: 'regency', regency: { code: r.code } })
    for (const p of PROVINCES) expect(parseDestination(p.label)).toMatchObject({ kind: 'province', province: { code: p.code } })
  })

  test('huruf besar/kecil, spasi, dan nama provinsi asli dari sumber tetap dikenali dan dibakukan', () => {
    expect(parseDestination('  kota bogor ,  jawa barat ')).toMatchObject({ kind: 'regency', value: 'Kota Bogor, Jawa Barat' })
    expect(parseDestination('Kota Administrasi Jakarta Pusat, Daerah Khusus Ibukota Jakarta')).toMatchObject({ kind: 'regency', value: 'Kota Administrasi Jakarta Pusat, DKI Jakarta' })
    expect(parseDestination('Daerah Khusus Ibukota Jakarta')).toMatchObject({ kind: 'province', value: 'DKI Jakarta' })
  })

  test('teks bebas dan data lama yang tidak ada di daftar dibaca sebagai "Lainnya" apa adanya', () => {
    expect(parseDestination('Kuala Lumpur, Malaysia')).toEqual({ kind: 'custom', text: 'Kuala Lumpur, Malaysia' })
    expect(parseDestination('Bogor, Jawa Barat')).toEqual({ kind: 'custom', text: 'Bogor, Jawa Barat' })
    expect(parseDestination('Kota Bogor')).toEqual({ kind: 'custom', text: 'Kota Bogor' })
    expect(parseDestination('Kota Bogor, Jawa Timur')).toEqual({ kind: 'custom', text: 'Kota Bogor, Jawa Timur' })
    expect(parseDestination(' Singapura ')).toEqual({ kind: 'custom', text: ' Singapura ' })
  })

  test('kosong atau hanya spasi dianggap kosong', () => {
    expect(parseDestination('')).toEqual({ kind: 'empty' })
    expect(parseDestination('   ')).toEqual({ kind: 'empty' })
  })
})
