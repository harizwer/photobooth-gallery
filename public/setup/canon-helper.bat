@echo off
title Photobooth Studio - Canon on this laptop
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -LiteralPath '%~f0' -Raw) -split '#PS#')[2]"
echo.
pause
exit /b
#PS#
# Photobooth Studio - Canon helper for the laptop.
# Keeps running while the booth is in use. When a guest is photographed on the tablet,
# it makes digiCamControl take the photo with the Canon, shrinks it to 4K and sends it to the tablet.
$ErrorActionPreference = 'Stop'
$SB  = 'https://dqeyaimxfkursttbdmyp.supabase.co'
$KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRxZXlhaW14Zmt1cnN0dGJkbXlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyODc2NTQsImV4cCI6MjEwODg2MzY1NH0.T5tHvHVpNzNHwxYFASy8WO6xr1bvfBko9gxHCoxVQSc'
$Dir = Join-Path $env:APPDATA 'PhotoboothStudio'; New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$TokFile = Join-Path $Dir 'login.dat'
$Shots = 'C:\PhotoboothCanon'; New-Item -ItemType Directory -Force -Path $Shots | Out-Null
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Drawing

function Say($t, $c = 'Gray') { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $t) -ForegroundColor $c }

# ---------- digiCamControl ----------
$Remote = @("${env:ProgramFiles(x86)}\digiCamControl\CameraControlRemoteCmd.exe", "$env:ProgramFiles\digiCamControl\CameraControlRemoteCmd.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
$App    = @("${env:ProgramFiles(x86)}\digiCamControl\CameraControl.exe", "$env:ProgramFiles\digiCamControl\CameraControl.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $Remote) {
  Say 'digiCamControl is not installed. Install it (free) from digicamcontrol.com, then run this file again.' Yellow
  Start-Process 'https://digicamcontrol.com/download'; return
}
if ($App -and -not (Get-Process -Name CameraControl -ErrorAction SilentlyContinue)) {
  Say 'Starting digiCamControl...'; Start-Process $App; Start-Sleep -Seconds 8
}
# Save photos in one known folder
try { & $Remote /c set session.folder $Shots | Out-Null } catch {}

# ---------- Login (username + password once; remembered safely for this Windows user) ----------
$S = @{ access = ''; refresh = ''; uid = ''; exp = [DateTime]::MinValue }
function Set-Session($j) {
  $S.access = $j.access_token; $S.refresh = $j.refresh_token
  $p = $S.access.Split('.')[1].Replace('-', '+').Replace('_', '/'); while ($p.Length % 4) { $p += '=' }
  $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p)) | ConvertFrom-Json
  $S.uid = $claims.sub; $S.exp = (Get-Date).AddSeconds([double]$claims.exp - [DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - 120)
  (ConvertTo-SecureString $S.refresh -AsPlainText -Force) | ConvertFrom-SecureString | Set-Content -Path $TokFile
}
function Refresh-Session {
  $j = Invoke-RestMethod -Method Post -Uri "$SB/auth/v1/token?grant_type=refresh_token" -Headers @{ apikey = $KEY } -ContentType 'application/json' -Body (@{ refresh_token = $S.refresh } | ConvertTo-Json)
  Set-Session $j
}
function Login {
  if (Test-Path $TokFile) {
    try { $sec = Get-Content $TokFile | ConvertTo-SecureString; $S.refresh = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)); Refresh-Session; return } catch { Say 'Saved login expired, please log in again.' Yellow }
  }
  while ($true) {
    $u = Read-Host 'Photobooth username'
    $pw = Read-Host 'Password' -AsSecureString
    $plain = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($pw))
    try { $j = Invoke-RestMethod -Method Post -Uri "$SB/functions/v1/login" -Headers @{ apikey = $KEY; Authorization = "Bearer $KEY" } -ContentType 'application/json' -Body (@{ username = $u; password = $plain } | ConvertTo-Json); Set-Session $j; return }
    catch { Say 'Wrong username or password. Try again.' Red }
  }
}
function H { if ((Get-Date) -gt $S.exp) { Refresh-Session }; return @{ apikey = $KEY; Authorization = "Bearer $($S.access)" } }
function Api($method, $path, $body) {
  $args2 = @{ Method = $method; Uri = "$SB/rest/v1/$path"; Headers = (H) + @{ Prefer = 'return=representation' }; ContentType = 'application/json' }
  if ($body) { $args2.Body = ($body | ConvertTo-Json -Compress) }
  return Invoke-RestMethod @args2
}

# ---------- Take one photo with the Canon ----------
function Take-Photo {
  $t0 = Get-Date
  & $Remote /c capture | Out-Null
  $deadline = (Get-Date).AddSeconds(15); $file = $null
  $roots = @($Shots, (Join-Path ([Environment]::GetFolderPath('MyPictures')) 'digiCamControl')) | Where-Object { Test-Path $_ }
  while ((Get-Date) -lt $deadline -and -not $file) {
    Start-Sleep -Milliseconds 300
    $file = Get-ChildItem -Path $roots -Recurse -Include *.jpg, *.jpeg -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $t0 } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  }
  if (-not $file) { throw 'The Canon did not save a photo. Check focus (lens on MF), that the camera is set to JPEG, and that digiCamControl shows the camera.' }
  $last = -1; for ($i = 0; $i -lt 20; $i++) { $len = (Get-Item $file.FullName).Length; if ($len -eq $last -and $len -gt 0) { break }; $last = $len; Start-Sleep -Milliseconds 200 }
  return $file.FullName
}
# Shrink to 4K (long side 4000 px), JPEG quality 92
function Shrink($path) {
  $img = [System.Drawing.Image]::FromFile($path)
  try {
    $s = [Math]::Min(1.0, 4000.0 / [Math]::Max($img.Width, $img.Height)); $w = [int]($img.Width * $s); $h = [int]($img.Height * $s)
    $bmp = New-Object System.Drawing.Bitmap $w, $h
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($img, 0, 0, $w, $h); $g.Dispose()
    $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters 1; $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 92L
    $ms = New-Object IO.MemoryStream; $bmp.Save($ms, $enc, $ep); $bmp.Dispose()
    return $ms.ToArray()
  } finally { $img.Dispose() }
}

# ---------- Main loop ----------
Login
Say "Logged in. Canon helper is running - keep this window open during the event." Green
$lastBeat = [DateTime]::MinValue
while ($true) {
  try {
    if (((Get-Date) - $lastBeat).TotalSeconds -ge 5) {
      Api 'PATCH' "station_settings?owner=eq.$($S.uid)" @{ helper_seen = (Get-Date).ToUniversalTime().ToString('o'); helper_info = 'digiCamControl' } | Out-Null
      $lastBeat = Get-Date
    }
    $req = Api 'GET' "capture_requests?status=eq.pending&order=created_at.asc&limit=1" $null
    if ($req -and @($req).Count -gt 0) {
      $r = @($req)[0]
      $ca = $r.created_at; if ($ca -isnot [DateTime]) { $ca = [DateTimeOffset]::Parse([string]$ca).UtcDateTime } else { $ca = $ca.ToUniversalTime() }
      $age = ((Get-Date).ToUniversalTime() - $ca).TotalSeconds
      if ($age -gt 30) { Api 'PATCH' "capture_requests?id=eq.$($r.id)" @{ status = 'failed'; error = 'too old' } | Out-Null; continue }
      $claim = Api 'PATCH' "capture_requests?id=eq.$($r.id)&status=eq.pending" @{ status = 'working'; updated_at = (Get-Date).ToUniversalTime().ToString('o') }
      if (-not $claim -or @($claim).Count -eq 0) { continue }
      Say 'Taking a photo...' Cyan
      try {
        $bytes = Shrink (Take-Photo)
        $obj = "u-$($S.uid)/cap/$($r.id).jpg"
        Invoke-RestMethod -Method Post -Uri "$SB/storage/v1/object/photos/$obj" -Headers ((H) + @{ 'x-upsert' = 'true' }) -ContentType 'image/jpeg' -Body $bytes | Out-Null
        Api 'PATCH' "capture_requests?id=eq.$($r.id)" @{ status = 'done'; path = $obj; updated_at = (Get-Date).ToUniversalTime().ToString('o') } | Out-Null
        Say ("Photo sent ({0:N1} MB)" -f ($bytes.Length / 1MB)) Green
      } catch {
        Say ("Photo failed: " + $_.Exception.Message) Red
        Api 'PATCH' "capture_requests?id=eq.$($r.id)" @{ status = 'failed'; error = $_.Exception.Message.Substring(0, [Math]::Min(200, $_.Exception.Message.Length)) } | Out-Null
      }
    } else { Start-Sleep -Milliseconds 350 }
  } catch {
    Say ("Connection problem: " + $_.Exception.Message + " - retrying") Yellow
    Start-Sleep -Seconds 3
  }
}
