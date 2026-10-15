// Realistic sample test grounded in the provided handwritten grid photo.
// Run: node test-sample.mjs
import { onRequestPost } from './functions/api/decipher.js';

// Simulate a frontend-optimized photo: 1600px JPEG q0.85 is typically
// 200-800KB -> ~270-1000K base64 chars. Use 300K chars of valid base64.
const realisticImage = 'data:image/jpeg;base64,' + 'A'.repeat(300000);

// Mocked vision-model JSON whose content mirrors what is visibly written
// in the sample (dense grid of short phrases). This does NOT claim the live
// model produced it; it validates the backend's handling of realistic content.
const sampleModelJson = JSON.stringify({
  notes: 'Dense grid, mostly legible; a few abbreviated words uncertain.',
  transcription: [
    'Announce: Tomorrow 6pm G12 Conf.',
    'Kulang Sounds bk spkr',
    'order creaseprotect cam phone [unclear]',
    'Bass guitar SUBS contrl or lower FX',
    'Heavy Duty door w/ panic bar',
    'Managed WordPress',
    'Attendance app',
    'Repaint Fun Hall',
    'Network switch managed',
    'Buy hand pump',
    "Tim's kitchen mosquito screen AC/fan mats 4 enclosure"
  ].join('\n'),
  tasks: [
    { title: 'Announce G12 Conf tomorrow 6pm', description: 'Announce: Tomorrow 6pm G12 Conf.', department: 'Events', location: 'Unknown', personInCharge: 'Unassigned', priority: 'High', type: 'Task', tags: ['#fac'], confidence: 0.85, uncertainText: [] },
    { title: 'Order creaseprotect cam phone [unclear]', description: 'order creaseprotect cam phone - [unclear abbreviation]', department: 'Facilities', location: 'Unknown', personInCharge: 'Unassigned', priority: 'Medium', type: 'Task', tags: ['#fac'], confidence: 0.4, uncertainText: ['creaseprotect'] },
    { title: 'Check bass guitar subs control', description: 'Bass guitar SUBS contrl or lower FX', department: 'Multimedia', location: 'Unknown', personInCharge: 'John Doe', priority: 'Medium', type: 'Task', tags: ['#fac'], confidence: 0.5, uncertainText: ['contrl'] },
    { title: 'Install heavy duty door with panic bar', description: 'Heavy Duty door w/ panic bar', department: 'Facilities', location: 'Unknown', personInCharge: 'Unassigned', priority: 'High', type: 'Maintenance', tags: ['#fac'], confidence: 0.9, uncertainText: [] },
    { title: 'Repaint Fun Hall', description: 'Repaint Fun Hall', department: 'Facilities', location: 'Fun Hall', personInCharge: 'Unassigned', priority: 'Low', type: 'Maintenance', tags: ['#fac'], confidence: 0.9, uncertainText: [] },
    { title: 'Set up managed network switch', description: 'Network switch managed', department: 'Multimedia', location: 'Unknown', personInCharge: 'Unassigned', priority: 'Medium', type: 'Task', tags: ['#fac'], confidence: 0.75, uncertainText: ['managed scope'] },
    { title: 'Buy hand pump', description: 'Buy hand pump', department: 'Facilities', location: 'Unknown', personInCharge: 'Unassigned', priority: 'Medium', type: 'Task', tags: ['#fac'], confidence: 0.8, uncertainText: [] },
    { title: 'Fix Tim kitchen enclosure screens', description: "Tim's kitchen mosquito screen AC/fan mats 4 enclosure", department: 'Facilities', location: 'Unknown', personInCharge: 'Unassigned', priority: 'Medium', type: 'Maintenance', tags: ['#fac'], confidence: 0.65, uncertainText: ['mats 4'] }
  ]
});

const env = { AI: { run: async (model, input) => ({ response: sampleModelJson }) } };
const req = { text: async () => JSON.stringify({ image: realisticImage, people: ['John Doe'], pastorPatterns: [] }) };
const res = await onRequestPost({ request: req, env });
const body = JSON.parse(await res.text());

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { pass++; console.log('PASS ' + name); } else { fail++; console.log('FAIL ' + name + ' ' + extra); } };

check('sample: 200', res.status === 200, 'status=' + res.status);
check('sample: 8 tasks', body.tasks?.length === 8, 'got=' + body.tasks?.length);
check('sample: transcription kept (grid lines)', (body.transcription || '').includes('G12 Conf') && (body.transcription || '').includes('panic bar'), (body.transcription || '').slice(0, 120));
check('sample: low-conf person forced Unassigned (John Doe @0.5)', body.tasks?.[2]?.personInCharge === 'Unassigned', JSON.stringify(body.tasks?.[2]).slice(0, 200));
check('sample: [unclear] preserved', JSON.stringify(body.tasks).includes('[unclear]'), '');
check('sample: departments valid', (body.tasks || []).every(t => ['Facilities','Custodial','Multimedia','Worship','Events','Administration'].includes(t.department)), '');
check('sample: reviewRequired', body.reviewRequired === true, '');
check('sample: inputMode messages', (body.inputMode || '').includes('messages'), body.inputMode);
check('sample: no image leak', !JSON.stringify(body).includes('AAAAAA'), '');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
