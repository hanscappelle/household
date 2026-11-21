'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { validAppointments, appointmentMemberIds, removeAppointmentMember, appointmentOnDate, appointmentOccurrences, mergeHouseholdState } = require('../seed');
const { childChangesAllowed } = require('../child-permissions');

const members = [{ id: 'm1', name: 'Mama' }, { id: 'm2', name: 'Papa' }];
const timed = { id: 'a1', title: 'Afspraak', memberId: 'm1', allDay: false, startDate: '2026-11-18', startTime: '22:00', endDate: '2026-11-20', endTime: '00:00' };
const allDay = { id: 'a2', title: 'Vrije afspraak', memberId: '', allDay: true, startDate: '2026-11-18', startTime: '', endDate: '2026-11-20', endTime: '' };
const timedWithoutMember = { ...timed };
delete timedWithoutMember.memberId;
const multi = { ...timedWithoutMember, id: 'a3', title: 'Samen', memberIds: ['m1', 'm2'] };

test('validates appointments, dates, times, assignments and duplicate ids', () => {
  assert.equal(validAppointments([timed, allDay, multi], members), true);
  for (const invalid of [
    { ...timed, startDate: '2026-02-30' },
    { ...timed, startDate: '0001-01-01' },
    { ...timed, endDate: timed.startDate, endTime: timed.startTime },
    { ...timed, startTime: '24:00' },
    { ...timed, memberId: 'unknown' },
    { ...allDay, startTime: '09:00' },
    { ...allDay, endDate: '2026-11-17' },
    { ...timed, title: ' ' },
    { ...multi, memberIds: ['m1', 'm1'] },
    { ...multi, memberIds: ['m1', 'unknown'] },
    { ...multi, memberIds: [''] },
    { ...multi, memberIds: 'm1' },
    { ...multi, memberId: 'm1' },
    timedWithoutMember
  ]) assert.equal(validAppointments([invalid], members), false);
  assert.equal(validAppointments([timed, timed], members), false);
  assert.equal(validAppointments(null, members), false);
});

test('removing a member preserves remaining assignees and supports legacy appointments', () => {
  assert.deepEqual(appointmentMemberIds(timed), ['m1']);
  assert.deepEqual(appointmentMemberIds(allDay), []);
  const updated = removeAppointmentMember(multi, 'm1');
  assert.deepEqual(updated.memberIds, ['m2']);
  assert.deepEqual(removeAppointmentMember(updated, 'm2').memberIds, []);
  assert.equal(removeAppointmentMember(timed, 'm1').memberId, '');
  assert.equal(removeAppointmentMember(timed, 'm2'), timed);
  assert.deepEqual(multi.memberIds, ['m1', 'm2']);
});

test('shows every affected day and excludes a timed end at midnight', () => {
  assert.deepEqual(['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'].map(day => appointmentOnDate(timed, day)), [false, true, true, false]);
  assert.deepEqual(['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21'].map(day => appointmentOnDate(allDay, day)), [false, true, true, true, false]);
  assert.equal(appointmentOnDate({ ...timed, endTime: '00:01' }, '2026-11-20'), true);
});

test('recurrences respect frequency, inclusive end, missing dates and multi-day overlaps', () => {
  const weekly = { ...allDay, recurrence: { frequency: 'weekly', until: '2026-12-02', exceptions: {} } };
  assert.equal(validAppointments([weekly], members), true);
  assert.deepEqual(appointmentOccurrences(weekly, '2026-11-18', '2026-12-31').map(item => item.startDate), ['2026-11-18', '2026-11-25', '2026-12-02']);
  assert.deepEqual(appointmentOccurrences(weekly, '2026-11-26', '2026-11-26').map(item => item.startDate), ['2026-11-25']);
  const monthly = { ...allDay, startDate: '2026-01-31', endDate: '2026-01-31', recurrence: { frequency: 'monthly', until: '', exceptions: {} } };
  assert.deepEqual(appointmentOccurrences(monthly, '2026-02-01', '2026-05-31').map(item => item.startDate), ['2026-03-31', '2026-05-31']);
  const yearly = { ...monthly, startDate: '2024-02-29', endDate: '2024-02-29', recurrence: { frequency: 'yearly', until: '', exceptions: {} } };
  assert.deepEqual(appointmentOccurrences(yearly, '2025-01-01', '2028-12-31').map(item => item.startDate), ['2028-02-29']);
  const bad = [
    { frequency: 'daily', until: '', exceptions: {} },
    { frequency: 'weekly', until: '2026-11-17', exceptions: {} },
    { frequency: 'weekly', until: '', exceptions: { '2026-02-30': null } },
    { frequency: 'weekly', until: '', exceptions: { '2026-11-25': { ...allDay, memberId: 'unknown' } } }
  ];
  for (const recurrence of bad) assert.equal(validAppointments([{ ...allDay, recurrence }], members), false);
});

test('biweekly recurrences start on the chosen date and handle limits, overlaps and exceptions', () => {
  const recurring = { ...allDay, startDate: '2026-12-23', endDate: '2026-12-25',
    recurrence: { frequency: 'biweekly', until: '2027-01-20', exceptions: {} } };
  assert.equal(validAppointments([recurring], members), true);
  assert.deepEqual(appointmentOccurrences(recurring, '2026-12-01', '2027-02-01').map(item => item.startDate),
    ['2026-12-23', '2027-01-06', '2027-01-20']);
  assert.deepEqual(appointmentOccurrences(recurring, '2027-01-07', '2027-01-07').map(item => item.occurrenceDate), ['2027-01-06']);
  assert.deepEqual(appointmentOccurrences(recurring, '2026-12-30', '2026-12-30'), []);
  recurring.recurrence.exceptions['2027-01-06'] = null;
  assert.deepEqual(appointmentOccurrences(recurring, '2027-01-01', '2027-01-31').map(item => item.startDate), ['2027-01-20']);
  recurring.recurrence.until = '';
  assert.deepEqual(appointmentOccurrences(recurring, '2027-02-03', '2027-02-03').map(item => item.startDate), ['2027-02-03']);
});

test('exceptions move or remove an occurrence without changing the series or other members', () => {
  const moved = { ...multi, startDate: '2026-12-01', endDate: '2026-12-02', endTime: '00:01' };
  const recurring = { ...multi, recurrence: { frequency: 'weekly', until: '', exceptions: { '2026-11-25': moved, '2026-12-02': null } } };
  assert.equal(validAppointments([recurring], members), true);
  assert.deepEqual(appointmentOccurrences(recurring, '2026-11-25', '2026-11-25'), []);
  assert.deepEqual(appointmentOccurrences(recurring, '2026-12-01', '2026-12-01').map(item => item.occurrenceDate), ['2026-11-25']);
  assert.deepEqual(appointmentOccurrences(recurring, '2026-12-02', '2026-12-02').map(item => item.occurrenceDate), ['2026-11-25']);
  assert.deepEqual(removeAppointmentMember(recurring, 'm1').recurrence.exceptions['2026-11-25'].memberIds, ['m2']);
  assert.deepEqual(recurring.recurrence.exceptions['2026-11-25'].memberIds, ['m1', 'm2']);
});

test('merges independent appointments and rejects member deletion versus concurrent appointment changes', () => {
  const base = { members, tasks: [], appointments: [], groceries: [], mealIdeas: [], notes: [], completed: {}, customization: {} };
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.appointments.push(timed);
  remote.appointments.push(allDay);
  assert.deepEqual(mergeHouseholdState(base, local, remote).appointments.map(item => item.id), ['a2', 'a1']);
  local.members = [];
  assert.throws(() => mergeHouseholdState(base, local, remote), /Dezelfde gegevens/);
  const legacy = { ...base };
  delete legacy.appointments;
  assert.equal(mergeHouseholdState(legacy, { ...legacy, appointments: [timed] }, legacy).appointments.length, 1);
});

test('children may view appointments but cannot change them', () => {
  const base = { members, tasks: [], groceries: [], mealIdeas: [], notes: [], completed: {}, appointments: [timed], customization: {} };
  const next = structuredClone(base);
  assert.equal(childChangesAllowed(base, next, {}), true);
  next.appointments[0].title = 'Anders';
  assert.equal(childChangesAllowed(base, next, {}), false);
  next.appointments = [];
  assert.equal(childChangesAllowed(base, next, {}), false);
  const withMultiple = { ...base, appointments: [multi] };
  const edited = structuredClone(withMultiple);
  edited.appointments[0].memberIds.pop();
  assert.equal(childChangesAllowed(withMultiple, edited, {}), false);
});

test('appointment list shows every selected name and labels unassigned appointments', () => {
  const source = readFileSync(require.resolve('../app'), 'utf8');
  const context = vm.createContext({
    state: { members, appointments: [multi, allDay, timed] }, appointmentMemberIds,
    isChild: () => false, renderAppointmentCalendar: () => '<div>Maandkalender</div>',
    appointmentMonth: new Date(), appointmentCalendarDate: '',
    appointmentsForMonth: items => items, birthdaysOn: () => [],
    renderAppointmentRows: items => `<strong>${items[0].title}</strong>`
  });
  vm.runInContext(
    source.slice(source.indexOf('function escapeHtml('), source.indexOf('function linkifyNoteDescription(')) +
    source.slice(source.indexOf('function dateKey('), source.indexOf('function membersForAssignment(')) +
    source.slice(source.indexOf('function renderAppointments('), source.indexOf('function renderAppointmentCalendar(')),
    context
  );
  const html = context.renderAppointments();
  assert.ok(html.indexOf('Maandkalender') < html.indexOf('<strong>Samen</strong>'));
  assert.match(html, /<strong>Samen<\/strong><small>Mama, Papa<\/small>/);
  assert.match(html, /<strong>Vrije afspraak<\/strong><small>Voor iedereen<\/small>/);
  assert.match(html, /<strong>Afspraak<\/strong><small>Mama<\/small>/);
  assert.ok(html.indexOf('<strong>Vrije afspraak</strong>') < html.indexOf('<strong>Afspraak</strong>'));
  assert.ok(html.indexOf('<strong>Afspraak</strong>') < html.indexOf('<strong>Samen</strong>'));
});

test('appointment calendar marks birthdays and includes the names in the day label', () => {
  const source = readFileSync(require.resolve('../app'), 'utf8');
  const birthday = { id: 'm1', name: 'Mama', birthDate: '2000-11-18' };
  const context = vm.createContext({
    state: { appointments: [] },
    appointmentMonth: new Date(2026, 10, 1),
    appointmentCalendarDate: '',
    DAYS: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
    appointmentOccurrences: () => [],
    birthdaysOn: date => date.getMonth() === 10 && date.getDate() === 18 ? [birthday] : [],
    escapeHtml: value => String(value),
    formatDate: date => `${date.getDate()} november ${date.getFullYear()}`,
    dateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  });
  vm.runInContext(
    source.slice(source.indexOf('function renderAppointmentCalendar('), source.indexOf('function changeAppointmentMonth(')),
    context
  );
  const html = context.renderAppointmentCalendar();
  const birthdayCell = html.match(/<button[^>]*data-date="2026-11-18"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.match(birthdayCell, /aria-label="18 november 2026: 0 afspraken · 1 verjaardag: Mama"/);
  assert.match(birthdayCell, /class="birthday-marker"/);
  const normalCell = html.match(/<button[^>]*data-date="2026-11-19"[^>]*>[\s\S]*?<\/button>/)[0];
  assert.doesNotMatch(normalCell, /birthday-marker/);
});

test('selecting a calendar day lists the family birthday with appointments', () => {
  const source = readFileSync(require.resolve('../app'), 'utf8');
  const birthday = { id: 'm1', name: 'Mama', birthDate: '2000-11-18' };
  const context = vm.createContext({
    state: { members: [birthday], appointments: [] },
    appointmentMonth: new Date(2026, 10, 1),
    appointmentCalendarDate: '2026-11-18',
    appointmentMemberIds,
    isChild: () => true,
    appointmentsForMonth: () => [],
    birthdaysOn: date => date.getMonth() === 10 && date.getDate() === 18 ? [birthday] : [],
    renderAppointmentCalendar: () => '<div>Kalender</div>',
    renderAppointmentRows: () => '',
    parseDate: value => new Date(`${value}T12:00:00`),
    dateKey: date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    formatDate: date => `${date.getDate()} november ${date.getFullYear()}`,
    escapeHtml: value => String(value)
  });
  vm.runInContext(
    source.slice(source.indexOf('function renderAppointments('), source.indexOf('function renderAppointmentCalendar(')),
    context
  );
  const html = context.renderAppointments();
  assert.match(html, /Afspraken en verjaardagen op 18 november 2026/);
  assert.match(html, /Verjaardag van Mama/);
  assert.match(html, /26 jaar · 18 november 2026/);
  assert.doesNotMatch(html, /Geen afspraken of verjaardagen op deze dag/);
});

test('current month lists upcoming and ongoing appointments; other months show overlapping appointments', () => {
  const source = readFileSync(require.resolve('../app'), 'utf8');
  const context = vm.createContext({ appointmentOnDate, appointmentOccurrences });
  vm.runInContext(
    source.slice(source.indexOf('function dateKey('), source.indexOf('function addDays(')) +
    source.slice(source.indexOf('function appointmentsForMonth('), source.indexOf('function renderAppointments(')),
    context
  );
  const items = [
    { ...allDay, id: 'past', startDate: '2026-11-01', endDate: '2026-11-17' },
    { ...timed, id: 'ended', startDate: '2026-11-18', startTime: '09:00', endDate: '2026-11-18', endTime: '10:00' },
    { ...timed, id: 'ongoing', startDate: '2026-11-18', startTime: '09:00', endDate: '2026-11-18', endTime: '10:01' },
    { ...allDay, id: 'today', startDate: '2026-11-18', endDate: '2026-11-18' },
    { ...timed, id: 'future', startDate: '2026-12-01', endDate: '2026-12-02' },
    { ...timed, id: 'midnight', startDate: '2026-10-31', endDate: '2026-11-01', endTime: '00:00' },
    { ...allDay, id: 'spans', startDate: '2026-10-31', endDate: '2026-11-01' }
  ];
  const now = new Date(2026, 10, 18, 10, 0, 30);
  const ids = result => Array.from(result, item => item.id);
  assert.deepEqual(ids(context.appointmentsForMonth(items, new Date(2026, 10, 1), now)), ['ongoing', 'today', 'future']);
  assert.deepEqual(ids(context.appointmentsForMonth(items, new Date(2026, 9, 1), now)), ['midnight', 'spans']);
  assert.deepEqual(ids(context.appointmentsForMonth(items, new Date(2026, 11, 1), now)), ['future']);
  assert.deepEqual(ids(context.appointmentsForMonth(items, new Date(2026, 8, 1), now)), []);
  const beforeNovember = new Date(2026, 9, 15);
  const november = ids(context.appointmentsForMonth(items, new Date(2026, 10, 1), beforeNovember));
  assert.ok(november.includes('spans'));
  assert.ok(!november.includes('midnight'));
  assert.deepEqual(ids(context.appointmentsForMonth(items, new Date(2026, 10, 1), now, '2026-11-18')), ['ended', 'ongoing', 'today']);
  assert.deepEqual(ids(context.appointmentsForMonth(items, new Date(2026, 10, 1), now, '2026-11-02')), ['past']);
  assert.deepEqual(ids(context.appointmentsForMonth(items, new Date(2026, 10, 1), now, '2026-11-28')), []);
  const series = { ...allDay, id: 'series', recurrence: { frequency: 'weekly', until: '', exceptions: { '2026-11-18': null } } };
  const upcoming = context.appointmentsForMonth([series], new Date(2026, 10, 1), now);
  assert.equal(upcoming.length, 1);
  assert.equal(upcoming[0].startDate, '2026-11-25');
  assert.equal(context.appointmentsForMonth([series], new Date(2026, 10, 1), now, '2026-11-18').length, 0);
  assert.equal(context.appointmentsForMonth([series], new Date(2026, 11, 1), now).length, 5);
  const biweekly = { ...allDay, recurrence: { frequency: 'biweekly', until: '', exceptions: {} } };
  assert.deepEqual(Array.from(context.appointmentsForMonth([biweekly], new Date(2026, 11, 1), now), item => item.startDate),
    ['2026-12-02', '2026-12-16', '2026-12-30']);
  assert.equal(context.appointmentsForMonth([biweekly], new Date(2026, 10, 1), now)[0].startDate, '2026-11-18');
  const lasting = { ...allDay, startDate: '2026-11-16', endDate: '2026-11-19',
    recurrence: { frequency: 'weekly', until: '2026-11-16', exceptions: {} } };
  assert.equal(context.appointmentsForMonth([lasting], new Date(2026, 10, 1), now).length, 1);
  const futureException = { ...allDay, startDate: '2027-01-01', endDate: '2027-01-01' };
  const endedSeries = { ...allDay, startDate: '2026-01-01', endDate: '2026-01-01',
    recurrence: { frequency: 'weekly', until: '2026-02-01', exceptions: { '2026-01-08': futureException } } };
  assert.equal(context.appointmentsForMonth([endedSeries], new Date(2026, 10, 1), now)[0].startDate, '2027-01-01');
});

test('month calendar shows every day with appointment counts and navigates across years', () => {
  const source = readFileSync(require.resolve('../app'), 'utf8');
  let renders = 0;
  let focused = '';
  const context = vm.createContext({
    state: { appointments: [timed, allDay, multi] },
    appointmentMonth: new Date(2026, 10, 1), appointmentCalendarDate: '',
    DAYS: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
    appointmentOnDate, appointmentOccurrences, birthdaysOn: () => [],
    render: () => { renders++; },
    document: { querySelector: selector => ({ focus() { focused = selector; } }) }
  });
  vm.runInContext(
    source.slice(source.indexOf('function escapeHtml('), source.indexOf('function linkifyNoteDescription(')) +
    source.slice(source.indexOf('function dateKey('), source.indexOf('function membersForAssignment(')) +
    source.slice(source.indexOf('function renderAppointmentCalendar('), source.indexOf('function openAppointment(')),
    context
  );
  const html = context.renderAppointmentCalendar();
  assert.match(html, /november 2026/);
  assert.equal((html.match(/data-date=/g) || []).length, 30);
  assert.match(html, /data-date="2026-11-18"[^>]*aria-label="[^"]*: 3 afspraken"/);
  assert.match(html, /data-date="2026-11-19"[^>]*aria-label="[^"]*: 3 afspraken"/);
  assert.match(html, /data-date="2026-11-20"[^>]*aria-label="[^"]*: 1 afspraak"/);
  assert.match(html, /data-date="2026-11-21"[^>]*aria-label="[^"]*: 0 afspraken"/);
  assert.match(html, /data-date="2026-11-21"[^>]*><span class="month-day-number">21<\/span><\/button>/);
  assert.match(html, /data-date="2026-11-18"[^>]*><span class="month-day-number">18<\/span><span class="month-appointment-count" aria-hidden="true">3<\/span>/);
  assert.match(html, /<tbody><tr>(?:<td><\/td>){6}<td><button[^>]*data-date="2026-11-01"/);
  context.appointmentCalendarDate = '2026-11-18';
  assert.match(context.renderAppointmentCalendar(), /class="month-day selected[^"]*"[^>]*data-date="2026-11-18"[^>]*aria-pressed="true"/);
  const current = new Date();
  context.appointmentMonth = new Date(current.getFullYear(), current.getMonth(), 1);
  assert.match(context.renderAppointmentCalendar(), /class="month-day [^"]*today"[^>]*aria-current="date"/);
  context.appointmentMonth = new Date(2026, 11, 1);
  context.changeAppointmentMonth(1);
  assert.equal(context.appointmentCalendarDate, '');
  assert.equal(context.appointmentMonth.getFullYear(), 2027);
  assert.equal(context.appointmentMonth.getMonth(), 0);
  assert.match(focused, /next-appointment-month/);
  context.changeAppointmentMonth(-1);
  assert.equal(context.appointmentMonth.getFullYear(), 2026);
  assert.equal(context.appointmentMonth.getMonth(), 11);
  assert.match(focused, /previous-appointment-month/);
  assert.equal(renders, 2);
  context.appointmentMonth = new Date(2028, 1, 1);
  assert.equal((context.renderAppointmentCalendar().match(/data-date=/g) || []).length, 29);
});

test('dashboard places shared appointments before shared tasks and personal appointments before personal tasks', () => {
  const source = readFileSync(require.resolve('../app'), 'utf8');
  const context = vm.createContext({
    state: { members, appointments: [timed, allDay, multi], customization: { welcomeTitle: 'Welkom', welcomeText: 'Hallo' }, notes: [] },
    selectedDate: '2026-11-18',
    DAYS: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
    appointmentOnDate, appointmentOccurrences, appointmentMemberIds,
    isChild: () => false,
    tasksOn: () => [{ id: 'free', freeToTake: true }, { id: 'personal', memberId: 'm1' }],
    membersOn: task => task.memberId ? members : [],
    birthdaysOn: () => [], isDone: () => false,
    avatar: () => '', speakButton: () => '', memberSpeechText: () => '', taskSpeechTitle: title => title, memberDetails: () => '',
    renderTaskRows: tasks => tasks.map(item => `<div>task-${item.id}</div>`).join(''),
    renderLoadDistribution: () => '', renderNoteCards: () => ''
  });
  vm.runInContext(
    source.slice(source.indexOf('function escapeHtml('), source.indexOf('function linkifyNoteDescription(')) +
    source.slice(source.indexOf('function dateKey('), source.indexOf('function membersForAssignment(')) +
    source.slice(source.indexOf('function appointmentLabel('), source.indexOf('function confirmTaskCompletion(')) +
    source.slice(source.indexOf('function renderDashboard('), source.indexOf('function renderNoteCards(')),
    context
  );
  const html = context.renderDashboard();
  const heading = html.slice(0, html.indexOf('<section class="hero">'));
  assert.match(heading, /data-action="new-task"/);
  assert.match(heading, /data-action="new-appointment"/);
  context.isChild = () => true;
  const childHeading = context.renderDashboard().split('<section class="hero">')[0];
  assert.doesNotMatch(childHeading, /data-action="new-(task|appointment)"/);
  const sharedHeading = html.indexOf('<span>Voor iedereen</span>');
  const sharedAppointment = html.indexOf('<strong>Vrije afspraak</strong>');
  const sharedTask = html.indexOf('task-free');
  const personalHeading = html.indexOf('<span>Mama</span>');
  const personalAppointment = html.indexOf('<strong>Afspraak</strong>');
  const personalTask = html.indexOf('task-personal');
  assert.ok([sharedHeading, sharedAppointment, sharedTask, personalHeading, personalAppointment, personalTask].every(index => index >= 0));
  assert.ok(sharedHeading < sharedAppointment && sharedAppointment < sharedTask && sharedTask < personalHeading &&
    personalHeading < personalAppointment && personalAppointment < personalTask);
  assert.match(html, /class="day-task-member-progress" aria-label="0 taken van 1 taak uitgevoerd">0\/1<\/span>/);
  assert.match(html, /class="appointment-icon" role="img" aria-label="Afspraak"/);
  assert.doesNotMatch(html, /class="appointment-row[^"]*"[^>]*>[^]*?<input[^>]*type="checkbox"/);
  const sharedStart = html.indexOf('<span>Voor iedereen</span>');
  const mamaStart = html.indexOf('<span>Mama</span>');
  const papaStart = html.indexOf('<span>Papa</span>');
  assert.doesNotMatch(html.slice(sharedStart, mamaStart), /<strong>Samen<\/strong>/);
  assert.match(html.slice(mamaStart, papaStart), /<strong>Samen<\/strong>/);
  assert.match(html.slice(papaStart), /<strong>Samen<\/strong>/);
});

test('appointment form creates, edits and deletes while toggling all-day fields', async () => {
  const source = readFileSync(require.resolve('../app'), 'utf8');
  const content = {};
  const modal = { showModal() {}, close() {} };
  const saves = [];
  const makeForm = item => {
    const listeners = {};
    const removeListeners = {};
    const control = value => ({ value, setCustomValidity(message) { this.error = message; }, reportValidity() {} });
    const allDayControl = { checked: item?.allDay || false, addEventListener(type, handler) { listeners[`allDay-${type}`] = handler; } };
    const form = {
      listeners, removeListeners, fields: [{}, {}], selectedMembers: item ? appointmentMemberIds(item) : ['m1', 'm2'],
      elements: {
        title: control(item?.title || 'Nieuwe afspraak'), memberId: control(item?.memberId || ''),
        allDay: allDayControl, startDate: control(item?.startDate || '2026-11-18'),
        endDate: control(item?.endDate || '2026-11-18'),
        startTime: control(item?.startTime || '09:00'), endTime: control(item?.endTime || '10:00'),
        repeat: control(item?.recurrence?.frequency || ''), repeatUntil: control(item?.recurrence?.until || '')
      },
      querySelectorAll: selector => selector === '.appointment-time'
        ? form.fields : form.selectedMembers.map(value => ({ value })),
      querySelector: () => item ? { addEventListener(type, handler) { removeListeners[type] = handler; } } : null,
      addEventListener(type, handler) { listeners[type] = handler; }
    };
    return form;
  };
  const context = vm.createContext({
    state: { members, appointments: [] }, selectedDate: '2026-11-18',
    validAppointments, appointmentMemberIds, appointmentOccurrences, crypto: { randomUUID: () => 'new-id' }, confirm: () => true,
    assignmentChoices: (name, selected) => `<div data-name="${name}">${selected.join(',')}</div>`,
    save: async next => { saves.push(structuredClone(next)); return true; },
    render() {}, showToast() {}, form: makeForm(),
    document: { querySelector(selector) {
      return selector === '#modal-content' ? content : selector === '#appointment-form' ? context.form : modal;
    } }
  });
  vm.runInContext(
    source.slice(source.indexOf('function escapeHtml('), source.indexOf('function linkifyNoteDescription(')) +
    source.slice(source.indexOf('function openAppointment('), source.indexOf('function renderTasks(')), context
  );
  context.openAppointment();
  const { startDate, endDate } = context.form.elements;
  startDate.value = '2026-11-20';
  context.form.listeners.input({ target: startDate });
  assert.equal(endDate.value, '2026-11-20');
  endDate.value = '2026-11-25';
  startDate.value = '2026-11-21';
  context.form.listeners.change({ target: startDate });
  assert.equal(endDate.value, '2026-11-25');
  startDate.value = '2026-11-25';
  context.form.listeners.input({ target: startDate });
  assert.equal(endDate.value, '2026-11-25');
  endDate.value = '';
  context.form.listeners.input({ target: startDate });
  assert.equal(endDate.value, '');
  endDate.value = '2026-11-18';
  context.form.listeners.input({ target: endDate });
  assert.equal(endDate.value, '2026-11-18');
  startDate.value = '2026-11-18';
  assert.equal(context.form.elements.startTime.required, true);
  context.form.elements.allDay.checked = true;
  context.form.listeners['allDay-change']();
  assert.equal(context.form.fields[0].hidden, true);
  assert.equal(context.form.elements.startTime.required, false);
  await context.form.listeners.submit({ preventDefault() {} });
  assert.equal(saves[0].appointments[0].allDay, true);
  assert.equal(saves[0].appointments[0].startTime, '');
  assert.deepEqual(saves[0].appointments[0].memberIds, ['m1', 'm2']);
  context.form = makeForm(context.state.appointments[0]);
  context.openAppointment('new-id');
  context.form.elements.title.value = 'Gewijzigd';
  context.form.selectedMembers = ['m2'];
  await context.form.listeners.submit({ preventDefault() {} });
  assert.equal(saves[1].appointments[0].title, 'Gewijzigd');
  assert.deepEqual(saves[1].appointments[0].memberIds, ['m2']);
  await context.form.removeListeners.click();
  assert.equal(saves[2].appointments.length, 0);
  context.state.appointments = [timed];
  context.form = makeForm(timed);
  context.openAppointment(timed.id);
  assert.match(content.innerHTML, /data-name="appointmentMemberIds">m1/);
  context.form.selectedMembers = ['m1', 'm2'];
  await context.form.listeners.submit({ preventDefault() {} });
  assert.deepEqual(saves[3].appointments[0].memberIds, ['m1', 'm2']);
  assert.equal(Object.hasOwn(saves[3].appointments[0], 'memberId'), false);
  context.form = makeForm(context.state.appointments[0]);
  context.openAppointment(timed.id);
  context.form.selectedMembers = [];
  await context.form.listeners.submit({ preventDefault() {} });
  assert.deepEqual(saves[4].appointments[0].memberIds, []);
  context.form = makeForm();
  context.openAppointment();
  assert.match(content.innerHTML, /value="biweekly"[^>]*>Elke twee weken<\/option>/);
  context.form.elements.repeat.value = 'biweekly';
  context.form.elements.repeatUntil.value = '2026-12-31';
  await context.form.listeners.submit({ preventDefault() {} });
  const series = context.state.appointments.find(item => item.id === 'new-id');
  assert.equal(series.recurrence.frequency, 'biweekly');
  context.openAppointment(series.id, '2026-12-02');
  assert.match(content.innerHTML, /Deze afspraak/);
  assert.match(content.innerHTML, /Hele reeks/);
  const instance = appointmentOccurrences(series, '2026-12-02', '2026-12-02')[0];
  context.form = makeForm(instance);
  context.openAppointment(series.id, '2026-12-02', 'occurrence');
  context.form.elements.title.value = 'Aangepaste afspraak';
  await context.form.listeners.submit({ preventDefault() {} });
  assert.equal(context.state.appointments.find(item => item.id === series.id).recurrence.exceptions['2026-12-02'].title, 'Aangepaste afspraak');
  context.form = makeForm(context.state.appointments.find(item => item.id === series.id));
  context.openAppointment(series.id, '2026-12-02', 'series');
  assert.match(content.innerHTML, /value="biweekly" selected/);
  context.form.elements.title.value = 'Reeks aangepast';
  await context.form.listeners.submit({ preventDefault() {} });
  assert.equal(context.state.appointments.find(item => item.id === series.id).recurrence.exceptions['2026-12-02'].title, 'Aangepaste afspraak');
  context.form = makeForm(instance);
  context.openAppointment(series.id, '2026-12-02', 'occurrence');
  await context.form.removeListeners.click();
  assert.equal(context.state.appointments.find(item => item.id === series.id).recurrence.exceptions['2026-12-02'], null);
});
