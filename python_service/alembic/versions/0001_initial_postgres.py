"""Initial PostgreSQL schema — FitTracker v2

Revision ID: 0001
Revises:
Create Date: 2025-01-01 00:00:00
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB, TIMESTAMPTZ

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Extensiones
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')

    # ── rep_sessions ────────────────────────────────────────
    op.create_table(
        "rep_sessions",
        sa.Column("id",           UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("external_id",  sa.Text, nullable=False),
        sa.Column("exercise_type",sa.Text, nullable=False),
        sa.Column("mode",         sa.Text, nullable=False, server_default="mediapipe"),
        sa.Column("started_at",   TIMESTAMPTZ, nullable=False, server_default=sa.text("NOW()")),
        sa.Column("ended_at",     TIMESTAMPTZ, nullable=True),
        sa.Column("total_reps",   sa.Integer, nullable=False, server_default="0"),
        sa.Column("total_sets",   sa.Integer, nullable=False, server_default="0"),
        sa.Column("calories_burned", sa.Float, nullable=True),
        sa.Column("avg_form_score",  sa.Float, nullable=True),
        sa.Column("notes",        sa.Text, nullable=True),
        sa.Column("synced_from_offline", sa.Boolean, server_default="false"),
        sa.Column("created_at",   TIMESTAMPTZ, nullable=False, server_default=sa.text("NOW()")),
    )

    # ── rep_sets ────────────────────────────────────────────
    op.create_table(
        "rep_sets",
        sa.Column("id",           UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("session_id",   UUID(as_uuid=True), sa.ForeignKey("rep_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("set_number",   sa.Integer, nullable=False),
        sa.Column("reps",         sa.Integer, nullable=False),
        sa.Column("duration_sec", sa.Float, nullable=True),
        sa.Column("form_score",   sa.Float, nullable=True),
        sa.Column("keypoints_json", JSONB, nullable=True),
        sa.Column("created_at",   TIMESTAMPTZ, nullable=False, server_default=sa.text("NOW()")),
    )

    # ── physical_metrics ────────────────────────────────────
    op.create_table(
        "physical_metrics",
        sa.Column("id",              UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("external_id",     sa.Text, nullable=False),
        sa.Column("measured_at",     sa.Date, nullable=False, server_default=sa.text("CURRENT_DATE")),
        sa.Column("bmi",             sa.Float, nullable=True),
        sa.Column("bmr",             sa.Float, nullable=True),
        sa.Column("tdee",            sa.Float, nullable=True),
        sa.Column("calorie_target",  sa.Float, nullable=True),
        sa.Column("body_fat_pct",    sa.Float, nullable=True),
        sa.Column("notes",           sa.Text, nullable=True),
        sa.Column("created_at",      TIMESTAMPTZ, nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("external_id", "measured_at", name="uq_metrics_ext_date"),
    )

    # ── diet_plans ──────────────────────────────────────────
    op.create_table(
        "diet_plans",
        sa.Column("id",              UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("external_id",     sa.Text, nullable=False),
        sa.Column("week_start",      sa.Date, nullable=False),
        sa.Column("goal",            sa.Text, nullable=False),
        sa.Column("calorie_target",  sa.Float, nullable=False),
        sa.Column("protein_g",       sa.Float, nullable=True),
        sa.Column("carbs_g",         sa.Float, nullable=True),
        sa.Column("fat_g",           sa.Float, nullable=True),
        sa.Column("rag_prompt",      sa.Text, nullable=True),
        sa.Column("rag_sources",     JSONB, nullable=True),
        sa.Column("manual_override", sa.Boolean, server_default="false"),
        sa.Column("pdf_url",         sa.Text, nullable=True),
        sa.Column("created_at",      TIMESTAMPTZ, nullable=False, server_default=sa.text("NOW()")),
        sa.UniqueConstraint("external_id", "week_start", name="uq_diet_ext_week"),
    )

    # ── diet_days ───────────────────────────────────────────
    op.create_table(
        "diet_days",
        sa.Column("id",             UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("plan_id",        UUID(as_uuid=True), sa.ForeignKey("diet_plans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day_of_week",    sa.SmallInteger, nullable=False),
        sa.Column("total_calories", sa.Float, nullable=True),
        sa.Column("notes",          sa.Text, nullable=True),
        sa.CheckConstraint("day_of_week BETWEEN 0 AND 6", name="ck_diet_day_range"),
    )

    # ── diet_meals ──────────────────────────────────────────
    op.create_table(
        "diet_meals",
        sa.Column("id",              UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("day_id",          UUID(as_uuid=True), sa.ForeignKey("diet_days.id", ondelete="CASCADE"), nullable=False),
        sa.Column("meal_type",       sa.Text, nullable=False),
        sa.Column("name",            sa.Text, nullable=False),
        sa.Column("quantity_g",      sa.Float, nullable=True),
        sa.Column("calories",        sa.Float, nullable=False),
        sa.Column("protein_g",       sa.Float, server_default="0"),
        sa.Column("carbs_g",         sa.Float, server_default="0"),
        sa.Column("fat_g",           sa.Float, server_default="0"),
        sa.Column("manual_override", sa.Boolean, server_default="false"),
        sa.CheckConstraint("meal_type IN ('breakfast','lunch','dinner','snack')", name="ck_meal_type"),
    )

    # ── routines ────────────────────────────────────────────
    op.create_table(
        "routines",
        sa.Column("id",           UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("external_id",  sa.Text, nullable=False),
        sa.Column("name",         sa.Text, nullable=False),
        sa.Column("goal",         sa.Text, nullable=False),
        sa.Column("weeks",        sa.Integer, nullable=False, server_default="4"),
        sa.Column("days_per_week",sa.Integer, nullable=False),
        sa.Column("rag_prompt",   sa.Text, nullable=True),
        sa.Column("rag_sources",  JSONB, nullable=True),
        sa.Column("is_active",    sa.Boolean, server_default="true"),
        sa.Column("created_at",   TIMESTAMPTZ, nullable=False, server_default=sa.text("NOW()")),
    )

    # ── routine_days ────────────────────────────────────────
    op.create_table(
        "routine_days",
        sa.Column("id",          UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("routine_id",  UUID(as_uuid=True), sa.ForeignKey("routines.id", ondelete="CASCADE"), nullable=False),
        sa.Column("day_index",   sa.SmallInteger, nullable=False),
        sa.Column("focus",       sa.Text, nullable=True),
        sa.Column("notes",       sa.Text, nullable=True),
    )

    # ── routine_exercises ───────────────────────────────────
    op.create_table(
        "routine_exercises",
        sa.Column("id",          UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("day_id",      UUID(as_uuid=True), sa.ForeignKey("routine_days.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name",        sa.Text, nullable=False),
        sa.Column("sets",        sa.Integer, nullable=True),
        sa.Column("reps",        sa.Text, nullable=True),
        sa.Column("rest_sec",    sa.Integer, nullable=True),
        sa.Column("met_value",   sa.Float, nullable=True),
        sa.Column("order_index", sa.SmallInteger, nullable=False, server_default="0"),
    )

    # ── documents (corpus RAG + embeddings pgvector) ────────
    op.execute("""
        CREATE TABLE documents (
            id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            source      TEXT NOT NULL,
            title       TEXT NOT NULL,
            chunk_index INTEGER NOT NULL DEFAULT 0,
            content     TEXT NOT NULL,
            embedding   vector(384),
            token_count INTEGER,
            ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(source, title, chunk_index)
        )
    """)

    # ── rag_queries ─────────────────────────────────────────
    op.create_table(
        "rag_queries",
        sa.Column("id",           UUID(as_uuid=True), primary_key=True, server_default=sa.text("uuid_generate_v4()")),
        sa.Column("external_id",  sa.Text, nullable=False),
        sa.Column("query_type",   sa.Text, nullable=False),
        sa.Column("prompt",       sa.Text, nullable=False),
        sa.Column("response",     sa.Text, nullable=False),
        sa.Column("sources_used", JSONB, nullable=True),
        sa.Column("tokens_in",    sa.Integer, nullable=True),
        sa.Column("tokens_out",   sa.Integer, nullable=True),
        sa.Column("latency_ms",   sa.Integer, nullable=True),
        sa.Column("created_at",   TIMESTAMPTZ, nullable=False, server_default=sa.text("NOW()")),
        sa.CheckConstraint("query_type IN ('diet','routine','general')", name="ck_query_type"),
    )

    # ── Índices ─────────────────────────────────────────────
    op.create_index("idx_rep_sessions_ext",      "rep_sessions",    ["external_id"])
    op.create_index("idx_rep_sessions_started",  "rep_sessions",    ["started_at"])
    op.create_index("idx_physical_metrics_ext",  "physical_metrics",["external_id", "measured_at"])
    op.create_index("idx_diet_plans_ext",        "diet_plans",      ["external_id", "week_start"])
    op.create_index("idx_routines_ext",          "routines",        ["external_id", "is_active"])
    op.create_index("idx_rag_queries_ext",       "rag_queries",     ["external_id", "created_at"])

    # Índice IVFFlat para búsqueda vectorial (se crea después de cargar datos)
    op.execute("""
        CREATE INDEX documents_embedding_idx
        ON documents USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 50)
    """)


def downgrade():
    tables = [
        "rag_queries", "documents", "routine_exercises", "routine_days",
        "routines", "diet_meals", "diet_days", "diet_plans",
        "physical_metrics", "rep_sets", "rep_sessions",
    ]
    for t in tables:
        op.execute(f"DROP TABLE IF EXISTS {t} CASCADE")
    op.execute("DROP EXTENSION IF EXISTS vector")
