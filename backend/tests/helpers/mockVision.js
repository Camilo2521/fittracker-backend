'use strict';

/**
 * Mock del módulo visionClient para tests que no deben tocar Python.
 * Usa jest.mock() desde el test file; este helper expone las implementaciones.
 */

const fallbackResponse = {
  ok: false,
  fallback: true,
  error: 'Python service not available in tests',
};

const mockVision = {
  createSession:    jest.fn().mockResolvedValue(fallbackResponse),
  completeSession:  jest.fn().mockResolvedValue(fallbackResponse),
  getSession:       jest.fn().mockResolvedValue(fallbackResponse),
  generateDietPdf:  jest.fn().mockResolvedValue(null),
  generateDiet:     jest.fn().mockResolvedValue(fallbackResponse),
  generateRoutine:  jest.fn().mockResolvedValue(fallbackResponse),
};

function resetMocks() {
  Object.values(mockVision).forEach(fn => fn.mockClear());
  mockVision.createSession.mockResolvedValue(fallbackResponse);
  mockVision.completeSession.mockResolvedValue(fallbackResponse);
  mockVision.getSession.mockResolvedValue(fallbackResponse);
  mockVision.generateDietPdf.mockResolvedValue(null);
  mockVision.generateDiet.mockResolvedValue(fallbackResponse);
  mockVision.generateRoutine.mockResolvedValue(fallbackResponse);
}

module.exports = { mockVision, fallbackResponse, resetMocks };
