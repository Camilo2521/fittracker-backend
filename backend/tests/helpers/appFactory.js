'use strict';

/**
 * Crea una instancia fresca de la app Express para cada test file.
 * Usa módulos cacheados de Jest, por lo que la DB :memory: persiste
 * dentro de un mismo archivo de tests pero se aísla entre runs.
 */
let _app = null;

function getApp() {
  if (!_app) {
    // Silenciamos morgan en tests
    jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    _app = require('../../src/app');
    jest.restoreAllMocks();
  }
  return _app;
}

module.exports = { getApp };
