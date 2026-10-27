// Tests for functions/api/decipher.js
// Run: node test-decipher.mjs
import { onRequestPost, onRequestOptions, onRequestGet } from './functions/api/decipher.js';

let passed = 0, failed = 0;
function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name + ' ' + extra); }
}
function makeRequest(obj, origin) {
  const raw = JSON.stringify(obj);
  return { text: async () => raw, headers: { get: (h) => (h.toLowerCase() === 'origin' ? (origin || null) : null) } };
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
  const res = await onRequestOptions({ request: makeRequest({}, 'https://steward-organizer.pages.dev') });
  ok('OPTIONS 204 + allows the site origin', res.status === 204 && res.headers.get('access-control-allow-origin') === 'https://steward-organizer.pages.dev', res.status);
  const stranger = await onRequestOptions({ request: makeRequest({}, 'https://someone-else.example') });
  ok('OPTIONS hides CORS from an unrelated origin', !stranger.headers.get('access-control-allow-origin'), stranger.headers.get('access-control-allow-origin'));
}

// 15. the writer's own department words are mapped, not dumped into Facilities
{
  const env = { AI: { run: async () => ({ response: JSON.stringify({ notes: 'n', transcription: 't', tasks: [
    { title: 'Media rack', department: 'Media', priority: 'Very High', tags: [], confidence: 0.9 },
    { title: 'F&B prep', department: 'F&B', priority: 'urgent', tags: [], confidence: 0.9 },
    { title: 'Admin filing', department: 'Admin', priority: 'Low', tags: [], confidence: 0.9 }
  ] }) }) } };
  const res = await onRequestPost({ request: makeRequest({ image: TINY_PNG }), env });
  const { body } = await readJson(res);
  ok('Media -> Multimedia', body.tasks[0].department === 'Multimedia', body.tasks[0].department);
  ok('Very High survives sanitising', body.tasks[0].priority === 'Very High', body.tasks[0].priority);
  ok('F&B -> Events', body.tasks[1].department === 'Events', body.tasks[1].department);
  ok('urgent -> Very High', body.tasks[1].priority === 'Very High', body.tasks[1].priority);
  ok('Admin -> Administration', body.tasks[2].department === 'Administration', body.tasks[2].department);
  ok('tags follow the real department', JSON.stringify(body.tasks[0].tags) === '["#mm"]', JSON.stringify(body.tasks[0].tags));
}

// 16. the reading brief, dictionary and correction memory reach the model
{
  let seen = null;
  const env = { AI: { run: async (m, input) => { seen = input; return { response: JSON.stringify({ notes: 'n', transcription: 't', tasks: [] }) }; } } };
  const res = await onRequestPost({
    request: makeRequest({
      image: TINY_PNG,
      dictionary: [{ tag: '#fac', label: 'Facilities', meaning: 'buildings and gear' }],
      pastorPatterns: [{ rawLine: 'pur spray (Roy)', correctedTitle: 'Pressure sprayer — Roy', edited: true }],
      readingProfile: 'Green highlighter always means a heading.'
    }), env
  });
  await readJson(res);
  const system = String(seen?.messages?.[0]?.content || '');
  const user = JSON.stringify(seen?.messages?.[1]?.content || '');
  ok('custom reading profile is in the system prompt', system.includes('Green highlighter always means a heading.'), system.slice(0, 120));
  ok('dictionary is offered to the model', user.includes('#fac'), user.slice(0, 200));
  ok('correction memory is offered', user.includes('pur spray'), user.slice(0, 200));
}

// 17. with no profile supplied, the built-in brief is still sent
{
  let seen = null;
  const env = { AI: { run: async (m, input) => { seen = input; return { response: JSON.stringify({ notes: 'n', transcription: 't', tasks: [] }) }; } } };
  await onRequestPost({ request: makeRequest({ image: TINY_PNG }), env });
  const system = String(seen?.messages?.[0]?.content || '');
  ok('built-in brief covers struck-through lines', /struck-through|scribbled out/i.test(system), system.slice(0, 120));
  ok('built-in brief covers Taglish', /Taglish|bugbog|napahiya/i.test(system), '');
  ok('built-in brief covers the green highlighter', /highlighter/i.test(system), '');
}

// 18. GET publishes the built-in brief so the editor cannot drift from it
{
  const res = await onRequestGet({ request: makeRequest({}) });
  const { status, body } = await readJson(res);
  ok('GET returns the built-in brief', status === 200 && typeof body.readingProfile === 'string' && body.readingProfile.length > 500, status);
}

// 19. a plain-text reading keeps his own #hashtags instead of forcing #fac
{
  const env = { AI: { run: async () => ({ response: 'Hazel plug 2x ? - #events. Check the front-back fan before the weekend service.' }) } };
  const res = await onRequestPost({ request: makeRequest({ image: TINY_PNG }), env });
  const { status, body } = await readJson(res);
  const tagged = (body.tasks || []).find(t => Array.isArray(t.tags) && t.tags.some(x => String(x).includes('events')));
  ok('plain text keeps the written hashtag', status === 200 && !!tagged, JSON.stringify(body).slice(0, 300));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
