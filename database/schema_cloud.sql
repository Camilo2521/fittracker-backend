--
-- PostgreSQL database dump
--

\restrict S29m4lkxLEDh9D2TmeDGSI6QZsgMXZQicR7eA2yoBWHJXUMGe8AAxGXkA9Uiyld

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: citext; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;


--
-- Name: EXTENSION citext; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION citext IS 'data type for case-insensitive character strings';


--
-- Name: cleanup_expired_tokens(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_expired_tokens() RETURNS TABLE(tokens_refresco_eliminados bigint, tokens_recuperacion_eliminados bigint)
    LANGUAGE plpgsql
    AS $$
DECLARE
  _rf BIGINT;
  _rp BIGINT;
BEGIN
  -- Refresh tokens: expirados O revocados hace más de 7 días
  DELETE FROM tokens_refresco
  WHERE expira_en < NOW()
     OR (revocado = TRUE AND creado_en < NOW() - INTERVAL '7 days');
  GET DIAGNOSTICS _rf = ROW_COUNT;

  -- Password-reset tokens: utilizados O expirados hace más de 24 horas
  DELETE FROM tokens_recuperacion
  WHERE utilizado = TRUE
     OR expira_en < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS _rp = ROW_COUNT;

  RETURN QUERY SELECT _rf, _rp;
END $$;


--
-- Name: fn_establecer_actualizado_en(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fn_establecer_actualizado_en() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.actualizado_en = NOW();
  RETURN NEW;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _migraciones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._migraciones (
    id bigint CONSTRAINT _migrations_id_not_null NOT NULL,
    archivo text CONSTRAINT _migrations_filename_not_null NOT NULL,
    aplicado_en timestamp with time zone DEFAULT now() CONSTRAINT _migrations_applied_at_not_null NOT NULL
);


--
-- Name: _migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public._migrations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: _migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public._migrations_id_seq OWNED BY public._migraciones.id;


--
-- Name: cuentas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cuentas (
    id bigint CONSTRAINT accounts_id_not_null NOT NULL,
    correo public.citext CONSTRAINT accounts_email_not_null NOT NULL,
    hash_contrasena text CONSTRAINT accounts_password_hash_not_null NOT NULL,
    nombre text DEFAULT ''::text CONSTRAINT accounts_name_not_null NOT NULL,
    objetivo text DEFAULT 'maintain'::text CONSTRAINT accounts_goal_not_null NOT NULL,
    peso numeric(6,2),
    altura_cm numeric(5,2),
    edad smallint,
    genero text,
    nivel_actividad text DEFAULT 'moderate'::text CONSTRAINT accounts_activity_level_not_null NOT NULL,
    restricciones text DEFAULT ''::text CONSTRAINT accounts_restrictions_not_null NOT NULL,
    peso_meta numeric(6,2),
    peso_inicio numeric(6,2),
    onboarding_completado boolean DEFAULT false CONSTRAINT accounts_completed_onboarding_not_null NOT NULL,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT accounts_created_at_not_null NOT NULL,
    actualizado_en timestamp with time zone DEFAULT now() CONSTRAINT accounts_updated_at_not_null NOT NULL,
    CONSTRAINT accounts_activity_level_check CHECK ((nivel_actividad = ANY (ARRAY['sedentary'::text, 'light'::text, 'moderate'::text, 'active'::text, 'very_active'::text]))),
    CONSTRAINT accounts_age_check CHECK (((edad > 0) AND (edad < 150))),
    CONSTRAINT accounts_gender_check CHECK ((genero = ANY (ARRAY['male'::text, 'female'::text, 'other'::text]))),
    CONSTRAINT accounts_goal_check CHECK ((objetivo = ANY (ARRAY['lose'::text, 'gain'::text, 'maintain'::text])))
);


--
-- Name: accounts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.accounts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: accounts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.accounts_id_seq OWNED BY public.cuentas.id;


--
-- Name: sugerencias_ia; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sugerencias_ia (
    id bigint CONSTRAINT ai_suggestions_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT ai_suggestions_account_id_not_null NOT NULL,
    tipo_sugerencia text CONSTRAINT ai_suggestions_suggestion_type_not_null NOT NULL,
    contenido text CONSTRAINT ai_suggestions_content_not_null NOT NULL,
    respuesta_usuario text,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT ai_suggestions_created_at_not_null NOT NULL
);


--
-- Name: ai_suggestions_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.ai_suggestions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: ai_suggestions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.ai_suggestions_id_seq OWNED BY public.sugerencias_ia.id;


--
-- Name: historial_chat; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.historial_chat (
    id bigint CONSTRAINT chat_history_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT chat_history_account_id_not_null NOT NULL,
    rol text CONSTRAINT chat_history_role_not_null NOT NULL,
    contenido text CONSTRAINT chat_history_content_not_null NOT NULL,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT chat_history_created_at_not_null NOT NULL,
    CONSTRAINT chat_history_role_check CHECK ((rol = ANY (ARRAY['user'::text, 'assistant'::text])))
);


--
-- Name: chat_history_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.chat_history_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: chat_history_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.chat_history_id_seq OWNED BY public.historial_chat.id;


--
-- Name: comidas_detectadas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comidas_detectadas (
    id bigint CONSTRAINT meals_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT meals_account_id_not_null NOT NULL,
    fecha date CONSTRAINT meals_date_not_null NOT NULL,
    nombre text CONSTRAINT meals_name_not_null NOT NULL,
    calorias integer DEFAULT 0 CONSTRAINT meals_calories_not_null NOT NULL,
    proteinas numeric(6,2) DEFAULT 0 CONSTRAINT meals_protein_not_null NOT NULL,
    carbohidratos numeric(6,2) DEFAULT 0 CONSTRAINT meals_carbs_not_null NOT NULL,
    grasas numeric(6,2) DEFAULT 0 CONSTRAINT meals_fat_not_null NOT NULL,
    detectado_por text DEFAULT 'manual'::text CONSTRAINT meals_detected_by_not_null NOT NULL,
    confianza numeric(4,3),
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT meals_created_at_not_null NOT NULL
);


--
-- Name: comidas_plan; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.comidas_plan (
    id bigint CONSTRAINT diet_meals_id_not_null NOT NULL,
    dia_id bigint CONSTRAINT diet_meals_day_id_not_null NOT NULL,
    nombre text CONSTRAINT diet_meals_name_not_null NOT NULL,
    calorias numeric(7,2),
    proteinas_g numeric(6,2),
    carbohidratos_g numeric(6,2),
    grasas_g numeric(6,2),
    ajuste_manual boolean DEFAULT false CONSTRAINT diet_meals_manual_override_not_null NOT NULL
);


--
-- Name: configuracion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.configuracion (
    id bigint CONSTRAINT settings_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT settings_account_id_not_null NOT NULL,
    clave text CONSTRAINT settings_key_not_null NOT NULL,
    valor text
);


--
-- Name: consumo_agua; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumo_agua (
    id bigint CONSTRAINT water_intake_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT water_intake_account_id_not_null NOT NULL,
    fecha date CONSTRAINT water_intake_date_not_null NOT NULL,
    vasos smallint DEFAULT 0 CONSTRAINT water_intake_glasses_not_null NOT NULL,
    ml integer DEFAULT 0 CONSTRAINT water_intake_ml_not_null NOT NULL,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT water_intake_created_at_not_null NOT NULL
);


--
-- Name: controles_diarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.controles_diarios (
    id bigint CONSTRAINT daily_checks_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT daily_checks_account_id_not_null NOT NULL,
    fecha date CONSTRAINT daily_checks_date_not_null NOT NULL,
    controles_json jsonb DEFAULT '{}'::jsonb CONSTRAINT daily_checks_checks_not_null NOT NULL,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT daily_checks_created_at_not_null NOT NULL
);


--
-- Name: daily_checks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.daily_checks_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: daily_checks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.daily_checks_id_seq OWNED BY public.controles_diarios.id;


--
-- Name: dias_dieta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dias_dieta (
    id bigint CONSTRAINT diet_days_id_not_null NOT NULL,
    plan_id bigint CONSTRAINT diet_days_plan_id_not_null NOT NULL,
    dia_semana smallint CONSTRAINT diet_days_day_of_week_not_null NOT NULL,
    calorias_totales numeric(7,2),
    CONSTRAINT diet_days_day_of_week_check CHECK (((dia_semana >= 1) AND (dia_semana <= 7)))
);


--
-- Name: dias_rutina; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dias_rutina (
    id bigint CONSTRAINT routine_days_id_not_null NOT NULL,
    rutina_id bigint CONSTRAINT routine_days_routine_id_not_null NOT NULL,
    indice_dia smallint CONSTRAINT routine_days_day_index_not_null NOT NULL,
    enfoque text,
    CONSTRAINT routine_days_day_index_check CHECK (((indice_dia >= 0) AND (indice_dia <= 6)))
);


--
-- Name: diet_days_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.diet_days_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: diet_days_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.diet_days_id_seq OWNED BY public.dias_dieta.id;


--
-- Name: registros_dieta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registros_dieta (
    id bigint CONSTRAINT diet_logs_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT diet_logs_account_id_not_null NOT NULL,
    fecha date DEFAULT CURRENT_DATE CONSTRAINT diet_logs_date_not_null NOT NULL,
    nombre_plan text,
    comidas_json jsonb DEFAULT '[]'::jsonb CONSTRAINT diet_logs_meals_not_null NOT NULL,
    total_kcal numeric(7,2),
    notas text,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT diet_logs_created_at_not_null NOT NULL
);


--
-- Name: diet_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.diet_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: diet_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.diet_logs_id_seq OWNED BY public.registros_dieta.id;


--
-- Name: diet_meals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.diet_meals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: diet_meals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.diet_meals_id_seq OWNED BY public.comidas_plan.id;


--
-- Name: planes_dieta; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.planes_dieta (
    id bigint CONSTRAINT diet_plans_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT diet_plans_account_id_not_null NOT NULL,
    inicio_semana date CONSTRAINT diet_plans_week_start_not_null NOT NULL,
    objetivo text,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT diet_plans_created_at_not_null NOT NULL
);


--
-- Name: diet_plans_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.diet_plans_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: diet_plans_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.diet_plans_id_seq OWNED BY public.planes_dieta.id;


--
-- Name: documentos_nutricion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documentos_nutricion (
    id bigint CONSTRAINT nutrition_documents_id_not_null NOT NULL,
    titulo text CONSTRAINT nutrition_documents_title_not_null NOT NULL,
    contenido text CONSTRAINT nutrition_documents_content_not_null NOT NULL,
    tipo text DEFAULT 'nutrition'::text CONSTRAINT nutrition_documents_type_not_null NOT NULL,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT nutrition_documents_created_at_not_null NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    title text NOT NULL,
    chunk_index integer DEFAULT 0 NOT NULL,
    content text NOT NULL,
    embedding jsonb,
    token_count integer,
    ingested_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ejercicios_rutina; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ejercicios_rutina (
    id bigint CONSTRAINT routine_exercises_id_not_null NOT NULL,
    dia_id bigint CONSTRAINT routine_exercises_day_id_not_null NOT NULL,
    nombre text CONSTRAINT routine_exercises_name_not_null NOT NULL,
    series smallint,
    repeticiones text,
    orden smallint DEFAULT 0 CONSTRAINT routine_exercises_order_index_not_null NOT NULL
);


--
-- Name: entrenamientos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.entrenamientos (
    id bigint CONSTRAINT workouts_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT workouts_account_id_not_null NOT NULL,
    fecha date CONSTRAINT workouts_date_not_null NOT NULL,
    tipo text CONSTRAINT workouts_type_not_null NOT NULL,
    duracion integer CONSTRAINT workouts_duration_not_null NOT NULL,
    intensidad text CONSTRAINT workouts_intensity_not_null NOT NULL,
    calorias integer,
    notas text,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT workouts_created_at_not_null NOT NULL,
    CONSTRAINT workouts_intensity_check CHECK ((intensidad = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))),
    CONSTRAINT workouts_type_check CHECK ((tipo = ANY (ARRAY['strength'::text, 'cardio'::text, 'flexibility'::text])))
);


--
-- Name: sesiones_ejercicio; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sesiones_ejercicio (
    id bigint CONSTRAINT exercises_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT exercises_account_id_not_null NOT NULL,
    fecha date CONSTRAINT exercises_date_not_null NOT NULL,
    tipo text CONSTRAINT exercises_type_not_null NOT NULL,
    duracion integer,
    repeticiones integer,
    series integer,
    puntuacion_postura numeric(5,2),
    retroalimentacion_json jsonb DEFAULT '[]'::jsonb CONSTRAINT exercises_feedback_not_null NOT NULL,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT exercises_created_at_not_null NOT NULL
);


--
-- Name: exercises_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.exercises_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: exercises_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.exercises_id_seq OWNED BY public.sesiones_ejercicio.id;


--
-- Name: meals_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.meals_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: meals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.meals_id_seq OWNED BY public.comidas_detectadas.id;


--
-- Name: mediciones_progreso; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.mediciones_progreso (
    id bigint CONSTRAINT progress_measurements_id_not_null NOT NULL,
    cuenta_id bigint,
    tipo text DEFAULT 'progress_measurement'::text CONSTRAINT progress_measurements_type_not_null NOT NULL,
    metricas_json jsonb,
    progreso_json jsonb,
    recomendaciones_json jsonb,
    marca_tiempo timestamp with time zone DEFAULT now() CONSTRAINT progress_measurements_timestamp_not_null NOT NULL
);


--
-- Name: memorias_usuario; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.memorias_usuario (
    id bigint CONSTRAINT user_memories_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT user_memories_account_id_not_null NOT NULL,
    clave text CONSTRAINT user_memories_key_not_null NOT NULL,
    valor text CONSTRAINT user_memories_value_not_null NOT NULL,
    actualizado_en timestamp with time zone DEFAULT now() CONSTRAINT user_memories_updated_at_not_null NOT NULL
);


--
-- Name: metricas_fisicas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.metricas_fisicas (
    id bigint CONSTRAINT physical_metrics_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT physical_metrics_account_id_not_null NOT NULL,
    imc numeric(5,2),
    tmb numeric(7,2),
    gasto_calorico numeric(7,2),
    meta_calorica numeric(7,2),
    medido_en timestamp with time zone DEFAULT now() CONSTRAINT physical_metrics_measured_at_not_null NOT NULL,
    fecha_calculo date DEFAULT CURRENT_DATE NOT NULL
);


--
-- Name: nutrition_documents_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.nutrition_documents_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nutrition_documents_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nutrition_documents_id_seq OWNED BY public.documentos_nutricion.id;


--
-- Name: registros_nutricion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registros_nutricion (
    id bigint CONSTRAINT nutrition_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT nutrition_account_id_not_null NOT NULL,
    fecha date CONSTRAINT nutrition_date_not_null NOT NULL,
    tipo_comida text,
    calorias integer DEFAULT 0 CONSTRAINT nutrition_calories_not_null NOT NULL,
    proteinas numeric(6,2) DEFAULT 0 CONSTRAINT nutrition_protein_not_null NOT NULL,
    carbohidratos numeric(6,2) DEFAULT 0 CONSTRAINT nutrition_carbs_not_null NOT NULL,
    grasas numeric(6,2) DEFAULT 0 CONSTRAINT nutrition_fat_not_null NOT NULL,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT nutrition_created_at_not_null NOT NULL
);


--
-- Name: nutrition_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.nutrition_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: nutrition_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.nutrition_id_seq OWNED BY public.registros_nutricion.id;


--
-- Name: tokens_recuperacion; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tokens_recuperacion (
    id bigint CONSTRAINT password_reset_tokens_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT password_reset_tokens_account_id_not_null NOT NULL,
    hash_token text CONSTRAINT password_reset_tokens_token_hash_not_null NOT NULL,
    expira_en timestamp with time zone CONSTRAINT password_reset_tokens_expires_at_not_null NOT NULL,
    utilizado boolean DEFAULT false CONSTRAINT password_reset_tokens_used_not_null NOT NULL,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT password_reset_tokens_created_at_not_null NOT NULL
);


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.password_reset_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: password_reset_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.password_reset_tokens_id_seq OWNED BY public.tokens_recuperacion.id;


--
-- Name: physical_metrics_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.physical_metrics_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: physical_metrics_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.physical_metrics_id_seq OWNED BY public.metricas_fisicas.id;


--
-- Name: registros_progreso; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registros_progreso (
    id bigint CONSTRAINT progress_logs_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT progress_logs_account_id_not_null NOT NULL,
    fecha date DEFAULT CURRENT_DATE CONSTRAINT progress_logs_date_not_null NOT NULL,
    peso numeric(6,2),
    grasa_corporal numeric(5,2),
    pecho_cm numeric(5,1),
    cintura_cm numeric(5,1),
    cadera_cm numeric(5,1),
    brazo_cm numeric(5,1),
    notas text,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT progress_logs_created_at_not_null NOT NULL
);


--
-- Name: progress_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.progress_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: progress_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.progress_logs_id_seq OWNED BY public.registros_progreso.id;


--
-- Name: progress_measurements_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.progress_measurements_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: progress_measurements_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.progress_measurements_id_seq OWNED BY public.mediciones_progreso.id;


--
-- Name: rag_queries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rag_queries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    external_id text NOT NULL,
    query_type text NOT NULL,
    prompt text NOT NULL,
    response text NOT NULL,
    sources_used jsonb,
    tokens_in integer,
    tokens_out integer,
    latency_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT rag_queries_query_type_check CHECK ((query_type = ANY (ARRAY['diet'::text, 'routine'::text, 'general'::text])))
);


--
-- Name: tokens_refresco; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tokens_refresco (
    id bigint CONSTRAINT refresh_tokens_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT refresh_tokens_account_id_not_null NOT NULL,
    hash_token text CONSTRAINT refresh_tokens_token_hash_not_null NOT NULL,
    expira_en timestamp with time zone CONSTRAINT refresh_tokens_expires_at_not_null NOT NULL,
    revocado boolean DEFAULT false CONSTRAINT refresh_tokens_revoked_not_null NOT NULL,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT refresh_tokens_created_at_not_null NOT NULL,
    agente_usuario text,
    ip text
);


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.refresh_tokens_id_seq OWNED BY public.tokens_refresco.id;


--
-- Name: registros_entrenamiento; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.registros_entrenamiento (
    id bigint CONSTRAINT workout_logs_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT workout_logs_account_id_not_null NOT NULL,
    fecha date DEFAULT CURRENT_DATE CONSTRAINT workout_logs_date_not_null NOT NULL,
    nombre_rutina text,
    ejercicios_json jsonb DEFAULT '[]'::jsonb CONSTRAINT workout_logs_exercises_not_null NOT NULL,
    duracion_min smallint,
    notas text,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT workout_logs_created_at_not_null NOT NULL,
    CONSTRAINT workout_logs_duration_min_check CHECK ((duracion_min > 0))
);


--
-- Name: routine_days_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routine_days_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routine_days_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routine_days_id_seq OWNED BY public.dias_rutina.id;


--
-- Name: routine_exercises_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routine_exercises_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routine_exercises_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routine_exercises_id_seq OWNED BY public.ejercicios_rutina.id;


--
-- Name: rutinas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.rutinas (
    id bigint CONSTRAINT routines_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT routines_account_id_not_null NOT NULL,
    nombre text CONSTRAINT routines_name_not_null NOT NULL,
    activo boolean DEFAULT true CONSTRAINT routines_is_active_not_null NOT NULL,
    creado_en timestamp with time zone DEFAULT now() CONSTRAINT routines_created_at_not_null NOT NULL
);


--
-- Name: routines_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.routines_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: routines_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.routines_id_seq OWNED BY public.rutinas.id;


--
-- Name: sesiones_rep; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sesiones_rep (
    id bigint CONSTRAINT rep_sessions_id_not_null NOT NULL,
    cuenta_id bigint CONSTRAINT rep_sessions_cuenta_id_not_null NOT NULL,
    tipo_ejercicio text CONSTRAINT rep_sessions_exercise_type_not_null NOT NULL,
    modo text DEFAULT 'mediapipe'::text CONSTRAINT rep_sessions_mode_not_null NOT NULL,
    iniciado_en timestamp with time zone DEFAULT now() CONSTRAINT rep_sessions_started_at_not_null NOT NULL,
    finalizado_en timestamp with time zone,
    total_repeticiones integer DEFAULT 0 CONSTRAINT rep_sessions_total_reps_not_null NOT NULL,
    total_series integer DEFAULT 0 CONSTRAINT rep_sessions_total_sets_not_null NOT NULL,
    calorias_quemadas numeric(7,2),
    puntuacion_forma_promedio numeric(5,2)
);


--
-- Name: sesiones_rep_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.sesiones_rep_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: sesiones_rep_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.sesiones_rep_id_seq OWNED BY public.sesiones_rep.id;


--
-- Name: settings_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: settings_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.settings_id_seq OWNED BY public.configuracion.id;


--
-- Name: user_memories_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.user_memories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: user_memories_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.user_memories_id_seq OWNED BY public.memorias_usuario.id;


--
-- Name: water_intake_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.water_intake_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: water_intake_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.water_intake_id_seq OWNED BY public.consumo_agua.id;


--
-- Name: workout_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workout_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workout_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workout_logs_id_seq OWNED BY public.registros_entrenamiento.id;


--
-- Name: workouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.workouts_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: workouts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.workouts_id_seq OWNED BY public.entrenamientos.id;


--
-- Name: _migraciones id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migraciones ALTER COLUMN id SET DEFAULT nextval('public._migrations_id_seq'::regclass);


--
-- Name: comidas_detectadas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comidas_detectadas ALTER COLUMN id SET DEFAULT nextval('public.meals_id_seq'::regclass);


--
-- Name: comidas_plan id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comidas_plan ALTER COLUMN id SET DEFAULT nextval('public.diet_meals_id_seq'::regclass);


--
-- Name: configuracion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracion ALTER COLUMN id SET DEFAULT nextval('public.settings_id_seq'::regclass);


--
-- Name: consumo_agua id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_agua ALTER COLUMN id SET DEFAULT nextval('public.water_intake_id_seq'::regclass);


--
-- Name: controles_diarios id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controles_diarios ALTER COLUMN id SET DEFAULT nextval('public.daily_checks_id_seq'::regclass);


--
-- Name: cuentas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas ALTER COLUMN id SET DEFAULT nextval('public.accounts_id_seq'::regclass);


--
-- Name: dias_dieta id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dias_dieta ALTER COLUMN id SET DEFAULT nextval('public.diet_days_id_seq'::regclass);


--
-- Name: dias_rutina id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dias_rutina ALTER COLUMN id SET DEFAULT nextval('public.routine_days_id_seq'::regclass);


--
-- Name: documentos_nutricion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_nutricion ALTER COLUMN id SET DEFAULT nextval('public.nutrition_documents_id_seq'::regclass);


--
-- Name: ejercicios_rutina id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ejercicios_rutina ALTER COLUMN id SET DEFAULT nextval('public.routine_exercises_id_seq'::regclass);


--
-- Name: entrenamientos id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrenamientos ALTER COLUMN id SET DEFAULT nextval('public.workouts_id_seq'::regclass);


--
-- Name: historial_chat id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_chat ALTER COLUMN id SET DEFAULT nextval('public.chat_history_id_seq'::regclass);


--
-- Name: mediciones_progreso id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mediciones_progreso ALTER COLUMN id SET DEFAULT nextval('public.progress_measurements_id_seq'::regclass);


--
-- Name: memorias_usuario id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memorias_usuario ALTER COLUMN id SET DEFAULT nextval('public.user_memories_id_seq'::regclass);


--
-- Name: metricas_fisicas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metricas_fisicas ALTER COLUMN id SET DEFAULT nextval('public.physical_metrics_id_seq'::regclass);


--
-- Name: planes_dieta id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planes_dieta ALTER COLUMN id SET DEFAULT nextval('public.diet_plans_id_seq'::regclass);


--
-- Name: registros_dieta id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_dieta ALTER COLUMN id SET DEFAULT nextval('public.diet_logs_id_seq'::regclass);


--
-- Name: registros_entrenamiento id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_entrenamiento ALTER COLUMN id SET DEFAULT nextval('public.workout_logs_id_seq'::regclass);


--
-- Name: registros_nutricion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_nutricion ALTER COLUMN id SET DEFAULT nextval('public.nutrition_id_seq'::regclass);


--
-- Name: registros_progreso id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_progreso ALTER COLUMN id SET DEFAULT nextval('public.progress_logs_id_seq'::regclass);


--
-- Name: rutinas id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutinas ALTER COLUMN id SET DEFAULT nextval('public.routines_id_seq'::regclass);


--
-- Name: sesiones_ejercicio id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones_ejercicio ALTER COLUMN id SET DEFAULT nextval('public.exercises_id_seq'::regclass);


--
-- Name: sesiones_rep id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones_rep ALTER COLUMN id SET DEFAULT nextval('public.sesiones_rep_id_seq'::regclass);


--
-- Name: sugerencias_ia id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sugerencias_ia ALTER COLUMN id SET DEFAULT nextval('public.ai_suggestions_id_seq'::regclass);


--
-- Name: tokens_recuperacion id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens_recuperacion ALTER COLUMN id SET DEFAULT nextval('public.password_reset_tokens_id_seq'::regclass);


--
-- Name: tokens_refresco id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens_refresco ALTER COLUMN id SET DEFAULT nextval('public.refresh_tokens_id_seq'::regclass);


--
-- Name: _migraciones _migrations_filename_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migraciones
    ADD CONSTRAINT _migrations_filename_key UNIQUE (archivo);


--
-- Name: _migraciones _migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._migraciones
    ADD CONSTRAINT _migrations_pkey PRIMARY KEY (id);


--
-- Name: cuentas accounts_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas
    ADD CONSTRAINT accounts_email_key UNIQUE (correo);


--
-- Name: cuentas accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cuentas
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: sugerencias_ia ai_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sugerencias_ia
    ADD CONSTRAINT ai_suggestions_pkey PRIMARY KEY (id);


--
-- Name: historial_chat chat_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_chat
    ADD CONSTRAINT chat_history_pkey PRIMARY KEY (id);


--
-- Name: controles_diarios daily_checks_account_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controles_diarios
    ADD CONSTRAINT daily_checks_account_id_date_key UNIQUE (cuenta_id, fecha);


--
-- Name: controles_diarios daily_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controles_diarios
    ADD CONSTRAINT daily_checks_pkey PRIMARY KEY (id);


--
-- Name: dias_dieta diet_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dias_dieta
    ADD CONSTRAINT diet_days_pkey PRIMARY KEY (id);


--
-- Name: registros_dieta diet_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_dieta
    ADD CONSTRAINT diet_logs_pkey PRIMARY KEY (id);


--
-- Name: comidas_plan diet_meals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comidas_plan
    ADD CONSTRAINT diet_meals_pkey PRIMARY KEY (id);


--
-- Name: planes_dieta diet_plans_account_id_week_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planes_dieta
    ADD CONSTRAINT diet_plans_account_id_week_start_key UNIQUE (cuenta_id, inicio_semana);


--
-- Name: planes_dieta diet_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planes_dieta
    ADD CONSTRAINT diet_plans_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: documents documents_source_title_chunk_index_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_source_title_chunk_index_key UNIQUE (source, title, chunk_index);


--
-- Name: sesiones_ejercicio exercises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones_ejercicio
    ADD CONSTRAINT exercises_pkey PRIMARY KEY (id);


--
-- Name: comidas_detectadas meals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comidas_detectadas
    ADD CONSTRAINT meals_pkey PRIMARY KEY (id);


--
-- Name: documentos_nutricion nutrition_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documentos_nutricion
    ADD CONSTRAINT nutrition_documents_pkey PRIMARY KEY (id);


--
-- Name: registros_nutricion nutrition_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_nutricion
    ADD CONSTRAINT nutrition_pkey PRIMARY KEY (id);


--
-- Name: tokens_recuperacion password_reset_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens_recuperacion
    ADD CONSTRAINT password_reset_tokens_pkey PRIMARY KEY (id);


--
-- Name: tokens_recuperacion password_reset_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens_recuperacion
    ADD CONSTRAINT password_reset_tokens_token_hash_key UNIQUE (hash_token);


--
-- Name: metricas_fisicas physical_metrics_account_id_measured_at_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metricas_fisicas
    ADD CONSTRAINT physical_metrics_account_id_measured_at_key UNIQUE (cuenta_id, medido_en);


--
-- Name: metricas_fisicas physical_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metricas_fisicas
    ADD CONSTRAINT physical_metrics_pkey PRIMARY KEY (id);


--
-- Name: registros_progreso progress_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_progreso
    ADD CONSTRAINT progress_logs_pkey PRIMARY KEY (id);


--
-- Name: mediciones_progreso progress_measurements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mediciones_progreso
    ADD CONSTRAINT progress_measurements_pkey PRIMARY KEY (id);


--
-- Name: rag_queries rag_queries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rag_queries
    ADD CONSTRAINT rag_queries_pkey PRIMARY KEY (id);


--
-- Name: tokens_refresco refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens_refresco
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: tokens_refresco refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens_refresco
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (hash_token);


--
-- Name: sesiones_rep rep_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones_rep
    ADD CONSTRAINT rep_sessions_pkey PRIMARY KEY (id);


--
-- Name: dias_rutina routine_days_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dias_rutina
    ADD CONSTRAINT routine_days_pkey PRIMARY KEY (id);


--
-- Name: ejercicios_rutina routine_exercises_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ejercicios_rutina
    ADD CONSTRAINT routine_exercises_pkey PRIMARY KEY (id);


--
-- Name: rutinas routines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutinas
    ADD CONSTRAINT routines_pkey PRIMARY KEY (id);


--
-- Name: configuracion settings_account_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracion
    ADD CONSTRAINT settings_account_id_key_key UNIQUE (cuenta_id, clave);


--
-- Name: configuracion settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracion
    ADD CONSTRAINT settings_pkey PRIMARY KEY (id);


--
-- Name: metricas_fisicas uq_metricas_fisicas_cuenta_fecha; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metricas_fisicas
    ADD CONSTRAINT uq_metricas_fisicas_cuenta_fecha UNIQUE (cuenta_id, fecha_calculo);


--
-- Name: memorias_usuario user_memories_account_id_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memorias_usuario
    ADD CONSTRAINT user_memories_account_id_key_key UNIQUE (cuenta_id, clave);


--
-- Name: memorias_usuario user_memories_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memorias_usuario
    ADD CONSTRAINT user_memories_pkey PRIMARY KEY (id);


--
-- Name: consumo_agua water_intake_account_id_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_agua
    ADD CONSTRAINT water_intake_account_id_date_key UNIQUE (cuenta_id, fecha);


--
-- Name: consumo_agua water_intake_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_agua
    ADD CONSTRAINT water_intake_pkey PRIMARY KEY (id);


--
-- Name: registros_entrenamiento workout_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_entrenamiento
    ADD CONSTRAINT workout_logs_pkey PRIMARY KEY (id);


--
-- Name: entrenamientos workouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrenamientos
    ADD CONSTRAINT workouts_pkey PRIMARY KEY (id);


--
-- Name: idx_comidas_detectadas_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comidas_detectadas_cuenta ON public.comidas_detectadas USING btree (cuenta_id, fecha DESC);


--
-- Name: idx_comidas_plan_dia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comidas_plan_dia ON public.comidas_plan USING btree (dia_id);


--
-- Name: idx_dias_dieta_plan; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dias_dieta_plan ON public.dias_dieta USING btree (plan_id);


--
-- Name: idx_dias_rutina_rutina; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dias_rutina_rutina ON public.dias_rutina USING btree (rutina_id);


--
-- Name: idx_documents_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_source ON public.documents USING btree (source, title);


--
-- Name: idx_ejercicios_rutina_dia; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ejercicios_rutina_dia ON public.ejercicios_rutina USING btree (dia_id, orden);


--
-- Name: idx_entrenamientos_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_entrenamientos_cuenta ON public.entrenamientos USING btree (cuenta_id, fecha DESC);


--
-- Name: idx_historial_chat_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historial_chat_cuenta ON public.historial_chat USING btree (cuenta_id, creado_en DESC);


--
-- Name: idx_mediciones_progreso_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_mediciones_progreso_cuenta ON public.mediciones_progreso USING btree (cuenta_id);


--
-- Name: idx_memorias_usuario_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_memorias_usuario_cuenta ON public.memorias_usuario USING btree (cuenta_id);


--
-- Name: idx_metricas_fisicas_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metricas_fisicas_cuenta ON public.metricas_fisicas USING btree (cuenta_id, medido_en DESC);


--
-- Name: idx_metricas_fisicas_cuenta_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_metricas_fisicas_cuenta_fecha ON public.metricas_fisicas USING btree (cuenta_id, fecha_calculo DESC);


--
-- Name: idx_planes_dieta_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_planes_dieta_cuenta ON public.planes_dieta USING btree (cuenta_id, inicio_semana DESC);


--
-- Name: idx_rag_queries_ext; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rag_queries_ext ON public.rag_queries USING btree (external_id, created_at);


--
-- Name: idx_registros_dieta_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_registros_dieta_cuenta ON public.registros_dieta USING btree (cuenta_id, fecha DESC);


--
-- Name: idx_registros_entrenamiento_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_registros_entrenamiento_cuenta ON public.registros_entrenamiento USING btree (cuenta_id, fecha DESC);


--
-- Name: idx_registros_nutricion_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_registros_nutricion_cuenta ON public.registros_nutricion USING btree (cuenta_id, fecha DESC);


--
-- Name: idx_registros_progreso_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_registros_progreso_cuenta ON public.registros_progreso USING btree (cuenta_id, fecha DESC);


--
-- Name: idx_rutinas_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rutinas_cuenta ON public.rutinas USING btree (cuenta_id, activo);


--
-- Name: idx_sesiones_ejercicio_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_ejercicio_cuenta ON public.sesiones_ejercicio USING btree (cuenta_id, fecha DESC);


--
-- Name: idx_sesiones_rep_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sesiones_rep_cuenta ON public.sesiones_rep USING btree (cuenta_id, iniciado_en DESC);


--
-- Name: idx_sugerencias_ia_cuenta; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sugerencias_ia_cuenta ON public.sugerencias_ia USING btree (cuenta_id, creado_en DESC);


--
-- Name: idx_tokens_recuperacion_cuenta_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_recuperacion_cuenta_id ON public.tokens_recuperacion USING btree (cuenta_id);


--
-- Name: idx_tokens_recuperacion_expira; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_recuperacion_expira ON public.tokens_recuperacion USING btree (expira_en);


--
-- Name: idx_tokens_recuperacion_expira_en; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_recuperacion_expira_en ON public.tokens_recuperacion USING btree (expira_en);


--
-- Name: idx_tokens_recuperacion_usado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_recuperacion_usado ON public.tokens_recuperacion USING btree (utilizado) WHERE (utilizado = true);


--
-- Name: idx_tokens_refresco_cuenta_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_refresco_cuenta_id ON public.tokens_refresco USING btree (cuenta_id);


--
-- Name: idx_tokens_refresco_expira; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_refresco_expira ON public.tokens_refresco USING btree (expira_en);


--
-- Name: idx_tokens_refresco_expira_en; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_refresco_expira_en ON public.tokens_refresco USING btree (expira_en);


--
-- Name: idx_tokens_refresco_revocado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_tokens_refresco_revocado ON public.tokens_refresco USING btree (revocado) WHERE (revocado = true);


--
-- Name: cuentas trg_cuentas_actualizado_en; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_cuentas_actualizado_en BEFORE UPDATE ON public.cuentas FOR EACH ROW EXECUTE FUNCTION public.fn_establecer_actualizado_en();


--
-- Name: sugerencias_ia ai_suggestions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sugerencias_ia
    ADD CONSTRAINT ai_suggestions_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: historial_chat chat_history_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historial_chat
    ADD CONSTRAINT chat_history_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: controles_diarios daily_checks_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.controles_diarios
    ADD CONSTRAINT daily_checks_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: dias_dieta diet_days_plan_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dias_dieta
    ADD CONSTRAINT diet_days_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.planes_dieta(id) ON DELETE CASCADE;


--
-- Name: registros_dieta diet_logs_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_dieta
    ADD CONSTRAINT diet_logs_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: comidas_plan diet_meals_day_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comidas_plan
    ADD CONSTRAINT diet_meals_day_id_fkey FOREIGN KEY (dia_id) REFERENCES public.dias_dieta(id) ON DELETE CASCADE;


--
-- Name: planes_dieta diet_plans_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.planes_dieta
    ADD CONSTRAINT diet_plans_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: sesiones_ejercicio exercises_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones_ejercicio
    ADD CONSTRAINT exercises_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: comidas_detectadas meals_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.comidas_detectadas
    ADD CONSTRAINT meals_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: mediciones_progreso mediciones_progreso_cuenta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.mediciones_progreso
    ADD CONSTRAINT mediciones_progreso_cuenta_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: registros_nutricion nutrition_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_nutricion
    ADD CONSTRAINT nutrition_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: tokens_recuperacion password_reset_tokens_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens_recuperacion
    ADD CONSTRAINT password_reset_tokens_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: metricas_fisicas physical_metrics_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.metricas_fisicas
    ADD CONSTRAINT physical_metrics_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: registros_progreso progress_logs_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_progreso
    ADD CONSTRAINT progress_logs_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: tokens_refresco refresh_tokens_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tokens_refresco
    ADD CONSTRAINT refresh_tokens_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: sesiones_rep rep_sessions_cuenta_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sesiones_rep
    ADD CONSTRAINT rep_sessions_cuenta_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: dias_rutina routine_days_routine_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dias_rutina
    ADD CONSTRAINT routine_days_routine_id_fkey FOREIGN KEY (rutina_id) REFERENCES public.rutinas(id) ON DELETE CASCADE;


--
-- Name: ejercicios_rutina routine_exercises_day_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ejercicios_rutina
    ADD CONSTRAINT routine_exercises_day_id_fkey FOREIGN KEY (dia_id) REFERENCES public.dias_rutina(id) ON DELETE CASCADE;


--
-- Name: rutinas routines_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rutinas
    ADD CONSTRAINT routines_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: configuracion settings_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.configuracion
    ADD CONSTRAINT settings_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: memorias_usuario user_memories_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.memorias_usuario
    ADD CONSTRAINT user_memories_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: consumo_agua water_intake_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumo_agua
    ADD CONSTRAINT water_intake_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: registros_entrenamiento workout_logs_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.registros_entrenamiento
    ADD CONSTRAINT workout_logs_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- Name: entrenamientos workouts_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.entrenamientos
    ADD CONSTRAINT workouts_account_id_fkey FOREIGN KEY (cuenta_id) REFERENCES public.cuentas(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict S29m4lkxLEDh9D2TmeDGSI6QZsgMXZQicR7eA2yoBWHJXUMGe8AAxGXkA9Uiyld

