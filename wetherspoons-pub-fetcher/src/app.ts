'use strict';

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const client = new SNSClient({ region: 'eu-west-2' });

import axios from 'axios';

axios.defaults.baseURL = 'https://static.wsstack.nn4maws.net';

export const handler = async () => {
    const { data: { venues } } = await axios.get('/v1/venues/en_gb/venues.json');

    const snsPromises = []

    for (const venue of venues) {

        // Skip closed pubs as their data isn't good
        if (venue.pubIsTempClosed || venue.pubIsClosed) {
            continue;
        }

        const command = new PublishCommand({
            TopicArn: 'arn:aws:sns:eu-west-2:729049610945:wetherspoons-pubs',
            Message: JSON.stringify({
                venueId: venue.venueId,
            }),
        })

        snsPromises.push(client.send(command));
    }

    await Promise.all(snsPromises);
}