'use strict';

// Create service client module using ES6 syntax.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Create an Amazon DynamoDB service client object.
const ddbClient = new DynamoDBClient({ region: 'eu-west-2' });

import { DynamoDBDocumentClient, QueryCommand, QueryCommandInput } from "@aws-sdk/lib-dynamodb";
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const TableName = 'wetherspoons-pubs';

const date: number = new Date().setHours(0, 0, 0, 0);

export const handler = async (event: any) => {

    const params: QueryCommandInput = {
        TableName,
        KeyConditionExpression: '#i = :k',
        ExpressionAttributeValues: {
            ':k': Number(event.pathParameters.venueId),
        },
        ExpressionAttributeNames: {
            '#i': 'venueId',
        }
    }

    const prices: any[] = [];

    do {
        const { Items, LastEvaluatedKey} = await ddbDocClient.send(new QueryCommand(params));
        params.ExclusiveStartKey = LastEvaluatedKey;
        if(Items) {
            prices.push(...Items);
        }
    } while(typeof params.ExclusiveStartKey != "undefined");

    return prices;
}