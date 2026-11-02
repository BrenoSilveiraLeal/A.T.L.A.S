$ErrorActionPreference = "Stop"
$gatewayDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir = (Resolve-Path (Join-Path $gatewayDir "../..")).Path
$envFile = Join-Path $gatewayDir ".env.local"
if (-not (Test-Path -LiteralPath $envFile)) { throw "Falta gateways/profitdll/.env.local. Configure o segredo e o endpoint privados antes de iniciar." }

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
if (-not $env:DASH_API_URL -or -not $env:PROFITDLL_INGEST_SECRET) { throw "Endpoint ou segredo privado do gateway ausente; solicite a configuração ao responsável pelo deploy." }

Push-Location $repoDir
try {
  & py -3 -c "import ctypes,sys; assert sys.platform == 'win32' and ctypes.sizeof(ctypes.c_void_p) == 8, 'Use Python Windows x64'"
  if ($LASTEXITCODE -ne 0) { throw "Instale Python 3 x64 para Windows antes de executar o gateway." }
  & py -3 (Join-Path $gatewayDir "gateway.py")
  if ($LASTEXITCODE -ne 0) { throw "O coletor ProfitDLL terminou com erro (código $LASTEXITCODE)." }
} finally {
  Pop-Location
}
