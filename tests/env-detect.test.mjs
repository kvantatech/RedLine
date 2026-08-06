import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envForUrl } from '../dashboard/public/env-detect.js';

test('envForUrl: staging/test/dev markers → stg', () => {
  for (const u of [
    'https://app.staging.example.com',
    'https://demo-web.staging.example.com/',
    'https://your-app.stg.example.com/api/config',
    'https://test.example.com',
    'https://qa-app.example.com',
    'https://dev.example.com',
    'https://uat.bank.example.com/login',
    'https://shop.preprod.example.com',
  ]) assert.equal(envForUrl(u), 'stg', u);
});

test('envForUrl: localhost / .local → local', () => {
  for (const u of ['http://localhost:4242/', 'http://127.0.0.1:3000', 'http://mybox.local/app'])
    assert.equal(envForUrl(u), 'local', u);
});

test('envForUrl: bare production domains → prod', () => {
  for (const u of [
    'https://www.careers.example.com/us/en/home',
    'https://example.com',
    'https://app.example.com/dashboard',
  ]) assert.equal(envForUrl(u), 'prod', u);
});

test('envForUrl: unparseable/empty → stg (never accidental prod)', () => {
  for (const u of ['', 'not a url', undefined, null]) assert.equal(envForUrl(u), 'stg', String(u));
});

test('envForUrl: does not false-match markers inside a word', () => {
  // "test"/"dev" embedded mid-label must not trip the non-prod regex.
  assert.equal(envForUrl('https://greatestapp.com'), 'prod');
  assert.equal(envForUrl('https://developers-inc.com'), 'prod');
});
