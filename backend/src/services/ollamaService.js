'use strict';

const BASE  = () => process.env.OLLAMA_URL   || 'http://localhost:11434';
const MODEL = () => process.env.OLLAMA_MODEL || 'llama3.2';

async function isAvailable() {
  try {
    const r = await fetch(`${BASE()}/api/tags`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

async function chat(messages, systemPrompt) {
  const r = await fetch(`${BASE()}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    MODEL(),
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream:   false,
      options:  { temperature: 0.82, top_p: 0.92, num_ctx: 4096, repeat_penalty: 1.05 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`Ollama ${r.status}: ${await r.text()}`);
  const d = await r.json();
  return d.message?.content ?? '';
}

async function* chatStream(messages, systemPrompt) {
  const r = await fetch(`${BASE()}/api/chat`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:    MODEL(),
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      stream:   true,
      options:  { temperature: 0.82, top_p: 0.92, num_ctx: 4096, repeat_penalty: 1.05 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!r.ok) throw new Error(`Ollama stream ${r.status}`);

  const reader  = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj.message?.content) yield obj.message.content;
        if (obj.done) return;
      } catch {}
    }
  }
}

async function listModels() {
  try {
    const r = await fetch(`${BASE()}/api/tags`, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return [];
    const d = await r.json();
    return (d.models || []).map(m => m.name);
  } catch { return []; }
}

module.exports = { isAvailable, chat, chatStream, listModels, getModel: MODEL };
