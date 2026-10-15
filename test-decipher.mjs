// Tests for functions/api/decipher.js
// Run: node test-decipher.mjs
import { onRequestPost, onRequestOptions } from './functions/api/decipher.js';

let passed = 0, failed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + ' ' + extra); }
}
function makeRequest(obj) {
  const raw = JSON.stringify(obj);
  return { text: async () => raw };
}
// 1x1 png data URL (valid image input)
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function readJson(res) { return { status: res.status, body: JSON.parse(await res.text()) }; }

// 1. valid image + valid structured response
{
  const env = { AI: { run: async () => ({ response: JSON.stringify({ notes: 'clear', transcription: 'Fix sink', tasks: [{ title: 'Fix sink', description: 'Fix sink in Big Kubo', department: 'Facilities', location: 'CC', personInCharge: 'Unassigned', priority: 'High', type: 'Maintenance', tags: ['#fac'], confidence: 0.9, uncertainText: [] }] }) }) } };
  const res = await onRequestPost({ request: makeRequest({ image: TINY_PNG, people: [], pastorPatterns: [] }), env });
  const { status, body } = await readJson(res);
  ok('valid image + valid response -> 200 + 1 task', status === 200 && body.tasks?.length === 1 && body.transcription === 'Fix sink', JSON.stringify({ status, body }).slice(0, 300));
}

// 2. plain-text model response -> transcription preserved, no crash
{
  const env = { AI: { run: async () => ({ response: 'The note says: please clean the chapel floor on Friday. Also repair door hinge.' }) } };
  const res = await onRequestPost({ request: makeRequest({ image: TINY_PNG }), env });
  const { status, body } = await readJson(res);
  ok('plain text -> 200 with transcription', status === 200 && typeof body.transcription === 'string' && body.transcription.length > 10, JSON.stringify({ status, body }).slice(0, 300));
}

// 3. JSON wrapped in markdown fences
{
  const payload = '```json\n{"notes":"ok","transcription":"line1","tasks":[]}\n```';
  const env = { AI: { run: async () => ({ response: payload }) } };
  const res = await onRequestPost({ request: makeRequest({ image: TINY_PNG }), env });
  const { status, body } = await readJson(res);
  ok('markdown fences -> parsed', status === 200 && body.transcription === 'line1' && Array.isArray(body.tasks), JSON.stringify({ status, body }).slice(0, 300));
}

// 4. empty model output -> useful 502 error
{
  const env = { AI: { run: async () => ({ response: '' }) } };
  const res = await onRequestPost({ request: makeRequest({ image: TINY_PNG }), env });
  const { status, body } = await readJson(res);
  ok('empty output -> 502 useful error', status === 502 && /empty|unreadable|could not finish/i.test(body.error || ''), JSON.stringify({ status, body }).slice(0, 300));
}

// 5. malformed (non-JSON, tiny) -> handled without crash
{
  const env = { AI: { run: async () => ({ response: '???' }) } };
  const res = await onRequestPost({ request: makeRequest({ image: TINY_PNG }), env });
  const { status, body } = await readJson(res);
  ok('malformed tiny -> 200 no-tasks or 502 (no crash)', (status === 200 && Array.isArray(body.tasks)) || status === 502, JSON.stringify({ status, body }).slice(0, 300));
}

// 6. AI invocation failure -> 502 mapped message, no secrets
{
  const env = { AI: { run: async () => { throw new Error('rate limited quota exceeded'); } } };
  const res = await onRequestPost({ request: makeRequest({ image: TINY_PNG }), env });
  const { status, body } = await readJson(res);
  ok('AI rate-limit -> 502 rate message', status === 502 && /rate-limited|usage limit/i.test(body.error || ''), JSON.stringify({ status, body }).slice(0, 300));
  ok('no image leak in error', !JSON.stringify(body).includes('iVBORw0KGgo'), '');
}

// 7. invalid image input -> 400
{
  const env = { AI: { run: async () => ({ response: '{}' }) } };
  const res = await onRequestPost({ request: makeRequest({ image: 'not-an-image' }), env });
  const { status } = await readJson(res);
  ok('invalid image -> 400', status === 400, 'status=' + status);
}

// 8. unsupported mime (svg) -> 400
{
  const env = { AI: { run: async () => ({ response: '{}' }) } };
  const res = await onRequestPost({ request: makeRequest({ image: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }), env });
  const { status } = await readJson(res);
  ok('unsupported mime -> 400', status === 400, 'status=' + status);
}

// 9. no identifiable tasks but valid transcription -> 200 empty tasks + transcription
{
  const env = { AI: { run: async () => ({ response: JSON.stringify({ notes: 'illegible but some words', transcription: 'some words [unclear]', tasks: [] }) }) } };
  const res = await onRequestPost({ request: makeRequest({ image: TINY_PNG }), env });
  const { status, body } = await readJson(res);
  ok('no tasks -> 200 empty + transcription', status === 200 && body.tasks.length === 0 && body.transcription.includes('some words'), JSON.stringify({ status, body }).slice(0, 300));
}

// 10. uncertain handwriting -> low confidence preserved, person forced Unassigned
{
  const env = { AI: { run: async () => ({ response: JSON.stringify({ notes: 'uncertain', transcription: '[unclear] faucet', tasks: [{ title: '[unclear] faucet fix', description: 'maybe faucet', department: 'Facilities', location: 'CC', personInCharge: 'John Doe', priority: 'High', type: 'Task', tags: [], confidence: 0.3, uncertainText: ['faucet'] }] }) }) } };
  const res = await onRequestPost({ request: makeRequest({ image: TINY_PNG, people: ['John Doe'] }), env });
  const { status, body } = await readJson(res);
  ok('uncertain -> Unassigned + low conf', status === 200 && body.tasks[0].personInCharge === 'Unassigned' && body.tasks[0].confidence < 0.8, JSON.stringify({ status, body }).slice(0, 300));
}

// 11. missing AI binding -> 503
{
  const res = await onRequestPost({ request: makeRequest({ image: TINY_PNG }), env: {} });
  const { status, body } = await readJson(res);
  ok('missing binding -> 503', status === 503 && /not connected/i.test(body.error || ''), JSON.stringify({ status, body }).slice(0, 200));
}

// 12. messages-format used first (inputMode) + OpenAI choices shape handled
{
  let seenInput = null;
  const env = { AI: { run: async (m, input) => { seenInput = input; return { choices: [{ message: { content: JSON.stringify({ notes: 'n', transcription: 't', tasks: [] }) } }] }; } } };
  const res = await onRequestPost({ request: makeRequest({ image: TINY_PNG }), env });
  const { status, body } = await readJson(res);
  ok('uses messages+image_url first', status === 200 && seenInput?.messages?.[1]?.content?.some?.(c => c?.image_url?.url?.startsWith('data:image/')), JSON.stringify(seenInput).slice(0, 300));
  ok('inputMode reported', typeof body.inputMode === 'string' && body.inputMode.includes('messages'), body.inputMode);
}

// 13. legacy fallback when messages rejected
{
  let calls = [];
  const env = { AI: { run: async (m, input) => { calls.push(input); if (calls.length === 1) throw new Error('invalid messages format'); return { response: JSON.stringify({ notes: 'n', transcription: 't2', tasks: [] }) }; } } };
  const res = await onRequestPost({ request: makeRequest({ image: TINY_PNG }), env });
  const { status, body } = await readJson(res);
  ok('legacy fallback -> 200 via bytes', status === 200 && body.inputMode === 'legacy-bytes' && Array.isArray(calls[1]?.image), JSON.stringify({ status, body }).slice(0, 300));
}

// 14. OPTIONS CORS
{
  const res = await onRequestOptions();
  ok('OPTIONS 204 + CORS', res.status === 204 && res.headers.get('access-control-allow-origin') === '*', res.status);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
