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
  app.slice(app.indexOf('function speakButton('), app.indexOf('function mealSpeechText(')),
  context
);

test('speech buttons are shown only for child accounts across all supported actions', () => {
  for (const action of ['speak-task', 'speak-member', 'speak-meal', 'speak-note']) {
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
  for (const action of ['speak-task', 'speak-member', 'speak-meal', 'speak-note']) {
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
