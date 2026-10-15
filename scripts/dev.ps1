# ==============================================================================
# SMART HOME "RUMAH" - DEVELOPMENT RUNNER (WINDOWS POWERSHELL)
# Menjalankan backend FastAPI dan frontend Vite secara bersamaan di Windows.
# ==============================================================================

[CmdletBinding()]
param (
    [switch]$SkipTests,
    [switch]$SkipLint
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path "$PSScriptRoot\.."
Set-Location $RepoRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "      SISTEM SMART HOME 'RUMAH' - DEV RUNNER (TAHAP 1)     " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Cek apakah setup.ps1 sudah dijalankan sebelumnya
$SetupMarker = Join-Path $RepoRoot ".setup_done"
if (-not (Test-Path $SetupMarker)) {
    Write-Host "`n[!] Skrip setup awal belum dijalankan!" -ForegroundColor Yellow
    Write-Host "    Silakan jalankan perintah setup terlebih dahulu:" -ForegroundColor Yellow
    Write-Host "    .\scripts\setup.ps1`n" -ForegroundColor White
    $runNow = Read-Host "Apakah Anda ingin menjalankan .\scripts\setup.ps1 sekarang? (Y/N)"
    if ($runNow -match "^[Yy]") {
        & "$PSScriptRoot\setup.ps1"
    } else {
        exit 1
    }
}

# 1. Validasi Python Virtual Environment
$PythonExe = Join-Path $RepoRoot "server\.venv\Scripts\python.exe"
if (-not (Test-Path $PythonExe)) {
    Write-Host "[!] Virtual environment tidak ditemukan di server\.venv." -ForegroundColor Yellow
    Write-Host "[*] Membuat virtual environment baru dengan Python 3.11..." -ForegroundColor Yellow
    py -3.11 -m venv "$RepoRoot\server\.venv"
    & "$PythonExe" -m pip install --upgrade pip
    & "$PythonExe" -m pip install -r "$RepoRoot\server\requirements.txt"
}

# 2. Validasi Node Modules di web/
$WebDir = Join-Path $RepoRoot "web"
$NodeModules = Join-Path $WebDir "node_modules"
if (-not (Test-Path $NodeModules)) {
    Write-Host "[*] Menginstal dependensi frontend (npm install)..." -ForegroundColor Yellow
    Push-Location $WebDir
    npm install
    Pop-Location
}

# 3. Pemeriksaan Kepatuhan Token Desain
if (-not $SkipLint) {
    Write-Host "`n[*] Menjalankan pemeriksaan token desain..." -ForegroundColor Green
    & "$PythonExe" "$RepoRoot\scripts\check_tokens.py"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Pemeriksaan token desain gagal! Ada warna hex di luar file token."
        exit $LASTEXITCODE
    }
}

# 4. Bangun Frontend Production Build (web/dist) untuk Akses Cepat via aujasena.my.id & FastAPI
Write-Host "`n[*] Menyiapkan bundle produksi frontend (npm run build)..." -ForegroundColor Green
Push-Location $WebDir
npm run build
Pop-Location
if ($LASTEXITCODE -ne 0) {
    Write-Error "Build frontend produksi gagal!"
    exit $LASTEXITCODE
}

# 4. Pengujian Otomatis
if (-not $SkipTests) {
    Write-Host "`n[*] Menjalankan tes otomatis backend (pytest)..." -ForegroundColor Green
    & "$PythonExe" -m pytest -v "$RepoRoot\server\tests"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Tes backend gagal!"
        exit $LASTEXITCODE
    }
}

Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host " Menjalankan Layanan:                                     " -ForegroundColor Cyan
Write-Host " - Backend API : http://127.0.0.1:8000                    " -ForegroundColor White
Write-Host " - Swagger Docs: http://127.0.0.1:8000/docs               " -ForegroundColor White
Write-Host " - API Health  : http://127.0.0.1:8000/api/health         " -ForegroundColor White
Write-Host " - Frontend UI : http://127.0.0.1:5173                    " -ForegroundColor White
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Tekan [Ctrl + C] untuk menghentikan semua layanan.`n" -ForegroundColor Yellow

# 5. Jalankan Backend & Frontend sebagai Child Process (Splatting)
$BackendParams = @{
    FilePath         = $PythonExe
    ArgumentList     = @("-m", "uvicorn", "server.app.main:app", "--host", "0.0.0.0", "--port", "8000", "--reload")
    WorkingDirectory = $RepoRoot
    PassThru         = $true
}
$BackendProcess = Start-Process @BackendParams

$FrontendParams = @{
    FilePath         = "cmd.exe"
    ArgumentList     = @("/c", "npm run dev -- --host 127.0.0.1 --port 5173")
    WorkingDirectory = $WebDir
    PassThru         = $true
}
$FrontendProcess = Start-Process @FrontendParams

try {
    while (-not $BackendProcess.HasExited -and -not $FrontendProcess.HasExited) {
        Start-Sleep -Seconds 1
    }
}
catch {
    Write-Host "`n[!] Menerima sinyal interupsi..." -ForegroundColor Yellow
}
finally {
    Write-Host "`n[*] Menghentikan seluruh proses..." -ForegroundColor Yellow
    if ($BackendProcess -and -not $BackendProcess.HasExited) {
        Stop-Process -Id $BackendProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($FrontendProcess -and -not $FrontendProcess.HasExited) {
        Stop-Process -Id $FrontendProcess.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "[OK] Layanan berhasil dihentikan dengan rapi." -ForegroundColor Green
}
