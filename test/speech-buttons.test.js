'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const app = readFileSync(require.resolve('../app'), 'utf8');
const context = vm.createContext({ role: 'owner' });
vm.runInContext(
  "const isChild = () => role === 'child';\n" +
  app.slice(app.indexOf('function escapeHtml('), app.indexOf('function capitalizeFirst(')) +
  app.slice(app.indexOf('function speakButton('), app.indexOf('function taskSpeechText(')),
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
