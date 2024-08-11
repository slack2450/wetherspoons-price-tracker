'use strict';

import { SQSEvent } from 'aws-lambda';

import axios from 'axios';

axios.defaults.baseURL = 'https://static.wsstack.nn4maws.net';

// Create service client module using ES6 syntax.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Create an Amazon DynamoDB service client object.
const ddbClient = new DynamoDBClient({ region: 'eu-west-2' });

import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const date = new Date().setHours(0, 0, 0, 0);

const TableName = 'wetherspoons-pubs';

import { getTodaysDrinks } from '../../lib/src/wetherspoons';

export const handler = async (event: SQSEvent): Promise<void> => {
    for (const record of event.Records) {
        const notification = JSON.parse(record.body);
        const inputData = JSON.parse(notification.Message);
 
        const venue = {
            venueId: inputData.venueId,
            date,
            drinks: await getTodaysDrinks(inputData.venueId, inputData.salesAreaId),
        };

        const command = new PutCommand({ TableName, Item: venue });

        await ddbDocClient.send(command);
    }

    return;
};
