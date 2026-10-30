@echo off
title Photobooth Studio - laptop printer setup
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ((Get-Content -LiteralPath '%~f0' -Raw) -split '#PS#')[2]"
echo.
pause
exit /b
#PS#
# Photobooth Studio: sets up this Windows laptop to print from the tablet.
# It does not install or delete anything. It only: sets the DNP as default printer, creates a Chrome
# shortcut that prints without the print window, keeps the laptop awake while plugged in,
# and opens the DNP printing preferences so you can turn on the 2-inch cut.
$url = 'https://photobooth-studio.harizwer03.workers.dev/app/'
Write-Host ''
Write-Host '=== Photobooth Studio - laptop printer setup ===' -ForegroundColor Cyan
Write-Host ''

# 1. DNP printer as the default printer
$p = $null
try { $p = Get-Printer -ErrorAction Stop | Where-Object { $_.Name -match 'RX1|DNP' -or $_.DriverName -match 'RX1|DNP' } | Select-Object -First 1 } catch {}
if ($p) {
  reg add "HKCU\Software\Microsoft\Windows NT\CurrentVersion\Windows" /v LegacyDefaultPrinterMode /t REG_DWORD /d 1 /f | Out-Null
  $esc = $p.Name -replace "'", "''"
  Get-CimInstance Win32_Printer -Filter "Name='$esc'" | Invoke-CimMethod -MethodName SetDefaultPrinter | Out-Null
  Write-Host "[OK] Default printer: $($p.Name)" -ForegroundColor Green
} else {
  Write-Host '[!] The DNP DS-RX1HS printer was not found on this laptop.' -ForegroundColor Yellow
  Write-Host '    Install the DNP DS-RX1HS driver, plug the printer in by USB, switch it on, then run this file again.'
  Start-Process 'https://www.google.com/search?q=DNP+DS-RX1HS+printer+driver+download+windows'
}

# 2. Chrome shortcut that prints straight away (no print window)
$chrome = @("$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if ($chrome) {
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Photobooth Printer.lnk'))
  $lnk.TargetPath = $chrome; $lnk.Arguments = "--kiosk-printing $url"; $lnk.IconLocation = "$chrome,0"; $lnk.Save()
  Write-Host '[OK] Desktop shortcut created: "Photobooth Printer"' -ForegroundColor Green
} else {
  Write-Host '[!] Google Chrome was not found. Install Chrome, then run this file again.' -ForegroundColor Yellow
  Start-Process 'https://www.google.com/chrome/'
}

# 3. Keep the laptop awake while it is plugged in (so prints never wait)
powercfg /change standby-timeout-ac 0 | Out-Null
powercfg /change hibernate-timeout-ac 0 | Out-Null
powercfg /change monitor-timeout-ac 0 | Out-Null
Write-Host '[OK] Laptop will not sleep while plugged in' -ForegroundColor Green

# 4. DNP printing preferences: the one setting you choose yourself
if ($p) {
  Write-Host ''
  Write-Host 'Now the DNP "Printing preferences" window opens. Please set:' -ForegroundColor Cyan
  Write-Host '   Paper size:  (6x4) or PC 4x6'
  Write-Host '   Orientation: Portrait'
  Write-Host '   2inch cut:   ON   (cuts the strips in half)'
  Write-Host '   then press OK.'
  Start-Process rundll32.exe -ArgumentList "printui.dll,PrintUIEntry /e /n `"$($p.Name)`"" -Wait
}

Write-Host ''
Write-Host 'All done. Next:' -ForegroundColor Cyan
Write-Host '  1. Close ALL Chrome windows.'
Write-Host '  2. Open "Photobooth Printer" on the desktop, log in, choose Admin board > Printer.'
Write-Host '  3. Tick "This laptop prints", then press "Test print strip".'
