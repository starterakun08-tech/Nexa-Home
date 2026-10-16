<#
.SYNOPSIS
    Peluncur Seluruh Layanan Nexa Home (Master Launcher) — Tahap 7.
.DESCRIPTION
    Menjalankan seluruh subsistem Nexa Home: Mosquitto MQTT, MediaMTX,
    FastAPI Backend, Cloudflare Tunnel, dan Watchdog Kesehatan.
#>

$ErrorActionPreference = "Continue"

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  NEXA HOME -- MENJALANKAN SELURUH SUBSISTEM (MASTER LAUNCHER)" -ForegroundColor Cyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 1. Pastikan direktori log tersedia
$logDir = "server\data\logs"
if (-not (Test-Path $logDir)) {
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null
}

# 2. Mulai Mosquitto jika terpasang dan belum berjalan
$mosquittoExe = "C:\Program Files\mosquitto\mosquitto.exe"
$mosqRunning = (Get-Process mosquitto -ErrorAction SilentlyContinue)
if (-not $mosqRunning -and (Test-Path $mosquittoExe)) {
    Write-Host "[*] Memulai Mosquitto MQTT Broker..." -ForegroundColor Yellow
    Start-Process -FilePath $mosquittoExe -ArgumentList "-v -c `"$projectRoot\server\data\mosquitto\mosquitto.conf`"" -WindowStyle Hidden
}

# 3. Mulai MediaMTX jika terpasang dan belum berjalan
$mediamtxExe = "C:\Users\DELL\mediamtx\mediamtx.exe"
if (-not (Test-Path $mediamtxExe)) {
    $mediamtxExe = "mediamtx.exe"
}
$mediamtxRunning = (Get-Process mediamtx -ErrorAction SilentlyContinue)
if (-not $mediamtxRunning -and (Test-Path $mediamtxExe)) {
    Write-Host "[*] Memulai MediaMTX Streaming Server..." -ForegroundColor Yellow
    Start-Process -FilePath $mediamtxExe -WindowStyle Hidden
}

# 4. Mulai FastAPI Backend
$pythonExe = "$projectRoot\server\.venv\Scripts\python.exe"
$uvicornRunning = (Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*uvicorn*" })
if (-not $uvicornRunning) {
    Write-Host "[*] Memulai FastAPI Backend Server (Port 8000)..." -ForegroundColor Yellow
    Start-Process -FilePath $pythonExe -ArgumentList "-m uvicorn server.app.main:app --host 0.0.0.0 --port 8000" -WorkingDirectory $projectRoot -WindowStyle Hidden
}

# 5. Mulai Cloudflare Tunnel
$cloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
if (-not (Test-Path $cloudflaredExe)) {
    $cloudflaredExe = "cloudflared.exe"
}
$tunnelRunning = (Get-Process cloudflared -ErrorAction SilentlyContinue)
$tunnelConfig = "$projectRoot\server\nexa_tunnel.yml"
if (-not $tunnelRunning -and (Test-Path $cloudflaredExe) -and (Test-Path $tunnelConfig)) {
    Write-Host "[*] Memulai Cloudflare Tunnel untuk aujasena.my.id..." -ForegroundColor Yellow
    Start-Process -FilePath $cloudflaredExe -ArgumentList "tunnel --config `"$tunnelConfig`" run 4e13bb28-53f8-475a-8021-3f11d3e07722" -WindowStyle Hidden
}

# 6. Mulai Watchdog
$watchdogRunning = (Get-Process python -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*watchdog.py*" })
if (-not $watchdogRunning) {
    Write-Host "[*] Memulai Watchdog Pemantau Kesehatan..." -ForegroundColor Yellow
    Start-Process -FilePath $pythonExe -ArgumentList "scripts\watchdog.py --interval 30" -WorkingDirectory $projectRoot -WindowStyle Hidden
}

Write-Host "`n[+] Seluruh layanan Nexa Home telah dipicu dan berjalan di latar belakang." -ForegroundColor Green
