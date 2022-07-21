import { SNSEvent } from 'aws-lambda';

import axios from 'axios';

axios.defaults.baseURL = 'https://static.wsstack.nn4maws.net';

import { v4 as uuidv4 } from 'uuid';

import AWS from 'aws-sdk';

const dynamodb = new AWS.DynamoDB({ apiVersion: '2012-08-10' });

const date = (new Date()).setHours(0, 0, 0, 0);

export const handler = async (event: SNSEvent): Promise<void> => {
    const message = event.Records[0].Sns.Message;
    const venue = JSON.parse(message);


    const { data: { menus } } = await axios.get(`/content/v3/menus/${venue.venueId}.json`);

    const productsInserted: string [] = [];
    const productInsertPromises: Promise<any>[] = [];

    for (const menu of menus) {
        if (menu.name == 'Drinks') {
            for (const subMenu of menu.subMenu) {
                for (const productGroup of subMenu.productGroups) {
                    for (const product of productGroup.products) {
                        if (productsInserted.indexOf(product.eposName) > -1)
                            continue;

                        productsInserted.push(product.eposName);

                        productInsertPromises.push(
                            dynamodb.putItem({
                                TableName: 'wetherspoons-drinks',
                                Item:
                                {
                                    id: {
                                        S: uuidv4(),
                                    },
                                    timestamp: {
                                        N: date.toString(),
                                    },
                                    name: {
                                        S: product.eposName,
                                    },
                                    venueName: {
                                        S: venue.name,
                                    },
                                    venueId: {
                                        S: venue.venueId.toString(),
                                    },
                                    price: {
                                        N: product.priceValue.toString(),
                                    },
                                },

                            }).promise()
                        );

                    }
                }
            }
        }
    }

    await Promise.all(productInsertPromises);

    return;
}