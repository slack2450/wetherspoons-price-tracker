'use strict';

import { SQSEvent } from 'aws-lambda';

import axios from 'axios';

axios.defaults.baseURL = 'https://static.wsstack.nn4maws.net';

import { v4 as uuidv4 } from 'uuid';

// Create service client module using ES6 syntax.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Create an Amazon DynamoDB service client object.
const ddbClient = new DynamoDBClient({ region: 'eu-west-2' });

import { DynamoDBDocumentClient, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const date = (new Date()).setHours(0, 0, 0, 0);

export const handler = async (event: SQSEvent): Promise<void> => {

    for (const record of event.Records) {

        const notification = JSON.parse(record.body);

        const venue = JSON.parse(notification.Message);

        const { data: { menus } } = await axios.get(`/content/v3/menus/${venue.venueId}.json`);

        const productsInserted: string[] = [];
        const putRequests: any[] = [];

        for (const menu of menus) {
            if (menu.name != 'Drinks')
                continue;

            for (const subMenu of menu.subMenu) {
                for (const productGroup of subMenu.productGroups) {
                    for (const product of productGroup.products) {
                        if (productsInserted.indexOf(product.productId) > -1)
                            continue;

                        productsInserted.push(product.productId);

                        putRequests.push({
                            PutRequest: {
                                Item: {
                                    id: uuidv4(),
                                    venueIdProductId: `${venue.venueId}-${product.productId}`,
                                    timestamp: date,
                                    name: product.eposName,
                                    venueId: venue.venueId,
                                    productId: product.productId,
                                    price: product.priceValue,
                                }
                            }
                        });
                    }
                }
            }
        }

        // Split PutRequests into batches of 25 as that's the DynamoDB max size
        const maxDynamoDBBatchSize = 25
        const commands: BatchWriteCommand[] = [];
        for (let i = 0; i < putRequests.length; i += maxDynamoDBBatchSize) {
            const chunk = putRequests.slice(i, i + maxDynamoDBBatchSize);

            commands.push(new BatchWriteCommand({
                RequestItems: {
                    'wetherspoons-drinks': chunk
                }
            }));
        }

        console.log(`Split ${putRequests.length} put requests into ${commands.length} commands`);

        const commandExecutions: Promise<any>[] = [];
        for(const command of commands as any[]) {
            console.log(`Sending batch of ${command.input.RequestItems['wetherspoons-drinks'].length}`);

            commandExecutions.push(ddbDocClient.send(command));
        }

        await Promise.all(commandExecutions);
    }

    return;
}