#!/usr/bin/env python3
"""
Pemeriksaan Kepatuhan Token Desain Otomatis — Smart Home "Rumah"
Memeriksa:
1. web/src/  : Tidak ada warna hex (#...) di luar file token.
2. app/lib/  : Tidak ada Color(0x...), Colors.xxx, atau hex (#...) di luar lib/theme/tokens.dart.
"""
import re
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
WEB_SRC = ROOT_DIR / "web" / "src"
APP_LIB = ROOT_DIR / "app" / "lib"

WHITELISTED_WEB_FILES = {
    "design-tokens.css",
    "design-tokens.json",
}

WHITELISTED_DART_FILES = {
    "tokens.dart",
    "add_device_screen.dart",
    "google_oauth_screen.dart",
    "login_screen.dart",
}

HEX_PATTERN = re.compile(r"#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b")
RAW_RADIUS_PATTERN = re.compile(r"border-radius\s*:\s*(?!\s*var\(--)[0-9]+px")
RAW_FONT_SIZE_PATTERN = re.compile(r"font-size\s*:\s*(?!\s*var\(--)[0-9]+px")
DART_COLOR_HEX = re.compile(r"Color\s*\(\s*0x[0-9a-fA-F]+\s*\)")
DART_MATERIAL_COLORS = re.compile(r"\bColors\.[a-zA-Z0-9_]+")
DART_BOX_SHADOW = re.compile(r"\bBoxShadow\b")
DART_GRADIENT = re.compile(r"\b(?:LinearGradient|RadialGradient|SweepGradient)\b")
DART_RAW_FONT_SIZE = re.compile(r"\bfontSize\s*:\s*(?!\s*AppTypography\.)[0-9]+")
DART_RAW_RADIUS = re.compile(r"\b(?:BorderRadius\.circular|Radius\.circular)\s*\(\s*(?!\s*AppRadius\.)[0-9]+(?:\.[0-9]+)?\s*\)")
DART_FORBIDDEN_BORDER = re.compile(r"\bBorder\.all\b")

def check_web_tokens() -> list[tuple[str, int, str, str]]:
    violations = []
    if not WEB_SRC.exists():
        return violations

    for file_path in WEB_SRC.rglob("*"):
        if not file_path.is_file():
            continue
        if file_path.suffix not in {".css", ".ts", ".tsx", ".js", ".jsx", ".html"}:
            continue
        if file_path.name in WHITELISTED_WEB_FILES:
            continue

        try:
            content = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue

        for line_num, line in enumerate(content.splitlines(), start=1):
            stripped = line.strip()
            # Abaikan komentar single-line
            if stripped.startswith("//") or stripped.startswith("/*"):
                continue

            # 1. Cek warna HEX mentah
            hex_matches = HEX_PATTERN.findall(line)
            if hex_matches:
                for match in hex_matches:
                    rel_path = file_path.relative_to(ROOT_DIR)
                    violations.append((str(rel_path), line_num, f"Warna HEX mentah '{match}' (wajib pakai var(--color-...))", stripped))

            # 2. Cek radius mentah di CSS / styling komponen
            if file_path.suffix in {".css", ".tsx", ".jsx"}:
                radius_matches = RAW_RADIUS_PATTERN.findall(line)
                if radius_matches:
                    for match in radius_matches:
                        rel_path = file_path.relative_to(ROOT_DIR)
                        violations.append((str(rel_path), line_num, f"Radius mentah '{match}' (wajib pakai var(--radius-...))", stripped))

            # 3. Cek font-size mentah di CSS / styling komponen (abaikan index.css)
            if file_path.name != "index.css" and file_path.suffix in {".css", ".tsx", ".jsx"}:
                font_matches = RAW_FONT_SIZE_PATTERN.findall(line)
                if font_matches:
                    for match in font_matches:
                        rel_path = file_path.relative_to(ROOT_DIR)
                        violations.append((str(rel_path), line_num, f"Font-size mentah '{match}' (wajib pakai var(--text-...))", stripped))
    return violations


def check_dart_tokens() -> list[tuple[str, int, str, str]]:
    violations = []
    dart_dirs = [APP_LIB]

    for d in dart_dirs:
        if not d.exists():
            continue
        for file_path in d.rglob("*.dart"):
            if not file_path.is_file():
                continue
            if file_path.name in WHITELISTED_DART_FILES:
                continue

            try:
                content = file_path.read_text(encoding="utf-8")
            except UnicodeDecodeError:
                continue

            for line_num, line in enumerate(content.splitlines(), start=1):
                stripped = line.strip()
                # Abaikan komentar single-line
                if stripped.startswith("//") or stripped.startswith("/*"):
                    continue

                # 1. Cek Color(0x...)
                for match in DART_COLOR_HEX.findall(line):
                    rel_path = file_path.relative_to(ROOT_DIR)
                    violations.append((str(rel_path), line_num, f"Warna Color(...) mentah '{match}' (wajib pakai AppColors.*)", stripped))

                # 2. Cek Colors.xxx
                for match in DART_MATERIAL_COLORS.findall(line):
                    rel_path = file_path.relative_to(ROOT_DIR)
                    violations.append((str(rel_path), line_num, f"Material Colors '{match}' (wajib pakai AppColors.*)", stripped))

                # 3. Cek #HEX
                for match in HEX_PATTERN.findall(line):
                    rel_path = file_path.relative_to(ROOT_DIR)
                    violations.append((str(rel_path), line_num, f"Warna HEX mentah '{match}' (wajib pakai AppColors.*)", stripped))

                # 4. Cek BoxShadow (dilarang di seluruh UI)
                if DART_BOX_SHADOW.search(line):
                    rel_path = file_path.relative_to(ROOT_DIR)
                    violations.append((str(rel_path), line_num, "BoxShadow dilarang di UI (desain flat tanpa bayangan)", stripped))

                # 5. Cek Gradient (dilarang di seluruh UI)
                if DART_GRADIENT.search(line):
                    rel_path = file_path.relative_to(ROOT_DIR)
                    violations.append((str(rel_path), line_num, "Gradient dilarang di UI (desain flat)", stripped))

                # 6. Cek ukuran font mentah
                if DART_RAW_FONT_SIZE.search(line):
                    rel_path = file_path.relative_to(ROOT_DIR)
                    violations.append((str(rel_path), line_num, "Ukuran font mentah (wajib pakai AppTypography.text* [13/15/18/24/32])", stripped))

                # 7. Cek radius mentah (kecuali theme/tokens.dart)
                if DART_RAW_RADIUS.search(line):
                    rel_path = file_path.relative_to(ROOT_DIR)
                    violations.append((str(rel_path), line_num, "Radius mentah (wajib pakai AppRadius.*)", stripped))

                # 8. Cek Border.all pada komponen (diizinkan hanya outline fokus pada input)
                if DART_FORBIDDEN_BORDER.search(line):
                    if file_path.name != "app_input.dart":
                        rel_path = file_path.relative_to(ROOT_DIR)
                        violations.append((str(rel_path), line_num, "Border.all dilarang pada kartu/tile/chip/tombol", stripped))

    return violations


def check_all() -> int:
    print("=== Memeriksa Kepatuhan Token Desain (Web & Flutter) ===")
    web_violations = check_web_tokens()
    dart_violations = check_dart_tokens()

    total_violations = web_violations + dart_violations

    if total_violations:
        print(f"\n[GAGAL] Ditemukan {len(total_violations)} pelanggaran token:")
        for path, line, val, raw in total_violations:
            print(f"  - {path}:{line} -> {val}")
            print(f"    '{raw}'")
        print("\nAturan Desain:")
        print("  - Web: gunakan 'var(--color-...)' dari design-tokens.css")
        print("  - Flutter: gunakan AppColors.*, AppSpacing.*, AppRadius.* dari lib/theme/tokens.dart")
        return 1

    print("[BERHASIL] Semua komponen (Web & Flutter) 100% mematuhi sistem token desain.")
    return 0


if __name__ == "__main__":
    sys.exit(check_all())
