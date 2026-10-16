# Pemetaan Alur Pairing dan Klaim Perangkat Saat Ini (Sebelum Tahap S)

Dokumen ini memetakan kondisi sistem eksisting pada server, web, firmware, dan aplikasi mobile Nexa Home sebelum implementasi TAHAP S.

---

## 1. Siapa yang Membuat Kode dan Token Pairing

| Komponen | Mekanisme Pembuatan | Nilai yang Dihasilkan |
|---|---|---|
| **Firmware MicroPython (`firmware/esp32_thonny.py`)** | Fungsi lambda baris 16: `generate_pair_code = lambda: "%06d" % ((urandom.getrandbits(24) if urandom else _ms()) % 1000000)` | 6-digit angka desimal acak. |
| **Firmware C++ PlatformIO (`firmware/esp32/src/main.cpp`)** | Fungsi `initDeviceIdentity()` baris 208-210: diturunkan secara statis dari MAC address eFuse: `snprintf(claimTokenBuf, sizeof(claimTokenBuf), "NEXA-%04X-%04X", ...)` | String statis berformat `NEXA-XXXX-XXXX` (tidak pernah berubah seumur hidup perangkat). |
| **Server Backend (`server/app/core/device_queue.py`)** | Tidak membuat kode sendiri; menerima kode dari perangkat via polling HTTP MicroPython melalui `register_pair_code(pair_code, device_id, ...)` (baris 25-45). | Menyimpan string kode 6-digit. |

---

## 2. Bagaimana Kode Disimpan

| Lokasi | Metode Penyimpanan | Keamanan / Hash |
|---|---|---|
| **Firmware MicroPython** | Disimpan di flash NVS/file sistem lokal `wifi_config.json` via `save_wifi_config()` (baris 21-24). | **Teks biasa (plain text)** tanpa hash atau enkripsi. Kode ini statis di flash dan dimuat ulang setiap reboot (`PAIR_CODE = _cfg.get("pair_code") or ...`). |
| **Firmware C++** | Diturunkan saat runtime dari eFuse MAC address. | **Teks biasa (plain text)** di memori RAM dan ditampilkan di web portal Captive Portal. |
| **Server Memory (`device_queue.py`)** | Disimpan dalam dictionary memori in-memory Python: `self._pair_codes[code_str] = {...}` (baris 37-43). | **Teks biasa (plain text)**, tanpa hash sha256 atau salt. |
| **Database Server SQLite** | Belum ada tabel sesi klaim (`claim_sessions`). Di tabel `devices`, kolom `mqtt_password_hash` menyimpan hash/plain token MQTT. | Tidak ada riwayat hash sesi klaim di database. |

---

## 3. Masa Berlaku Kode

- **Server (`device_queue.py` baris 54)**: Berlaku selama **1800 detik (30 menit)** (`time.time() - entry.get("updated_at", 0) < 1800`).
- **Firmware MicroPython**: Berlaku **selamanya** selama file `wifi_config.json` ada dan belum di-factory reset.
- **Firmware C++**: Berlaku **selamanya** karena diturunkan dari alamat fisik MAC hardware.
- **Kesesuaian Invarian I5**: Menyimpang dari aturan (seharusnya 120 detik sekali pakai dengan rotasi otomatis).

---

## 4. Apakah Ditandai Terpakai?

- **Server**: **TIDAK PERNAH DITANDAI TERPAKAI**.
  Pada `claim_device` di `server/app/api/routes/devices.py` (baris 250-370), fungsi memanggil `device_queue.resolve_pair_code(token)`. Namun setelah perangkat berhasil diklaim dan diikat ke pengguna:
  - Kode **tidak dihapus** dari `device_queue._pair_codes`.
  - Kode **tidak memiliki flag status** ('aktif', 'terpakai', 'kedaluwarsa', 'dicabut').
  - Akibatnya: kode yang sama dapat dipanggil berulang kali oleh akun mana pun selama jendela 1800 detik masih aktif (bug reproduksi c).

---

## 5. Apa yang Terjadi Saat Klaim (`POST /api/devices/claim`)

Alur eksekusi di `server/app/api/routes/devices.py` (baris 250-370):
1. **Ekstraksi Target**:
   Membaca `device_id` dan `token` (atau `pair_code`).
   Jika `token` ada, panggil `device_queue.resolve_pair_code(token)`.
   Jika tidak ketemu dan `target_device_id` ada, panggil `device_queue.resolve_pair_code(target_device_id)` (baris 267).
   *Celah Invarian I8*: Menyediakan `target_device_id` saja tanpa kode pairing dapat meloloskan klaim jika ID cocok dengan antrean in-memory!
2. **Fallback ID**:
   Jika `target_device_id` kosong tetapi `token` berupa 6-digit angka, server membuat ID temporer: `target_device_id = f"esp32_{token}"` (baris 275). Ini menyebabkan terbentuknya perangkat palsu seperti `466923` atau `esp32_466923` di database.
3. **Pemeriksaan Eksisting**:
   Mencari perangkat di database (`select(Device).where(Device.id == target_device_id)`).
   - Jika ada dan `dev.owner_id and dev.owner_id != user.id`: Melempar `HTTP 403 Forbidden` (bukan `409 Conflict` sesuai Invarian I1).
   - Jika `dev.owner_id` bernilai `None` atau sama: Mengisi `dev.owner_id = user.id`.
   - Jika belum ada: Membuat `Device` baru dengan `owner_id = user.id` dan membuat kredensial MQTT baru (`generate_device_mqtt_credentials`).
4. **Pembaruan Peran Pengguna (Akar Masalah Bug b)**:
   Tepat pada **baris 340-344**:
   ```python
   # Tetapkan pemilik hanya setelah perangkat berhasil ditemukan atau dibuat.
   user.is_approved = True
   user.role = "pemilik"
   if not user.family_id:
       user.family_id = user.id
   ```
   **Setiap pengguna** (termasuk anggota biasa yang baru mendaftar) yang berhasil mengeksekusi endpoint klaim ini langsung diubah perannya menjadi `"pemilik"`. Jika keluarga tersebut sebelumnya sudah memiliki pengelola (`budi`, dengan role `"admin"`), keluarga tersebut kini memiliki **DUA PENGELOLA** (`budi` bertindak sebagai `admin`, dan `risang` bertindak sebagai `pemilik`). Ini melanggar Invarian I2 dan I3.
5. **Kredensial MQTT**:
   Jika perangkat sebelumnya sudah terdaftar dan diklaim ulang, kredensial MQTT lama di ESP32 tidak diperbarui (karena ESP32 masih menyimpan kredensial dari pembuatan pertama). Akibatnya di sisi broker Mosquitto, autentikasi terganggu atau tidak sinkron, dan perangkat tampil sebagai `"LWT: Terputus"`.

---

## 6. Alur Putus Perangkat (`POST /api/devices/{device_id}/unbind`)

Alur eksekusi di `server/app/api/routes/devices.py` (baris 416-530):
1. Memeriksa peran `current_user.role in ("admin", "pemilik")`.
2. Menghapus kepemilikan: `dev.owner_id = None`, `dev.mqtt_password_hash = None`, `dev.is_online = False`.
3. Mengubah peran pengguna (baris 485-486): Jika user tidak memiliki perangkat lain, perannya diubah menjadi `"biasa"`. (Melanggar Invarian I2).
4. Langsung mencabut kredensial Mosquitto via `revoke_device_mqtt_credentials(device_id)` (baris 490).
5. Jika perangkat dianggap online: Mengirim perintah `factory_reset` via MQTT.
   *Kelemahan*: Karena kredensial MQTT langsung dicabut di baris 490, jika koneksi broker atau socket terputus saat itu, broker dapat menolak ack dari ESP32.
   *Kelemahan*: Tidak ada penanganan perangkat offline dengan kredensial terbatas 7 hari yang menunggu konfirmasi ack reset (S4).

---

## 7. Alur Tambah dan Putus di Web & App Mobile

1. **Web (`web/src/pages/PerangkatPage.tsx`)**:
   - Modal tambah perangkat memanggil `devicesApi.addDevice` (yang memanggil `POST /api/devices` langsung membuat record baru di database) bukan alur klaim kode pairing dinamis.
   - Dialog "Putuskan & Reset Perangkat" menampilkan teks konfirmasi yang belum membedakan secara tegas kondisi online vs offline.
2. **App Flutter (`app/lib/screens/add_device_screen.dart`)**:
   - Mendukung input QR JSON `{"id": "...", "token": "..."}`, format URI `rumah://claim?...`, atau teks 6 digit.
   - Mengirim POST ke `/api/devices/claim`.
   - Mengalami kendala pada alur login (S6) yang menyebabkan pengguna terhenti sebelum mencapai layar klaim.
