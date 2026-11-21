'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const app = readFileSync(require.resolve('../app'), 'utf8');
const context = vm.createContext({ role: 'owner', state: { customization: { speakButtonsForAdults: false } } });
vm.runInContext(
  "const isChild = () => role === 'child';\n" +
  app.slice(app.indexOf('function escapeHtml('), app.indexOf('function capitalizeFirst(')) +
  app.slice(app.indexOf('function speakButton('), app.indexOf('function mealSpeechText(')) +
  app.slice(app.indexOf('function appointmentLabel('), app.indexOf('function confirmTaskCompletion(')),
  context
);

test('speech buttons are shown only for child accounts across all supported actions', () => {
  for (const action of ['speak-task', 'speak-member', 'speak-meal', 'speak-appointment', 'speak-note']) {
    for (const role of ['owner', 'parent', '']) {
      context.role = role;
      assert.equal(context.speakButton(action, 'id', 'Tekst', 'Voorlezen'), '');
    }
    context.role = 'child';
    const button = context.speakButton(action, 'id', 'Tekst', 'Voorlezen', 'Voor te lezen', 'Luister');
    assert.match(button, new RegExp(`data-action="${action}"`));
    assert.match(button, /data-speech-text="Voor te lezen"/);
    assert.match(button, /aria-label="Tekst voorlezen"/);
    assert.match(button, /<span>Luister<\/span>/);
  }
});

test('adult speech buttons are enabled by the household setting while child buttons remain enabled by default', () => {
  for (const action of ['speak-task', 'speak-member', 'speak-meal', 'speak-appointment', 'speak-note']) {
    context.role = 'owner';
    assert.equal(context.speakButton(action, 'id', 'Tekst', 'Voorlezen'), '');
    context.state.customization.speakButtonsForAdults = true;
    assert.match(context.speakButton(action, 'id', 'Tekst', 'Voorlezen'), /data-action=/);
    context.state.customization.speakButtonsForAdults = false;
    context.role = 'child';
    assert.match(context.speakButton(action, 'id', 'Tekst', 'Voorlezen'), /data-action=/);
  }
});

test('task speech omits icons from task names without changing the displayed name', () => {
  const speech = context.taskSpeechText({
    title: '🧹 Keuken schoonmaken 🧽',
    important: false
  }, false);
  assert.match(speech, /^Keuken schoonmaken\./);
  assert.doesNotMatch(speech, /🧹|🧽/);
});

test('task speech uses a readable fallback when the task name contains only icons', () => {
  const speech = context.taskSpeechText({ title: '🧹🧽', important: true }, false);
  assert.match(speech, /^Taak\. Belangrijke taak\./);
  assert.doesNotMatch(speech, /🧹|🧽/);
});

test('member speech includes the selected day task totals and completed count', () => {
  context.formatDate = () => 'woensdag 19 november';
  context.isDone = (task, date, memberId) => task.doneFor.includes(memberId);
  const date = new Date('2026-11-19T12:00:00');
  const member = { id: 'm1', name: 'Sanne' };
  const tasks = [
    { doneFor: ['m1'] },
    { doneFor: [] },
    { doneFor: ['m2'] }
  ];
  assert.equal(
    context.memberSpeechText(member, tasks, date),
    'Sanne. Op woensdag 19 november: 1 taak van 3 taken uitgevoerd.'
  );
  assert.equal(
    context.memberSpeechText(member, [{ doneFor: ['m1'] }], date),
    'Sanne. Op woensdag 19 november: 1 taak van 1 taak uitgevoerd.'
  );
  assert.equal(
    context.memberSpeechText(member, [], date),
    'Sanne. Op woensdag 19 november: 0 taken van 0 taken uitgevoerd.'
  );
});

test('child appointment rows have a speech button that omits pictograms from the spoken text', () => {
  context.role = 'child';
  context.formatDate = () => '19 november 2026';
  context.parseDate = value => new Date(`${value}T12:00:00`);
  const html = context.renderAppointmentRows([{
    id: 'a1',
    title: '🎂 Verjaardag 🥳',
    allDay: true,
    startDate: '2026-11-19',
    endDate: '2026-11-19'
  }]);

  assert.match(html, /data-action="speak-appointment"/);
  assert.match(html, /aria-label="🎂 Verjaardag 🥳 voorlezen"/);
  assert.match(html, /data-speech-text="Verjaardag\. 19 november 2026 · Hele dag\."/);
  assert.doesNotMatch(html.match(/data-speech-text="([^"]*)"/)[1], /🎂|🥳/);
});
