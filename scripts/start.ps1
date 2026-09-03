$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not (Test-Path 'backend/node_modules')) {
  throw 'Install backend dependencies first: cd backend; npm install'
}
if (-not (Test-Path '.env')) {
  throw 'Create a repository-root .env before starting the app.'
}

$npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
if ($null -eq $npm) {
  throw 'npm.cmd was not found on PATH.'
}
Write-Host "Using npm: $($npm.Source)"

& $npm.Source --prefix backend run db:migrate:local
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$backend = $null
$frontend = $null
try {
  Write-Host 'Starting PetitBakery Worker on http://localhost:8787'
  Write-Host 'Starting PetitBakery Pages preview on http://localhost:8788'
  $backend = Start-Process -FilePath $env:ComSpec -ArgumentList '/d /s /c "npm.cmd --prefix backend run dev"' -WorkingDirectory $root -NoNewWindow -PassThru
  $frontend = Start-Process -FilePath 'node.exe' -ArgumentList 'scripts/serve-frontend.mjs' -WorkingDirectory $root -NoNewWindow -PassThru

  while (-not $backend.HasExited -and -not $frontend.HasExited) {
    Start-Sleep -Seconds 1
  }
}
finally {
  foreach ($process in @($backend, $frontend)) {
    if ($null -ne $process -and -not $process.HasExited) {
      & taskkill.exe /PID $process.Id /T /F | Out-Null
    }
  }
}
