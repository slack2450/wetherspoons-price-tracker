'use strict';

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const client = new SNSClient({ region: 'eu-west-2' });

import { WetherspoonsAPI } from "../../lib/src/apis/jdw-apps";

export const handler = async () => {
  const snsPromises = [];

  const venues = await WetherspoonsAPI.venues();

  for (const venue of venues) {
    if (venue.isClosed) continue;

    const command = new PublishCommand({
      TopicArn: 'arn:aws:sns:eu-west-2:729049610945:wetherspoons-pubs',
      Message: JSON.stringify(venue),
    })

    snsPromises.push(client.send(command));
  }

  await Promise.all(snsPromises);
}
