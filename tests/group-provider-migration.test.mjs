import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrateProviderModel } from '../.pi/runtime/group-service.mjs';
import { sharedRoleVersionFromSource, onboardingState } from '../.pi/runtime/group-onboarding.mjs';
import { fixture } from './group-fixture.mjs';

const roles = ['coordinator', 'executor', 'validator'];
function roleSource(root, rolesObject) {
  for (const [role, skill] of [['coordinator', 'coordinate-group'], ['executor', 'execute-group-task'], ['validator', 'review-group-task']]) {
    mkdirSync(join(root, '.pi', 'agents'), { recursive: true });
    mkdirSync(join(root, '.pi', 'skills', skill), { recursive: true });
    writeFileSync(join(root, '.pi', 'agents', `${role}.md`), `${role} stable prompt\n`);
    writeFileSync(join(root, '.pi', 'skills', skill, 'SKILL.md'), `${role} stable skill\n`);
  }
  mkdirSync(join(root, '.pi'), { recursive: true });
  const raw = `${JSON.stringify(rolesObject, null, 2)}\n`;
  writeFileSync(join(root, '.pi', 'roles.json'), raw);
  return raw;
}
function roleConfigs() {
  return Object.fromEntries(roles.map((role, i) => [role, {
    provider: 'old-provider', model: `old-model-${i}`, skill: role === 'coordinator' ? 'coordinate-group' : role === 'executor' ? 'execute-group-task' : 'review-group-task',
    tools: role === 'coordinator' ? ['read', 'team_read', 'team_submit'] : ['read', 'edit', 'team_read', 'team_submit']
  }]));
}
function migrateFixture(f, { targetTransform = config => { for (const role of roles) { config[role].provider = 'new-provider'; config[role].model = 'new-model'; } return config; }, observationTransform = sessions => sessions.map(session => [session.pid, { status: 'stopped' }]) } = {}) {
  const sourceRoot = join(f.root, 'runtime-source'), prior = roleConfigs(), priorRolesSource = roleSource(sourceRoot, prior);
  const target = targetTransform(structuredClone(prior));
  roleSource(sourceRoot, target);
  const lifecycle = onboardingState(f.store, 'sample', 'lead');
  lifecycle.role_version = sharedRoleVersionFromSource(sourceRoot, priorRolesSource);
  f.store.db.prepare('UPDATE group_lifecycle SET data=? WHERE group_id=?').run(JSON.stringify(lifecycle), 'sample');
  const sessions = f.store.sessions('sample');
  for (let index = 0; index < sessions.length; index++) {
    const session = sessions[index]; session.config = prior[session.role]; session.pid = 41000 + index;
    session.process_start_stamp = `old-stamp-${index}`; session.session_path = join(f.root, `${session.role}.jsonl`);
    f.store.db.prepare('UPDATE sessions SET data=? WHERE group_id=? AND role=?').run(JSON.stringify(session), 'sample', session.role);
  }
  const observe = pids => new Map(observationTransform(sessions).map(([pid, value]) => [pid, value]));
  return { sourceRoot, priorRolesSource, prior, target, sessions, observe };
}

test('provider/model migration preserves active work, sessions, onboarding evidence and records verified PID reuse', () => {
  const f = fixture(); try {
    const setup = migrateFixture(f, { observationTransform: sessions => sessions.map((session, index) => [session.pid, index === 1
      ? { status: 'running', stamp: 'new-unrelated-process-stamp' }
      : { status: 'stopped' }]) });
    const peerMessageId = f.store.notice('sample', 'validator', { type: 'message', task_id: 'T1', body: 'Existing independent review request.' });
    const oldLifecycle = onboardingState(f.store, 'sample', 'lead');
    const oldSessions = f.store.sessions('sample');
    const receipt = migrateProviderModel(f.store, 'sample', { priorRolesSource: setup.priorRolesSource, sourceRoot: setup.sourceRoot, observe: setup.observe });
    assert.equal(receipt.kind, 'provider_model_migration');
    assert.equal(receipt.active_task, 'T1');
    assert.equal(receipt.prior_roles_source, setup.priorRolesSource);
    assert.equal(receipt.prior_sessions.length, 3);
    assert.equal(receipt.process_evidence.find(item => item.role === 'executor').result, 'pid_reused_unrelated_process_preserved');
    assert.equal(f.store.group('sample').active_task, 'T1');
    const current = f.store.sessions('sample');
    for (const role of roles) {
      const old = oldSessions.find(item => item.role === role), next = current.find(item => item.role === role);
      assert.equal(next.pid, null); assert.equal(next.launcher_pid, null);
      assert.equal(next.session_id, old.session_id); assert.equal(next.session_path, old.session_path);
      assert.equal(next.config.provider, 'new-provider'); assert.equal(next.config.model, 'new-model');
    }
    const lifecycle = onboardingState(f.store, 'sample', 'lead');
    assert.equal(lifecycle.status, 'ready'); assert.equal(lifecycle.epoch, oldLifecycle.epoch);
    assert.deepEqual(lifecycle.receipts, oldLifecycle.receipts);
    assert.equal(lifecycle.role_version, sharedRoleVersionFromSource(setup.sourceRoot, readFileSync(join(setup.sourceRoot, '.pi/roles.json'), 'utf8')));
    const audit = JSON.parse(f.store.db.prepare('SELECT data FROM provider_model_migrations WHERE id=?').get(receipt.id).data);
    assert.equal(audit.prior_roles_source, setup.priorRolesSource);
    assert.deepEqual(audit.prior_sessions.map(session => session.session_path), oldSessions.map(session => session.session_path));
    assert.equal(f.store.inbox('sample', 'coordinator').some(message => message.data.type === 'provider_model_migrated'), true);
    assert.equal(f.store.inbox('sample', 'validator').some(message => message.data.type === 'provider_model_migrated'), false);
    assert.equal(f.store.inbox('sample', 'validator').some(message => message.id === peerMessageId && message.data.body === 'Existing independent review request.'), true);
    assert.equal(f.store.pending('sample', 'validator').some(message => message.id === peerMessageId), true);
  } finally { f.cleanup(); }
});

test('provider/model migration rejects tool changes and live or unknown process identities without mutation', () => {
  for (const failure of ['tools', 'live', 'unknown']) {
    const f = fixture(); try {
      const setup = migrateFixture(f, {
        targetTransform: config => {
          for (const role of roles) { config[role].provider = 'new-provider'; config[role].model = 'new-model'; }
          if (failure === 'tools') config.executor.tools.push('bash');
          return config;
        },
        observationTransform: sessions => sessions.map((session, index) => [session.pid, failure === 'live' && index === 0
          ? { status: 'running', stamp: session.process_start_stamp }
          : failure === 'unknown' && index === 0 ? { status: 'unknown' } : { status: 'stopped' }])
      });
      const before = f.store.sessions('sample');
      const matcher = failure === 'tools' ? /only provider and model/ : failure === 'live' ? /still running/ : /identity is unknown/;
      assert.throws(() => migrateProviderModel(f.store, 'sample', { priorRolesSource: setup.priorRolesSource, sourceRoot: setup.sourceRoot, observe: setup.observe }), matcher);
      assert.deepEqual(f.store.sessions('sample'), before);
      const table = f.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='provider_model_migrations'").get();
      assert.equal(table ? f.store.db.prepare('SELECT count(*) AS count FROM provider_model_migrations').get().count : 0, 0);
    } finally { f.cleanup(); }
  }
});

test('provider/model migration refuses prompt, skill or group-definition drift', () => {
  for (const drift of ['prompt', 'skill', 'definition']) {
    const f = fixture(); try {
      const setup = migrateFixture(f);
      if (drift === 'prompt') writeFileSync(join(setup.sourceRoot, '.pi', 'agents', 'executor.md'), 'changed prompt\n');
      if (drift === 'skill') writeFileSync(join(setup.sourceRoot, '.pi', 'skills', 'execute-group-task', 'SKILL.md'), 'changed skill\n');
      if (drift === 'definition') {
        const path = join(f.main, 'groups', 'sample', 'group.md');
        writeFileSync(path, readFileSync(path, 'utf8').replace('Responsibilities for sample.', 'Changed responsibilities.'));
      }
      assert.throws(() => migrateProviderModel(f.store, 'sample', { priorRolesSource: setup.priorRolesSource, sourceRoot: setup.sourceRoot, observe: setup.observe }),
        drift === 'definition' ? /current group definition requires completed onboarding/ : /does not reconstruct the recorded role version/);
      assert.equal(f.store.sessions('sample').some(session => session.pid === null), false);
    } finally { f.cleanup(); }
  }
});
