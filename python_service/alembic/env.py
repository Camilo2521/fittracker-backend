import os
from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context

config = context.config

# Inyectar DATABASE_URL_SYNC desde variable de entorno
db_url = os.environ.get("DATABASE_URL_SYNC") or os.environ.get("DATABASE_URL", "")
# asyncpg → psycopg2 para Alembic (sync)
db_url = db_url.replace("postgresql+asyncpg://", "postgresql://")
config.set_main_option("sqlalchemy.url", db_url)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

from app.database import Base  # noqa: E402
import app.models  # noqa: F401, E402 — importa todos los modelos para que Base los detecte

target_metadata = Base.metadata


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True,
                      dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
