# Runs the game on this PC and opens it to your other devices through a
# Cloudflare quick tunnel. The address is printed at the end and changes each
# time this script is run. Visitors must enter ACCESS_CODE from server\.env.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$run  = Join-Path $root '.remote'
$port = 3344
New-Item -ItemType Directory -Force $run | Out-Null

& (Join-Path $root 'stop-remote.ps1') | Out-Null

if (-not (Test-Path (Join-Path $root 'client\dist\index.html'))) {
  Push-Location (Join-Path $root 'client'); npx vite build; Pop-Location
}

$env:NODE_ENV = 'production'
$env:PORT = "$port"
$server = Start-Process bun -ArgumentList 'run','src/index.ts' -WorkingDirectory (Join-Path $root 'server') `
  -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run 'server.log') -RedirectStandardError (Join-Path $run 'server.err.log')

# An empty config keeps this separate from any named tunnel set up on this PC.
$cfg = Join-Path $run 'quick-tunnel.yml'
Set-Content $cfg '# quick tunnel: no settings'
$tunnelLog = Join-Path $run 'tunnel.log'
Remove-Item $tunnelLog -ErrorAction SilentlyContinue
$tunnel = Start-Process cloudflared -ArgumentList 'tunnel','--config',"`"$cfg`"",'--no-autoupdate','--url',"http://127.0.0.1:$port" `
  -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $run 'tunnel.out.log') -RedirectStandardError $tunnelLog

"$($server.Id)`n$($tunnel.Id)" | Set-Content (Join-Path $run 'pids.txt')

$url = $null
foreach ($i in 1..40) {
  Start-Sleep -Seconds 1
  if (Test-Path $tunnelLog) {
    $m = Select-String -Path $tunnelLog -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($m) { $url = $m.Matches[0].Value; break }
  }
}
if ($url) {
  $url | Set-Content (Join-Path $run 'url.txt')
  "Game address: $url"
  "Access code: see ACCESS_CODE in server\.env"
} else {
  "The tunnel did not report an address. See $tunnelLog"
}
