# Inventarisasi Pembersihan Pekerjaan 2 — Nexa Home (TAHAP W2)

## 1. Pembersihan Akun Test / Seed Database
Database aktif `server/data/rumah.db` telah dibersihkan dari akun-akun sisa pengujian otomatis atau seed lama tanpa relasi/referensi aktif:

### Akun yang Dihapus:
1. `admin_hb_tester` (ID 10) — Akun test otomatis heartbeat/integration.
2. `test_whep_user` (ID 9) — Akun uji coba WHEP streaming.
3. `user_1791955919` (ID 5) — Akun sementara uji coba registrasi numerik.
4. `test_baru_123` (ID 6) — Akun uji coba registrasi manual.

### Akun Riil yang Dipertahankan:
1. `budi` (ID 2, Pemilik / Keluarga Utama, TOTP terdaftar `JBSWY3DPEHPK3PXP`)
2. `siti` (ID 3, Anggota Keluarga)
3. `anak` (ID 4, Tamu)
4. `risang` (ID 7, Pemilik)
5. `prinsess` (ID 8, Tamu)
6. `dtrbinu` (ID 11, Pemilik)

Backup database sebelum pembersihan tersimpan aman di `backups/rumah_20261016_130040.db` beserta berkas `-wal` dan `-shm`.

---

## 2. Relokasi Bobot Model YOLO
Semua file model YOLO yang sebelumnya mengotori root folder proyek telah dipindahkan ke direktori `models/`:
- `yolo11n-pose.onnx` -> `models/yolo11n-pose.onnx`
- `yolo11n-pose.pt` -> `models/yolo11n-pose.pt`
- `yolo11n.onnx` -> `models/yolo11n.onnx`
- `yolo11n.pt` -> `models/yolo11n.pt`
- `yolo11s.onnx` -> `models/yolo11s.onnx`
- `yolo11s.pt` -> `models/yolo11s.pt`

`.gitignore` diperbarui untuk mengabaikan bobot model biner (`models/*.pt`, `models/*.onnx`, `models/*.engine`, dll.) agar tidak mengotori repositori Git.

---

## 3. Penyatuan Label Peran dan Perbaikan Setup Pemilik
1. **Label Peran Tunggal di UI**:
   - Dibuat `web/src/utils/roleLabels.ts` dengan fungsi `getRoleLabel()` dan `isOwnerRole()`.
   - Peran `"admin"` dan `"pemilik"` secara konsisten ditampilkan sebagai **"Pemilik"** di seluruh antarmuka web Nexa Home.
   - Memperbaiki **BUG-17**: Label peran di `AppShell.tsx` dan `AppShell.module.css` ditampilkan dengan rapi di bawah nama pengguna.
   - Memperbaiki **BUG-04**: Pengecekan peran di `MemberDetailPage.tsx` menggunakan `isOwnerRole()` sehingga pemilik tidak terblokir dengan salah.
2. **Setup Wizard Pemilik Pertama (`/login`)**:
   - Judul diubah menjadi: **"Buat akun pemilik"**
   - Subtitle: **"Akun pertama untuk Nexa Home. Kode setup tampil di konsol server."**
   - Tombol submit: **"Buat akun"**
   - Dihilangkan badge "Setup" redundan dan dekorasi "MQTT · TLS / Protokol MQTT · 2026".
   - Alur pembuatan akun pemilik pertama diuji dan dipastikan aman saat database baru dibuat.
3. **Persetujuan Akun Belum Disetujui (BUG-14)**:
   - `App.tsx` telah dihubungkan dengan `<ApprovalPendingScreen />` di dalam `ProtectedRoute` saat `user && !user.is_approved`.
4. **Keamanan Rute Keluarga (BUG-09 & BUG-11)**:
   - `PUT /family/settings` dikunci hanya untuk peran pemilik/admin (`require_role("admin", "pemilik")`).
   - Penghapusan anggota keluarga di `server/app/api/routes/family.py` mengembalikan peran target menjadi `"biasa"`.
5. **Standardisasi Nama Brand (BUG-16)**:
   - Dibuat `web/src/constants/app.ts` (`APP_NAME = 'Nexa Home'`).
   - Semua teks "Rumah" yang digunakan sebagai nama produk/aplikasi di web maupun server diganti menjadi "Nexa Home".

---

## 4. Inventarisasi Kode Mati dan Jalur Legacy

| Komponen / File | Status Lama | Penanganan / Keputusan | Catatan |
|---|---|---|---|
| `models/` (root *.pt, *.onnx) | Mengotori root direktori workspace | Direlokasi ke `models/` & diabaikan di `.gitignore` | Kode backend/analitik mengarah ke `models/` jika diperlukan |
| Akun test seed di DB | 4 akun test tak terpakai | Dihapus tuntas dari `server/data/rumah.db` | Akun riil tetap utuh |
| Rute `/admin/*` lama | Ada pengecekan legacy `admin` vs `pemilik` di beberapa handler | Disatukan di backend (`require_role("admin", "pemilik")`) dan di frontend (`isOwnerRole()`) | Skema token JWT tetap kompatibel dengan mobile app Flutter |
| `fallback is_family` di `send_device_command` | Membuka kontrol perangkat jika `family_id` kosong (BUG-03) | Dihapus di Pekerjaan 1 | Hanya anggota keluarga terverifikasi yang dapat mengirim perintah |
| Teks mock/dekorasi di LoginPage | "MQTT · TLS" dan "Protokol MQTT · 2026" | Dihapus di Pekerjaan 2 | UI bersih dan fungsional |
| Toggle pengenalan wajah palsu | Dummy UI tanpa backend | Dijadwalkan dihapus di Pekerjaan 3 | Menghindari ilusi fitur privasi |
