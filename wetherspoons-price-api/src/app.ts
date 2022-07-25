'use strict';

// Create service client module using ES6 syntax.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Create an Amazon DynamoDB service client object.
const ddbClient = new DynamoDBClient({ region: 'eu-west-2' });

import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

export const handler = async (event: any) => {
    const query = new QueryCommand({
        TableName: 'wetherspoons-drinks',
        IndexName: 'venueIdProductId-index',
        KeyConditionExpression: '#i = :k',
        ExpressionAttributeValues: {
            ':k': `${event.pathParameters.venueId}-${event.pathParameters.productId}`,
        },
        ExpressionAttributeNames: {
            '#i': 'venueIdProductId',
        }
    });

    const data = await ddbDocClient.send(query);

    return data.Items;
}