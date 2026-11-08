import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePlan } from './monitoring-plan.mjs';

const plan = (address, actions, before = {}, after = {}) => ({ resource_changes: [{ address, change: { actions, before, after } }] });
const collector = 'module.wetherspoons_menu_fetcher.aws_lambda_function.wetherspoons_menu_fetcher';
const publisher = 'module.wetherspoons_pub_fetcher.aws_lambda_function.wetherspoons_pub_fetcher';

test('allows collector code and monitor creation', () => {
  assert.equal(validatePlan(plan(collector, ['update'],
    { source_code_hash: 'old', source_code_size: 100, last_modified: 'before' },
    { source_code_hash: 'new' }), 'collector').length, 1);
  assert.equal(validatePlan(plan('aws_lambda_function.pub_failure_monitor', ['create']), 'monitor').length, 1);
});
test('rejects queue changes and deletes even when targeted through dependencies', () => {
  assert.throws(() => validatePlan(plan('aws_sqs_queue.wetherspoons_queue', ['update']), 'collector'));
  assert.throws(() => validatePlan(plan('aws_lambda_function.pub_failure_monitor', ['delete', 'create']), 'monitor'));
});
test('allows publisher code updates but rejects creating or replacing it', () => {
  assert.equal(validatePlan(plan(publisher, ['update'], { source_code_hash: 'old' }, { source_code_hash: 'new' }), 'collector').length, 1);
  assert.throws(() => validatePlan(plan(publisher, ['create']), 'collector'));
  assert.throws(() => validatePlan(plan(publisher, ['delete', 'create']), 'collector'));
});
test('rejects changing either fetcher runtime, credentials or concurrency', () => {
  for (const address of [collector, publisher]) {
    for (const key of ['runtime', 'environment', 'reserved_concurrent_executions']) {
      assert.throws(() => validatePlan(plan(address, ['update'], { [key]: 'old' }, { [key]: 'new' }), 'collector'));
    }
  }
});
test('permits read-only dependencies but rejects changes from the other phase', () => {
  assert.deepEqual(validatePlan(plan('aws_sqs_queue.wetherspoons_queue', ['no-op']), 'collector'), []);
  assert.throws(() => validatePlan(plan(collector, ['update']), 'monitor'));
  assert.throws(() => validatePlan(plan(publisher, ['update']), 'monitor'));
  assert.throws(() => validatePlan(plan('module.wetherspoons_pub_fetcher.aws_scheduler_schedule.operational_hours', ['update']), 'collector'));
});
