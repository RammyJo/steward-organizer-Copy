// Extra checks: oversize, large realistic payload, no-secret leak
import { onRequestPost } from './functions/api/decipher.js';
const TINY = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
async function body(res){ return JSON.parse(await res.text()); }
// oversize body (>9M chars) -> 413 or 400, no AI call
{
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(9_000_001);
  let called = false;
  const env = { AI: { run: async () => { called = true; return {}; } } };
  const res = await onRequestPost({ request: { text: async () => JSON.stringify({ image: big }) }, env });
  console.log('oversize status', res.status, 'aiCalled', called, res.status === 413 || res.status === 400 ? 'PASS' : 'FAIL');
}
// realistic 200KB image passes validation and reaches AI
{
  const med = 'data:image/jpeg;base64,' + 'A'.repeat(270000);
  let seen = null;
  const env = { AI: { run: async (m, i) => { seen = i; return { response: JSON.stringify({ notes: '', transcription: 't', tasks: [] }) }; } } };
  const res = await onRequestPost({ request: { text: async () => JSON.stringify({ image: med }) }, env });
  const b = await body(res);
  console.log('medium status', res.status, 'mode', b.inputMode, res.status === 200 && seen?.messages ? 'PASS' : 'FAIL');
}
// license error mapping
{
  const env = { AI: { run: async () => { throw new Error('Missing license agreement for meta llama'); } } };
  const res = await onRequestPost({ request: { text: async () => JSON.stringify({ image: TINY }) }, env });
  const b = await body(res);
  console.log('license status', res.status, /license/i.test(b.error) ? 'PASS' : 'FAIL', '-', (b.error||'').slice(0,80));
}
// secret check: error must not contain base64 payload
{
  const med = 'data:image/jpeg;base64,' + 'QUJD'.repeat(5000);
  const env = { AI: { run: async () => { throw new Error('boom ' + 'x'.repeat(50)); } } };
  const res = await onRequestPost({ request: { text: async () => JSON.stringify({ image: med }) }, env });
  const b = await body(res);
  const leaked = JSON.stringify(b).includes('QUJDQUJD');
  console.log('no-leak', !leaked ? 'PASS' : 'FAIL');
}
