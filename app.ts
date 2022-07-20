'use strict'

import 'dotenv/config'

import logger from './config/winston';
logger.info('🚀 Server is starting...');

import { connect, connection } from 'mongoose';

if (!process.env.MONGO_URL)
    throw new Error('❌ No MongoDB URL specified');

connect(process.env.MONGO_URL);

import axios from 'axios';
import Drink from './models/Drink';

axios.defaults.baseURL = 'https://static.wsstack.nn4maws.net';

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

connection.once('open', async () => {
    logger.info('Opened connection to the database 🎉');

    const date = (new Date()).setHours(0, 0, 0, 0);

    const deleted = await Drink.deleteMany({timestamp: date});

    logger.info(`✅ cleared ${deleted.deletedCount} datapoints for ${date.toLocaleString()}`);

    const { data: { venues } } = await axios.get('/v1/venues/en_gb/venues.json');

    for (const venue of venues) {

        // Skip closed pubs as their data isn't good
        if (venue.pubIsTempClosed || venue.pubIsClosed) {
            logger.info(`🚧 Skipping ${venue.name} as it's closed!`);
            continue;
        }

        let menus: any;
        do {
            try {
                ({ data: { menus } } = await axios.get(`/content/v3/menus/${venue.venueId}.json`));
            } catch {
                logger.warn(`❌ Request failed for ${venue.name} retying in 10 seconds...`);
                await sleep(10 * 1000);
            }
        } while (!menus);

        const productInserts = []

        for (const menu of menus) {
            if (menu.name == 'Drinks') {
                for (const subMenu of menu.subMenu) {
                    for (const productGroup of subMenu.productGroups) {
                        for (const product of productGroup.products) {
                            productInserts.push(Drink.findOneAndUpdate(
                                {
                                    timestamp: date,
                                    name: product.eposName,
                                    venue: {
                                        name: venue.name,
                                        id: venue.venueId,
                                    },
                                },
                                {
                                    price: product.priceValue,
                                },
                                {
                                    upsert: true,
                                    new: true,
                                }
                            ))
                        }
                    }
                }
            }
        }

        await Promise.all(productInserts);
        
        logger.info(`✅ Fetched data for ${venue.name}`);
    }

    logger.info('✅ Finished scraping data! 🎉');
});