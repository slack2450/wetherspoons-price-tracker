'use strict';

// Create service client module using ES6 syntax.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Create an Amazon DynamoDB service client object.
const ddbClient = new DynamoDBClient({ region: 'eu-west-2' });

import { DynamoDBDocumentClient, ScanCommand, ScanCommandInput } from "@aws-sdk/lib-dynamodb";
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const TableName = 'wetherspoons-pub-rankings';

export const handler = async () => {
    const params: ScanCommandInput = {
        TableName
    }

    const rankings: any[] = [];

    do {
        const { Items, LastEvaluatedKey} = await ddbDocClient.send(new ScanCommand(params));
        params.ExclusiveStartKey = LastEvaluatedKey;
        if(Items) {
            rankings.push(...Items);
        }
    } while(typeof params.ExclusiveStartKey != "undefined");

    return rankings;
}