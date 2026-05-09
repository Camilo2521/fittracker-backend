'use strict';
const fs   = require('fs');
const http = require('http');
const path = require('path');

const API_KEY   = process.argv[2];
const WF_DIR    = path.join(__dirname, 'workflows');

if (!API_KEY) {
  console.error('Uso: node n8n/import-workflows.js <API_KEY>');
  process.exit(1);
}

async function importWorkflow(filename) {
  return new Promise((resolve, reject) => {
    const raw  = JSON.parse(fs.readFileSync(path.join(WF_DIR, filename), 'utf8'));
    // n8n API no acepta estos campos en el body (son read-only)
    // Campos read-only que n8n rechaza al crear via API
    for (const k of ['id','versionId','meta','active','tags']) delete raw[k];
    const body = JSON.stringify(raw);
    const options = {
      hostname: 'localhost',
      port:     5678,
      path:     '/api/v1/workflows',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'X-N8N-API-KEY':  API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (j.id) resolve({ id: j.id, name: j.name });
          else reject(new Error(JSON.stringify(j).slice(0, 300)));
        } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function activateWorkflow(id) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ active: true });
    const options = {
      hostname: 'localhost',
      port:     5678,
      path:     `/api/v1/workflows/${id}/activate`,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'X-N8N-API-KEY':  API_KEY,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = http.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  const workflows = [
    'fittracker-ai-agent.json',
    'fittracker-weekly-checkin.json',
  ];

  for (const file of workflows) {
    try {
      console.log(`Importando ${file}...`);
      const wf = await importWorkflow(file);
      console.log(`  ✅ Importado: "${wf.name}" (id=${wf.id})`);

      console.log(`  Activando...`);
      await activateWorkflow(wf.id);
      console.log(`  ✅ Activado`);
    } catch (err) {
      console.error(`  ❌ Error en ${file}:`, err.message);
    }
  }

  console.log('\n✅ Todos los workflows importados y activados.');
  console.log('🌐 Abre http://localhost:5678 para verificar.');
})();
