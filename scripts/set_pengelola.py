#!/usr/bin/env python3
"""
Skrip Pemulihan Lokal Pengelola Nexa Home
Hanya dapat dijalankan langsung di mesin server dengan akses langsung ke basis data.
Tidak tersedia melalui antarmuka web ataupun rute API.

Penggunaan:
    python scripts/set_pengelola.py <username>
"""

import datetime
import json
import os
import sqlite3
import sys
from pathlib import Path

# Tentukan path basis data SQLite produksi
BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "server" / "data" / "rumah.db"


def main():
    if len(sys.argv) < 2:
        print("Penggunaan: python scripts/set_pengelola.py <username>")
        sys.exit(1)

    target_username = sys.argv[1].strip()

    if not DB_PATH.exists():
        print(f"Galat: Berkas basis data tidak ditemukan di {DB_PATH}")
        sys.exit(1)

    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()

    try:
        # 1. Cari target user
        cur.execute(
            "SELECT id, username, full_name, role, family_id FROM users WHERE username = ?;",
            (target_username,),
        )
        target = cur.fetchone()

        if not target:
            print(f"Galat: Pengguna dengan username '{target_username}' tidak ditemukan.")
            sys.exit(1)

        target_id, target_uname, target_fullname, target_role, target_famid = target

        if target_role in ("admin", "pemilik"):
            print(f"Informasi: Pengguna '{target_username}' sudah berstatus Pengelola ({target_role}).")
            sys.exit(0)

        # 2. Cari pengelola aktif saat ini
        family_id = target_famid or 2
        cur.execute(
            "SELECT id, username, role FROM users WHERE (family_id = ? OR id = ?) AND role IN ('admin', 'pemilik');",
            (family_id, family_id),
        )
        current_managers = cur.fetchall()

        print("========================================================")
        print(" PEMULIHAN PENGELOLA AKUN KELUARGA — NEXA HOME ")
        print("========================================================")
        print(f"Target Pengguna Baru : {target_uname} (ID: {target_id}, Nama: {target_fullname or '-'})")
        print(f"Peran Saat Ini       : {target_role}")
        print(f"Keluarga ID          : {family_id}")
        if current_managers:
            curr_names = ", ".join([f"{m[1]} ({m[2]})" for m in current_managers])
            print(f"Pengelola Saat Ini   : {curr_names}")
        else:
            print("Pengelola Saat Ini   : (Belum ada pengelola)")
        print("========================================================")

        confirm = input(f"Pindahkan peran Pengelola ke '{target_uname}'? Ketik 'y' untuk melanjutkan: ").strip().lower()
        if confirm != "y":
            print("Operasi dibatalkan oleh pengguna.")
            sys.exit(0)

        # 3. Eksekusi dalam SATU transaksi atomik
        now = datetime.datetime.utcnow().isoformat()

        # a. Turunkan pengelola lama menjadi member
        for m in current_managers:
            cur.execute("UPDATE users SET role = 'member' WHERE id = ?;", (m[0],))

        # b. Angkat target pengguna menjadi admin (Pengelola)
        cur.execute(
            "UPDATE users SET role = 'admin', family_id = ?, is_approved = 1 WHERE id = ?;",
            (family_id, target_id),
        )

        # c. Catat di audit log
        audit_details = json.dumps({
            "action": "manual_recovery_set_pengelola",
            "previous_managers": [m[1] for m in current_managers],
            "new_manager": target_uname,
            "timestamp": now,
        })
        cur.execute(
            """
            INSERT INTO audit_logs (user_id, username, action, target_type, target_id, details, ip_address, created_at)
            VALUES (?, ?, 'security.set_pengelola', 'user', ?, ?, '127.0.0.1', ?);
            """,
            (target_id, target_uname, str(target_id), audit_details, now),
        )

        con.commit()
        print(f"\nSukses: Peran Pengelola berhasil dipindahkan ke '{target_uname}'.")
        print("Perubahan telah dicatat dalam log audit basis data.")

    except Exception as e:
        con.rollback()
        print(f"Galat transaksi basis data: {e}")
        sys.exit(1)
    finally:
        con.close()


if __name__ == "__main__":
    main()
