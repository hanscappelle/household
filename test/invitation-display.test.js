'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const app = readFileSync(require.resolve('../app'), 'utf8');
const renderFamilySource = app.slice(app.indexOf('function renderFamily()'), app.indexOf('function renderGroceries()'));

function renderFamily({ sent, child = false, demo = false }) {
  const context = vm.createContext({
    state: { members: [], tasks: [] },
    householdInfo: { members: [], invitations: [], canInvite: !child },
    accountEmail: 'owner@example.test',
    demoMode: demo,
    isChild: () => child,
    createdInvitationUrl: 'https://example.test/household/?uitnodiging=test',
    createdInvitationEmail: 'family@example.test',
    createdInvitationEmailSent: sent,
    passwordResetSentEmail: '',
    escapeHtml: value => String(value)
  });
  vm.runInContext(renderFamilySource, context);
  return context.renderFamily();
}

test('invitation page confirms email submission and keeps the shareable link', () => {
  const html = renderFamily({ sent: true });
  assert.match(html, /Uitnodiging versturen/);
  assert.match(html, /aangeboden voor verzending naar family@example\.test/);
  assert.match(html, /https:\/\/example\.test\/household\/\?uitnodiging=test/);
  assert.match(html, /Link kopiëren/);
});

test('invitation page clearly reports delivery failure and offers the link', () => {
  const html = renderFamily({ sent: false });
  assert.match(html, /e-mail kon niet worden verzonden/);
  assert.match(html, /Deel de link hieronder rechtstreeks/);
  assert.match(html, /Link kopiëren/);
});

test('child and demo views do not offer invitation creation', () => {
  assert.doesNotMatch(renderFamily({ sent: true, child: true }), /id="household-invite-form"/);
  assert.doesNotMatch(renderFamily({ sent: true, demo: true }), /id="household-invite-form"/);
});
