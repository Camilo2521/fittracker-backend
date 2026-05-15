/**
 * Pushes the full workflow definition to n8n via PUT /rest/workflows/:id
 * This forces n8n to reload nodes from our payload instead of the DB cache.
 */
const http = require('http');

const WORKFLOW_ID = 'U7fHPfZF9vwTdF28';
const N8N_EMAIL   = 'gonzalezcamilo437@gmail.com';
const N8N_PASS    = 'fittracker2026';

const NEW_NODES = [
  {
    id:          '8b018827-111e-4cdf-ab53-cbd4bd0f3f9b',
    name:        'Webhook',
    type:        'n8n-nodes-base.webhook',
    position:    [0, 0],
    webhookId:   'a3785d44-3b73-4d2c-9ab9-3eab80eb806b',
    parameters:  { path: 'fittracker-events', options: {}, httpMethod: 'POST', authentication: 'headerAuth' },
    credentials: { httpHeaderAuth: { id: 'UfpjcuDpAGiqFPjZ', name: 'Header Auth account' } },
    typeVersion: 2.1,
  },
  {
    id:         '76760a12-2c4c-449a-aaf9-e7915028d0f7',
    name:       'HTTP Request',
    type:       'n8n-nodes-base.httpRequest',
    position:   [208, 0],
    parameters: {
      url:              'http://127.0.0.1:3000/api/v1/n8n/build-prompt',
      method:           'POST',
      options:          {},
      jsonBody:         '={{ $json }}',
      sendBody:         true,
      sendHeaders:      true,
      specifyBody:      'json',
      headerParameters: { parameters: [{ name: 'x-n8n-secret', value: '6e64aad89b97f393b01d82045bd5c1c664947faf57fe692c258e788372893c3b' }] },
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
      jsonBody:    "={{ JSON.stringify({model: 'llama3.2', messages: [{role: 'user', content: $json.prompt}], stream: false}) }}",
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
      url:              'http://127.0.0.1:3000/api/v1/n8n/callback',
      method:           'POST',
      options:          {},
      jsonBody:         "={{ JSON.stringify({ accountId: $('Webhook').item.json.body.accountId, event: $('Webhook').item.json.body.event, suggestionType: $('HTTP Request').item.json.suggestionType, suggestion: $json.message.content }) }}",
      sendBody:         true,
      sendHeaders:      true,
      specifyBody:      'json',
      headerParameters: { parameters: [{ name: 'x-n8n-secret', value: '6e64aad89b97f393b01d82045bd5c1c664947faf57fe692c258e788372893c3b' }] },
    },
    typeVersion: 4.4,
  },
];

const NEW_CONNECTIONS = {
  Webhook:        { main: [[{ node: 'HTTP Request',  type: 'main', index: 0 }]] },
  'HTTP Request': { main: [[{ node: 'Ollama',        type: 'main', index: 0 }]] },
  Ollama:         { main: [[{ node: 'HTTP Request1', type: 'main', index: 0 }]] },
};

function req(method, path, body, cookie) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const r = http.request({
      hostname: 'localhost', port: 5678, path, method,
      headers: {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(bodyStr),
        ...(cookie ? { Cookie: cookie } : {}),
      },
    }, res => {
      let d = '';
      res.on('data', c => (d += c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body:   (() => { try { return JSON.parse(d); } catch { return d; } })(),
        cookie: (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; '),
      }));
    });
    r.on('error', reject);
    if (bodyStr) r.write(bodyStr);
    r.end();
  });
}

(async () => {
  // Login
  const login = await req('POST', '/rest/login', { emailOrLdapLoginId: N8N_EMAIL, password: N8N_PASS });
  if (login.status !== 200) { console.error('Login failed:', login.status, login.body); process.exit(1); }
  const cookie = login.cookie;
  console.log('[n8n] Logged in');

  // Deactivate first so the PUT doesn't fail on active webhook
  const deact = await req('PATCH', `/rest/workflows/${WORKFLOW_ID}`, { active: false }, cookie);
  console.log('[n8n] Deactivate:', deact.status);
  await new Promise(r => setTimeout(r, 1000));

  // GET current workflow to get the full object shape
  const getWf = await req('GET', `/rest/workflows/${WORKFLOW_ID}`, null, cookie);
  if (getWf.status !== 200) { console.error('GET failed:', getWf.status, getWf.body); process.exit(1); }
  const wf = getWf.body.data || getWf.body;
  console.log('[n8n] Got workflow, id:', wf.id, 'current node count:', (wf.nodes || []).length);

  // PUT with new nodes
  const payload = {
    ...wf,
    nodes:       NEW_NODES,
    connections: NEW_CONNECTIONS,
    active:      false,
  };

  const put = await req('PATCH', `/rest/workflows/${WORKFLOW_ID}`, { nodes: NEW_NODES, connections: NEW_CONNECTIONS }, cookie);
  console.log('[n8n] PATCH status:', put.status);
  if (put.status !== 200) { console.error('PATCH body:', JSON.stringify(put.body).slice(0, 800)); process.exit(1); }

  const putNodes = (put.body.data || put.body).nodes || [];
  console.log('[n8n] Updated nodes:', putNodes.map(n => `${n.name}(${n.type})`).join(', '));

  await new Promise(r => setTimeout(r, 1000));

  // Reactivate with full state so n8n doesn't fall back to cached old nodes
  const act = await req('PATCH', `/rest/workflows/${WORKFLOW_ID}`, { active: true, nodes: NEW_NODES, connections: NEW_CONNECTIONS }, cookie);
  console.log('[n8n] Activate:', act.status);
  const actNodes = (act.body.data || act.body).nodes || [];
  console.log('[n8n] Active nodes:', actNodes.map(n => n.name + ':' + (n.parameters?.url || n.parameters?.path || '')).join(' | '));

  console.log('\n✅ Workflow updated via API — Ollama with 127.0.0.1 URLs active.');
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
