# FitTracker — Migración a base de datos cloud
# Uso: .\migrate_to_cloud.ps1 -CloudUrl "postgresql://..."
#
# Pasos previos:
#   Supabase → https://app.supabase.com → New project → Settings → Database → Connection string
#   Railway  → https://railway.app → New project → PostgreSQL → Variables → DATABASE_URL

param(
    [Parameter(Mandatory=$true)]
    [string]$CloudUrl
)

$LocalUrl = "postgresql://postgres:fittracker2026@127.0.0.1:5432/fittracker"
$SchemaFile = "$PSScriptRoot\schema_cloud.sql"

Write-Host "=== FitTracker Cloud Migration ===" -ForegroundColor Cyan
Write-Host "Destino: $($CloudUrl -replace ':([^:@]+)@', ':***@')"

# 1 — Aplicar esquema
Write-Host "`n[1/3] Aplicando esquema..." -ForegroundColor Yellow
psql $CloudUrl -f $SchemaFile
if ($LASTEXITCODE -ne 0) { Write-Error "Error aplicando esquema"; exit 1 }
Write-Host "Esquema aplicado OK" -ForegroundColor Green

# 2 — Migrar datos (solo tablas de negocio, no logs ni tokens)
$Tables = @("cuentas","rutinas","dias_rutina","ejercicios_rutina",
            "planes_dieta","dias_dieta","comidas_plan",
            "sesiones_rep","registros_entrenamiento","registros_dieta",
            "registros_progreso","mediciones_progreso","metricas_fisicas",
            "configuracion","documentos_nutricion","documents","rag_queries")

Write-Host "`n[2/3] Migrando datos..." -ForegroundColor Yellow
foreach ($table in $Tables) {
    $count = psql $LocalUrl -t -c "SELECT COUNT(*) FROM $table 2>/dev/null" 2>$null
    if ($count -and [int]$count.Trim() -gt 0) {
        Write-Host "  → $table ($($count.Trim()) filas)"
        pg_dump $LocalUrl --data-only --no-owner --no-acl -t $table |
            psql $CloudUrl
    }
}
Write-Host "Datos migrados OK" -ForegroundColor Green

# 3 — Actualizar .env
Write-Host "`n[3/3] Actualiza tu .env con:" -ForegroundColor Yellow
Write-Host "  backend/.env         → DATABASE_URL=$CloudUrl" -ForegroundColor Cyan
Write-Host "  python_service/.env  → DATABASE_URL=postgresql+asyncpg://$(($CloudUrl -replace 'postgresql://', ''))" -ForegroundColor Cyan
Write-Host "  python_service/.env  → DATABASE_URL_SYNC=postgresql+psycopg2://$(($CloudUrl -replace 'postgresql://', ''))" -ForegroundColor Cyan

Write-Host "`n✅ Migración completada!" -ForegroundColor Green
