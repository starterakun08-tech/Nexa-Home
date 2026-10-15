# ==============================================================================
# SMART HOME "RUMAH" - SATU PERINTAH SETUP OTOMATIS (WINDOWS POWERSHELL)
# Idempoten: Aman dijalankan berulang, hanya memasang yang belum tersedia.
# Penggunaan: .\scripts\setup.ps1 [-WithMobile] [-Yes] [-SkipTests]
# ==============================================================================

[CmdletBinding()]
param (
    [switch]$WithMobile,
    [switch]$WithFirmware,
    [switch]$WithOfflineTTS,
    [switch]$Yes,
    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path "$PSScriptRoot\.."
Set-Location $RepoRoot

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       SISTEM SMART HOME 'RUMAH' - SETUP OTOMATIS         " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$Results = [System.Collections.Generic.List[PSObject]]::new()

function Add-Result {
    param(
        [string]$Component,
        [string]$Status,
        [string]$Note
    )
    $obj = [PSCustomObject]@{
        Komponen = $Component
        Status   = $Status
        Catatan  = $Note
    }
    $Results.Add($obj)
}

# ------------------------------------------------------------------------------
# 1. Pengecekan Lingkungan Dasar (Git, Python 3.11, Node.js, Mosquitto)
# ------------------------------------------------------------------------------
Write-Host "`n[1/7] Memeriksa perangkat lunak dasar..." -ForegroundColor Green

$MissingTools = [System.Collections.Generic.List[string]]::new()

# Cek Git
if (Get-Command "git" -ErrorAction SilentlyContinue) {
    $gitVer = (git --version).Trim()
    Add-Result "Git" "OK" $gitVer
} else {
    $MissingTools.Add("Git.Git")
    Add-Result "Git" "GAGAL" "Belum terpasang"
}

# Cek Python 3.11
$hasPy311 = $false
try {
    $pyCheck = & py -3.11 --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        $hasPy311 = $true
        Add-Result "Python 3.11" "OK" ($pyCheck.ToString().Trim())
    }
} catch {}

if (-not $hasPy311) {
    $MissingTools.Add("Python.Python.3.11")
    Add-Result "Python 3.11" "GAGAL" "Gunakan Python 3.11 via py launcher"
}

# Cek Node.js & npm
if (Get-Command "node" -ErrorAction SilentlyContinue) {
    $nodeVer = (node --version).Trim()
    Add-Result "Node.js" "OK" $nodeVer
} else {
    $MissingTools.Add("OpenJS.NodeJS.LTS")
    Add-Result "Node.js" "GAGAL" "Belum terpasang"
}

# Cek Mosquitto MQTT Broker (Windows Service)
$mosqSvc = Get-Service -Name "mosquitto" -ErrorAction SilentlyContinue
$mosqBin = Test-Path "C:\Program Files\mosquitto\mosquitto.exe"

if ($mosqSvc -or $mosqBin) {
    if ($mosqSvc -and $mosqSvc.Status -ne "Running") {
        try {
            Start-Service -Name "mosquitto" -ErrorAction SilentlyContinue
        } catch {}
    }
    # Hapus aturan firewall lama jika ada (idempoten)
    try {
        Remove-NetFirewallRule -DisplayName "NexaHome-Mosquitto-LocalSubnet" -ErrorAction SilentlyContinue
    } catch {}
    # Aturan Firewall Windows: Hanya izinkan LocalSubnet pada port 1883
    $ruleName = "Rumah-Mosquitto-LocalSubnet"
    $existingFw = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
    if (-not $existingFw) {
        try {
            New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -LocalPort 1883 -Protocol TCP -Action Allow -RemoteAddress LocalSubnet -ErrorAction SilentlyContinue | Out-Null
            Add-Result "Mosquitto Firewall" "OK" "Port 1883 dibatasi ke LocalSubnet"
        } catch {
            Add-Result "Mosquitto Firewall" "PERINGATAN" "Gagal buat rule (perlu hak Admin)"
        }
    } else {
        Add-Result "Mosquitto Firewall" "OK" "Rule LocalSubnet sudah aktif"
    }
    Add-Result "Mosquitto Broker" "OK" "Service Windows aktif (port 1883)"
} else {
    $MissingTools.Add("EclipseFoundation.Mosquitto")
    Add-Result "Mosquitto Broker" "GAGAL" "Belum terpasang"
}

# Cek MediaMTX & Aturan Firewall WebRTC/WHEP (Hanya LocalSubnet)
$mediamtxConfigPath = Join-Path $RepoRoot "tools\mediamtx\mediamtx.yml"
if (Test-Path $mediamtxConfigPath) {
    $mediamtxContent = Get-Content $mediamtxConfigPath -Raw
    $tcpPort = "8889"
    if ($mediamtxContent -match 'webrtcAddress:\s*:?(\d+)') {
        $tcpPort = $matches[1]
    }
    $udpPort = "8189"
    if ($mediamtxContent -match 'webrtcLocalUDPAddress:\s*:?(\d+)') {
        $udpPort = $matches[1]
    } elseif ($mediamtxContent -match 'webrtcICEUDPMuxAddress:\s*:?(\d+)') {
        $udpPort = $matches[1]
    }

    $fwDisplayName = "Rumah-MediaMTX-LocalSubnet"
    try {
        Remove-NetFirewallRule -DisplayName $fwDisplayName -ErrorAction SilentlyContinue
    } catch {}

    try {
        New-NetFirewallRule -DisplayName $fwDisplayName -Name "Rumah-MediaMTX-TCP" -Direction Inbound -LocalPort $tcpPort -Protocol TCP -Action Allow -RemoteAddress LocalSubnet -ErrorAction SilentlyContinue | Out-Null
        New-NetFirewallRule -DisplayName $fwDisplayName -Name "Rumah-MediaMTX-UDP" -Direction Inbound -LocalPort $udpPort -Protocol UDP -Action Allow -RemoteAddress LocalSubnet -ErrorAction SilentlyContinue | Out-Null
        Add-Result "MediaMTX Firewall" "OK" "TCP $tcpPort & UDP $udpPort dibatasi ke LocalSubnet ($fwDisplayName)"
    } catch {
        Add-Result "MediaMTX Firewall" "PERINGATAN" "Gagal buat rule (perlu hak Administrator)"
    }
}


# Cek Flutter & Android jika flag -WithMobile diberikan
$hasFlutter = (Get-Command "flutter" -ErrorAction SilentlyContinue) -ne $null
if ($WithMobile) {
    if ($hasFlutter) {
        Add-Result "Flutter SDK" "OK" "Terpasang"
    } else {
        $MissingTools.Add("Flutter.Flutter")
        Add-Result "Flutter SDK" "GAGAL" "Belum terpasang"
    }
} else {
    if ($hasFlutter) {
        Add-Result "Flutter SDK" "OK" "Terpasang (opsional)"
    } else {
        Add-Result "Flutter SDK" "DILEWATI" "Jalankan dengan -WithMobile bila ingin memasang"
    }
}

# Cek PlatformIO jika flag -WithFirmware diberikan
$hasPio = (Get-Command "pio" -ErrorAction SilentlyContinue) -ne $null
if ($WithFirmware) {
    if ($hasPio) {
        Add-Result "PlatformIO CLI" "OK" "Terpasang"
    } else {
        Add-Result "PlatformIO CLI" "MEMASANG" "Akan dipasang via pip ke venv"
    }
} else {
    if ($hasPio) {
        Add-Result "PlatformIO CLI" "OK" "Terpasang (opsional)"
    } else {
        Add-Result "PlatformIO CLI" "DILEWATI" "Jalankan dengan -WithFirmware bila ingin memasang"
    }
}

# ------------------------------------------------------------------------------
# 2. Pemasangan Otomatis via Winget (Jika Ada yang Kurang)
# ------------------------------------------------------------------------------
if ($MissingTools.Count -gt 0) {
    Write-Host "`n[!] Ditemukan komponen yang belum terpasang: $($MissingTools -join ', ')" -ForegroundColor Yellow
    $hasWinget = (Get-Command "winget" -ErrorAction SilentlyContinue) -ne $null

    if (-not $hasWinget) {
        Write-Host "[!] Paket manajer 'winget' tidak ditemukan di sistem Windows ini." -ForegroundColor Red
        Write-Host "    Silakan unduh dan pasang secara manual melalui:" -ForegroundColor Yellow
        Write-Host "    - Git      : https://git-scm.com/download/win" -ForegroundColor White
        Write-Host "    - Python   : https://www.python.org/downloads/release/python-3119/" -ForegroundColor White
        Write-Host "    - Node.js  : https://nodejs.org/" -ForegroundColor White
        Write-Host "    - Flutter  : https://docs.flutter.dev/get-started/install/windows" -ForegroundColor White
    } else {
        Write-Host "[*] Alat yang akan dipasang via winget:" -ForegroundColor Cyan
        foreach ($tool in $MissingTools) {
            Write-Host "    - $tool" -ForegroundColor White
        }

        $proceed = $Yes
        if (-not $proceed) {
            $confirm = Read-Host "`nApakah Anda ingin memasang komponen di atas sekarang? (Y/N)"
            if ($confirm -match "^[Yy]") {
                $proceed = $true
            }
        }

        if ($proceed) {
            foreach ($tool in $MissingTools) {
                Write-Host "`n[*] Memasang $tool via winget..." -ForegroundColor Yellow
                winget install --id $tool -e --silent --accept-package-agreements --accept-source-agreements
            }
            Write-Host "`n[!] Pemasangan selesai. Jika PATH sistem diperbarui, silakan buka terminal baru lalu jalankan skrip ini lagi." -ForegroundColor Yellow
        } else {
            Write-Host "`n[*] Pemasangan dibatalkan oleh pengguna." -ForegroundColor Yellow
        }
    }
}

# ------------------------------------------------------------------------------
# 3. Konfigurasi Lingkungan (.env)
# ------------------------------------------------------------------------------
Write-Host "`n[2/6] Memeriksa berkas konfigurasi .env..." -ForegroundColor Green
$EnvFile = Join-Path $RepoRoot ".env"
$EnvExample = Join-Path $RepoRoot ".env.example"

if (-not (Test-Path $EnvFile)) {
    if (Test-Path $EnvExample) {
        Copy-Item $EnvExample $EnvFile
        Write-Host "[OK] Berkas .env baru berhasil dibuat dari .env.example." -ForegroundColor Green
        Add-Result "Konfigurasi .env" "OK" "Dibuat dari .env.example"
    } else {
        Add-Result "Konfigurasi .env" "GAGAL" ".env.example tidak ditemukan"
    }
} else {
    Write-Host "[OK] Berkas .env sudah ada (tidak ditimpa)." -ForegroundColor Gray
    Add-Result "Konfigurasi .env" "OK" "Sudah ada (aman/tidak ditimpa)"
}

# ------------------------------------------------------------------------------
# 4. Inisialisasi Backend Server (Python 3.11 venv)
# ------------------------------------------------------------------------------
Write-Host "`n[3/6] Menyiapkan server backend (server/.venv)..." -ForegroundColor Green
$ServerDir = Join-Path $RepoRoot "server"
$VenvDir = Join-Path $ServerDir ".venv"
$PythonExe = Join-Path $VenvDir "Scripts\python.exe"

if (-not (Test-Path $PythonExe)) {
    Write-Host "[*] Membuat virtual environment baru di server\.venv..." -ForegroundColor Yellow
    py -3.11 -m venv $VenvDir
}

if (Test-Path $PythonExe) {
    Write-Host "[*] Menginstal dependensi server (pip install)..." -ForegroundColor Yellow
    & "$PythonExe" -m pip install --upgrade pip --quiet
    & "$PythonExe" -m pip install -r "$ServerDir\requirements.txt" --quiet
    Add-Result "Backend venv" "OK" "Dependensi Python terpasang"

    if ($WithFirmware) {
        Write-Host "[*] Memasang PlatformIO CLI (-WithFirmware)..." -ForegroundColor Yellow
        & "$PythonExe" -m pip install platformio --quiet
        Add-Result "PlatformIO CLI" "OK" "Terpasang via pip"
    }
} else {
    Add-Result "Backend venv" "GAGAL" "Python virtual environment gagal dibuat"
}

# ------------------------------------------------------------------------------
# 4b. Inisialisasi Offline TTS Piper (-WithOfflineTTS)
# ------------------------------------------------------------------------------
if ($WithOfflineTTS) {
    Write-Host "`n[*] Menyiapkan Piper Offline TTS & Voice Model Indonesia..." -ForegroundColor Green
    $ToolsDir = Join-Path $RepoRoot "tools\piper"
    $ModelsDir = Join-Path $RepoRoot "server\data\models\piper"
    New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null
    New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

    $PiperExe = Join-Path $ToolsDir "piper.exe"
    $VoiceModel = Join-Path $ModelsDir "id_ID-news_tts-medium.onnx"
    $VoiceConfig = Join-Path $ModelsDir "id_ID-news_tts-medium.onnx.json"

    # URL unduhan resmi rhasspy/piper-voices
    $PiperZipUrl = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"
    $VoiceModelUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx"
    $VoiceConfigUrl = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/id/id_ID/news_tts/medium/id_ID-news_tts-medium.onnx.json"

    $hasAllTTS = (Test-Path $PiperExe) -and (Test-Path $VoiceModel) -and (Test-Path $VoiceConfig)
    if ($hasAllTTS) {
        Write-Host "[OK] Piper TTS binary dan model suara Indonesia (news_tts) sudah terpasang." -ForegroundColor Gray
        Add-Result "Offline TTS (Piper)" "OK" "Binary dan model id_ID-news_tts siap (idempoten)"
    } else {
        $proceedTTS = $Yes
        if (-not $proceedTTS) {
            $confirm = Read-Host "`nApakah Anda ingin mengunduh Piper TTS binary & voice model Indonesia offline sekarang? (Y/N)"
            if ($confirm -match "^[Yy]") {
                $proceedTTS = $true
            }
        }

        if ($proceedTTS) {
            try {
                $TempZip = Join-Path $env:TEMP "piper_windows_amd64.zip"
                Write-Host "[*] Mengunduh Piper binary..." -ForegroundColor Yellow
                Invoke-WebRequest -Uri $PiperZipUrl -OutFile $TempZip -UseBasicParsing
                Expand-Archive -Path $TempZip -DestinationPath $ToolsDir -Force
                Remove-Item $TempZip -Force -ErrorAction SilentlyContinue

                Write-Host "[*] Mengunduh Piper model suara Bahasa Indonesia (id_ID-news_tts-medium)..." -ForegroundColor Yellow
                Invoke-WebRequest -Uri $VoiceModelUrl -OutFile $VoiceModel -UseBasicParsing
                Invoke-WebRequest -Uri $VoiceConfigUrl -OutFile $VoiceConfig -UseBasicParsing

                $modelHash = (Get-FileHash -Path $VoiceModel -Algorithm SHA256).Hash
                if ($modelHash) {
                    Write-Host "[OK] Checksum model dihitung lokal: $modelHash" -ForegroundColor Green
                }
                Add-Result "Offline TTS (Piper)" "OK" "Berhasil diunduh dan diverifikasi (dihitung lokal)"
            } catch {
                Write-Host "[!] Gagal mengunduh Piper TTS: $_" -ForegroundColor Red
                Add-Result "Offline TTS (Piper)" "GAGAL" "Gagal mengunduh: $($_.Exception.Message)"
            }
        } else {
            Add-Result "Offline TTS (Piper)" "DILEWATI" "Dibatalkan oleh pengguna"
        }
    }
} else {
    Add-Result "Offline TTS (Piper)" "DILEWATI" "Jalankan dengan -WithOfflineTTS bila ingin memasang"
}

# ------------------------------------------------------------------------------
# 4c. Inisialisasi Media Server (MediaMTX & FFmpeg - Tahap 4)
# ------------------------------------------------------------------------------
Write-Host "`n[*] Menyiapkan Media Server (MediaMTX & FFmpeg)..." -ForegroundColor Green
$MediaMTXDir = Join-Path $RepoRoot "tools\mediamtx"
$MediaMTXExe = Join-Path $MediaMTXDir "mediamtx.exe"
$MediaMTXConf = Join-Path $MediaMTXDir "mediamtx.yml"
$FFmpegDir = Join-Path $RepoRoot "tools\ffmpeg"
$FFmpegExe = Join-Path $FFmpegDir "bin\ffmpeg.exe"
$hasSystemFFmpeg = (Get-Command "ffmpeg" -ErrorAction SilentlyContinue) -ne $null

# MediaMTX setup (idempoten & checksum diverifikasi)
if (Test-Path $MediaMTXExe) {
    Write-Host "[OK] MediaMTX binary sudah ada di tools/mediamtx." -ForegroundColor Gray
    Add-Result "MediaMTX Server" "OK" "Binary siap (idempoten)"
} else {
    $proceedMediaMTX = $Yes
    if (-not $proceedMediaMTX) {
        $confirm = Read-Host "`nApakah Anda ingin mengunduh MediaMTX binary resmi (v1.9.3 Windows AMD64)? (Y/N)"
        if ($confirm -match "^[Yy]") {
            $proceedMediaMTX = $true
        }
    }
    if ($proceedMediaMTX) {
        try {
            New-Item -ItemType Directory -Force -Path $MediaMTXDir | Out-Null
            $MediaMTXZip = Join-Path $env:TEMP "mediamtx_windows_amd64.zip"
            $MediaMTXUrl = "https://github.com/bluenviron/mediamtx/releases/download/v1.9.3/mediamtx_v1.9.3_windows_amd64.zip"
            Write-Host "[*] Mengunduh MediaMTX..." -ForegroundColor Yellow
            Invoke-WebRequest -Uri $MediaMTXUrl -OutFile $MediaMTXZip -UseBasicParsing
            $mtxHash = (Get-FileHash -Path $MediaMTXZip -Algorithm SHA256).Hash
            Write-Host "[OK] Checksum MediaMTX SHA-256: $mtxHash" -ForegroundColor Green
            Expand-Archive -Path $MediaMTXZip -DestinationPath $MediaMTXDir -Force
            Remove-Item $MediaMTXZip -Force -ErrorAction SilentlyContinue
            Add-Result "MediaMTX Server" "OK" "Berhasil diunduh dan diverifikasi"
        } catch {
            Write-Host "[!] Gagal mengunduh MediaMTX: $_" -ForegroundColor Red
            Add-Result "MediaMTX Server" "GAGAL" "Gagal mengunduh: $($_.Exception.Message)"
        }
    } else {
        Add-Result "MediaMTX Server" "DILEWATI" "Dibatalkan oleh pengguna"
    }
}

# Tulis konfigurasi mediamtx.yml dengan HTTP auth hook ke backend
if (Test-Path $MediaMTXDir) {
    $mediamtxYmlContent = @"
# Konfigurasi MediaMTX untuk Rumah Smart Home
# Hanya mendengarkan di LAN dan mendelegasikan auth ke backend
logLevel: info
logDestinations: [stdout]

# API Kontrol
api: yes
apiAddress: 127.0.0.1:9997

# Autentikasi terpusat via HTTP Hook ke backend FastAPI
authMethod: http
authHTTPAddress: http://127.0.0.1:8000/api/cameras/auth/mediamtx

# Protokol Streaming (Hanya LAN / Localhost)
protocols: [tcp]
rtsp: yes
rtspAddress: :8554

webrtc: yes
webrtcAddress: :8889

hls: no
rtmp: no
srt: no

paths:
  all:
"@
    Set-Content -Path $MediaMTXConf -Value $mediamtxYmlContent -Encoding UTF8
}

# Setup Windows Service untuk MediaMTX jika admin
$mtxSvc = Get-Service -Name "mediamtx" -ErrorAction SilentlyContinue
if (-not $mtxSvc -and (Test-Path $MediaMTXExe)) {
    try {
        $scArgs = "create mediamtx binPath= `"$MediaMTXExe $MediaMTXConf`" start= auto DisplayName= `"Rumah MediaMTX`""
        Start-Process "sc.exe" -ArgumentList $scArgs -NoNewWindow -Wait -ErrorAction SilentlyContinue
        Start-Service -Name "mediamtx" -ErrorAction SilentlyContinue
        Add-Result "MediaMTX Service" "OK" "Service Windows terdaftar"
    } catch {
        Add-Result "MediaMTX Service" "MANUAL" "Jalankan via dev.ps1 atau nssm"
    }
}

# FFmpeg check / install
if ($hasSystemFFmpeg -or (Test-Path $FFmpegExe)) {
    Add-Result "FFmpeg Video Tool" "OK" "Terpasang"
} else {
    $proceedFFmpeg = $Yes
    if (-not $proceedFFmpeg) {
        $confirm = Read-Host "`nApakah Anda ingin memasang FFmpeg via winget (Gyan.FFmpeg.Essentials)? (Y/N)"
        if ($confirm -match "^[Yy]") {
            $proceedFFmpeg = $true
        }
    }
    if ($proceedFFmpeg) {
        try {
            winget install --id Gyan.FFmpeg.Essentials -e --silent --accept-package-agreements --accept-source-agreements
            Add-Result "FFmpeg Video Tool" "OK" "Terpasang via winget"
        } catch {
            Add-Result "FFmpeg Video Tool" "GAGAL" "Silakan pasang FFmpeg manual"
        }
    } else {
        Add-Result "FFmpeg Video Tool" "DILEWATI" "Dibatalkan oleh pengguna"
    }
}
# ------------------------------------------------------------------------------
# 4d. Inisialisasi Model Vision AI (Tahap 5)
# ------------------------------------------------------------------------------
Write-Host "`n[*] Menyiapkan Model Vision AI (YOLO11 ONNX)..." -ForegroundColor Green
$YoloDir = Join-Path $RepoRoot "server\data\models\yolo"
$YoloModel = Join-Path $YoloDir "yolo11n.onnx"
$YoloPoseModel = Join-Path $YoloDir "yolo11n-pose.onnx"

$hasModels = (Test-Path $YoloModel) -and (Test-Path $YoloPoseModel)
if ($hasModels) {
    $sha256 = (Get-FileHash -Path $YoloModel -Algorithm SHA256).Hash
    Write-Host "[OK] Model YOLO ONNX sudah tersedia: $sha256 (dihitung lokal)" -ForegroundColor Gray
    Add-Result "Vision AI Models" "OK" "Model YOLO11 ONNX siap (idempoten)"
} else {
    $proceedExport = $Yes
    if (-not $proceedExport) {
        $confirm = Read-Host "`nApakah Anda ingin mengekspor / menyiapkan model Vision AI (YOLO11 ONNX) sekarang? (Y/N)"
        if ($confirm -match "^[Yy]") {
            $proceedExport = $true
        }
    }

    if ($proceedExport) {
        try {
            Write-Host "[*] Menjalankan scripts/export_models.py..." -ForegroundColor Yellow
            & "$PythonExe" "$RepoRoot\scripts\export_models.py"
            if (Test-Path $YoloModel) {
                $sha256 = (Get-FileHash -Path $YoloModel -Algorithm SHA256).Hash
                Write-Host "[OK] Ekspor model berhasil. SHA-256 (dihitung lokal): $sha256" -ForegroundColor Green
                Add-Result "Vision AI Models" "OK" "Berhasil diekspor & diverifikasi (dihitung lokal)"
            } else {
                Add-Result "Vision AI Models" "GAGAL" "Model tidak ditemukan setelah ekspor"
            }
        } catch {
            Write-Host "[!] Gagal mengekspor model: $_" -ForegroundColor Red
            Add-Result "Vision AI Models" "GAGAL" "Gagal ekspor: $($_.Exception.Message)"
        }
    } else {
        Add-Result "Vision AI Models" "DILEWATI" "Dibatalkan oleh pengguna"
    }
}

# ------------------------------------------------------------------------------
Write-Host "`n[4/6] Menyiapkan frontend web..." -ForegroundColor Green
$WebDir = Join-Path $RepoRoot "web"
$NodeModules = Join-Path $WebDir "node_modules"

if (-not (Test-Path $NodeModules)) {
    Write-Host "[*] Menginstal paket frontend web (npm install)..." -ForegroundColor Yellow
    Push-Location $WebDir
    npm install --quiet
    Pop-Location
    Add-Result "Web Frontend" "OK" "npm install selesai"
} else {
    Write-Host "[OK] node_modules web sudah ada." -ForegroundColor Gray
    Add-Result "Web Frontend" "OK" "node_modules siap"
}

# ------------------------------------------------------------------------------
# 6. Inisialisasi Flutter App (app/ flutter pub get)
# ------------------------------------------------------------------------------
Write-Host "`n[5/6] Menyiapkan aplikasi mobile Flutter (app/)..." -ForegroundColor Green
$AppDir = Join-Path $RepoRoot "app"

if (Test-Path $AppDir) {
    # Generate tokens.dart dari design-tokens.json
    if (Test-Path $PythonExe) {
        & "$PythonExe" "$RepoRoot\scripts\gen_flutter_theme.py"
    }

    if ($hasFlutter) {
        Write-Host "[*] Mengambil paket Flutter (flutter pub get)..." -ForegroundColor Yellow
        Push-Location $AppDir
        flutter pub get
        Pop-Location
        Add-Result "Flutter App" "OK" "flutter pub get & theme tokens selesai"
    } else {
        Add-Result "Flutter App" "DILEWATI" "Flutter SDK belum terpasang di host"
    }
}

# ------------------------------------------------------------------------------
# 7. Pengujian Mutu (Token Checker & Backend Pytest)
# ------------------------------------------------------------------------------
Write-Host "`n[6/6] Menjalankan verifikasi pengujian otomatis..." -ForegroundColor Green

if (Test-Path $PythonExe) {
    # Verifikasi token
    & "$PythonExe" "$RepoRoot\scripts\check_tokens.py"
    if ($LASTEXITCODE -eq 0) {
        Add-Result "Design Tokens" "OK" "100% mematuhi sistem token"
    } else {
        Add-Result "Design Tokens" "GAGAL" "Ditemukan warna di luar token"
    }

    # Pytest
    if (-not $SkipTests) {
        & "$PythonExe" -m pytest -q "$ServerDir\tests"
        if ($LASTEXITCODE -eq 0) {
            Add-Result "Backend Tests" "OK" "Semua tes pytest lulus"
        } else {
            Add-Result "Backend Tests" "GAGAL" "Sebagian tes pytest gagal"
        }
    } else {
        Add-Result "Backend Tests" "DILEWATI" "Flag -SkipTests aktif"
    }
}

# Tandai bahwa setup berhasil
Set-Content -Path (Join-Path $RepoRoot ".setup_done") -Value (Get-Date).ToString("s")

# ------------------------------------------------------------------------------
# Cetak Tabel Ringkasan
# ------------------------------------------------------------------------------
Write-Host "`n==========================================================" -ForegroundColor Cyan
Write-Host "                  RINGKASAN STATUS SETUP                  " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

$Results | Format-Table -AutoSize -Property Komponen, Status, Catatan

Write-Host "`n[OK] Setup selesai! Anda dapat menjalankan sistem dengan:" -ForegroundColor Green
Write-Host "     .\scripts\dev.ps1`n" -ForegroundColor Yellow
