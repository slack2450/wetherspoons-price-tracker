'use strict';

import { InfluxDB, WriteApi } from '@influxdata/influxdb-client';
import { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';
import { getDrinks } from 'wetherspoons-api';
import { PrepareDependencies, prepareRecord } from './menu-record';
const SERVER_UPSTREAM_DEADLINE_MS = 25_000;

export interface Dependencies extends PrepareDependencies {
  createWriteApi: () => Pick<WriteApi, 'writePoint' | 'close'>
}

const defaultDependencies: Dependencies = {
  getDrinks: venue => getDrinks(venue, { timeoutMs: SERVER_UPSTREAM_DEADLINE_MS }),
  createWriteApi: () => new InfluxDB({
    url: process.env.INFLUXDB_URL!,
    token: process.env.INFLUXDB_WRITE_API_TOKEN!,
    timeout: 30000,
  }).getWriteApi(
      process.env.INFLUXDB_ORG!,
      process.env.INFLUXDB_BUCKET!,
      'ms',
      {
        batchSize: 1000,
        flushInterval: 1000,
        maxRetries: 2,
        maxRetryTime: 60000,
        minRetryDelay: 1000,
        maxRetryDelay: 15000,
      },
    ),
};

export async function processRecord(
  record: SQSRecord,
  dependencies: Dependencies = defaultDependencies,
): Promise<void> {
  const prepared = await prepareRecord(record, dependencies);
  if (prepared.kind === 'unavailable') {
    console.log(prepared.logMessage);
    return;
  }

  const writeApi = dependencies.createWriteApi();
  prepared.points.forEach(point => writeApi.writePoint(point));
  await writeApi.close();
  console.log(prepared.logMessage);
}

export async function handle(
  event: SQSEvent,
  dependencies: Dependencies = defaultDependencies,
): Promise<SQSBatchResponse> {
  const results = await Promise.allSettled(
    event.Records.map(record => prepareRecord(record, dependencies)),
  );

  const writes = results.flatMap(result => (
    result.status === 'fulfilled' && result.value.kind === 'write'
      ? [result.value]
      : []
  ));

  let writeFailure: { error: unknown } | undefined;
  if (writes.length > 0) {
    try {
      // One writer per SQS batch prevents a five-record batch from opening five
      // simultaneous Influx flushes. The timestamp makes a whole-batch retry
      // idempotent if Influx accepted the points but the acknowledgement failed.
      const writeApi = dependencies.createWriteApi();
      writes.forEach(prepared => {
        prepared.points.forEach(point => writeApi.writePoint(point));
      });
      await writeApi.close();
    } catch (error) {
      writeFailure = { error };
    }
  }

  const batchItemFailures: SQSBatchItemFailure[] = [];
  results.forEach((result, index) => {
    const error = result.status === 'rejected'
      ? result.reason
      : result.value.kind === 'write'
        ? writeFailure?.error
        : undefined;
    const failed = result.status === 'rejected'
      || (result.status === 'fulfilled'
        && result.value.kind === 'write'
        && writeFailure !== undefined);
    if (!failed) {
      if (result.status === 'fulfilled') console.log(result.value.logMessage);
      return;
    }
    const record = event.Records[index];
    if (!record) return;
    const receiveCount = Number(record.attributes.ApproximateReceiveCount ?? 1);
    const maxReceiveCount = Number(process.env.MAX_RECEIVE_COUNT ?? 5);
    if (receiveCount >= maxReceiveCount) {
      console.error(
        `MENU_RECORD_FAILED messageId=${record.messageId} attempts=${receiveCount}`,
        error,
      );
    } else {
      console.warn(
        `MENU_RECORD_RETRY messageId=${record.messageId} attempt=${receiveCount}/${maxReceiveCount}`,
        error,
      );
    }
    batchItemFailures.push({ itemIdentifier: record.messageId });
  });

  return { batchItemFailures };
}

export const handler = (event: SQSEvent): Promise<SQSBatchResponse> => handle(event);
