'use strict';

// Create service client module using ES6 syntax.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Create an Amazon DynamoDB service client object.
const ddbClient = new DynamoDBClient({ region: 'eu-west-2' });

import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const TableName = 'wetherspoons-pubs';

export const handler = async (event: any) => {
    const query = new QueryCommand({
        TableName,
        KeyConditionExpression: '#i = :k',
        ExpressionAttributeValues: {
            ':k': Number(event.pathParameters.venueId),
        },
        ExpressionAttributeNames: {
            '#i': 'venueId',
        }
    });

    const data = await ddbDocClient.send(query);

    return data.Items;
}