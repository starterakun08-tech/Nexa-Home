# Proyek "Rumah" — Smart Home + Asisten AI + Pengawasan Keluarga

Sistem Smart Home mandiri yang dirancang untuk privasi penuh (pemrosesan lokal), efisiensi hardware, dan kestabilan jangka panjang.

**Target Lingkungan Server:**
- Sistem Operasi: Windows 10 (64-bit)
- Spesifikasi Pengujian Nyata: 11th Gen Intel(R) Core(TM) i7-1185G7 @ 3.00GHz (4 Core / 8 Thread, 31.73 GB RAM, tanpa GPU diskrit)
- Catatan Kejujuran: TIDAK DIUKUR pada Intel Core i3 Gen 4.

---

## Memulai dari Nol (Panduan Cepat)

Untuk memulai seluruh sistem dari repositori baru:

```powershell
.\scripts\setup.ps1
.\scripts\dev.ps1
```

1. **`.\scripts\setup.ps1`**: Idempoten. Memeriksa alat (Git, Python 3.11, Node.js LTS, Flutter jika `-WithMobile`), membuat virtual environment, menginstal dependensi, menyalin `.env.example` ke `.env` (tanpa menimpa), dan menjalankan verifikasi awal.
2. **`.\scripts\dev.ps1`**: Menjalankan server backend FastAPI dan server frontend secara bersamaan.

---

## Struktur Repositori (Monorepo)

```text
├── docs/               # Dokumentasi keputusan arsitektur (DECISIONS.md)
├── server/             # Backend Python 3.11 (FastAPI, SQLite WAL, SQLAlchemy, Argon2, TOTP)
│   ├── app/
│   │   ├── api/routes/ # Endpoint API (/auth, /audit-logs, /health, /test)
│   │   ├── core/       # Konfigurasi, Security (Argon2, TOTP, JWT), SetupManager, Database
│   │   ├── models/     # Model SQLAlchemy (User, RefreshToken, AuditLog)
│   │   └── main.py     # Entrypoint aplikasi FastAPI
│   ├── data/           # Database SQLite lokal (rumah.db)
│   └── tests/          # Pengujian otomatis backend (pytest)
├── app/                # Aplikasi Mobile Utama (Android Native Flutter)
│   ├── lib/
│   │   ├── components/ # Komponen dasar (AppButton, AppCard, AppSwitch, AppBadge, AppInput, AppToast, EmptyState)
│   │   ├── core/       # State Riverpod, ApiClient Dio, StorageService
│   │   ├── screens/    # SetupWizard, Login, Verify2FA, Shell (6 Tab), DesignScreen (Debug)
│   │   └── theme/      # tokens.dart (dihasilkan otomatis dari design-tokens.json)
│   └── assets/fonts/   # Font lokal offline (Public Sans & IBM Plex Mono)
├── web/                # Frontend Web Cadangan (React 19 + Vite - STATUS: DIBEKUKAN)
├── firmware/           # Firmware MicroPython untuk ESP32
│   └── legacy/         # Cadangan firmware lama (.gitignore aktif)
├── camera-app/         # Direktori persiapan modul kamera HP bekas (Tahap 4)
├── scripts/
│   ├── setup.ps1       # Satu perintah setup otomatis lingkungan Windows
│   ├── dev.ps1         # Runner multi-proses layanan pengembangan
│   ├── gen_flutter_theme.py # Generator tokens.dart dari design-tokens.json
│   └── check_tokens.py # Linter otomatis kepatuhan token desain (Web & Flutter)
├── .env.example        # Template konfigurasi rahasia & parameter sistem
├── .gitignore          # Pengabaian rahasia, venv, node_modules, build artifacts
└── pyproject.toml      # Konfigurasi pytest dan ruff
```

---

## Alur Autentikasi & Setup Wizard (Tahap 1)

1. **Setup Admin Sekali Pakai (One-Time Console Code):**
   - Saat backend pertama kali dijalankan tanpa akun admin di database, server secara otomatis mencetak kode acak sekali pakai di konsol terminal (misal: `RUMAH-A8F2K9`).
   - Endpoint `POST /api/auth/setup-admin` hanya dapat diakses melalui **Localhost atau Jaringan Lokal (LAN privat)**. Akses dari IP publik otomatis ditolak (HTTP 403).
   - Admin pertama wajib memasangkan **TOTP 2FA** dan menerima **8 kode pemulihan (recovery codes)** sekali pakai.
2. **Autentikasi & Peran (RBAC):**
   - Kata sandi di-hash menggunakan **Argon2id**.
   - Login admin mengembalikan status `2fa_required` dan membutuhkan kode TOTP 6 digit atau recovery code.
   - Peran pengguna didukung secara ketat di backend: `admin`, `member`, `child`.
   - Log audit dicatat otomatis pada setiap aktivitas autentikasi dan pembuatan akun di tabel `audit_logs`.

---

## Pengujian dan Pemeriksaan Mutu

### 1. Pengujian Backend (pytest)
```powershell
.\server\.venv\Scripts\python.exe -m pytest -v
```

### 2. Pemeriksaan Kepatuhan Token Desain (Web & Flutter)
```powershell
.\server\.venv\Scripts\python.exe scripts\check_tokens.py
```
*Memverifikasi tidak ada warna HEX `#...`, `Color(0x...)`, atau `Colors.xxx` yang di-hardcode di luar berkas token.*

### 3. Pengujian Aplikasi Flutter
```powershell
cd app
flutter test
flutter analyze
cd ..
```

### 4. Build APK Release Android (Split ABI)
```powershell
cd app
flutter build apk --release --split-per-abi
cd ..
```
*Hasil APK arsitektur modern tersimpan di `app/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk` (~16.9 MB).*

### 5. Cara Menguji Aplikasi Android di HP Asli lewat LAN
Aplikasi telah dilengkapi konfigurasi [network_security_config.xml](file:///c:/Users/DELL/Downloads/Nexa%20Home/app/android/app/src/main/res/xml/network_security_config.xml) untuk mengizinkan lalu lintas HTTP lokal di jaringan pribadi (RFC 1918):
1. Pastikan laptop/server dan HP terhubung ke WiFi/LAN yang sama.
2. Cari IP lokal server (contoh: jalankan `ipconfig`, misal `192.168.1.50`).
3. Pasang APK (`app-arm64-v8a-release.apk`) di HP Android.
4. Buka aplikasi, masuk ke menu **Pengaturan**, dan ubah Alamat Server menjadi `http://192.168.1.50:8000`.
5. Aplikasi akan langsung terhubung ke server backend secara lancar tanpa hambatan blokir cleartext Android.

### 6. Cara Menguji Koneksi Mosquitto MQTT dari Perangkat Lain di LAN
Broker Mosquitto mendengarkan di antarmuka `0.0.0.0:1883` dengan `allow_anonymous false` dan dilindungi Windows Firewall (aturan `Rumah-Mosquitto-LocalSubnet` hanya mengizinkan subnet lokal).

Untuk menguji konektivitas dari perangkat lain (laptop lain, HP, atau ESP32):
1. **Dapatkan IP LAN Server**: Jalankan `ipconfig` di server (misal: `192.168.1.50`).
2. **Uji dari Terminal Komputer Lain** (menggunakan klien Mosquitto resmi):
   ```bash
   # Berlangganan (Subscribe) ke topik perangkat:
   mosquitto_sub -h 192.168.1.50 -p 1883 -u <DEVICE_ID> -P <DEVICE_MQTT_PASSWORD> -t "home/<DEVICE_ID>/cmd"

   # Mengirim (Publish) status dari perangkat:
   mosquitto_pub -h 192.168.1.50 -p 1883 -u <DEVICE_ID> -P <DEVICE_MQTT_PASSWORD> -t "home/<DEVICE_ID>/state" -m "{\"channels\":{\"ch1\":true}}"
   ```
3. **Uji dari HP Android**:
   - Pasang aplikasi seperti **MQTT Analyzer** atau **MQTT Dash** dari Google Play Store.
   - Tambahkan broker dengan host `192.168.1.50`, port `1883`, Client ID bebas, username dan password sesuai akun perangkat yang dibuat di menu Perangkat admin.
   - Sambungkan; jika kredensial benar, status akan `Connected`. Jika kredensial salah atau anonim, koneksi ditolak (RC 4/5).
4. **Verifikasi Firewall**:
   Jika perangkat di LAN gagal terhubung (timeout), pastikan aturan Windows Firewall aktif:
   ```powershell
   Get-NetFirewallRule -DisplayName "Rumah-Mosquitto-LocalSubnet"
   ```

### 7. Skrip Pemulihan Pengelola Akun Keluarga (`scripts/set_pengelola.py`)
Sesuai aturan keamanan Nexa Home, Pengelola akun keluarga tepat **SATU** orang per keluarga dan **tidak dapat diubah atau ditransfer melalui antarmuka web/aplikasi**.
Jika pengelola kehilangan akses atau perlu dipindahkan secara fisik:
1. Akses terminal/konsol mesin server lokal secara langsung.
2. Jalankan perintah pemulihan:
   ```bash
   python scripts/set_pengelola.py <username_tujuan>
   ```
3. Konfirmasikan pemindahan peran saat diminta (`y`).
4. Skrip akan memindahkan hak Pengelola dalam satu transaksi atomik di SQLite dan mencatat log audit keamanannya.

---

## Catatan Keamanan Hardware (ESP32 & Sensor MQ-2)

> [!WARNING]
> **PENTING — Pembagi Tegangan ADC ESP32:**
> Output analog dari sensor gas MQ-2 menghasilkan sinyal hingga **5,0 V**, sedangkan batas toleransi ADC ESP32 (pin GPIO 33) maksimal adalah **3,3 V**. 
> Anda **WAJIB** memasang rangkaian pembagi tegangan (*voltage divider*) menggunakan 2 resistor (misalnya R1 = 10kΩ ke pin A0 sensor, R2 = 20kΩ ke GND, dan titik tengah dihubungkan ke GPIO 33 ESP32) agar chip ESP32 tidak terbakar atau rusak permanen.

---

## Panduan Setup Notifikasi Push (FCM Opsional)

Sistem menggunakan antarmuka `NotificationProvider` dengan dua penyedia:
1. **`InAppNotificationProvider` (Default / Aktif Otomatis)**:
   - Kejadian disimpan di database lokal SQLite, disiarkan langsung melalui WebSocket server, dan memunculkan badge notifikasi di aplikasi web serta mobile tanpa memerlukan layanan luar.
2. **`FCMNotificationProvider` (Opsional)**:
   - Digunakan untuk push notification ke smartphone keluarga saat aplikasi sedang berjalan di background atau layar terkunci.
   - **Jaminan Privasi**: Payload push notification **HANYA BERUPA TEKS GENERIK**: `"Ada peringatan baru di Rumah"`. Detail spesifik (tipe kejadian, ruangan, waktu) tidak pernah dikirimkan ke server Firebase; detail baru diambil secara aman oleh aplikasi langsung dari server lokal setelah login.

### Langkah Setup Kredensial Firebase (Bila Ingin Mengaktifkan):
1. Buka [Firebase Console](https://console.firebase.google.com/) dan buat project baru (misal: "Rumah Smart Home").
2. Masuk ke **Project Settings** > tab **Service accounts**.
3. Klik tombol **Generate new private key** untuk mengunduh berkas Service Account JSON.
4. Letakkan berkas JSON tersebut ke dalam direktori server yang aman (misalnya: `server/data/firebase-credentials.json` — pastikan diabaikan oleh `.gitignore`).
5. Tambahkan baris konfigurasi berikut ke berkas `.env`:
   ```bash
   FCM_CREDENTIALS_JSON_PATH="server/data/firebase-credentials.json"
   ```
6. Bila berkas kredensial tidak ada di `.env`, penyedia FCM secara otomatis **TIDAK AKTIF** dan sistem sepenuhnya menggunakan `inapp` tanpa error.

---

## Status Tahap Pengembangan

- [x] **Tahap 0: Fondasi Repo dan Keputusan** (Selesai)
- [x] **Tahap 1: Backend Inti, Autentikasi, dan App Android Flutter** (Selesai)
- [x] **Tahap 2: Kontrol IoT (MQTT) dan Firmware Baru** (Selesai)
- [x] **Tahap 3: Asisten Percakapan dan Suara (DeepSeek + TTS/STT)** (Selesai)
- [x] **Tahap 4: Kamera dari HP Bekas (WebRTC / MediaMTX)** (Selesai)
- [x] **Tahap 5: Vision AI dan Pencarian Barang (YOLO11 ONNX)** (Selesai)
- [x] **Tahap 6: Insight Keluarga (Aturan Otomasi & Privasi)** (Selesai)
- [ ] **Tahap 7: Pengerasan Keamanan dan Peluncuran**

