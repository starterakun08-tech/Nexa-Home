# Rencana Kerja Tahap W2 — Nexa Home Web

Dokumen ini merinci rencana eksekusi TAHAP W2 untuk perbaikan web Nexa Home, mencakup empat pekerjaan utama dan perbaikan bug terlapor (BUG-01 hingga BUG-17).

---

## 1. Tata Kelola & Batasan Keras
- **Nama Produk**: "Nexa Home" di seluruh UI. Jika ada kata "Rumah" yang dipakai sebagai nama produk di `web/`, diganti ke "Nexa Home" melalui konstanta terpusat `APP_NAME` (dan dicatat lokasinya).
- **Git Branch**: `w2-perbaikan` dengan satu commit per pekerjaan:
  1. `feat(w2): perbaikan bug putus perangkat (Pekerjaan 1)`
  2. `feat(w2): pembersihan fungsi dan akun admin lama (Pekerjaan 2)`
  3. `feat(w2): menu pengaturan dropdown sidebar (Pekerjaan 3)`
  4. `feat(w2): antarmuka keluarga daftar anggota (Pekerjaan 4)`
- **Backup Database**: Salinan SQLite `server/data/rumah.db` beserta `-wal` dan `-shm` disimpan di `backups/rumah_20261016_130040.db` sebelum modifikasi data apa pun.
- **Batasan Sentuh**: Backend (`server/`) disentuh HANYA untuk Pekerjaan 1, Pekerjaan 2, dan perbaikan bug kritis/tinggi backend. `firmware/` dan `camera-app/` TIDAK disentuh sama sekali. `app/` (Flutter) hanya disentuh seminimal mungkin bila ada referensi yang dihapus di Pekerjaan 2 agar tetap dapat dikompilasi.
- **Desain & Token**: Tidak ada warna hex baru. Token acuan adalah halaman Beranda (kartu tanpa border, radius lembut). Satu token bentuk baru yang diizinkan adalah `radius-seg-dalam = 6px` di `design-tokens.json` untuk Pekerjaan 4.

---

## 2. Pekerjaan 1 — Bug Tombol "Ya, Putuskan Perangkat"
### Akar Masalah (Root Cause)
1. **Frontend (`web/src/pages/PerangkatPage.tsx`)**:
   - `unbindMutation` tidak memiliki state disable `isPending` pada tombol, membuka celah race condition / double-click.
   - Tidak ada blok penanganan `onError` yang menampilkan pesan galat faktual di dalam dialog modal beserta tombol "Coba lagi".
   - Teks dialog menjanjikan reset ke mode SoftAP secara mutlak tanpa memeriksa apakah perangkat sedang online atau offline.
2. **Backend (`server/app/api/routes/devices.py`)**:
   - Query `list_devices` menyertakan `or_(Device.owner_id.is_(None), Device.owner_id.in_(family_ids))`. Saat `dev.owner_id = None`, perangkat tetap muncul di daftar perangkat karena kondisi `owner_id.is_(None)` terpenuhi.
   - Endpoint `unbind_device` belum mengikat pelepasan kepemilikan, pencabutan kredensial MQTT, reload ACL broker Mosquitto, publikasi reset bersyarat (hanya jika online), dan pencatatan audit log ke dalam satu transaksi atomik.
   - Celah otorisasi fallback `elif not current_user.family_id: is_family = True` (BUG-03) pada endpoint kontrol perangkat.

### Solusi & Rencana Eksekusi
1. Di `server/app/api/routes/devices.py`:
   - Ubah query `list_devices` agar hanya mengambil perangkat milik keluarga terkait (`Device.owner_id.in_(family_user_ids)`), menghapus inklusi `owner_id.is_(None)`.
   - Perbaiki `unbind_device`:
     - Pastikan hanya pemilik (`pemilik` / `admin`) yang diizinkan (role guard 403).
     - Jalankan dalam transaksi: `dev.owner_id = None`, hapus kredensial MQTT perangkat dari database/ACL, kirim publish MQTT factory reset HANYA bila perangkat berstatus online (`is_online == True`), catat audit log `device_unbound`.
     - Perbaiki otorisasi kontrol perangkat (BUG-03).
     - Perbaiki query sinkronisasi perangkat keluarga (BUG-09b).
2. Di `web/src/pages/PerangkatPage.tsx`:
   - Tampilkan teks dialog jujur berdasarkan status perangkat:
     - Jika offline: *"Perangkat sedang offline dan tidak akan menerima perintah reset. Perangkat dilepas dari akun. Untuk mengatur ulang WiFi-nya, tekan dan tahan tombol reset di alat."*
     - Jika online: *"Perangkat ESP32 akan diputuskan dari akun Anda dan dikembalikan ke kondisi baru. Server akan mengirim perintah factory reset ke modul agar menghapus konfigurasi WiFi dan kembali ke mode Access Point (SoftAP)."*
   - Tombol "Ya, Putuskan Perangkat" nonaktif dengan indikator datar saat loading (`isPending`), request idempoten.
   - Jika sukses: dialog menutup, data di-invalidasi tanpa reload penuh, muncul snackbar datar "Perangkat diputuskan".
   - Jika gagal: dialog tetap terbuka, tampilkan pesan galat faktual dan tombol "Coba lagi".
   - Tampilkan kembali relay exhaust fan (`relay_fan`) di panel saklar (BUG-07).

---

## 3. Pekerjaan 2 — Pembersihan Admin & Kode Lama
### Target & Tindakan
1. **Inventaris Kode & Route**:
   - Jalankan `check_tokens.py`, pencarian grep untuk artefak lama (`admin`, `setup`, `seed`, `bootstrap`).
   - Catat di `docs/w2-pembersihan.md` daftar item, lokasi, referensi, dan keputusan.
2. **Penyatuan Peran**:
   - Label tampilan di seluruh antarmuka web diubah dari "Admin" menjadi "Pemilik".
   - Pertahankan penegakan otorisasi di server dan map peran backend (`admin` / `pemilik`) secara konsisten.
   - Perbaiki `MemberDetailPage.tsx` yang mental ketika dibuka oleh pemilik (BUG-04).
   - Perbaiki role leak di `PUT /api/family/settings` agar hanya pemilik yang bisa mengubah (BUG-09).
   - Perbaiki mutasi delete member agar tidak meninggalkan role kosong (BUG-11).
3. **Pembersihan Akun**:
   - Identifikasi akun di database. Hapus hanya akun uji/seed dummy (`admin_hb_tester`, `test_whep_user`, `user_1791955919`, `test_baru_123`).
   - PERTAHANKAN akun asli pengguna (`budi`, `siti`, `anak`, `risang`, `aujasenarisang`, `dtrbinu`).
4. **Halaman Setup Akun Pertama**:
   - Sesuaikan tampilan `LoginPage.tsx` saat mode setup:
     - Judul: "Buat akun pemilik" (hilangkan "Penyiapan Admin" dan badge "Setup").
     - Subjudul: "Akun pertama untuk Nexa Home. Kode setup tampil di konsol server."
     - Tombol: "Buat akun".
     - Hapus teks dekoratif tidak faktual "Protokol Jaringan: MQTT · TLS" dan footer "Protokol MQTT · 2026".
5. **Aset Model Besar**:
   - Pindahkan file `yolo*.onnx` dan `yolo*.pt` dari root repo ke folder `models/` dan perbarui `.gitignore`.
6. **Perbaikan Terlapor Lainnya**:
   - Ganti sisa string branding "Rumah" menjadi "Nexa Home" (BUG-16).
   - Pasang guard `ApprovalPendingScreen.tsx` untuk akun yang belum disetujui (BUG-14).

---

## 4. Pekerjaan 3 — Menu Pengaturan Dropdown di Sidebar
### Target & Komponen
1. **Sidebar Dropdown (Cloudflare Compute Style)**:
   - Buat komponen modular: `NavGroup` dan `NavSubItem`.
   - Baris induk "Pengaturan" dilengkapi ikon, label, dan chevron kanan (berotasi ke bawah saat terbuka).
   - Garis vertikal 1px (`var(--color-border)`) di sisi kiri daftar anak yang menjorok.
   - Baris anak tinggi 36px, teks 15px, tanpa ikon. State aktif berlatar tint ON dengan teks aksen 600. Hover berlatar inset.
   - Mendukung badge "Beta" dan sub-grup beranak di masa depan.
   - Keyboard accessible: Enter/Space untuk toggle, outline fokus 2px aksen, atribut `aria-expanded`, `aria-controls`, `aria-current="page"`.
   - Animasi buka-tutup halus <= 150ms dengan dukungan `prefers-reduced-motion`.
   - Di mobile/drawer sidebar, behavior tetap konsisten.
2. **Rute & Redirection**:
   - Rute anak: `/pengaturan/akun`, `/pengaturan/privasi`, `/pengaturan/kamera`, `/pengaturan/suara`, `/pengaturan/kanal`, `/pengaturan/audit`.
   - Hapus bilah tab horizontal lama di konten `PengaturanPage.tsx`.
   - `/pengaturan` dialihkan ke rute terakhir dari `localStorage` atau default ke `/pengaturan/akun`.
3. **Audit Opsi Pengaturan**:
   - Hapus opsi kontrol privasi palsu "Pengenalan anggota keluarga — Deteksi wajah per orang" karena arsitektur Nexa Home berbasis anonimitas tanpa pengenalan wajah.
   - Hubungkan saklar privasi riil dengan endpoint backend agar tersimpan persisten (BUG-08).
   - Hubungkan histori kegiatan dengan event riil backend (BUG-12).
   - Perbaiki otorisasi audio TTS pada tab suara asisten (BUG-06).
   - Perbaiki bug konfirmasi asisten di frontend dan backend (BUG-01, BUG-02).

---

## 5. Pekerjaan 4 — Halaman Keluarga Bergaya Daftar Anggota
### Target & Desain
1. **Desain Daftar Anggota (Acuan Google Family)**:
   - Lebar maksimum 800px, rata tengah, kartu borderless, latar kartu dengan pemisah celah 2px.
   - Tambahkan token `radius-seg-dalam = 6px` ke `design-tokens.json` dan jalankan generator token.
   - Buat komponen bersama: `SegmentedList`, `ListRow`, `Avatar`, `InfoRow`, `ConfirmDialog`.
   - Baris pertama: radius atas 20px, bawah 6px. Baris tengah: semua sudut 6px. Baris terakhir: atas 6px, bawah 20px. Baris tunggal: semua 20px.
   - Tinggi baris min 72px, padding 16px 20px, avatar inisial bulat 48px, nama 15/600 (tambahkan "(Anda)" untuk pengguna aktif), subteks peran 13/400.
   - Status undangan pending ditaruh di bawah dengan titik peringatan 8px + "Menunggu diterima".
2. **Banner Status Deteksi**:
   - Jika Vision Worker offline, tampilkan kartu datar tint bahaya: *"Deteksi aktivitas tidak aktif. Layanan penglihatan tidak merespons, jadi deteksi postur, zona, dan jatuh tidak berjalan."* (Hilangkan istilah "heartbeat" / "AI Tidak Aktif").
3. **Dialog "Undang Anggota"**:
   - Modal datar di tengah (atau bottom sheet di mobile), radius 20px, input username, tombol Batal dan Kirim Undangan.
   - State reaktif useQuery agar anggota langsung muncul begitu undangan diterima (BUG-10).
4. **Halaman Detail Anggota (`/keluarga/:id`)**:
   - Avatar besar 72px, nama, username mono, ubah peran (hanya pemilik).
   - Tombol "Hapus Anggota" berwarna bahaya dengan dialog konfirmasi.
   - Larangan menghapus diri sendiri dan larangan menghapus/menurunkan pemilik terakhir (tombol disabled dengan tooltip keterangan).
5. **Pemeriksaan Kontras & Responsivitas**:
   - Pastikan rasio kontras teks sekunder memenuhi WCAG AA minimal 4.5:1.
   - Uji tampilan responsif pada 1440px, 1024px, 768px, dan 390px.

---

## 6. Verifikasi Akhir & Laporan
- Pengujian otomatis: `pytest` untuk backend, `npm run build` & `npm run test` untuk web, `check_tokens.py`.
- Screenshot SESUDAH di `docs/ui-review/web/w2/after/` untuk semua halaman terkait (Desktop Light/Dark, Mobile Light).
- Build produksi `web/dist` dan pastikan reverse proxy / server menyajikan build baru.
- Laporan final 10 poin sesuai spesifikasi tugas.
