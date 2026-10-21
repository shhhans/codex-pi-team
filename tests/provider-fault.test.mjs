import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProviderFault, assertProviderResumeAllowed } from '../.pi/runtime/provider-fault.mjs';

test('classifies explicit account quota and normalizes reset time to UTC', () => {
  const fault = classifyProviderFault('{"status":429,"message":"AccountQuotaExceeded: reset at 2026-10-21 14:07:48 +0800 CST"}', {
    provider: 'example', model: 'model-x', now: '2026-10-21T00:00:00Z',
  });
  assert.equal(fault.code, 'account_quota_exceeded');
  assert.equal(fault.reset_at, '2026-10-21T06:07:48.000Z');
  assert.deepEqual(fault.time, { local: '2026-10-21 14:07:48', offset: '+08:00', zone: 'CST' });
  assert.equal(fault.provider, 'example');
  assert.equal(fault.model, 'model-x');
});

test('does not infer quota from an ordinary 429 and handles missing reset time', () => {
  assert.equal(classifyProviderFault('HTTP 429 Too Many Requests').code, null);
  const fault = classifyProviderFault('AccountQuotaExceeded: retry later');
  assert.equal(fault.code, 'account_quota_exceeded');
  assert.equal(fault.reset_at, null);
});

test('does not guess the timezone of an ambiguous reset or retain raw request metadata', () => {
  const fault = classifyProviderFault('AccountQuotaExceeded: reset at 2026-10-21 14:07:48 CST. Request id: sensitive-value');
  assert.equal(fault.reset_at, null);
  assert.doesNotMatch(JSON.stringify(fault), /sensitive-value|Request id/);
  assert.equal(classifyProviderFault('AccountQuotaExceeded: reset at 2026-10-21 06:07:48 UTC').reset_at, '2026-10-21T06:07:48.000Z');
});

test('blocks only while a known quota reset remains in the future; force overrides', () => {
  const session = { provider_fault: { code: 'account_quota_exceeded', reset_at: '2026-10-21T06:07:48.000Z' } };
  assert.throws(() => assertProviderResumeAllowed(session, { now: '2026-10-21T06:00:00Z' }), /2026-10-21T06:07:48/);
  assert.equal(assertProviderResumeAllowed(session, { now: '2026-10-21T06:07:48Z' }), true);
  assert.equal(assertProviderResumeAllowed(session, { now: '2026-10-21T06:00:00Z', force: true }), true);
  assert.equal(assertProviderResumeAllowed({ provider_fault: { code: 'account_quota_exceeded', reset_at: null } }), true);
  assert.equal(assertProviderResumeAllowed({ provider_fault: { code: 'other', reset_at: '2099-01-01T00:00:00Z' } }), true);
});
