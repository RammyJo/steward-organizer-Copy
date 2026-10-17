const fs = require('fs');
const { JSDOM } = require('jsdom');
const html = fs.readFileSync('C:\\Users\\ORAS Intern\\AppData\\Local\\Temp\\opencode\\steward-repo\\index.html', 'utf8');
let pass = 0, fail = 0;
const check = (n, c, e = '') => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, e); } };
const errors = [];
const dom = new JSDOM(html, {
  url: 'https://steward-organizer.pages.dev/',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  beforeParse(w) { w.addEventListener('error', e => errors.push(String(e.message))); }
});
const click = (win, el) => el.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
setTimeout(() => {
  const win = dom.window, doc = win.document;
  check('no runtime errors', errors.length === 0, errors.join(' | '));

  // ---- Section filter tabs ----
  win.navigate('tasks');
  const tabs = [...doc.querySelectorAll('.segment-tab')];
  check('6 segment tabs (All + 5 sections)', tabs.length === 6, 'got ' + tabs.length);
  check('first tab is All and active', tabs[0]?.dataset.section === 'all' && tabs[0].classList.contains('active'));
  const allRows = doc.querySelectorAll('[data-section-list] [data-task-id]');
  check('All view renders 204 rows', allRows.length === 204, 'got ' + allRows.length);
  check('All badge = 204', tabs[0].querySelector('.segment-count').textContent === '204', tabs[0].querySelector('.segment-count').textContent);

  const mmTab = tabs.find(b => b.dataset.section === 'Multimedia');
  const mmBadge = parseInt(mmTab.querySelector('.segment-count').textContent, 10);
  click(win, mmTab);
  const lists = doc.querySelectorAll('[data-section-list]');
  check('filtering shows exactly 1 section list', lists.length === 1, 'got ' + lists.length);
  check('the shown section is Multimedia', lists[0]?.dataset.sectionList === 'Multimedia', lists[0]?.dataset.sectionList);
  const mmRows = lists[0]?.querySelectorAll('[data-task-id]').length;
  check('Multimedia rows match its badge', mmRows === mmBadge, 'rows ' + mmRows + ' badge ' + mmBadge);
  check('Multimedia tab now active', doc.querySelector('.segment-tab.active')?.dataset.section === 'Multimedia');

  const discTab = [...doc.querySelectorAll('.segment-tab')].find(b => b.dataset.section === 'Discipleship');
  click(win, discTab);
  check('Discipleship filter shows 1 list named Discipleship', doc.querySelectorAll('[data-section-list]').length === 1 && doc.querySelector('[data-section-list]')?.dataset.sectionList === 'Discipleship');

  click(win, [...doc.querySelectorAll('.segment-tab')].find(b => b.dataset.section === 'all'));
  check('back to All shows 5 sections', doc.querySelectorAll('[data-section-list]').length === 5, 'got ' + doc.querySelectorAll('[data-section-list]').length);

  // ---- Calendar ----
  win.navigate('calendar');
  const monthLabel = doc.querySelector('.cal-month')?.textContent || '';
  check('calendar renders a month + year', /\d{4}/.test(monthLabel), monthLabel);
  check('7 weekday headers', doc.querySelectorAll('.cal-dow').length === 7, doc.querySelectorAll('.cal-dow').length);
  const now = new Date();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayCells = doc.querySelectorAll('.cal-cell:not(.empty)');
  check('day cells equal days in current month', dayCells.length === dim, 'cells ' + dayCells.length + ' vs ' + dim);
  const todayCell = doc.querySelector('.cal-cell.today');
  check('today is highlighted', !!todayCell && todayCell.querySelector('.cal-daynum')?.textContent === String(now.getDate()));
  const undatedRows = doc.querySelectorAll('.cal-undated .task-row');
  console.log('   (info) undated tasks listed: ' + undatedRows.length);
  check('calendar shows undated tasks so nothing is hidden', undatedRows.length > 0, 'got ' + undatedRows.length);
  const before = monthLabel;
  click(win, doc.querySelector('[data-action="cal-prev"]'));
  const prevLabel = doc.querySelector('.cal-month').textContent;
  check('Prev changes the month', prevLabel !== before, before + ' -> ' + prevLabel);
  click(win, doc.querySelector('[data-action="cal-today"]'));
  check('Today returns to current month', doc.querySelector('.cal-month').textContent === before, doc.querySelector('.cal-month').textContent + ' vs ' + before);
  click(win, doc.querySelector('[data-action="cal-next"]'));
  check('Next moves forward a month', doc.querySelector('.cal-month').textContent !== before);

  // ---- Other tabs still fine ----
  const navResults = [];
  for (const p of ['dashboard', 'tasks', 'calendar', 'reports', 'admin', 'inbox']) {
    try { win.navigate(p); navResults.push(p + ':' + (doc.getElementById('page-content').innerHTML.length > 0 ? 'ok' : 'EMPTY')); }
    catch (e) { navResults.push(p + ':THROW'); }
  }
  check('all tabs navigate', navResults.every(r => r.endsWith('ok')), navResults.join(' '));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}, 4000);
