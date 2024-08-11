'use strict';

import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

const client = new SNSClient({ region: 'eu-west-2' });

import { getOpenPubs } from "../../lib/src/wetherspoons";

export const handler = async () => {
    const snsPromises = [];

    const pubs = await getOpenPubs();

    for (const pub of pubs) {

        const command = new PublishCommand({
            TopicArn: 'arn:aws:sns:eu-west-2:729049610945:wetherspoons-pubs',
            Message: JSON.stringify({
                venueId: pub.id,
                salesAreaId: pub.salesArea,
            }),
        })

        snsPromises.push(client.send(command));
    }

    await Promise.all(snsPromises);
}