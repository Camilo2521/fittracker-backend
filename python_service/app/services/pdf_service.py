"""
PDF Service — Genera el plan de dieta semanal como PDF descargable.
Usa reportlab (sin dependencias de sistema).
"""
import io
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
)

# Paleta FitTracker
GREEN   = colors.HexColor("#4DEB6E")
DARK    = colors.HexColor("#0F0F0D")
SURFACE = colors.HexColor("#1A1A17")
TEXT2   = colors.HexColor("#8A8A82")

MEAL_NAMES_ES = {
    "breakfast": "Desayuno",
    "lunch":     "Almuerzo",
    "dinner":    "Cena",
    "snack":     "Merienda",
}
DAYS_ES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]


def generate_diet_pdf(diet_data: dict, user_name: str = "Usuario") -> bytes:
    """
    Recibe el dict del plan de dieta (mismo formato que genera el backend/local)
    y devuelve bytes PDF listos para servir con Content-Type: application/pdf.
    """
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm,
        topMargin=2*cm, bottomMargin=2*cm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "FTTitle",
        parent=styles["Title"],
        fontSize=22, fontName="Helvetica-Bold",
        textColor=DARK, spaceAfter=4,
    )
    sub_style = ParagraphStyle(
        "FTSub",
        parent=styles["Normal"],
        fontSize=10, textColor=TEXT2, spaceAfter=12,
    )
    day_style = ParagraphStyle(
        "FTDay",
        parent=styles["Heading2"],
        fontSize=13, fontName="Helvetica-Bold",
        textColor=DARK, spaceBefore=14, spaceAfter=4,
    )
    note_style = ParagraphStyle(
        "FTNote",
        parent=styles["Normal"],
        fontSize=9, textColor=TEXT2, spaceAfter=6,
    )

    week_start  = diet_data.get("weekStart") or diet_data.get("week_start", "")
    kcal_target = diet_data.get("dailyCalorieTarget") or diet_data.get("calorie_target", "")
    goal        = diet_data.get("goal", "maintain")
    days        = diet_data.get("days", [])
    notes       = diet_data.get("notes", "")

    story = []

    # ── Encabezado ─────────────────────────────────────────────
    story.append(Paragraph("FitTracker", title_style))
    story.append(Paragraph(f"Plan de alimentación semanal", sub_style))
    story.append(HRFlowable(width="100%", thickness=2, color=GREEN, spaceAfter=6))

    meta_data = [
        ["Semana:", week_start],
        ["Usuario:", user_name],
        ["Objetivo:", {"lose": "Pérdida de peso", "gain": "Ganancia muscular", "maintain": "Mantenimiento"}.get(goal, goal)],
        ["Calorías/día:", f"{kcal_target} kcal"],
        ["Generado:", datetime.now().strftime("%d/%m/%Y %H:%M")],
    ]
    meta_table = Table(meta_data, colWidths=[4*cm, 12*cm])
    meta_table.setStyle(TableStyle([
        ("FONTNAME",  (0,0), (0,-1), "Helvetica-Bold"),
        ("FONTSIZE",  (0,0), (-1,-1), 9),
        ("TEXTCOLOR", (0,0), (-1,-1), colors.black),
        ("ROWBACKGROUNDS", (0,0), (-1,-1), [colors.white, colors.HexColor("#F5F5F3")]),
        ("TOPPADDING",    (0,0), (-1,-1), 3),
        ("BOTTOMPADDING", (0,0), (-1,-1), 3),
    ]))
    story.append(meta_table)
    story.append(Spacer(1, 0.4*cm))

    # ── Días ──────────────────────────────────────────────────
    for d in days:
        day_label = d.get("day") or DAYS_ES[d.get("day_of_week", 0)]
        total_cal = d.get("totalCalories") or d.get("total_calories", kcal_target)
        meals     = d.get("meals", [])

        story.append(Paragraph(f"{day_label} — {total_cal} kcal", day_style))

        table_data = [["Comida", "Descripción", "Kcal", "Prot.", "Carbs", "Grasas"]]
        for m in meals:
            name = MEAL_NAMES_ES.get(m.get("meal_type", ""), m.get("name", "—"))
            desc = m.get("description") or m.get("name", "")
            cal  = m.get("calories", "—")
            prot = f"{m.get('protein_g', m.get('protein', '—'))}g"
            carb = f"{m.get('carbs_g',   m.get('carbs',   '—'))}g"
            fat  = f"{m.get('fat_g',     m.get('fat',     '—'))}g"
            table_data.append([name, desc, str(cal), prot, carb, fat])

        col_w = [2.5*cm, 8.5*cm, 1.8*cm, 1.5*cm, 1.5*cm, 1.5*cm]
        t = Table(table_data, colWidths=col_w)
        t.setStyle(TableStyle([
            ("BACKGROUND",  (0,0), (-1,0), GREEN),
            ("TEXTCOLOR",   (0,0), (-1,0), colors.black),
            ("FONTNAME",    (0,0), (-1,0), "Helvetica-Bold"),
            ("FONTSIZE",    (0,0), (-1,-1), 8),
            ("ROWBACKGROUNDS", (0,1), (-1,-1), [colors.white, colors.HexColor("#F5F5F3")]),
            ("GRID",        (0,0), (-1,-1), 0.3, colors.HexColor("#DDDDDA")),
            ("TOPPADDING",    (0,0), (-1,-1), 3),
            ("BOTTOMPADDING", (0,0), (-1,-1), 3),
            ("VALIGN",      (0,0), (-1,-1), "MIDDLE"),
        ]))
        story.append(t)

    # ── Notas ─────────────────────────────────────────────────
    if notes:
        story.append(Spacer(1, 0.5*cm))
        story.append(HRFlowable(width="100%", thickness=1, color=TEXT2, spaceAfter=4))
        story.append(Paragraph(f"💡 {notes}", note_style))

    story.append(Spacer(1, 0.3*cm))
    story.append(Paragraph(
        "Generado automáticamente por FitTracker · fittracker.app",
        note_style
    ))

    doc.build(story)
    return buf.getvalue()
