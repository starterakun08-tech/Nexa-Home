"""
NEXA HOME - Sinkronisasi Firmware ke Flash Internal ESP32 (main.py)
-------------------------------------------------------------------
Skrip ini mengunggah esp32_thonny.py ke sistem berkas internal ESP32
sebagai 'main.py' agar langsung berjalan otomatis saat ESP32 dinyalakan ulang.
"""

import os
import sys
import subprocess
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
SOURCE_FILE = ROOT_DIR / "esp32_thonny.py"

def find_esp32_port():
    try:
        import serial.tools.list_ports
        ports = list(serial.tools.list_ports.comports())
        for p in ports:
            desc = p.description.lower()
            if any(k in desc for k in ["ch340", "cp210", "usb-serial", "uart", "esp"]):
                return p.device
        if ports:
            return ports[0].device
    except Exception:
        pass
    return "COM19"

def main():
    if not SOURCE_FILE.exists():
        print(f"[ERROR] File sumber tidak ditemukan: {SOURCE_FILE}")
        sys.exit(1)

    port = find_esp32_port()
    print("=" * 60)
    print("  NEXA HOME - SINKRONISASI FIRMWARE KE ESP32")
    print("=" * 60)
    print(f"File Sumber : {SOURCE_FILE.name}")
    print(f"Target Port : {port}")
    print(f"Target File : :main.py (Flash Internal ESP32)")
    print("-" * 60)

    # Cek apakah mpremote terpasang
    py_exec = sys.executable

    # 1. Salin modul uQR.py jika ada
    uqr_file = ROOT_DIR / "uQR.py"
    if uqr_file.exists():
        uqr_cmd = [py_exec, "-m", "mpremote", "connect", port, "cp", str(uqr_file), ":uQR.py"]
        print(f"Menyalin modul QR: {' '.join(uqr_cmd)}")
        subprocess.run(uqr_cmd, capture_output=True)

    # 2. Salin firmware utama ke :main.py
    cmd = [py_exec, "-m", "mpremote", "connect", port, "cp", str(SOURCE_FILE), ":main.py"]

    print(f"Menjalankan: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode == 0:
        print("\n[SUKSES] esp32_thonny.py BERHASIL disalin menjadi 'main.py' di dalam ESP32!")
        print("Sekarang saat ESP32 restart / dicolok ulang kabelnya, ia akan otomatis")
        print("menjalankan kode terbaru tanpa perlu membuka Thonny lagi.\n")
    else:
        err = result.stderr.strip() or result.stdout.strip()
        print(f"\n[GAGAL] Output: {err}")
        if "in use" in err.lower() or "access" in err.lower():
            print("\n" + "!" * 60)
            print("PENTING: Port serial sedang dikunci oleh Thonny IDE!")
            print("Pilih salah satu solusi di bawah ini:")
            print("1. CARA PALING MUDAH (Langsung di Thonny):")
            print("   - Di Thonny, klik File -> Save as... (atau Save copy...)")
            print("   - Pilih 'MicroPython device'")
            print("   - Beri nama: main.py -> Klik OK (Overwrite)")
            print("2. Atau tutup aplikasi Thonny sebentar, lalu jalankan skrip ini lagi.")
            print("!" * 60 + "\n")

if __name__ == "__main__":
    main()
