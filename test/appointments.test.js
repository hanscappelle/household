'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { validAppointments, appointmentMemberIds, removeAppointmentMember, appointmentOnDate, mergeHouseholdState } = require('../seed');
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
    isChild: () => false, renderAppointmentRows: items => `<strong>${items[0].title}</strong>`
  });
  vm.runInContext(
    source.slice(source.indexOf('function escapeHtml('), source.indexOf('function linkifyNoteDescription(')) +
    source.slice(source.indexOf('function renderAppointments('), source.indexOf('function openAppointment(')),
    context
  );
  const html = context.renderAppointments();
  assert.match(html, /<strong>Samen<\/strong><small>Mama, Papa<\/small>/);
  assert.match(html, /<strong>Vrije afspraak<\/strong><small>Voor iedereen<\/small>/);
  assert.match(html, /<strong>Afspraak<\/strong><small>Mama<\/small>/);
});

test('dashboard places shared appointments before shared tasks and personal appointments before personal tasks', () => {
  const source = readFileSync(require.resolve('../app'), 'utf8');
  const context = vm.createContext({
    state: { members, appointments: [timed, allDay, multi], customization: { welcomeTitle: 'Welkom', welcomeText: 'Hallo' }, notes: [] },
    selectedDate: '2026-11-18',
    DAYS: ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'],
    appointmentOnDate, appointmentMemberIds,
    isChild: () => false,
    tasksOn: () => [{ id: 'free', freeToTake: true }, { id: 'personal', memberId: 'm1' }],
    membersOn: task => task.memberId ? members : [],
    birthdaysOn: () => [], isDone: () => false,
    avatar: () => '', speakButton: () => '', memberDetails: () => '',
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
  const sharedHeading = html.indexOf('<span>Voor iedereen</span>');
  const sharedAppointment = html.indexOf('<strong>Vrije afspraak</strong>');
  const sharedTask = html.indexOf('task-free');
  const personalHeading = html.indexOf('<span>Mama</span>');
  const personalAppointment = html.indexOf('<strong>Afspraak</strong>');
  const personalTask = html.indexOf('task-personal');
  assert.ok([sharedHeading, sharedAppointment, sharedTask, personalHeading, personalAppointment, personalTask].every(index => index >= 0));
  assert.ok(sharedHeading < sharedAppointment && sharedAppointment < sharedTask && sharedTask < personalHeading &&
    personalHeading < personalAppointment && personalAppointment < personalTask);
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
        startTime: control(item?.startTime || '09:00'), endTime: control(item?.endTime || '10:00')
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
    validAppointments, appointmentMemberIds, crypto: { randomUUID: () => 'new-id' }, confirm: () => true,
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
});
