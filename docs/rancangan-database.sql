-- Rancangan database relasional Sistem Absensi Terintegrasi KPPU (PostgreSQL)
-- Disusun dari struktur file nyata (Rapat Absensi, September 2026).
--
-- Keputusan kunci:
--  * PK pegawai = ID internal. NIP, NIKA, dan NIK KTP disimpan sebagai kolom UNIQUE opsional, karena:
--    - kolom "NIK" di ekspor mesin pusat ternyata berisi NIP (2 baris berisi NIKA);
--    - NIK KTP tidak ada di sumber absensi mana pun;
--    - sebagian pegawai Kanwil hanya dikenal lewat nama + nomor mesin;
--    - ditemukan NIP berbeda untuk orang yang sama di dua sistem (perlu digabung, bukan ditolak).
--  * Semua variasi identitas per sumber disimpan di pegawai_alias, sehingga impor berikutnya otomatis cocok.
--  * Data mentah (catatan_absensi) tidak pernah ditimpa; status final ada di rekap_harian + keputusan (audit).

CREATE TABLE kantor (
  id            SMALLSERIAL PRIMARY KEY,
  kode          TEXT NOT NULL UNIQUE,            -- 'PUSAT', 'KANWIL-I', ...
  nama          TEXT NOT NULL,                   -- 'Kanwil I'
  kota          TEXT,
  lat           NUMERIC(9,6),                    -- titik geofence WFO
  lng           NUMERIC(9,6),
  radius_m      INTEGER DEFAULT 1000
);

CREATE TABLE unit_kerja (
  id            SERIAL PRIMARY KEY,
  kantor_id     SMALLINT NOT NULL REFERENCES kantor(id),
  nama          TEXT NOT NULL,                   -- 'Biro Pencegahan', 'Satuan Pelaksana Lampung'
  induk_id      INTEGER REFERENCES unit_kerja(id),
  UNIQUE (kantor_id, nama)
);

CREATE TABLE pegawai (
  id                  BIGSERIAL PRIMARY KEY,
  nip                 CHAR(18) UNIQUE,           -- PPPK: YYYYMMDD + YYYY + '21' + G + NNN
  nika                VARCHAR(12) UNIQUE,        -- pola x.yy.zzzz
  nik_ktp             CHAR(16) UNIQUE,
  nama                TEXT NOT NULL,
  kantor_id           SMALLINT REFERENCES kantor(id),
  unit_id             INTEGER REFERENCES unit_kerja(id),
  status_kepegawaian  TEXT NOT NULL DEFAULT 'Belum diketahui'
                      CHECK (status_kepegawaian IN ('PPPK','PNS','Non-ASN','Belum diketahui')),
  golongan            VARCHAR(8),                -- 'III/b' atau 'IX' (PPPK)
  jabatan             TEXT,
  tanggal_lahir       DATE,
  jenis_kelamin       CHAR(1) CHECK (jenis_kelamin IN ('L','P')),
  agama               TEXT,
  no_whatsapp         TEXT,
  email               TEXT,
  tanggal_mulai_kerja DATE,
  status_aktif        TEXT NOT NULL DEFAULT 'Aktif',
  field_turunan       TEXT[] DEFAULT '{}',       -- mis. {'tanggal_lahir','jenis_kelamin'} = dibaca dari NIP
  dibuat_pada         TIMESTAMPTZ NOT NULL DEFAULT now(),
  diubah_pada         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Setiap cara sebuah sumber menyebut pegawai: NIP, NIKA, ID aplikasi (prefix foto), No. mesin per kantor, nama tertulis.
CREATE TABLE pegawai_alias (
  id                BIGSERIAL PRIMARY KEY,
  pegawai_id        BIGINT NOT NULL REFERENCES pegawai(id) ON DELETE CASCADE,
  jenis             TEXT NOT NULL CHECK (jenis IN ('nip','nika','app','mesin','nama')),
  nilai             TEXT NOT NULL,                -- 'Kanwil I:2', 'A. Muhari', '3.24.0404'
  nilai_normal      TEXT NOT NULL,                -- token nama yang dinormalisasi untuk pencarian
  sumber            TEXT NOT NULL,                -- 'Mesin absensi Kanwil II', 'Surat tugas Panitera'
  metode            TEXT NOT NULL CHECK (metode IN ('nip','nika','app','mesin','nama','manual')),
  skor              NUMERIC(3,2),
  dikonfirmasi_oleh TEXT,
  dikonfirmasi_pada TIMESTAMPTZ,
  UNIQUE (jenis, sumber, nilai_normal)
);
CREATE INDEX ON pegawai_alias (jenis, nilai_normal);

CREATE TABLE file_sumber (
  id            BIGSERIAL PRIMARY KEY,
  nama_file     TEXT NOT NULL,
  jenis         TEXT NOT NULL CHECK (jenis IN ('mesin','daring','matriks-kanwil','jadwal-kanwil','laporan-kanwil','surat-tugas')),
  kantor_id     SMALLINT REFERENCES kantor(id),
  periode_mulai DATE,
  periode_selesai DATE,
  tanggal_belum_lengkap DATE[] DEFAULT '{}',     -- ekspor diambil sebelum data hari itu lengkap
  sha256        CHAR(64) NOT NULL UNIQUE,         -- cegah impor ganda
  catatan_parser TEXT[],
  diimpor_oleh  TEXT NOT NULL,
  diimpor_pada  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Data mentah per baris/sel sumber; pegawai_id terisi setelah pencocokan identitas.
CREATE TABLE catatan_absensi (
  id            BIGSERIAL PRIMARY KEY,
  file_id       BIGINT NOT NULL REFERENCES file_sumber(id) ON DELETE CASCADE,
  pegawai_id    BIGINT REFERENCES pegawai(id),
  nama_tertulis TEXT NOT NULL,
  id_tertulis   TEXT,                             -- NIP/NIKA/No. mesin seperti tertulis
  tanggal       DATE NOT NULL,
  jadwal_masuk  TIME,
  jadwal_pulang TIME,
  label_jadwal  TEXT,                             -- 'Sen-Kam (2016)', 'Puasa Sen-Kam'
  jam_masuk     TIME,
  jam_pulang    TIME,
  hadir_tanpa_jam BOOLEAN DEFAULT false,          -- laporan kode Kanwil VI
  kode          TEXT CHECK (kode IN ('PD','DL','WFA','S','C','CB','I','DIKLAT','KO','X','ERR','T')),
  kode_asli     TEXT,
  mode          TEXT CHECK (mode IN ('WFO','WFA')),
  approved      BOOLEAN,
  lokasi        TEXT,
  lat_masuk     NUMERIC(9,6), lng_masuk NUMERIC(9,6),
  lat_pulang    NUMERIC(9,6), lng_pulang NUMERIC(9,6),
  terlambat_mnt INTEGER, pulang_cepat_mnt INTEGER, lembur_mnt INTEGER,
  catatan       TEXT[],                           -- 'jam-sama-hari-sebelumnya', 'jam-manual-absen-error'
  rujukan       TEXT NOT NULL                     -- 'Sheet1 · baris 4072'
);
CREATE INDEX ON catatan_absensi (pegawai_id, tanggal);

CREATE TABLE surat_tugas (
  id            BIGSERIAL PRIMARY KEY,
  file_id       BIGINT REFERENCES file_sumber(id),
  nomor         TEXT,                             -- NULL = penugasan tanpa nomor (ditandai sebagai isu)
  tanggal_st    DATE,
  kantor_id     SMALLINT REFERENCES kantor(id),
  unit          TEXT,                             -- 'Kesekjenan', 'Investigasi', 'Panitera'
  tujuan        TEXT,
  tanggal_mulai DATE NOT NULL,
  tanggal_selesai DATE NOT NULL CHECK (tanggal_selesai >= tanggal_mulai),
  tanggal_tertulis TEXT,                          -- '31 Ags-2 Sep 2026'
  lokal         BOOLEAN NOT NULL DEFAULT false,   -- ST lokal / dinas dalam kota ≤ 8 jam
  nomor_spd     TEXT
);

CREATE TABLE surat_tugas_pegawai (
  surat_tugas_id BIGINT NOT NULL REFERENCES surat_tugas(id) ON DELETE CASCADE,
  pegawai_id     BIGINT REFERENCES pegawai(id),   -- NULL sampai nama dicocokkan
  nama_tertulis  TEXT NOT NULL,
  rujukan        TEXT,
  PRIMARY KEY (surat_tugas_id, nama_tertulis)
);

CREATE TABLE hari_libur (
  tanggal   DATE PRIMARY KEY,
  nama      TEXT NOT NULL,
  jenis     TEXT NOT NULL CHECK (jenis IN ('nasional','cuti-bersama','kantor'))
);

-- Hasil rekonsiliasi per pegawai per hari (dihitung ulang setiap impor/keputusan).
CREATE TABLE rekap_harian (
  pegawai_id    BIGINT NOT NULL REFERENCES pegawai(id),
  tanggal       DATE NOT NULL,
  hari_kerja    BOOLEAN NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('hadir','hadir-wfa','dinas-lokal','dinas-luar','diklat','cuti','sakit','izin','tanpa-keterangan','tidak-lengkap','libur','tidak-ada-data')),
  dasar         TEXT NOT NULL,
  jam_masuk     TIME,
  jam_pulang    TIME,
  terlambat_mnt INTEGER NOT NULL DEFAULT 0,
  pulang_cepat_mnt INTEGER NOT NULL DEFAULT 0,
  lembur_mnt    INTEGER NOT NULL DEFAULT 0,
  status_um     TEXT NOT NULL CHECK (status_um IN ('eligible','held','excluded')),
  alasan_um     TEXT NOT NULL,
  nominal_um    INTEGER NOT NULL DEFAULT 0,
  aturan_um_id  INTEGER,
  PRIMARY KEY (pegawai_id, tanggal)
);

CREATE TABLE isu (
  id          TEXT PRIMARY KEY,                   -- '<pegawai>|<tanggal>|<jenis>' agar stabil antar impor
  pegawai_id  BIGINT NOT NULL REFERENCES pegawai(id),
  tanggal     DATE NOT NULL,
  jenis       TEXT NOT NULL,                      -- 'dinas-vs-scan-kantor', 'st-tumpang-tindih', ...
  tingkat     TEXT NOT NULL CHECK (tingkat IN ('tinggi','sedang','rendah')),
  detail      TEXT NOT NULL,
  menahan_um  BOOLEAN NOT NULL,
  catatan_ids BIGINT[],
  surat_tugas_ids BIGINT[]
);

CREATE TABLE keputusan (
  id          BIGSERIAL PRIMARY KEY,
  isu_id      TEXT NOT NULL REFERENCES isu(id),
  keputusan   TEXT NOT NULL CHECK (keputusan IN ('akui-hadir','akui-dinas','tidak-hadir','valid')),
  catatan     TEXT,
  reviewer    TEXT NOT NULL,
  waktu       TIMESTAMPTZ NOT NULL DEFAULT now(),
  dibatalkan_pada TIMESTAMPTZ                      -- tidak dihapus, hanya dibatalkan (jejak audit)
);

CREATE TABLE aturan_uang_makan (
  id                   SERIAL PRIMARY KEY,
  berlaku_mulai        DATE NOT NULL,
  wajib_scan_lengkap   BOOLEAN NOT NULL,
  wajib_tepat_waktu    BOOLEAN NOT NULL,
  toleransi_terlambat  SMALLINT NOT NULL DEFAULT 0,
  pulang_cepat_gugur   BOOLEAN NOT NULL,
  wfa_dihitung         BOOLEAN NOT NULL,
  dinas_lokal_dihitung BOOLEAN NOT NULL,
  tarif                JSONB NOT NULL,             -- {"I":35000,"II":35000,"III":37000,"IV":41000}
  pph_persen           JSONB NOT NULL,             -- {"I":0,"II":0,"III":5,"IV":15}
  disetujui_oleh       TEXT
);

CREATE TABLE periode_uang_makan (
  periode        CHAR(7) PRIMARY KEY,              -- '2026-09'
  aturan_id      INTEGER NOT NULL REFERENCES aturan_uang_makan(id),
  status         TEXT NOT NULL DEFAULT 'draf' CHECK (status IN ('draf','diajukan','disetujui','terkunci')),
  total_bruto    BIGINT, total_pph BIGINT, total_netto BIGINT,
  disetujui_oleh TEXT, disetujui_pada TIMESTAMPTZ
);
