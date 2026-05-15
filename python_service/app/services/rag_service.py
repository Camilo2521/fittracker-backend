"""
Fase 4 — RAG Service.
Búsqueda vectorial en PostgreSQL/pgvector + generación con OpenAI.
"""
import time
import json
import logging
from typing import Optional

from app.config import get_settings
from app.schemas.rag import (
    UserProfile, DietPlanOut, RoutinePlanOut,
    DayOut, MealOut, RoutineDayOut, ExerciseOut,
)

logger = logging.getLogger("fittracker.rag")

# ── Prompts ────────────────────────────────────────────────

_DIET_SYSTEM = """Eres un nutricionista deportivo experto.
Genera planes de dieta SEMANALES en JSON estricto con esta estructura:
{
  "calorie_target": <número>,
  "protein_g": <número>,
  "carbs_g": <número>,
  "fat_g": <número>,
  "days": [
    {
      "day_of_week": <0-6>,
      "total_calories": <número>,
      "meals": [
        {"meal_type": "breakfast|lunch|dinner|snack",
         "name": "<nombre>",
         "calories": <número>,
         "protein_g": <número>,
         "carbs_g": <número>,
         "fat_g": <número>,
         "quantity_g": <número o null>}
      ]
    }
  ]
}
Responde SOLO con el JSON, sin texto adicional."""

_ROUTINE_SYSTEM = """Eres un entrenador personal experto.
Genera rutinas de entrenamiento en JSON estricto con esta estructura:
{
  "name": "<nombre de la rutina>",
  "weeks": <número de semanas>,
  "days": [
    {
      "day_index": <0-6>,
      "focus": "<piernas|pecho|espalda|hombros|cardio|full body>",
      "exercises": [
        {"name": "<ejercicio>",
         "sets": <número>,
         "reps": "<ej: 12 o 8-12>",
         "rest_sec": <segundos>}
      ]
    }
  ]
}
Responde SOLO con el JSON, sin texto adicional."""


# ── Context builder ────────────────────────────────────────

def _profile_context(p: UserProfile) -> str:
    parts = [f"Objetivo: {p.goal}"]
    if p.current_weight:
        parts.append(f"Peso actual: {p.current_weight} kg")
    if p.target_weight:
        parts.append(f"Peso objetivo: {p.target_weight} kg")
    if p.height_cm:
        parts.append(f"Altura: {p.height_cm} cm")
    if p.age:
        parts.append(f"Edad: {p.age} años")
    if p.gender:
        parts.append(f"Sexo: {p.gender}")
    parts.append(f"Nivel de actividad: {p.activity_level}")
    if p.restrictions:
        parts.append(f"Restricciones alimentarias: {p.restrictions}")
    return " | ".join(parts)


async def _retrieve_docs(query: str, limit: int = 3) -> list[str]:
    """
    Búsqueda semántica sobre documentos ingestados.
    Usa numpy cosine similarity (JSONB embeddings) — no requiere pgvector.
    """
    try:
        import numpy as np
        from sentence_transformers import SentenceTransformer
        from app.database import get_engine
        from sqlalchemy import text

        model = SentenceTransformer("all-MiniLM-L6-v2")
        q_emb = model.encode(query)

        engine = get_engine()
        async with engine.connect() as conn:
            rows = await conn.execute(
                text("SELECT content, embedding FROM documents WHERE embedding IS NOT NULL LIMIT 500")
            )
            records = rows.fetchall()

        if not records:
            return []

        contents   = [r[0] for r in records]
        embeddings = np.array([r[1] for r in records], dtype=float)

        # Cosine similarity
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        norms[norms == 0] = 1
        sims = embeddings / norms @ (q_emb / (np.linalg.norm(q_emb) or 1))
        top_idx = np.argsort(sims)[::-1][:limit]
        return [contents[i] for i in top_idx]

    except Exception as e:
        logger.warning(f"[rag] No se pudo recuperar documentos: {e}")
        return []


async def _call_llm(system: str, user_msg: str) -> tuple[str, int, int, int]:
    """
    Llama al LLM configurado y devuelve (content, tokens_in, tokens_out, latency_ms).
    Prioridad: OpenAI si OPENAI_API_KEY está presente → Ollama en caso contrario.
    """
    settings = get_settings()
    t0 = time.time()

    if settings.openai_api_key:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.openai_api_key)
        response = await client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system},
                {"role": "user",   "content": user_msg},
            ],
            temperature=0.4,
            response_format={"type": "json_object"},
        )
        latency_ms = int((time.time() - t0) * 1000)
        msg = response.choices[0].message.content
        usage = response.usage
        return msg, usage.prompt_tokens, usage.completion_tokens, latency_ms

    # Ollama — API compatible con OpenAI en /v1/chat/completions
    import httpx
    payload = {
        "model":    settings.ollama_model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": user_msg},
        ],
        "stream": False,
        "options": {"temperature": 0.4},
        "format":  "json",
    }
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(f"{settings.ollama_url}/api/chat", json=payload)
        r.raise_for_status()
        data = r.json()

    latency_ms = int((time.time() - t0) * 1000)
    msg = data["message"]["content"]
    tok_in  = data.get("prompt_eval_count", 0)
    tok_out = data.get("eval_count", 0)
    return msg, tok_in, tok_out, latency_ms


async def _save_query(db, external_id: str, query_type: str, prompt: str,
                      response: str, sources: list[str],
                      tokens_in: int, tokens_out: int, latency_ms: int) -> None:
    import uuid
    from datetime import datetime, timezone
    from app.models.document import RagQuery
    db.add(RagQuery(
        id=uuid.uuid4(),
        external_id=external_id,
        query_type=query_type,
        prompt=prompt,
        response=response,
        sources_used=sources,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        latency_ms=latency_ms,
        created_at=datetime.now(timezone.utc),
    ))
    await db.flush()


# ── Diet generation ────────────────────────────────────────

async def generate_diet(profile: UserProfile, week_start: str, db) -> DietPlanOut:
    ctx = _profile_context(profile)
    docs = await _retrieve_docs(f"dieta nutrición {profile.goal} {profile.restrictions or ''}")
    rag_ctx = "\n\n".join(docs) if docs else ""

    prompt = f"Perfil del usuario: {ctx}\nSemana: {week_start}"
    if rag_ctx:
        prompt += f"\n\nContexto nutricional de referencia:\n{rag_ctx}"

    raw, tok_in, tok_out, lat = await _call_llm(_DIET_SYSTEM, prompt)
    data = json.loads(raw)

    await _save_query(
        db, profile.external_id, "diet", prompt, raw,
        docs, tok_in, tok_out, lat,
    )

    days = [
        DayOut(
            day_of_week=d["day_of_week"],
            total_calories=d.get("total_calories", 0),
            meals=[
                MealOut(
                    meal_type=m["meal_type"],
                    name=m["name"],
                    calories=m["calories"],
                    protein_g=m.get("protein_g", 0),
                    carbs_g=m.get("carbs_g", 0),
                    fat_g=m.get("fat_g", 0),
                    quantity_g=m.get("quantity_g"),
                )
                for m in d.get("meals", [])
            ],
        )
        for d in data.get("days", [])
    ]

    return DietPlanOut(
        week_start=week_start,
        goal=profile.goal,
        calorie_target=data.get("calorie_target", 2000),
        protein_g=data.get("protein_g", 0),
        carbs_g=data.get("carbs_g", 0),
        fat_g=data.get("fat_g", 0),
        days=days,
        sources_used=docs[:3],
    )


# ── Routine generation ─────────────────────────────────────

async def generate_routine(profile: UserProfile, days_per_week: int, db) -> RoutinePlanOut:
    ctx = _profile_context(profile)
    docs = await _retrieve_docs(f"rutina entrenamiento {profile.goal} fuerza cardio")
    rag_ctx = "\n\n".join(docs) if docs else ""

    prompt = f"Perfil: {ctx}\nDías por semana disponibles: {days_per_week}"
    if rag_ctx:
        prompt += f"\n\nContexto de entrenamiento de referencia:\n{rag_ctx}"

    raw, tok_in, tok_out, lat = await _call_llm(_ROUTINE_SYSTEM, prompt)
    data = json.loads(raw)

    await _save_query(
        db, profile.external_id, "routine", prompt, raw,
        docs, tok_in, tok_out, lat,
    )

    routine_days = [
        RoutineDayOut(
            day_index=d["day_index"],
            focus=d.get("focus", "full body"),
            exercises=[
                ExerciseOut(
                    name=e["name"],
                    sets=e.get("sets"),
                    reps=str(e["reps"]) if "reps" in e else None,
                    rest_sec=e.get("rest_sec"),
                )
                for e in d.get("exercises", [])
            ],
        )
        for d in data.get("days", [])
    ]

    return RoutinePlanOut(
        name=data.get("name", "Rutina personalizada"),
        goal=profile.goal,
        weeks=data.get("weeks", 4),
        days_per_week=days_per_week,
        days=routine_days,
        sources_used=docs[:3],
    )


# ── Document ingestion ─────────────────────────────────────

async def ingest_document(source: str, title: str, content: str,
                          chunk_size: int, db) -> int:
    """Divide el contenido en chunks, genera embeddings y los guarda en pgvector."""
    import uuid
    from datetime import datetime, timezone
    from app.models.document import Document

    try:
        from sentence_transformers import SentenceTransformer
    except ImportError:
        raise ValueError("sentence-transformers no instalado")

    model = SentenceTransformer("all-MiniLM-L6-v2")
    words  = content.split()
    chunks = [
        " ".join(words[i: i + chunk_size])
        for i in range(0, len(words), chunk_size)
    ]

    count = 0
    for i, chunk in enumerate(chunks):
        # Guardar embedding como lista JSON (compatible con JSONB sin pgvector)
        embedding = model.encode(chunk).tolist()
        db.add(Document(
            id=uuid.uuid4(),
            source=source,
            title=title,
            chunk_index=i,
            content=chunk,
            embedding=embedding,
            token_count=len(chunk.split()),
            ingested_at=datetime.now(timezone.utc),
        ))
        count += 1

    await db.flush()
    return count
