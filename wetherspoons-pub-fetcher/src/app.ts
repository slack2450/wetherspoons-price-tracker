'use strict';

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const client = new SNSClient({ region: 'eu-west-2' });

import { venues } from 'wetherspoons-api';

export const handler = async () => {
  const snsPromises = [];

  const highLevelVenues = await venues();

  console.log(`Fetch ${highLevelVenues.length} pubs`);

  for (const venue of highLevelVenues) {
    if (venue.isClosed) continue;

    console.log(`Submitting ${venue.name} (${venue.id}) for processing`)

    const command = new PublishCommand({
      TopicArn: 'arn:aws:sns:eu-west-2:729049610945:wetherspoons-pubs',
      Message: JSON.stringify(venue),
    })

    snsPromises.push(client.send(command));
  }

  await Promise.all(snsPromises);
}
