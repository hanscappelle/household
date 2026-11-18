'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');

const app = readFileSync(require.resolve('../app'), 'utf8');
const context = vm.createContext({});
vm.runInContext(
  app.slice(app.indexOf('function escapeHtml('), app.indexOf('function capitalizeFirst(')),
  context
);

test('note descriptions render HTTP and www URLs as safe clickable links', () => {
  const html = context.linkifyNoteDescription(
    'Bekijk https://example.com/pad?a=1&b=2.\nOf www.example.org'
  );

  assert.match(html, /href="https:\/\/example\.com\/pad\?a=1&amp;b=2"/);
  assert.match(html, /<a href="https:\/\/example\.com\/pad\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">https:\/\/example\.com\/pad\?a=1&amp;b=2<\/a>\./);
  assert.match(html, /<br>Of <a href="https:\/\/www\.example\.org" target="_blank" rel="noopener noreferrer">www\.example\.org<\/a>/);
});

test('note descriptions escape markup and do not link non-HTTP schemes', () => {
  const html = context.linkifyNoteDescription('<img src=x> javascript:alert(1)');

  assert.equal(html, '&lt;img src=x&gt; javascript:alert(1)');
  assert.doesNotMatch(html, /<a\b/);
});
