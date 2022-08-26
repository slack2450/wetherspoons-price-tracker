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

interface Drink {
    name: string;
    productId: number;
    price: number;
    units: number;
}

interface Venue {
    venueId: number;
    date: number;
    drinks: Drink[];
}

export const handler = async (event: SQSEvent): Promise<void> => {
    for (const record of event.Records) {
        const notification = JSON.parse(record.body);
        const inputData = JSON.parse(notification.Message);

        const {
            data: { menus },
        } = await axios.get(`/content/v3/menus/${inputData.venueId}.json`);

        const productsInserted: number[] = [];

        const venue: Venue = {
            venueId: inputData.venueId,
            date,
            drinks: [],
        };

        for (const menu of menus) {
            if (menu.name != 'Drinks') continue;

            for (const subMenu of menu.subMenu) {
                for (const productGroup of subMenu.productGroups) {
                    for (const product of productGroup.products) {
                        if (productsInserted.indexOf(product.productId) > -1)
                            continue;

                        const regex = /ABV, (...) unit/;
                        const matches = product.description.matches(regex);
                        const units = parseFloat(matches[1]);

                        productsInserted.push(product.productId);

                        venue.drinks.push({
                            name: product.eposName,
                            productId: product.productId,
                            price: product.priceValue,
                            units,
                        });
                    }
                }
            }
        }

        const command = new PutCommand({ TableName, Item: venue });

        await ddbDocClient.send(command);
    }

    return;
};
