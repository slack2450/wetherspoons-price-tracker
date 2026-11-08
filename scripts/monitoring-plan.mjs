import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const targets = {
  monitor: [
    'aws_iam_role.pub_failure_monitor',
    'aws_iam_role_policy.pub_failure_monitor',
    'aws_cloudwatch_log_group.pub_failure_monitor',
    'aws_lambda_function.pub_failure_monitor',
    'aws_cloudwatch_event_rule.pub_failure_monitor',
    'aws_lambda_permission.pub_failure_monitor',
    'aws_cloudwatch_event_target.pub_failure_monitor',
    'aws_cloudwatch_metric_alarm.recurring_pub_failures',
    'aws_cloudwatch_metric_alarm.unidentified_record_failures',
    'aws_cloudwatch_metric_alarm.pub_failure_monitor_errors',
    'aws_cloudwatch_metric_alarm.pub_failure_monitor_delivery',
  ],
  collector: [
    'aws_cloudwatch_metric_alarm.dead_letter_queue_not_empty',
    'aws_cloudwatch_metric_alarm.source_queue_too_old',
    'module.wetherspoons_menu_fetcher.aws_cloudwatch_metric_alarm.menu_record_failures',
    'module.wetherspoons_menu_fetcher.aws_lambda_function.wetherspoons_menu_fetcher',
    'module.wetherspoons_pub_fetcher.aws_lambda_function.wetherspoons_pub_fetcher',
  ],
};

export function validatePlan(plan, phase) {
  if (!targets[phase]) throw new Error('Unknown monitoring deployment phase');
  const changes = [];
  for (const resource of plan.resource_changes ?? []) {
    const { actions, before, after } = resource.change;
    if (actions.every(action => ['no-op', 'read'].includes(action))) continue;
    const allowed = targets[phase].some(address => resource.address === address || resource.address.startsWith(`${address}[`));
    if (!allowed || actions.includes('delete')) throw new Error(`Out-of-scope/destructive change: ${resource.address}`);
    if (phase === 'collector' && actions.join(',') !== 'update') throw new Error(`Expected an existing resource: ${resource.address}`);
    if (resource.address.endsWith('aws_lambda_function.wetherspoons_menu_fetcher')
      || resource.address.endsWith('aws_lambda_function.wetherspoons_pub_fetcher')) {
      // Compatible library/code updates only: preserve environment, concurrency,
      // runtime, permissions, queues and schedules for both fetchers.
      const codeFields = new Set([
        'source_code_hash', 'code_sha256', 'source_code_size', 'last_modified',
        'version', 'qualified_arn', 'qualified_invoke_arn', 'signing_job_arn', 'signing_profile_version_arn',
      ]);
      for (const key of new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])) {
        if (!codeFields.has(key) && JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) {
          throw new Error(`Unexpected collector configuration change: ${key}`);
        }
      }
    }
    changes.push({ address: resource.address, actions });
  }
  return changes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [phase, planFile] = process.argv.slice(2);
  if (!targets[phase]) throw new Error('Expected monitor or collector phase');
  if (!planFile) console.log(targets[phase].map(address => `-target=${address}`).join('\n'));
  else console.log(JSON.stringify(validatePlan(JSON.parse(readFileSync(planFile, 'utf8')), phase), null, 2));
}
