'use strict';

// Create service client module using ES6 syntax.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Create an Amazon DynamoDB service client object.
const ddbClient = new DynamoDBClient({ region: 'eu-west-2' });

import { DynamoDBDocumentClient} from "@aws-sdk/lib-dynamodb";
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

export const handler = async (event: any) => {
    const query = new QueryCommand({
        TableName: 'wetherspoons-drinks',
        IndexName: 'venueId-name-index',
        KeyConditionExpression: '#v = :venueId and #n = :name',
        ExpressionAttributeValues: {
            ':venueId': event.pathParameters.venueId,
            ':name': event.pathParameters.name,
        },
        ExpressionAttributeNames: {
            '#v': 'venueId',
            '#n': 'name',
        }
    });

    const data = await ddbDocClient.send(query);

    return data.Items;
}