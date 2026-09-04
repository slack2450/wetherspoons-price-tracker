'use strict';

import { randomUUID } from 'node:crypto';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { venues } from 'wetherspoons-api';

const region = 'eu-west-2';
const sns = new SNSClient({ region });

interface ScheduleEvent {
  id?: string
  time?: string
}

type Venue = Awaited<ReturnType<typeof venues>>[number];

export interface Dependencies {
  getVenues: () => Promise<Venue[]>
  publish: (message: string) => Promise<void>
}

export interface PublishSummary {
  runId: string
  observedAt: string
  publishedCount: number
}

const defaultDependencies: Dependencies = {
  getVenues: venues,
  publish: async message => {
    await sns.send(new PublishCommand({
      TopicArn: process.env.PUBS_TOPIC_ARN!,
      Message: message,
    }));
  },
};

export const run = async (
  event: ScheduleEvent = {},
  dependencies: Dependencies = defaultDependencies,
): Promise<PublishSummary> => {
  if (event.time !== undefined && Number.isNaN(Date.parse(event.time))) {
    throw new Error(`Schedule event contained an invalid time: ${event.time}`);
  }

  const runId = event.id ?? randomUUID();
  const observedAt = event.time ?? new Date().toISOString();
  const highLevelVenues = (await dependencies.getVenues()).filter(venue => !venue.isClosed);

  if (highLevelVenues.length === 0) {
    throw new Error('Wetherspoons returned zero open pubs');
  }
  if (new Set(highLevelVenues.map(venue => venue.venueRef)).size !== highLevelVenues.length) {
    throw new Error('Wetherspoons returned duplicate open venue references');
  }

  console.log(`RUN_STARTED runId=${runId} observedAt=${observedAt} expected=${highLevelVenues.length}`);

  for (let offset = 0; offset < highLevelVenues.length; offset += 25) {
    const batch = highLevelVenues.slice(offset, offset + 25);
    await Promise.all(batch.map(async venue => {
      console.log(`Submitting ${venue.name} (${venue.id}) for processing`);
      await dependencies.publish(JSON.stringify({ runId, observedAt, venue }));
    }));
  }

  console.log(`RUN_PUBLISHED runId=${runId} count=${highLevelVenues.length}`);
  return { runId, observedAt, publishedCount: highLevelVenues.length };
};

export const handler = (event: ScheduleEvent = {}): Promise<PublishSummary> => run(event);
