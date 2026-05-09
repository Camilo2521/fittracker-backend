# ─────────────────────────────────────────────────────────────────────────────
# FitTracker × n8n — Script de inicio permanente
# Ejecutar: PowerShell -ExecutionPolicy Bypass -File n8n\start-n8n.ps1
# ─────────────────────────────────────────────────────────────────────────────

# ── Secretos y configuración ───────────────────────────────────────────────
# Copia n8n\.env.example → n8n\.env y rellena los valores, o define las
# variables de entorno antes de ejecutar este script.

if (Test-Path "$PSScriptRoot\.env") {
    Get-Content "$PSScriptRoot\.env" | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]*)=(.*)$') {
            [System.Environment]::SetEnvironmentVariable($matches[1].Trim(), $matches[2].Trim(), 'Process')
        }
    }
}

if (-not $env:N8N_SECRET)      { $env:N8N_SECRET      = [System.Guid]::NewGuid().ToString('N') + [System.Guid]::NewGuid().ToString('N') }
$env:FITTRACKER_BACKEND_URL          = if ($env:FITTRACKER_BACKEND_URL) { $env:FITTRACKER_BACKEND_URL } else { "http://localhost:3000" }
$env:N8N_PORT                        = "5678"
$env:N8N_HOST                        = "localhost"
$env:N8N_PROTOCOL                    = "http"
$env:N8N_LOG_LEVEL                   = "warn"
$env:N8N_SECURE_COOKIE               = "false"
$env:N8N_PUSH_BACKEND                = "websocket"
$env:N8N_BLOCK_ENV_ACCESS_IN_NODE   = "false"
$env:EXECUTIONS_DATA_SAVE_ON_SUCCESS = "none"
$env:EXECUTIONS_DATA_SAVE_ON_ERROR   = "all"

# ── Base de datos n8n (PostgreSQL) ─────────────────────────────────────────
$env:DB_TYPE                = "postgresdb"
$env:DB_POSTGRESDB_HOST     = if ($env:DB_POSTGRESDB_HOST)     { $env:DB_POSTGRESDB_HOST }     else { "127.0.0.1" }
$env:DB_POSTGRESDB_PORT     = if ($env:DB_POSTGRESDB_PORT)     { $env:DB_POSTGRESDB_PORT }     else { "5432" }
$env:DB_POSTGRESDB_DATABASE = if ($env:DB_POSTGRESDB_DATABASE) { $env:DB_POSTGRESDB_DATABASE } else { "n8n_fittracker" }
$env:DB_POSTGRESDB_USER     = if ($env:DB_POSTGRESDB_USER)     { $env:DB_POSTGRESDB_USER }     else { "postgres" }
if (-not $env:DB_POSTGRESDB_PASSWORD) {
    Write-Host "  ❌ DB_POSTGRESDB_PASSWORD no configurada. Define la variable o añádela a n8n\.env" -ForegroundColor Red
    exit 1
}

# ── API KEY DE ANTHROPIC (REQUERIDO PARA COACHING IA) ─────────────────────
# Obtén tu clave en: https://console.anthropic.com/settings/keys
if (-not $env:ANTHROPIC_API_KEY) {
    Write-Host ""
    Write-Host "  ⚠️  ANTHROPIC_API_KEY no configurada" -ForegroundColor Yellow
    Write-Host "  El agente IA funcionará pero Claude no generará coaching." -ForegroundColor Yellow
    Write-Host "  Define ANTHROPIC_API_KEY en n8n\.env o como variable de entorno." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  FitTracker × n8n — Agente IA de Coaching Fitness v2" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
Write-Host "  n8n UI:         http://localhost:5678" -ForegroundColor Green
Write-Host "  Backend:        http://localhost:3000" -ForegroundColor Green
Write-Host "  Webhook URL:    http://localhost:5678/webhook/fittracker-events" -ForegroundColor Green
Write-Host "  n8n Status:     http://localhost:3000/api/v1/n8n/status" -ForegroundColor Green
Write-Host ""
Write-Host "  Credenciales n8n: las que configuraste al primer inicio" -ForegroundColor DarkCyan
Write-Host ""
Write-Host "  Workflows activos:" -ForegroundColor DarkCyan
Write-Host "    ✅ FitTracker AI Coaching Agent (events en tiempo real)" -ForegroundColor White
Write-Host "    ✅ FitTracker Weekly Check-in (cron: lunes 9am)" -ForegroundColor White
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$n8nBin = "C:\Users\camil\AppData\Roaming\npm\node_modules\n8n\bin\n8n"
node $n8nBin start
