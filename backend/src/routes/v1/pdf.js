'use strict';

const express = require('express');
const router  = express.Router();
const vision  = require('../../services/visionClient');

/**
 * POST /api/v1/pdf/diet
 * Body: { dietData, userName }
 * Proxy al servicio Python → devuelve el PDF al cliente.
 */
router.post('/diet', async (req, res) => {
  const { dietData, userName = 'Usuario' } = req.body;
  if (!dietData) return res.status(400).json({ error: 'dietData es requerido' });

  const pdfBuffer = await vision.generateDietPdf(dietData, userName);
  if (!pdfBuffer) {
    return res.status(503).json({ error: 'Servicio PDF no disponible' });
  }

  const week = dietData.weekStart || dietData.week_start || 'semana';
  res.set({
    'Content-Type':        'application/pdf',
    'Content-Disposition': `attachment; filename="fittracker-dieta-${week}.pdf"`,
    'Content-Length':      pdfBuffer.length,
  });
  res.send(pdfBuffer);
});

module.exports = router;
