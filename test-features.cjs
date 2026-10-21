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
  check('Facilities tab badge = 101', tabs.find(b => b.dataset.section === 'Facilities').querySelector('.segment-count').textContent === '101');
  check('Multimedia tab badge = 103', tabs.find(b => b.dataset.section === 'Multimedia').querySelector('.segment-count').textContent === '103');
  check('no task falls into Unassigned by department', tabs.find(b => b.dataset.section === 'Unassigned').querySelector('.segment-count').textContent === '0');

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
  check('Discipleship filter shows only the Discipleship heading', doc.querySelector('.section-title')?.textContent === 'Discipleship' && !doc.querySelector('[data-section-list="Multimedia"]'));

  click(win, [...doc.querySelectorAll('.segment-tab')].find(b => b.dataset.section === 'all'));
  check('back to All shows 204 rows again', doc.querySelectorAll('[data-section-list] [data-task-id]').length === 204, 'got ' + doc.querySelectorAll('[data-section-list] [data-task-id]').length);
  check('only the two populated sections render a list', doc.querySelectorAll('[data-section-list]').length === 2, 'got ' + doc.querySelectorAll('[data-section-list]').length);

  // ---- Manual "move to section" picker on each row ----
  const badgeOf = s => [...doc.querySelectorAll('.segment-tab')].find(b => b.dataset.section === s).querySelector('.segment-count').textContent;
  const pickers = doc.querySelectorAll('[data-move-section]');
  check('every section row has a move picker', pickers.length === 204, 'got ' + pickers.length);
  check('picker first option is Auto + section', pickers[0].value === '' && /^Auto/.test(pickers[0].options[0].textContent), pickers[0].value + ' / ' + pickers[0].options[0].textContent);
  const victimId = doc.querySelector('[data-section-list="Multimedia"] [data-task-id]').dataset.taskId;
  let picker = doc.querySelector(`[data-move-section="${victimId}"]`);
  picker.value = 'Discipleship';
  picker.dispatchEvent(new win.Event('change', { bubbles: true }));
  check('a hand move creates a Discipleship list', !!doc.querySelector('[data-section-list="Discipleship"]'));
  check('Discipleship holds exactly the moved task', doc.querySelectorAll('[data-section-list="Discipleship"] [data-task-id]').length === 1);
  check('Multimedia drops to 102', badgeOf('Multimedia') === '102', badgeOf('Multimedia'));
  check('Discipleship badge becomes 1', badgeOf('Discipleship') === '1', badgeOf('Discipleship'));
  check('Facilities is untouched', badgeOf('Facilities') === '101', badgeOf('Facilities'));
  check('picker remembers the hand move', doc.querySelector(`[data-move-section="${victimId}"]`).value === 'Discipleship');
  picker = doc.querySelector(`[data-move-section="${victimId}"]`);
  picker.value = '';
  picker.dispatchEvent(new win.Event('change', { bubbles: true }));
  check('back to Auto restores Multimedia 103', badgeOf('Multimedia') === '103', badgeOf('Multimedia'));
  check('Discipleship is empty again', badgeOf('Discipleship') === '0', badgeOf('Discipleship'));

  // ---- Discipleship review dialog ----
  check('review callout appears on All', !![...doc.querySelectorAll('.callout')].find(c => /may be discipleship work/.test(c.textContent)), 'no callout');
  click(win, doc.querySelector('.segment-tab[data-section="Multimedia"]'));
  check('callout hidden while a section filter is active', ![...doc.querySelectorAll('.callout')].some(c => /may be discipleship work/.test(c.textContent)));
  click(win, doc.querySelector('.segment-tab[data-section="all"]'));
  const callout2 = [...doc.querySelectorAll('.callout')].find(c => /may be discipleship work/.test(c.textContent));
  click(win, callout2.querySelector('[data-action="review-discipleship"]'));
  const picks = [...doc.querySelectorAll('.split-pick')];
  console.log('   (info) discipleship candidates offered: ' + picks.length);
  check('review dialog lists ticked candidates', picks.length === 12 && picks.every(p => p.checked), 'picks ' + picks.length);
  check('dialog tells you which section each one sits in', /currently in Multimedia/.test(doc.querySelector('.modal-body').textContent));
  picks.forEach((p, i) => { if (i > 0) p.checked = false; });
  click(win, doc.querySelector('[data-action="apply-discipleship"]'));
  check('only the ticked task moved to Discipleship', doc.querySelectorAll('[data-section-list="Discipleship"] [data-task-id]').length === 1, 'got ' + doc.querySelectorAll('[data-section-list="Discipleship"] [data-task-id]').length);
  check('review dialog closes after moving', doc.querySelectorAll('.split-pick').length === 0);

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

  // ---- Navigation reflects the capture flow ----
  const navPages = [...doc.querySelectorAll('#primary-nav [data-page]')].map(b => b.dataset.page);
  const navText = [...doc.querySelectorAll('#primary-nav [data-page]')].map(b => b.textContent.trim());
  check('no Inbox nav item', !navPages.includes('inbox') && !navText.some(t => /^Inbox/.test(t)), navText.join(' | '));
  check('no AI Task Capture nav item', !navPages.includes('ai-capture') && !navText.some(t => /AI Task Capture/.test(t)), navText.join(' | '));
  check('For confirmation nav item exists', navPages.includes('confirmations') && navText.some(t => /^For confirmation/.test(t)), navText.join(' | '));

  win.navigate('dashboard');
  click(win, doc.querySelector('[data-action="upload-notes"]'));
  check('Capture notes opens the capture page', win.eval('currentPage') === 'ai-capture', win.eval('currentPage'));
  check('capture page sends readings to confirmation', /Send to For confirmation/.test(doc.getElementById('page-content').textContent));

  // ---- Confirmation queue ----
  win.navigate('confirmations');
  check('empty confirmation queue explains itself', /Nothing waiting for confirmation/.test(doc.getElementById('page-content').textContent));
  win.eval(`state.confirmations.unshift({id:'C-1',title:'note.jpg',createdAt:new Date().toISOString(),source:'AI image capture',files:['note.jpg'],transcription:'Fix the speaker in the youth hall',notes:'',tasks:[{title:'Fix the speaker',description:'youth hall',department:'Multimedia',location:'CC',personInCharge:'Unassigned',priority:'Medium',confidence:0.72,tags:['#mm'],type:'Maintenance',sourceFile:'note.jpg'}],status:'Pending confirmation'})`);
  win.navigate('confirmations');
  check('pending capture is listed', /note\.jpg/.test(doc.getElementById('page-content').textContent));
  check('confirmation badge counts pending captures', doc.getElementById('confirmation-count').textContent === '1', doc.getElementById('confirmation-count').textContent);
  const beforeConfirm = win.eval('state.tasks.length');
  click(win, doc.querySelector('[data-action="review-confirmation"]'));
  check('review modal opens with editable rows', doc.querySelectorAll('[data-confirm-row]').length === 1);
  doc.querySelector('[data-confirm="person"]').value = 'Rodel';
  click(win, doc.querySelector('[data-action="confirm-capture"]'));
  check('confirming adds exactly one task', win.eval('state.tasks.length') === beforeConfirm + 1, beforeConfirm + ' -> ' + win.eval('state.tasks.length'));
  check('confirmed task is Ready when a person is set', win.eval('state.tasks[0].status') === 'Ready', win.eval('state.tasks[0].status'));
  check('capture is marked Confirmed', win.eval("state.confirmations[0].status") === 'Confirmed', win.eval("state.confirmations[0].status"));
  check('badge clears after confirming', doc.getElementById('confirmation-count').textContent === '0', doc.getElementById('confirmation-count').textContent);
  check('recently handled list appears', /Recently handled/.test(doc.getElementById('page-content').textContent));

  // ---- Editable calendar ----
  win.navigate('calendar');
  click(win, doc.querySelector('[data-action="cal-today"]'));
  check('calendar offers New event', !!doc.querySelector('[data-action="new-event"]'));
  click(win, doc.querySelector('[data-action="new-event"]'));
  check('event form opens', !!doc.getElementById('event-form'));
  doc.getElementById('f-title').value = 'Staff meeting';
  doc.getElementById('f-date').value = win.eval('todayISO()');
  doc.getElementById('f-start').value = '09:00';
  doc.getElementById('f-end').value = '10:00';
  doc.getElementById('f-location').value = 'CEC';
  doc.getElementById('event-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  check('event is saved', win.eval('state.events.length') === 1, win.eval('state.events.length'));
  check('event chip appears on the calendar', !!doc.querySelector('.cal-event'));
  check('event shows on its day', /Staff meeting/.test(doc.querySelector('.cal-grid').textContent));
  click(win, doc.querySelector('.cal-event'));
  check('event detail opens', doc.querySelector('.modal-title')?.textContent === 'Staff meeting');
  click(win, doc.querySelector('[data-action="edit-event"]'));
  doc.getElementById('f-title').value = 'Staff meeting (moved)';
  doc.getElementById('event-form').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
  check('event can be edited', /Staff meeting \(moved\)/.test(doc.querySelector('.cal-grid').textContent));
  click(win, doc.querySelector('.cal-event'));
  click(win, doc.querySelector('[data-action="delete-event"]'));
  click(win, doc.getElementById('delete-event-confirm'));
  check('event can be deleted', win.eval('state.events.length') === 0, win.eval('state.events.length'));
  const addBtn = doc.querySelector('.cal-add');
  const addDate = addBtn.dataset.date;
  click(win, addBtn);
  check('day + prefills that date', doc.getElementById('f-date').value === addDate, doc.getElementById('f-date').value + ' vs ' + addDate);
  click(win, doc.querySelector('[data-action="close-modal"]'));

  // ---- Other tabs still fine ----
  const navResults = [];
  for (const p of ['dashboard', 'tasks', 'calendar', 'reports', 'admin', 'confirmations']) {
    try { win.navigate(p); navResults.push(p + ':' + (doc.getElementById('page-content').innerHTML.length > 0 ? 'ok' : 'EMPTY')); }
    catch (e) { navResults.push(p + ':THROW'); }
  }
  check('all tabs navigate', navResults.every(r => r.endsWith('ok')), navResults.join(' '));

  check('no runtime errors after the new flows', errors.length === 0, errors.join(' | '));
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
}, 4000);
