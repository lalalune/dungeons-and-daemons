# Stops the game server and tunnel started by start-remote.ps1.
$pidFile = Join-Path $PSScriptRoot '.remote\pids.txt'
if (Test-Path $pidFile) {
  foreach ($id in Get-Content $pidFile) {
    if ($id -match '^\d+$') {
      $p = Get-Process -Id $id -ErrorAction SilentlyContinue
      if ($p -and $p.ProcessName -in 'bun','cloudflared') { Stop-Process -Id $id -Force }
    }
  }
  Remove-Item $pidFile
  'Stopped.'
} else { 'Nothing was running.' }
