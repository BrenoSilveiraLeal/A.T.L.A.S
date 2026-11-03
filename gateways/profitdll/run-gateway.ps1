$ErrorActionPreference = "Stop"
$gatewayDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir = (Resolve-Path (Join-Path $gatewayDir "../..")).Path
if (-not $env:LOCALAPPDATA) { throw "LOCALAPPDATA nao esta definido; nao e seguro guardar a configuracao privada junto ao repositorio." }
$configDir = Join-Path $env:LOCALAPPDATA "ATLAS\ProfitDLL"
$envFile = Join-Path $configDir "gateway.env"
if (-not (Test-Path -LiteralPath $configDir)) { New-Item -ItemType Directory -Path $configDir -Force | Out-Null }
if (-not (Test-Path -LiteralPath $envFile)) {
  $legacyEnvFile = Join-Path $gatewayDir ".env.local"
  if (Test-Path -LiteralPath $legacyEnvFile) {
    Move-Item -LiteralPath $legacyEnvFile -Destination $envFile
    Write-Host "Migrei a configuracao privada existente para $envFile."
  } else {
    Copy-Item -LiteralPath (Join-Path $gatewayDir ".env.example") -Destination $envFile
    throw "Criei $envFile a partir do modelo. Preencha runtime, endpoint e segredo privado e execute novamente."
  }
}
$env:PROFITDLL_ENV_FILE = $envFile

foreach ($line in [IO.File]::ReadAllLines($envFile)) {
  $value = $line.Trim()
  if (-not $value -or $value.StartsWith("#") -or -not $value.Contains("=")) { continue }
  $parts = $value.Split("=", 2)
  $key = $parts[0].Trim()
  $setting = $parts[1].Trim().Trim('"').Trim("'")
  if ($key -match '^[A-Z][A-Z0-9_]*$' -and $setting -and -not [Environment]::GetEnvironmentVariable($key)) {
    [Environment]::SetEnvironmentVariable($key, $setting, "Process")
  }
}

$config = Get-Content -Raw -LiteralPath (Join-Path $repoDir "config/daytrade.json") | ConvertFrom-Json
$configuredTicker = $config.instruments | Where-Object { $_.id -eq "WIN" -and $_.enabled } | Select-Object -ExpandProperty symbol
if (-not $configuredTicker -or $env:PROFITDLL_TICKER -ne $configuredTicker) { throw "PROFITDLL_TICKER precisa corresponder ao contrato ativo configurado no DASH ($configuredTicker)." }
if ($env:PROFITDLL_API_URL) { throw "Use DASH_API_URL, não PROFITDLL_API_URL." }
if (-not $env:PROFITDLL_RUNTIME_DIR -or -not (Test-Path -LiteralPath (Join-Path $env:PROFITDLL_RUNTIME_DIR "ProfitDLL.dll"))) { throw "Extraia o pacote x64 oficial da Nelogica e configure PROFITDLL_RUNTIME_DIR para a pasta que contém ProfitDLL.dll." }
$dllPath = Join-Path $env:PROFITDLL_RUNTIME_DIR "ProfitDLL.dll"
$signature = Get-AuthenticodeSignature -LiteralPath $dllPath
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Nelogica Sistemas de Software Ltda\.') {
  throw "A assinatura da ProfitDLL não foi validada como um binário oficial da Nelogica; o gateway não será iniciado."
}
$dllVersion = (Get-Item -LiteralPath $dllPath).VersionInfo.ProductVersion
if (-not $dllVersion) { $dllVersion = (Get-Item -LiteralPath (Join-Path $env:PROFITDLL_RUNTIME_DIR "ProfitDLL.dll")).VersionInfo.FileVersion }
Write-Host "ProfitDLL file version: $(if ($dllVersion) { $dllVersion } else { 'not provided by the package' })"
if (-not $env:DASH_API_URL -or -not $env:PROFITDLL_INGEST_SECRET) { throw "Endpoint ou segredo privado do gateway ausente; solicite a configuração ao responsável pelo deploy." }
if ($env:DASH_API_URL -notmatch '^https://[^/\s<>]+/api/daytrade/quote$' -or $env:DASH_API_URL -match 'your-deployment') { throw "DASH_API_URL precisa ser a rota HTTPS exata /api/daytrade/quote." }
if ($env:PROFITDLL_INGEST_SECRET -match '^(replace|change|your[-_])') { throw "Substitua o segredo de exemplo pelo mesmo segredo privado configurado no servidor." }
if ($env:PROFITDLL_INGEST_SECRET.Length -lt 32) { throw "PROFITDLL_INGEST_SECRET precisa ter pelo menos 32 caracteres aleatorios." }
if ($env:CRON_SECRET -and $env:PROFITDLL_INGEST_SECRET -ceq $env:CRON_SECRET) { throw "Use um segredo exclusivo para ProfitDLL; nao reutilize CRON_SECRET." }

Push-Location $repoDir
try {
  & py -3 -c "import ctypes,sys; assert sys.platform == 'win32' and ctypes.sizeof(ctypes.c_void_p) == 8, 'Use Python Windows x64'"
  if ($LASTEXITCODE -ne 0) { throw "Instale Python 3 x64 para Windows antes de executar o gateway." }
  & py -3 (Join-Path $gatewayDir "gateway.py")
  if ($LASTEXITCODE -ne 0) { throw "O coletor ProfitDLL terminou com erro (código $LASTEXITCODE)." }
} finally {
  Pop-Location
}
