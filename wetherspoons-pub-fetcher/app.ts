'use strict';

import AWS from 'aws-sdk';

AWS.config.update({ region: 'eu-west-2' });

const sns = new AWS.SNS({ apiVersion: '2010-03-31' });

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

        const snsPromise = sns.publish({
            TopicArn: 'arn:aws:sns:eu-west-2:729049610945:wetherspoons-pubs',
            Message: JSON.stringify({
                name: venue.name,
                venueId: venue.venueId,
            }),
        }).promise();

        snsPromises.push(snsPromise);
    }

    await Promise.all(snsPromises);
}