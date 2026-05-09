# ─────────────────────────────────────────────────────────────────────────────
# FitTracker × n8n — Script de inicio permanente
# Ejecutar: PowerShell -ExecutionPolicy Bypass -File n8n\start-n8n.ps1
# ─────────────────────────────────────────────────────────────────────────────

# ── Secretos y configuración (preconfigurados) ─────────────────────────────
$env:N8N_SECRET                      = "YOUR_N8N_SECRET_HERE"
$env:FITTRACKER_BACKEND_URL          = "http://localhost:3000"
$env:N8N_PORT                        = "5678"
$env:N8N_HOST                        = "localhost"
$env:N8N_PROTOCOL                    = "http"
$env:N8N_LOG_LEVEL                   = "warn"
$env:N8N_SECURE_COOKIE               = "false"
$env:N8N_PUSH_BACKEND                = "websocket"
$env:N8N_BLOCK_ENV_ACCESS_IN_NODE   = "false"
$env:EXECUTIONS_DATA_SAVE_ON_SUCCESS = "none"
$env:EXECUTIONS_DATA_SAVE_ON_ERROR   = "all"

# ── Base de datos n8n (PostgreSQL — no necesita sqlite3) ───────────────────
$env:DB_TYPE                = "postgresdb"
$env:DB_POSTGRESDB_HOST     = "127.0.0.1"
$env:DB_POSTGRESDB_PORT     = "5432"
$env:DB_POSTGRESDB_DATABASE = "n8n_fittracker"
$env:DB_POSTGRESDB_USER     = "postgres"
$env:DB_POSTGRESDB_PASSWORD = "YOUR_DB_PASSWORD_HERE"

# ── API KEY DE ANTHROPIC (REQUERIDO PARA COACHING IA) ─────────────────────
# Obtén tu clave en: https://console.anthropic.com/settings/keys
# Descomenta y reemplaza con tu clave real:
$env:ANTHROPIC_API_KEY = "YOUR_ANTHROPIC_API_KEY_HERE"

if (-not $env:ANTHROPIC_API_KEY) {
    Write-Host ""
    Write-Host "  ⚠️  ANTHROPIC_API_KEY no configurada" -ForegroundColor Yellow
    Write-Host "  El agente IA funcionará pero Claude no generará coaching." -ForegroundColor Yellow
    Write-Host "  Edita este archivo y añade tu clave: sk-ant-api03-..." -ForegroundColor Yellow
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
Write-Host "  Credenciales n8n:" -ForegroundColor DarkCyan
Write-Host "    Email:    admin@fittracker.local" -ForegroundColor White
Write-Host "    Password: YOUR_N8N_ADMIN_PASSWORD_HERE" -ForegroundColor White
Write-Host ""
Write-Host "  Workflows activos:" -ForegroundColor DarkCyan
Write-Host "    ✅ FitTracker AI Coaching Agent (events en tiempo real)" -ForegroundColor White
Write-Host "    ✅ FitTracker Weekly Check-in (cron: lunes 9am)" -ForegroundColor White
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""

$n8nBin = "C:\Users\camil\AppData\Roaming\npm\node_modules\n8n\bin\n8n"
node $n8nBin start
