/**
 * Switches the n8n "Message a model" (Anthropic) node to an Ollama HTTP Request.
 * Also updates the callback node to read from Ollama response format.
 */

const { Client } = require('pg');
const http = require('http');

const WORKFLOW_ID = 'U7fHPfZF9vwTdF28';
const N8N_BASE    = 'http://localhost:5678';
const N8N_EMAIL   = 'admin@fittracker.local';
const N8N_PASS    = 'fittracker2026';

// ── New nodes ────────────────────────────────────────────────────────────────

const NEW_NODES = [
  {
    id:          '8b018827-111e-4cdf-ab53-cbd4bd0f3f9b',
    name:        'Webhook',
    type:        'n8n-nodes-base.webhook',
    position:    [0, 0],
    webhookId:   'a3785d44-3b73-4d2c-9ab9-3eab80eb806b',
    parameters:  {
      path:           'fittracker-events',
      options:        {},
      httpMethod:     'POST',
      authentication: 'headerAuth',
    },
    credentials:  { httpHeaderAuth: { id: 'UfpjcuDpAGiqFPjZ', name: 'Header Auth account' } },
    typeVersion:  2.1,
  },
  {
    id:         '76760a12-2c4c-449a-aaf9-e7915028d0f7',
    name:       'HTTP Request',
    type:       'n8n-nodes-base.httpRequest',
    position:   [208, 0],
    parameters: {
      url:              'http://localhost:3000/api/v1/n8n/build-prompt',
      method:           'POST',
      options:          {},
      jsonBody:         '={{ JSON.stringify($json) }}\n',
      sendBody:         true,
      sendHeaders:      true,
      specifyBody:      'json',
      headerParameters: {
        parameters: [{ name: 'x-n8n-secret', value: '6e64aad89b97f393b01d82045bd5c1c664947faf57fe692c258e788372893c3b' }],
      },
    },
    typeVersion: 4.4,
  },
  {
    id:         'e9fdfa31-17de-45bb-b1df-fe951c315743',
    name:       'Ollama',
    type:       'n8n-nodes-base.httpRequest',
    position:   [420, 0],
    parameters: {
      url:         'http://127.0.0.1:11434/api/chat',
      method:      'POST',
      options:     {},
      jsonBody:    '={\n  "model": "llama3.2",\n  "messages": [{"role": "user", "content": "={{ $json.prompt }}"}],\n  "stream": false\n}',
      sendBody:    true,
      specifyBody: 'json',
    },
    typeVersion: 4.4,
  },
  {
    id:         'cbea5bf3-f965-40b8-b957-aa7e6ea49473',
    name:       'HTTP Request1',
    type:       'n8n-nodes-base.httpRequest',
    position:   [640, 0],
    parameters: {
      url:              'http://localhost:3000/api/v1/n8n/callback',
      method:           'POST',
      options:          {},
      // Ollama returns { message: { content: "..." } }
      jsonBody:         '={\n  "accountId": "{{ $(\'Webhook\').item.json.accountId }}",\n  "event": "{{ $(\'Webhook\').item.json.event }}",\n  "suggestionType": "{{ $(\'HTTP Request\').item.json.suggestionType }}",\n  "suggestion": "{{ $json.message.content }}"\n}\n',
      sendBody:         true,
      sendHeaders:      true,
      specifyBody:      'json',
      headerParameters: {
        parameters: [{ name: 'x-n8n-secret', value: '6e64aad89b97f393b01d82045bd5c1c664947faf57fe692c258e788372893c3b' }],
      },
    },
    typeVersion: 4.4,
  },
];

const NEW_CONNECTIONS = {
  Webhook:        { main: [[{ node: 'HTTP Request', type: 'main', index: 0 }]] },
  'HTTP Request': { main: [[{ node: 'Ollama',       type: 'main', index: 0 }]] },
  Ollama:         { main: [[{ node: 'HTTP Request1', type: 'main', index: 0 }]] },
};

// ── n8n REST helpers ──────────────────────────────────────────────────────────

function n8nReq(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const opts = {
      hostname: 'localhost',
      port:     5678,
      path,
      method,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        try { resolve({ status: res.statusCode, body: JSON.parse(data), cookie: setCookie }); }
        catch { resolve({ status: res.statusCode, body: data, cookie: setCookie }); }
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

async function getSessionCookie() {
  const r = await n8nReq('POST', '/rest/login', { emailAddress: N8N_EMAIL, password: N8N_PASS });
  if (r.status !== 200) throw new Error(`Login failed: ${r.status} — ${JSON.stringify(r.body)}`);
  const cookie = (r.cookie || []).map(c => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('No session cookie returned');
  return cookie;
}

// ── DB update ─────────────────────────────────────────────────────────────────

async function updateWorkflowInDB() {
  const client = new Client({ connectionString: 'postgresql://postgres:fittracker2026@127.0.0.1:5432/n8n' });
  await client.connect();
  try {
    await client.query(
      `UPDATE workflow_entity
          SET nodes       = $1::jsonb,
              connections = $2::jsonb,
              "updatedAt" = NOW()
        WHERE id = $3`,
      [JSON.stringify(NEW_NODES), JSON.stringify(NEW_CONNECTIONS), WORKFLOW_ID],
    );
    console.log('[DB] workflow_entity updated');

    // Also fix workflow_history so old cached snapshots don't confuse n8n
    const r = await client.query(
      `UPDATE workflow_history
          SET nodes       = $1::jsonb,
              connections = $2::jsonb
        WHERE "workflowId" = $3`,
      [JSON.stringify(NEW_NODES), JSON.stringify(NEW_CONNECTIONS), WORKFLOW_ID],
    );
    console.log(`[DB] workflow_history updated: ${r.rowCount} rows`);
  } finally {
    await client.end();
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log('=== Switching n8n workflow from Anthropic → Ollama ===\n');

  // 1. Update DB
  await updateWorkflowInDB();

  // 2. Login to n8n
  console.log('[n8n] Logging in…');
  let cookie;
  try {
    cookie = await getSessionCookie();
    console.log('[n8n] Session acquired');
  } catch (e) {
    console.error('[n8n] Login failed:', e.message);
    console.log('\n⚠️  DB updated. Restart n8n manually to apply changes.');
    process.exit(0);
  }

  // 3. Deactivate
  console.log('[n8n] Deactivating workflow…');
  const deact = await n8nReq('PATCH', `/rest/workflows/${WORKFLOW_ID}`, { active: false }, cookie);
  console.log(`[n8n] Deactivate: ${deact.status}`);

  await new Promise(r => setTimeout(r, 1500));

  // 4. Activate
  console.log('[n8n] Activating workflow…');
  const act = await n8nReq('PATCH', `/rest/workflows/${WORKFLOW_ID}`, { active: true }, cookie);
  console.log(`[n8n] Activate: ${act.status}`);

  console.log('\n✅ Done — n8n now uses Ollama (llama3.2) instead of Anthropic Claude.');
})().catch(e => { console.error('Fatal:', e); process.exit(1); });
