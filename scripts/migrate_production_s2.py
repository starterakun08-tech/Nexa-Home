"""
scripts/migrate_production_s2.py
Migrasi Aman Database Produksi untuk TAHAP S (S1 - S4).
- Membuat backup timestamped sebelum migrasi.
- Memperbaiki data peran ganda: risang (id=7) kembali menjadi 'member', budi (id=2) tetap sebagai 'pemilik' (Pengelola).
- Membuat tabel claim_sessions dan indeks unik parsial.
- Menambahkan kolom reset_status dan reset_requested_at jika belum ada.
- Memverifikasi invarian 1 pengelola per keluarga.
"""

import os
import shutil
import sqlite3
from datetime import datetime

DB_PATH = "server/data/rumah.db"
BACKUP_DIR = "backups"

def main():
    if not os.path.exists(DB_PATH):
        print(f"[ERROR] Database {DB_PATH} tidak ditemukan.")
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = os.path.join(BACKUP_DIR, f"rumah_pre_migrate_s2_{ts}.db")
    shutil.copy2(DB_PATH, backup_file)
    print(f"[OK] Backup berhasil dibuat: {backup_file}")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    try:
        # 1. Update risang role to member
        cursor.execute("SELECT id, username, role, family_id FROM users WHERE username = 'risang' OR id = 7;")
        risang = cursor.fetchone()
        if risang:
            print(f"Status sebelum: User {risang[1]} (id={risang[0]}, role={risang[2]}, family_id={risang[3]})")
            cursor.execute("UPDATE users SET role = 'member' WHERE id = 7;")
            print("Peran risang diperbarui menjadi 'member'.")

        # 2. Add columns to devices if not exist
        cursor.execute("PRAGMA table_info(devices);")
        columns = [row[1] for row in cursor.fetchall()]
        if "reset_status" not in columns:
            cursor.execute("ALTER TABLE devices ADD COLUMN reset_status TEXT DEFAULT NULL;")
            print("Kolom devices.reset_status ditambahkan.")
        if "reset_requested_at" not in columns:
            cursor.execute("ALTER TABLE devices ADD COLUMN reset_requested_at TIMESTAMP DEFAULT NULL;")
            print("Kolom devices.reset_requested_at ditambahkan.")

        # 3. Create claim_sessions table if not exists
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS claim_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            device_id VARCHAR(64) NOT NULL,
            code_hash VARCHAR(64) NOT NULL,
            qr_token_hash VARCHAR(64) NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'aktif',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            expires_at TIMESTAMP NOT NULL,
            used_at TIMESTAMP,
            used_by INTEGER REFERENCES users(id)
        );
        """)
        print("Tabel claim_sessions diverifikasi.")

        # 4. Partial index on claim_sessions
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_session_active ON claim_sessions(device_id) WHERE status = 'aktif';")

        # 5. Partial index on users: max 1 manager per family
        cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_one_manager_per_family ON users(COALESCE(family_id, id)) WHERE role IN ('admin', 'pemilik');")
        print("Indeks unik parsial idx_one_manager_per_family berhasil dibuat.")

        conn.commit()

        # Verifikasi
        cursor.execute("SELECT id, username, role, family_id FROM users WHERE role IN ('admin', 'pemilik');")
        managers = cursor.fetchall()
        print("\nDaftar Pengelola Saat Ini:")
        for m in managers:
            print(f" - ID: {m[0]}, Username: {m[1]}, Peran: {m[2]}, Family ID: {m[3]}")

        cursor.execute("SELECT id, username, role, family_id FROM users WHERE username = 'risang';")
        print("Status Risang:", cursor.fetchone())

        print("\n[SUKSES] Migrasi produksi selesai tanpa kendala.")
    except Exception as e:
        conn.rollback()
        print(f"[FATAL] Gagal migrasi: {e}")
        raise
    finally:
        conn.close()

if __name__ == "__main__":
    main()
