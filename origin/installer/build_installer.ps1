#requires -Version 5.1
<#
.SYNOPSIS
  Build pipeline para Origin v0.2 en Windows.
  1) Descarga el modelo Whisper (small por default) a installer/models/
  2) Ejecuta PyInstaller con installer/origin.spec → dist/Origin/Origin.exe
  3) Compila el instalador con Inno Setup → dist/OriginSetup-*.exe

.EXAMPLE
  pwsh installer/build_installer.ps1
  pwsh installer/build_installer.ps1 -Model medium
#>
[CmdletBinding()]
param(
    [ValidateSet("tiny", "base", "small", "medium", "large-v3")]
    [string]$Model = "small",

    [string]$IsccPath = "C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
    [switch]$SkipPiper,
    [string]$PiperVersion = "2023.11.14-2"
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path "$PSScriptRoot/..").Path
Set-Location $Root

Write-Host "==> Build Origin v0.3 con modelo Whisper '$Model'" -ForegroundColor Cyan

# --- 0) Piper + voces ----------------------------------------------------
if (-not $SkipPiper) {
    Write-Host "==> [0/4] Descarga Piper + voces TTS" -ForegroundColor Cyan
    $PiperDir = Join-Path $Root "installer/piper"
    $VoicesDir = Join-Path $Root "installer/voices"
    New-Item -ItemType Directory -Force -Path $PiperDir, $VoicesDir | Out-Null

    if (-not (Test-Path "$PiperDir/piper.exe")) {
        $url = "https://github.com/rhasspy/piper/releases/download/$PiperVersion/piper_windows_amd64.zip"
        Write-Host "  Bajando $url" -ForegroundColor DarkGray
        Invoke-WebRequest $url -OutFile "$PiperDir/piper.zip"
        Expand-Archive "$PiperDir/piper.zip" -DestinationPath $PiperDir -Force
        Remove-Item "$PiperDir/piper.zip"
        # Algunas versiones meten piper/* en un subdirectorio: aplanar.
        if (Test-Path "$PiperDir/piper/piper.exe") {
            Move-Item "$PiperDir/piper/*" $PiperDir -Force
            Remove-Item "$PiperDir/piper" -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    $voices = @(
        @{ Stem = "es_ES-mls_10246-low"; Path = "es/es_ES/mls_10246/low" },
        @{ Stem = "en_US-amy-low";       Path = "en/en_US/amy/low" }
    )
    foreach ($v in $voices) {
        $base = "https://huggingface.co/rhasspy/piper-voices/resolve/main/$($v.Path)"
        foreach ($ext in @("onnx", "onnx.json")) {
            $f = "$VoicesDir/$($v.Stem).$ext"
            if (-not (Test-Path $f)) {
                Write-Host "  Bajando $($v.Stem).$ext" -ForegroundColor DarkGray
                Invoke-WebRequest "$base/$($v.Stem).$ext" -OutFile $f
            }
        }
    }
}

# --- 1) Modelo Whisper -----------------------------------------------------
Write-Host "==> [1/4] Descarga del modelo Whisper" -ForegroundColor Cyan
$ModelsDir = Join-Path $Root "installer/models"
New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null
uv run python -c @"
from pathlib import Path
from huggingface_hub import snapshot_download
target = Path(r'$ModelsDir') / f'Systran--faster-whisper-$Model'
target.mkdir(parents=True, exist_ok=True)
if any(target.iterdir()):
    print('modelo ya presente, saltando descarga')
else:
    snapshot_download(repo_id=f'Systran/faster-whisper-$Model', local_dir=str(target), local_dir_use_symlinks=False)
print('OK', target)
"@

# --- 2) PyInstaller --------------------------------------------------------
Write-Host "==> [2/4] PyInstaller (onedir)" -ForegroundColor Cyan
if (Test-Path "build")   { Remove-Item -Recurse -Force "build" }
if (Test-Path "dist")    { Remove-Item -Recurse -Force "dist" }
uv run pyinstaller installer/origin.spec --noconfirm

# --- 3) Inno Setup ---------------------------------------------------------
Write-Host "==> [3/4] Inno Setup" -ForegroundColor Cyan
if (-not (Test-Path $IsccPath)) {
    Write-Warning "ISCC.exe no encontrado en '$IsccPath'. Saltando empaquetado del .exe."
    Write-Host "Para producir el instalador, instalá Inno Setup 6: https://jrsoftware.org/isinfo.php"
    Write-Host "El bundle PyInstaller quedó en: dist/Origin/Origin.exe"
    return
}
& "$IsccPath" "installer/origin.iss"
Write-Host "==> Listo. Instalador en: dist/" -ForegroundColor Green
