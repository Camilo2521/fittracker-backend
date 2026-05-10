-- ============================================================
-- Migration 005 — Traducción completa del esquema a español
-- FitTracker v3.1.0
-- Renombra todas las tablas, columnas, índices y triggers
-- de inglés a español según el mapeo oficial.
-- ============================================================

-- ── 1. Renombrar tablas ───────────────────────────────────────────────────────

ALTER TABLE IF EXISTS accounts              RENAME TO cuentas;
ALTER TABLE IF EXISTS chat_history          RENAME TO historial_chat;
ALTER TABLE IF EXISTS workout_logs          RENAME TO registros_entrenamiento;
ALTER TABLE IF EXISTS diet_logs             RENAME TO registros_dieta;
ALTER TABLE IF EXISTS progress_logs         RENAME TO registros_progreso;
ALTER TABLE IF EXISTS ai_suggestions        RENAME TO sugerencias_ia;
ALTER TABLE IF EXISTS user_memories         RENAME TO memorias_usuario;
ALTER TABLE IF EXISTS nutrition_documents   RENAME TO documentos_nutricion;
ALTER TABLE IF EXISTS diet_plans            RENAME TO planes_dieta;
ALTER TABLE IF EXISTS diet_days             RENAME TO dias_dieta;
ALTER TABLE IF EXISTS diet_meals            RENAME TO comidas_plan;
ALTER TABLE IF EXISTS routines              RENAME TO rutinas;
ALTER TABLE IF EXISTS routine_days          RENAME TO dias_rutina;
ALTER TABLE IF EXISTS routine_exercises     RENAME TO ejercicios_rutina;
ALTER TABLE IF EXISTS physical_metrics      RENAME TO metricas_fisicas;
ALTER TABLE IF EXISTS weights               RENAME TO pesos;
ALTER TABLE IF EXISTS goals                 RENAME TO objetivos;
ALTER TABLE IF EXISTS daily_checks          RENAME TO controles_diarios;
ALTER TABLE IF EXISTS water_intake          RENAME TO consumo_agua;
ALTER TABLE IF EXISTS workouts              RENAME TO entrenamientos;
ALTER TABLE IF EXISTS nutrition             RENAME TO registros_nutricion;
ALTER TABLE IF EXISTS meals                 RENAME TO comidas_detectadas;
ALTER TABLE IF EXISTS exercises             RENAME TO sesiones_ejercicio;
ALTER TABLE IF EXISTS progress_measurements RENAME TO mediciones_progreso;
ALTER TABLE IF EXISTS settings              RENAME TO configuracion;
ALTER TABLE IF EXISTS refresh_tokens        RENAME TO tokens_refresco;
ALTER TABLE IF EXISTS password_reset_tokens RENAME TO tokens_recuperacion;
ALTER TABLE IF EXISTS _migrations           RENAME TO _migraciones;

-- ── 2. Renombrar columnas: cuentas (antes accounts) ──────────────────────────

ALTER TABLE IF EXISTS cuentas RENAME COLUMN email                TO correo;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN password_hash        TO hash_contrasena;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN name                 TO nombre;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN goal                 TO objetivo;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN weight               TO peso;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN height_cm            TO altura_cm;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN age                  TO edad;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN gender               TO genero;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN activity_level       TO nivel_actividad;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN restrictions         TO restricciones;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN target_weight        TO peso_meta;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN start_weight         TO peso_inicio;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN completed_onboarding TO onboarding_completado;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN created_at           TO creado_en;
ALTER TABLE IF EXISTS cuentas RENAME COLUMN updated_at           TO actualizado_en;

-- ── 3. Renombrar columnas: historial_chat (antes chat_history) ────────────────

ALTER TABLE IF EXISTS historial_chat RENAME COLUMN account_id TO cuenta_id;
ALTER TABLE IF EXISTS historial_chat RENAME COLUMN role       TO rol;
ALTER TABLE IF EXISTS historial_chat RENAME COLUMN content    TO contenido;
ALTER TABLE IF EXISTS historial_chat RENAME COLUMN created_at TO creado_en;

-- ── 4. Renombrar columnas: registros_entrenamiento (antes workout_logs) ───────

ALTER TABLE IF EXISTS registros_entrenamiento RENAME COLUMN account_id   TO cuenta_id;
ALTER TABLE IF EXISTS registros_entrenamiento RENAME COLUMN date         TO fecha;
ALTER TABLE IF EXISTS registros_entrenamiento RENAME COLUMN routine_name TO nombre_rutina;
ALTER TABLE IF EXISTS registros_entrenamiento RENAME COLUMN exercises    TO ejercicios_json;
ALTER TABLE IF EXISTS registros_entrenamiento RENAME COLUMN duration_min TO duracion_min;
ALTER TABLE IF EXISTS registros_entrenamiento RENAME COLUMN notes        TO notas;
ALTER TABLE IF EXISTS registros_entrenamiento RENAME COLUMN created_at   TO creado_en;

-- ── 5. Renombrar columnas: registros_dieta (antes diet_logs) ─────────────────

ALTER TABLE IF EXISTS registros_dieta RENAME COLUMN account_id TO cuenta_id;
ALTER TABLE IF EXISTS registros_dieta RENAME COLUMN date       TO fecha;
ALTER TABLE IF EXISTS registros_dieta RENAME COLUMN plan_name  TO nombre_plan;
ALTER TABLE IF EXISTS registros_dieta RENAME COLUMN meals      TO comidas_json;
ALTER TABLE IF EXISTS registros_dieta RENAME COLUMN notes      TO notas;
ALTER TABLE IF EXISTS registros_dieta RENAME COLUMN created_at TO creado_en;

-- ── 6. Renombrar columnas: registros_progreso (antes progress_logs) ──────────

ALTER TABLE IF EXISTS registros_progreso RENAME COLUMN account_id TO cuenta_id;
ALTER TABLE IF EXISTS registros_progreso RENAME COLUMN date       TO fecha;
ALTER TABLE IF EXISTS registros_progreso RENAME COLUMN weight     TO peso;
ALTER TABLE IF EXISTS registros_progreso RENAME COLUMN body_fat   TO grasa_corporal;
ALTER TABLE IF EXISTS registros_progreso RENAME COLUMN chest_cm   TO pecho_cm;
ALTER TABLE IF EXISTS registros_progreso RENAME COLUMN waist_cm   TO cintura_cm;
ALTER TABLE IF EXISTS registros_progreso RENAME COLUMN hip_cm     TO cadera_cm;
ALTER TABLE IF EXISTS registros_progreso RENAME COLUMN arm_cm     TO brazo_cm;
ALTER TABLE IF EXISTS registros_progreso RENAME COLUMN notes      TO notas;
ALTER TABLE IF EXISTS registros_progreso RENAME COLUMN created_at TO creado_en;

-- ── 7. Renombrar columnas: sugerencias_ia (antes ai_suggestions) ─────────────

ALTER TABLE IF EXISTS sugerencias_ia RENAME COLUMN account_id      TO cuenta_id;
ALTER TABLE IF EXISTS sugerencias_ia RENAME COLUMN suggestion_type TO tipo_sugerencia;
ALTER TABLE IF EXISTS sugerencias_ia RENAME COLUMN content         TO contenido;
ALTER TABLE IF EXISTS sugerencias_ia RENAME COLUMN user_feedback   TO respuesta_usuario;
ALTER TABLE IF EXISTS sugerencias_ia RENAME COLUMN created_at      TO creado_en;

-- ── 8. Renombrar columnas: memorias_usuario (antes user_memories) ─────────────

ALTER TABLE IF EXISTS memorias_usuario RENAME COLUMN account_id  TO cuenta_id;
ALTER TABLE IF EXISTS memorias_usuario RENAME COLUMN key         TO clave;
ALTER TABLE IF EXISTS memorias_usuario RENAME COLUMN value       TO valor;
ALTER TABLE IF EXISTS memorias_usuario RENAME COLUMN updated_at  TO actualizado_en;

-- ── 9. Renombrar columnas: documentos_nutricion (antes nutrition_documents) ───

ALTER TABLE IF EXISTS documentos_nutricion RENAME COLUMN title      TO titulo;
ALTER TABLE IF EXISTS documentos_nutricion RENAME COLUMN content    TO contenido;
ALTER TABLE IF EXISTS documentos_nutricion RENAME COLUMN type       TO tipo;
ALTER TABLE IF EXISTS documentos_nutricion RENAME COLUMN created_at TO creado_en;

-- ── 10. Renombrar columnas: planes_dieta (antes diet_plans) ──────────────────

ALTER TABLE IF EXISTS planes_dieta RENAME COLUMN account_id  TO cuenta_id;
ALTER TABLE IF EXISTS planes_dieta RENAME COLUMN week_start  TO inicio_semana;
ALTER TABLE IF EXISTS planes_dieta RENAME COLUMN goal        TO objetivo;
ALTER TABLE IF EXISTS planes_dieta RENAME COLUMN created_at  TO creado_en;

-- ── 11. Renombrar columnas: dias_dieta (antes diet_days) ─────────────────────

-- plan_id no cambia
ALTER TABLE IF EXISTS dias_dieta RENAME COLUMN day_of_week    TO dia_semana;
ALTER TABLE IF EXISTS dias_dieta RENAME COLUMN total_calories TO calorias_totales;

-- ── 12. Renombrar columnas: comidas_plan (antes diet_meals) ──────────────────

ALTER TABLE IF EXISTS comidas_plan RENAME COLUMN day_id          TO dia_id;
ALTER TABLE IF EXISTS comidas_plan RENAME COLUMN name            TO nombre;
ALTER TABLE IF EXISTS comidas_plan RENAME COLUMN calories        TO calorias;
ALTER TABLE IF EXISTS comidas_plan RENAME COLUMN protein_g       TO proteinas_g;
ALTER TABLE IF EXISTS comidas_plan RENAME COLUMN carbs_g         TO carbohidratos_g;
ALTER TABLE IF EXISTS comidas_plan RENAME COLUMN fat_g           TO grasas_g;
ALTER TABLE IF EXISTS comidas_plan RENAME COLUMN manual_override TO ajuste_manual;

-- ── 13. Renombrar columnas: rutinas (antes routines) ─────────────────────────

ALTER TABLE IF EXISTS rutinas RENAME COLUMN account_id TO cuenta_id;
ALTER TABLE IF EXISTS rutinas RENAME COLUMN name       TO nombre;
ALTER TABLE IF EXISTS rutinas RENAME COLUMN is_active  TO activo;
ALTER TABLE IF EXISTS rutinas RENAME COLUMN created_at TO creado_en;

-- ── 14. Renombrar columnas: dias_rutina (antes routine_days) ─────────────────

ALTER TABLE IF EXISTS dias_rutina RENAME COLUMN routine_id TO rutina_id;
ALTER TABLE IF EXISTS dias_rutina RENAME COLUMN day_index  TO indice_dia;
ALTER TABLE IF EXISTS dias_rutina RENAME COLUMN focus      TO enfoque;

-- ── 15. Renombrar columnas: ejercicios_rutina (antes routine_exercises) ───────

ALTER TABLE IF EXISTS ejercicios_rutina RENAME COLUMN day_id      TO dia_id;
ALTER TABLE IF EXISTS ejercicios_rutina RENAME COLUMN name        TO nombre;
ALTER TABLE IF EXISTS ejercicios_rutina RENAME COLUMN sets        TO series;
ALTER TABLE IF EXISTS ejercicios_rutina RENAME COLUMN reps        TO repeticiones;
ALTER TABLE IF EXISTS ejercicios_rutina RENAME COLUMN order_index TO orden;

-- ── 16. Renombrar columnas: metricas_fisicas (antes physical_metrics) ─────────

ALTER TABLE IF EXISTS metricas_fisicas RENAME COLUMN account_id     TO cuenta_id;
ALTER TABLE IF EXISTS metricas_fisicas RENAME COLUMN bmi            TO imc;
ALTER TABLE IF EXISTS metricas_fisicas RENAME COLUMN bmr            TO tmb;
ALTER TABLE IF EXISTS metricas_fisicas RENAME COLUMN tdee           TO gasto_calorico;
ALTER TABLE IF EXISTS metricas_fisicas RENAME COLUMN calorie_target TO meta_calorica;
ALTER TABLE IF EXISTS metricas_fisicas RENAME COLUMN measured_at    TO medido_en;

-- ── 17. Renombrar columnas: pesos (antes weights) ─────────────────────────────

ALTER TABLE IF EXISTS pesos RENAME COLUMN account_id TO cuenta_id;
ALTER TABLE IF EXISTS pesos RENAME COLUMN date       TO fecha;
ALTER TABLE IF EXISTS pesos RENAME COLUMN value      TO valor;
ALTER TABLE IF EXISTS pesos RENAME COLUMN unit       TO unidad;
ALTER TABLE IF EXISTS pesos RENAME COLUMN created_at TO creado_en;

-- ── 18. Renombrar columnas: objetivos (antes goals) ───────────────────────────

ALTER TABLE IF EXISTS objetivos RENAME COLUMN account_id     TO cuenta_id;
ALTER TABLE IF EXISTS objetivos RENAME COLUMN goal           TO tipo;
ALTER TABLE IF EXISTS objetivos RENAME COLUMN target_weight  TO peso_meta;
ALTER TABLE IF EXISTS objetivos RENAME COLUMN start_weight   TO peso_inicio;
ALTER TABLE IF EXISTS objetivos RENAME COLUMN current_weight TO peso_actual;
ALTER TABLE IF EXISTS objetivos RENAME COLUMN created_at     TO creado_en;
ALTER TABLE IF EXISTS objetivos RENAME COLUMN updated_at     TO actualizado_en;

-- ── 19. Renombrar columnas: controles_diarios (antes daily_checks) ────────────

ALTER TABLE IF EXISTS controles_diarios RENAME COLUMN account_id TO cuenta_id;
ALTER TABLE IF EXISTS controles_diarios RENAME COLUMN date       TO fecha;
ALTER TABLE IF EXISTS controles_diarios RENAME COLUMN checks     TO controles_json;
ALTER TABLE IF EXISTS controles_diarios RENAME COLUMN created_at TO creado_en;

-- ── 20. Renombrar columnas: consumo_agua (antes water_intake) ─────────────────

ALTER TABLE IF EXISTS consumo_agua RENAME COLUMN account_id TO cuenta_id;
ALTER TABLE IF EXISTS consumo_agua RENAME COLUMN date       TO fecha;
ALTER TABLE IF EXISTS consumo_agua RENAME COLUMN glasses    TO vasos;
ALTER TABLE IF EXISTS consumo_agua RENAME COLUMN created_at TO creado_en;

-- ── 21. Renombrar columnas: entrenamientos (antes workouts) ───────────────────

ALTER TABLE IF EXISTS entrenamientos RENAME COLUMN account_id TO cuenta_id;
ALTER TABLE IF EXISTS entrenamientos RENAME COLUMN date       TO fecha;
ALTER TABLE IF EXISTS entrenamientos RENAME COLUMN type       TO tipo;
ALTER TABLE IF EXISTS entrenamientos RENAME COLUMN duration   TO duracion;
ALTER TABLE IF EXISTS entrenamientos RENAME COLUMN intensity  TO intensidad;
ALTER TABLE IF EXISTS entrenamientos RENAME COLUMN calories   TO calorias;
ALTER TABLE IF EXISTS entrenamientos RENAME COLUMN notes      TO notas;
ALTER TABLE IF EXISTS entrenamientos RENAME COLUMN created_at TO creado_en;

-- ── 22. Renombrar columnas: registros_nutricion (antes nutrition) ─────────────

ALTER TABLE IF EXISTS registros_nutricion RENAME COLUMN account_id TO cuenta_id;
ALTER TABLE IF EXISTS registros_nutricion RENAME COLUMN date       TO fecha;
ALTER TABLE IF EXISTS registros_nutricion RENAME COLUMN meal_type  TO tipo_comida;
ALTER TABLE IF EXISTS registros_nutricion RENAME COLUMN calories   TO calorias;
ALTER TABLE IF EXISTS registros_nutricion RENAME COLUMN protein    TO proteinas;
ALTER TABLE IF EXISTS registros_nutricion RENAME COLUMN carbs      TO carbohidratos;
ALTER TABLE IF EXISTS registros_nutricion RENAME COLUMN fat        TO grasas;
ALTER TABLE IF EXISTS registros_nutricion RENAME COLUMN created_at TO creado_en;

-- ── 23. Renombrar columnas: comidas_detectadas (antes meals) ──────────────────

ALTER TABLE IF EXISTS comidas_detectadas RENAME COLUMN account_id   TO cuenta_id;
ALTER TABLE IF EXISTS comidas_detectadas RENAME COLUMN date         TO fecha;
ALTER TABLE IF EXISTS comidas_detectadas RENAME COLUMN name         TO nombre;
ALTER TABLE IF EXISTS comidas_detectadas RENAME COLUMN calories     TO calorias;
ALTER TABLE IF EXISTS comidas_detectadas RENAME COLUMN protein      TO proteinas;
ALTER TABLE IF EXISTS comidas_detectadas RENAME COLUMN carbs        TO carbohidratos;
ALTER TABLE IF EXISTS comidas_detectadas RENAME COLUMN fat          TO grasas;
ALTER TABLE IF EXISTS comidas_detectadas RENAME COLUMN detected_by  TO detectado_por;
ALTER TABLE IF EXISTS comidas_detectadas RENAME COLUMN confidence   TO confianza;
ALTER TABLE IF EXISTS comidas_detectadas RENAME COLUMN created_at   TO creado_en;

-- ── 24. Renombrar columnas: sesiones_ejercicio (antes exercises) ──────────────

ALTER TABLE IF EXISTS sesiones_ejercicio RENAME COLUMN account_id    TO cuenta_id;
ALTER TABLE IF EXISTS sesiones_ejercicio RENAME COLUMN date          TO fecha;
ALTER TABLE IF EXISTS sesiones_ejercicio RENAME COLUMN type          TO tipo;
ALTER TABLE IF EXISTS sesiones_ejercicio RENAME COLUMN duration      TO duracion;
ALTER TABLE IF EXISTS sesiones_ejercicio RENAME COLUMN reps          TO repeticiones;
ALTER TABLE IF EXISTS sesiones_ejercicio RENAME COLUMN sets          TO series;
ALTER TABLE IF EXISTS sesiones_ejercicio RENAME COLUMN posture_score TO puntuacion_postura;
ALTER TABLE IF EXISTS sesiones_ejercicio RENAME COLUMN feedback      TO retroalimentacion_json;
ALTER TABLE IF EXISTS sesiones_ejercicio RENAME COLUMN created_at    TO creado_en;

-- ── 25. Renombrar columnas: mediciones_progreso (antes progress_measurements) ─

ALTER TABLE IF EXISTS mediciones_progreso RENAME COLUMN account_id      TO cuenta_id;
ALTER TABLE IF EXISTS mediciones_progreso RENAME COLUMN type            TO tipo;
ALTER TABLE IF EXISTS mediciones_progreso RENAME COLUMN metrics         TO metricas_json;
ALTER TABLE IF EXISTS mediciones_progreso RENAME COLUMN progress        TO progreso_json;
ALTER TABLE IF EXISTS mediciones_progreso RENAME COLUMN recommendations TO recomendaciones_json;
ALTER TABLE IF EXISTS mediciones_progreso RENAME COLUMN timestamp       TO marca_tiempo;

-- ── 26. Renombrar columnas: configuracion (antes settings) ────────────────────

ALTER TABLE IF EXISTS configuracion RENAME COLUMN account_id TO cuenta_id;
ALTER TABLE IF EXISTS configuracion RENAME COLUMN key        TO clave;
ALTER TABLE IF EXISTS configuracion RENAME COLUMN value      TO valor;

-- ── 27. Renombrar columnas: tokens_refresco (antes refresh_tokens) ────────────

ALTER TABLE IF EXISTS tokens_refresco RENAME COLUMN account_id  TO cuenta_id;
ALTER TABLE IF EXISTS tokens_refresco RENAME COLUMN token_hash  TO hash_token;
ALTER TABLE IF EXISTS tokens_refresco RENAME COLUMN expires_at  TO expira_en;
ALTER TABLE IF EXISTS tokens_refresco RENAME COLUMN revoked     TO revocado;
ALTER TABLE IF EXISTS tokens_refresco RENAME COLUMN created_at  TO creado_en;
ALTER TABLE IF EXISTS tokens_refresco RENAME COLUMN user_agent  TO agente_usuario;

-- ── 28. Renombrar columnas: tokens_recuperacion (antes password_reset_tokens) ─

ALTER TABLE IF EXISTS tokens_recuperacion RENAME COLUMN account_id  TO cuenta_id;
ALTER TABLE IF EXISTS tokens_recuperacion RENAME COLUMN token_hash  TO hash_token;
ALTER TABLE IF EXISTS tokens_recuperacion RENAME COLUMN expires_at  TO expira_en;
ALTER TABLE IF EXISTS tokens_recuperacion RENAME COLUMN used        TO utilizado;
ALTER TABLE IF EXISTS tokens_recuperacion RENAME COLUMN created_at  TO creado_en;

-- ── 29. Renombrar columnas: _migraciones (antes _migrations) ─────────────────

ALTER TABLE IF EXISTS _migraciones RENAME COLUMN filename   TO archivo;
ALTER TABLE IF EXISTS _migraciones RENAME COLUMN applied_at TO aplicado_en;

-- ── 30. Renombrar índices ─────────────────────────────────────────────────────

ALTER INDEX IF EXISTS idx_chat_history_account              RENAME TO idx_historial_chat_cuenta;
ALTER INDEX IF EXISTS idx_workout_logs_account              RENAME TO idx_registros_entrenamiento_cuenta;
ALTER INDEX IF EXISTS idx_diet_logs_account                 RENAME TO idx_registros_dieta_cuenta;
ALTER INDEX IF EXISTS idx_progress_logs_account             RENAME TO idx_registros_progreso_cuenta;
ALTER INDEX IF EXISTS idx_ai_suggestions_account            RENAME TO idx_sugerencias_ia_cuenta;
ALTER INDEX IF EXISTS idx_user_memories_account             RENAME TO idx_memorias_usuario_cuenta;
ALTER INDEX IF EXISTS idx_diet_plans_account                RENAME TO idx_planes_dieta_cuenta;
ALTER INDEX IF EXISTS idx_routines_account                  RENAME TO idx_rutinas_cuenta;
ALTER INDEX IF EXISTS idx_routine_exercises_day             RENAME TO idx_ejercicios_rutina_dia;
ALTER INDEX IF EXISTS idx_physical_metrics_account          RENAME TO idx_metricas_fisicas_cuenta;
ALTER INDEX IF EXISTS idx_weights_account                   RENAME TO idx_pesos_cuenta;
ALTER INDEX IF EXISTS idx_workouts_account                  RENAME TO idx_entrenamientos_cuenta;
ALTER INDEX IF EXISTS idx_meals_account                     RENAME TO idx_comidas_detectadas_cuenta;
ALTER INDEX IF EXISTS idx_exercises_account                 RENAME TO idx_sesiones_ejercicio_cuenta;
ALTER INDEX IF EXISTS idx_progress_measurements_account     RENAME TO idx_mediciones_progreso_cuenta;
ALTER INDEX IF EXISTS idx_refresh_tokens_account_id         RENAME TO idx_tokens_refresco_cuenta_id;
ALTER INDEX IF EXISTS idx_refresh_tokens_expires_at         RENAME TO idx_tokens_refresco_expira_en;
ALTER INDEX IF EXISTS idx_prt_account_id                    RENAME TO idx_tokens_recuperacion_cuenta_id;
ALTER INDEX IF EXISTS idx_prt_expires_at                    RENAME TO idx_tokens_recuperacion_expira_en;

-- ── 31. Renombrar la función de trigger ───────────────────────────────────────

ALTER FUNCTION fn_set_updated_at() RENAME TO fn_establecer_actualizado_en;

-- ── 32. Recrear triggers con nuevos nombres de tabla y función ────────────────

-- Eliminar triggers viejos (nombres originales sobre las tablas ya renombradas)
DROP TRIGGER IF EXISTS trg_accounts_updated_at ON cuentas;
DROP TRIGGER IF EXISTS trg_goals_updated_at    ON objetivos;

-- Crear triggers con nombres en español
CREATE TRIGGER trg_cuentas_actualizado_en
  BEFORE UPDATE ON cuentas
  FOR EACH ROW EXECUTE FUNCTION fn_establecer_actualizado_en();

CREATE TRIGGER trg_objetivos_actualizado_en
  BEFORE UPDATE ON objetivos
  FOR EACH ROW EXECUTE FUNCTION fn_establecer_actualizado_en();

-- ── 33. Registrar esta migración ──────────────────────────────────────────────

INSERT INTO _migraciones (archivo) VALUES ('005_traducir_schema.sql')
  ON CONFLICT (archivo) DO NOTHING;
