'use strict';

import { SQSEvent } from 'aws-lambda';

import axios from 'axios';

axios.defaults.baseURL = 'https://static.wsstack.nn4maws.net';

// Create service client module using ES6 syntax.
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';

// Create an Amazon DynamoDB service client object.
const ddbClient = new DynamoDBClient({ region: 'eu-west-2' });

import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { Menu, Venue } from './types';
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

const date = new Date().setHours(0, 0, 0, 0);

const TableName = 'wetherspoons-pubs';

const beerRegex = /(\d?\.?\d?\d) unit/;
const wineRegex = /(\d?\d?\.?\d?\d%) ABV/;
const volumeRegex = /(\d?\d\d)ml/;

export const handler = async (event: SQSEvent): Promise<void> => {
    for (const record of event.Records) {
        const notification = JSON.parse(record.body);
        const inputData = JSON.parse(notification.Message);

        const {
            data: { menus },
        } : { data: { menus: Menu[] }} = await axios.get(`/content/v8/menus/${inputData.venueId}.json`);

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

                        const beerMatches = product.description.match(beerRegex);
                        const wineMatches = product.description.match(wineRegex);

                        if(beerMatches) {
                            const units = parseFloat(beerMatches[1]);

                            productsInserted.push(product.productId);

                            venue.drinks.push({
                                name: product.eposName,
                                productId: product.productId,
                                price: product.priceValue,
                                units,
                            });
                        } else if (wineMatches) {
                            const descriptionVol = product.description.match(volumeRegex);
                            const percentage = parseFloat(wineMatches[1]);

                            if (descriptionVol) {
                                const units = (percentage * parseFloat(descriptionVol[1])) / 1000;

                                productsInserted.push(product.productId);

                                venue.drinks.push({
                                    name: product.eposName,
                                    productId: product.productId,
                                    price: product.priceValue,
                                    units,
                                })
                            } else {
                                if (product.defaultPortionName) {
                                    const volume = product.defaultPortionName.match(volumeRegex);
                      
                                    if(!volume)
                                        continue;

                                    const units = (percentage * parseFloat(volume[1])) / 1000;

                                    productsInserted.push(product.productId);
                      
                                    venue.drinks.push({
                                        name: product.eposName,
                                        productId: product.productId,
                                        price: product.priceValue,
                                        units,
                                    })
                                  } else {
                                    const volume = 175; // Assume medium glass of wine
                      
                                    const units = (percentage * volume) / 1000;

                                    productsInserted.push(product.productId);
                      
                                    venue.drinks.push({
                                        name: product.eposName,
                                        productId: product.productId,
                                        price: product.priceValue,
                                        units,
                                    })
                                  }
                            }
                        }
                    }
                }
            }
        }

        const command = new PutCommand({ TableName, Item: venue });

        await ddbDocClient.send(command);
    }

    return;
};
