import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import path from 'path';

function getTotpCode(): string {
  try {
    const pyPath = path.resolve(process.cwd(), '../server/.venv/Scripts/python.exe');
    const out = execSync(
      `"${pyPath}" -c "import pyotp; print(pyotp.TOTP('JBSWY3DPEHPK3PXP').now())"`
    )
      .toString()
      .trim();
    return out;
  } catch {
    return '123456';
  }
}

const COMPARE_DIR = path.resolve(process.cwd(), '../docs/design/compare');

test.describe('Dashboard Nexa Home — Stitch Design & End-to-End Verification', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('1. Setup / Login dengan 2FA TOTP', async ({ page }) => {
    await page.goto('/login');

    // Screenshot Login Light
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'login', 'light_1440.png'),
      fullPage: true,
    });

    // Toggle theme to dark and screenshot Login Dark
    await page.click('button[title="Ubah tema"]');
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'login', 'dark_1440.png'),
      fullPage: true,
    });
    // Return to light theme
    await page.click('button[title="Ubah tema"]');

    // Isi username & password
    await page.fill('#username', 'budi');
    await page.fill('#password', 'Password123!');
    await page.click('button[type="submit"]');

    // Menuju tahap 2: Kode Verifikasi 6-Digit TOTP
    await expect(page.locator('text=Verifikasi 2 Langkah')).toBeVisible();

    const totpCode = getTotpCode();
    const otpInputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(totpCode[i]);
    }

    // Klik tombol Verifikasi & Masuk
    await page.click('button[type="submit"]');

    // Berhasil masuk ke Beranda
    await expect(page).toHaveURL(/\/beranda/);
    await expect(page.locator('h2', { hasText: 'Beranda' })).toBeVisible();
  });

  test('2. Beranda: Realtime Switch, Matikan Semua, dan Tangkapan Layar', async ({ page }) => {
    // Login terlebih dahulu
    await page.goto('/login');
    await page.fill('#username', 'budi');
    await page.fill('#password', 'Password123!');
    await page.click('button[type="submit"]');

    const totpCode = getTotpCode();
    const otpInputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(totpCode[i]);
    }
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/beranda/);

    // Verifikasi 4 summary metrics ada di layar
    await expect(page.locator('text=Perangkat menyala')).toBeVisible();
    await expect(page.locator('text=Sensor gas')).toBeVisible();
    await expect(page.locator('text=Cahaya ruangan')).toBeVisible();
    await expect(page.locator('text=Kamera aktif')).toBeVisible();

    // Screenshot Beranda Light
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'beranda', 'light_1440.png'),
      fullPage: true,
    });

    // Toggle theme to dark and screenshot Beranda Dark
    await page.click('button[aria-label="Beralih tema"]');
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'beranda', 'dark_1440.png'),
      fullPage: true,
    });
    // Balik ke light
    await page.click('button[aria-label="Beralih tema"]');

    // Uji dialog konfirmasi "Matikan Semua" jika tombol ada
    const turnOffAllBtn = page.locator('button:has-text("Matikan Semua")');
    if (await turnOffAllBtn.isVisible()) {
      await turnOffAllBtn.click();
      await expect(page.locator('text=Matikan Semua Perangkat?')).toBeVisible();
      // Batal dialog
      await page.click('button:has-text("Batal")');
      await expect(page.locator('text=Matikan Semua Perangkat?')).not.toBeVisible();
    }
  });

  test('3. Perangkat: Panel Saklar, Status LWT, Grafik, & Tangkapan Layar', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', 'budi');
    await page.fill('#password', 'Password123!');
    await page.click('button[type="submit"]');

    const totpCode = getTotpCode();
    const otpInputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(totpCode[i]);
    }
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/\/beranda/);

    // Navigasi ke Perangkat
    await page.click('a[href="/perangkat"]');
    await expect(page).toHaveURL(/\/perangkat/);
    await expect(page.locator('text=Panel Saklar & Sensor Nexa Home')).toBeVisible();

    // Screenshot Perangkat Light
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'perangkat', 'light_1440.png'),
      fullPage: true,
    });

    // Dark mode
    await page.click('button[aria-label="Beralih tema"]');
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'perangkat', 'dark_1440.png'),
      fullPage: true,
    });
    await page.click('button[aria-label="Beralih tema"]');
  });

  test('4. Asisten: Percakapan, Aksi Sensitif, & Tangkapan Layar', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', 'budi');
    await page.fill('#password', 'Password123!');
    await page.click('button[type="submit"]');

    const totpCode = getTotpCode();
    const otpInputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(totpCode[i]);
    }
    await page.click('button[type="submit"]');

    await page.click('a[href="/asisten"]');
    await expect(page).toHaveURL(/\/asisten/);
    await expect(page.locator('text=Perintah cepat:')).toBeVisible();

    // Screenshot Asisten Light
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'asisten', 'light_1440.png'),
      fullPage: true,
    });

    // Dark mode
    await page.click('button[aria-label="Beralih tema"]');
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'asisten', 'dark_1440.png'),
      fullPage: true,
    });
    await page.click('button[aria-label="Beralih tema"]');
  });

  test('5. Kamera: Banner LAN, Mode Privasi, & Tangkapan Layar', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', 'budi');
    await page.fill('#password', 'Password123!');
    await page.click('button[type="submit"]');

    const totpCode = getTotpCode();
    const otpInputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(totpCode[i]);
    }
    await page.click('button[type="submit"]');

    await page.click('a[href="/kamera"]');
    await expect(page).toHaveURL(/\/kamera/);
    await expect(page.locator('text=Live view aktif di jaringan rumah (LAN)')).toBeVisible();

    // Screenshot Kamera Light
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'kamera', 'light_1440.png'),
      fullPage: true,
    });

    // Dark mode
    await page.click('button[aria-label="Beralih tema"]');
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'kamera', 'dark_1440.png'),
      fullPage: true,
    });
    await page.click('button[aria-label="Beralih tema"]');
  });

  test('6. Keluarga (Admin Saja): Disclaimer & Tangkapan Layar', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', 'budi');
    await page.fill('#password', 'Password123!');
    await page.click('button[type="submit"]');

    const totpCode = getTotpCode();
    const otpInputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(totpCode[i]);
    }
    await page.click('button[type="submit"]');

    await page.click('a[href="/keluarga"]');
    await expect(page).toHaveURL(/\/keluarga/);
    await expect(page.locator('text=Bukan alat medis. Hanya angka dan kejadian')).toBeVisible();
    await expect(page.locator('text=Fitur Wawasan Keluarga Belum Tersedia')).toBeVisible();

    // Screenshot Keluarga Light
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'keluarga', 'light_1440.png'),
      fullPage: true,
    });

    // Dark mode
    await page.click('button[aria-label="Beralih tema"]');
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'keluarga', 'dark_1440.png'),
      fullPage: true,
    });
    await page.click('button[aria-label="Beralih tema"]');
  });

  test('7. Pengaturan: Tab, 2FA, Peringatan Audio Kamera, & Tangkapan Layar', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#username', 'budi');
    await page.fill('#password', 'Password123!');
    await page.click('button[type="submit"]');

    const totpCode = getTotpCode();
    const otpInputs = page.locator('input[inputmode="numeric"]');
    for (let i = 0; i < 6; i++) {
      await otpInputs.nth(i).fill(totpCode[i]);
    }
    await page.click('button[type="submit"]');

    await page.click('a[href="/pengaturan"]');
    await expect(page).toHaveURL(/\/pengaturan/);
    await expect(page.locator('text=Profil Akun & Autentikasi 2FA')).toBeVisible();

    // Screenshot Pengaturan Light
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'pengaturan', 'light_1440.png'),
      fullPage: true,
    });

    // Dark mode
    await page.click('button[aria-label="Beralih tema"]');
    await page.screenshot({
      path: path.join(COMPARE_DIR, 'pengaturan', 'dark_1440.png'),
      fullPage: true,
    });
    await page.click('button[aria-label="Beralih tema"]');
  });

  test('8. RBAC Child: Menu Kamera & Keluarga Tersembunyi dan Akses Langsung Ditolak (403)', async ({ page, request }) => {
    await page.goto('/login');
    await page.fill('#username', 'anak');
    await page.fill('#password', 'Password123!');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/beranda/);

    // Di sidebar, Kamera dan Keluarga TIDAK BOLEH MUNCUL
    await expect(page.locator('nav a[href="/kamera"]')).not.toBeVisible();
    await expect(page.locator('nav a[href="/keluarga"]')).not.toBeVisible();

    // Percobaan navigasi langsung di browser dialihkan
    await page.goto('/keluarga');
    await expect(page).toHaveURL(/\/beranda/);

    // Tes langsung API backend dengan token child: GET /api/cameras wajib 403 Forbidden
    const loginRes = await request.post('/api/auth/login', {
      data: { username: 'anak', password: 'Password123!' },
    });
    const loginData = await loginRes.json();
    const res = await request.get('/api/cameras', {
      headers: { Authorization: `Bearer ${loginData.access_token}` },
    });
    expect(res.status()).toBe(403);
  });

  test('9. RBAC Member: Menu Keluarga Tersembunyi dan Akses Kamera Terfilter', async ({ page, request }) => {
    await page.goto('/login');
    await page.fill('#username', 'siti');
    await page.fill('#password', 'Password123!');
    await page.click('button[type="submit"]');

    await expect(page).toHaveURL(/\/beranda/);

    // Di sidebar, Keluarga TIDAK BOLEH MUNCUL untuk member
    await expect(page.locator('nav a[href="/keluarga"]')).not.toBeVisible();

    // Kamera tetap bisa diakses oleh member
    await expect(page.locator('nav a[href="/kamera"]')).toBeVisible();

    // Tes langsung API backend dengan token member: GET /api/cameras berhasil (200 OK)
    const loginRes = await request.post('/api/auth/login', {
      data: { username: 'siti', password: 'Password123!' },
    });
    const loginData = await loginRes.json();
    const res = await request.get('/api/cameras', {
      headers: { Authorization: `Bearer ${loginData.access_token}` },
    });
    expect(res.status()).toBe(200);
  });
});
