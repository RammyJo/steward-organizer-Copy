const fs = require('fs');
const html = fs.readFileSync('C:\\Users\\ORAS Intern\\AppData\\Local\\Temp\\opencode\\steward-repo\\index.html', 'utf8');
const i0 = html.indexOf('function sectionFor(t){');
const i1 = html.indexOf('function filteredTasks(){', i0);
if (i0 < 0 || i1 < 0) { console.log('FAIL extract'); process.exit(1); }
const src = html.slice(i0, i1) + '\n;globalThis.__S = { sectionFor, SECTIONS, sectionTasks };';
const state = { priorityOrder: [], tasks: [] };
const saveState = () => {}, addActivity = () => {}, renderPage = () => {}, showToast = () => {};
const getTask = () => null;
eval(src);
const { sectionFor: secFor, SECTIONS: SECS } = globalThis.__S;
let pass = 0, fail = 0;
const check = (name, cond, extra='') => { if (cond) { pass++; console.log('PASS', name); } else { fail++; console.log('FAIL', name, extra); } };

const cases = [
  [{ title: 'Install sink drain and faucet inside Big Kubo', department: 'Facilities', owner: 'Unassigned' }, 'Facilities'],
  [{ title: 'Install sink drain and faucet inside Big Kubo', department: 'Facilities', owner: 'John' }, 'Facilities'],
  [{ title: 'Complete water supply for Big Kubo', department: 'Facilities', owner: '' }, 'Facilities'],
  [{ title: 'Bass guitar SUBS control', department: 'Multimedia', owner: 'Tech' }, 'Multimedia'],
  [{ title: 'Network switch managed', department: 'Facilities', owner: 'Tech' }, 'Facilities'],
  [{ title: 'Clean the chapel floor', department: 'Custodial', owner: 'Ana' }, 'Facilities'],
  [{ title: 'Sunday worship rehearsal', department: 'Worship', owner: 'Ana' }, 'Discipleship'],
  [{ title: 'VBS teaser video', department: 'Events', owner: 'Ana' }, 'Discipleship'],
  [{ title: 'File the business permit', department: 'Administration', owner: 'Ana' }, 'Admin'],
  [{ title: 'Announce G12 Conf tomorrow', department: 'Events', owner: 'Ana' }, 'Discipleship'],
  [{ title: 'Repaint Fun Hall', department: 'Facilities', owner: 'Bob' }, 'Facilities'],
  [{ title: 'Buy hand pump', department: '', owner: 'Bob' }, 'Facilities'],
  [{ title: 'Youth fellowship night', department: '', owner: 'Bob' }, 'Discipleship'],
  [{ title: 'Fix projector in sanctuary', department: '', owner: 'Bob' }, 'Multimedia'],
  [{ title: 'Prepare payroll records', department: '', owner: 'Bob' }, 'Admin'],
  [{ title: 'Sunday worship livestream setup', department: 'Multimedia', owner: 'Bob' }, 'Multimedia'],
  [{ title: 'Install subwoofers using the QSC amp', department: 'Facilities', owner: 'Marck Paolo' }, 'Facilities'],
  [{ title: 'Ask about parking rules', department: 'Unsorted', owner: 'Bob' }, 'Unassigned'],
  [{ title: 'Worship hall media setup', department: 'Multimedia', owner: 'Paolo' }, 'Multimedia'],
  [{ title: 'Repair stockroom and build server room', department: 'Facilities', owner: 'Unassigned' }, 'Facilities'],
];
check('department wins over keywords (no task lands in Unassigned just for having no owner)', cases.every(([t, exp]) => secFor(t) === exp));
for (const [t, exp] of cases) check(`section: "${t.title}" -> ${exp}`, secFor(t) === exp, 'got ' + secFor(t));
check('5 sections', SECS.map(s => s.id).join(',') === 'Facilities,Multimedia,Discipleship,Admin,Unassigned');
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
