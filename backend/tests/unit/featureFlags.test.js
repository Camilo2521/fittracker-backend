'use strict';

/**
 * Unit tests — Feature Flags middleware
 */

describe('Feature Flags', () => {
  let FLAGS, requireFlag;

  beforeEach(() => {
    jest.resetModules();
  });

  function loadModule(envOverrides = {}) {
    const saved = {};
    for (const [k, v] of Object.entries(envOverrides)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    const mod = require('../../src/middleware/featureFlags');
    // Restore
    for (const [k] of Object.entries(envOverrides)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    return mod;
  }

  describe('FLAGS object', () => {
    it('defaults all flags to false when env vars are absent', () => {
      const { FLAGS } = loadModule({
        FEATURE_VISION_V2:   undefined,
        FEATURE_RAG_ENABLED: undefined,
        FEATURE_WEEKLY_PDF:  undefined,
      });
      expect(FLAGS.vision_v2).toBe(false);
      expect(FLAGS.rag_enabled).toBe(false);
      expect(FLAGS.weekly_pdf).toBe(false);
    });

    it('activates vision_v2 when env var is "true"', () => {
      const { FLAGS } = loadModule({ FEATURE_VISION_V2: 'true' });
      expect(FLAGS.vision_v2).toBe(true);
    });

    it('activates rag_enabled when env var is "true"', () => {
      const { FLAGS } = loadModule({ FEATURE_RAG_ENABLED: 'true' });
      expect(FLAGS.rag_enabled).toBe(true);
    });

    it('activates weekly_pdf when env var is "true"', () => {
      const { FLAGS } = loadModule({ FEATURE_WEEKLY_PDF: 'true' });
      expect(FLAGS.weekly_pdf).toBe(true);
    });

    it('does NOT activate flag for truthy-but-not-"true" values', () => {
      const { FLAGS } = loadModule({ FEATURE_RAG_ENABLED: '1' });
      expect(FLAGS.rag_enabled).toBe(false);
    });
  });

  describe('require() middleware', () => {
    function makeReqRes() {
      const res = {
        _status: null, _body: null,
        status(code) { this._status = code; return this; },
        json(body)   { this._body   = body; return this; },
      };
      const req  = {};
      const next = jest.fn();
      return { req, res, next };
    }

    it('calls next() when the flag is enabled', () => {
      const { require: requireFlag, FLAGS } = loadModule({ FEATURE_WEEKLY_PDF: 'true' });
      FLAGS.weekly_pdf = true; // Reload already sets it — explicit for clarity
      const { req, res, next } = makeReqRes();
      requireFlag('weekly_pdf')(req, res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(res._status).toBeNull();
    });

    it('returns 501 when the flag is disabled', () => {
      const { require: requireFlag } = loadModule({ FEATURE_WEEKLY_PDF: 'false' });
      const { req, res, next } = makeReqRes();
      requireFlag('weekly_pdf')(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res._status).toBe(501);
      expect(res._body).toMatchObject({ flag: 'weekly_pdf' });
    });

    it('includes a hint in the 501 response', () => {
      const { require: requireFlag } = loadModule({ FEATURE_RAG_ENABLED: 'false' });
      const { req, res, next } = makeReqRes();
      requireFlag('rag_enabled')(req, res, next);
      expect(res._body.hint).toMatch(/FEATURE_RAG_ENABLED/i);
    });
  });
});
