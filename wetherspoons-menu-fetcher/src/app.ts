'use strict';

import { SQSEvent } from 'aws-lambda';
import { InfluxDB, Point } from '@influxdata/influxdb-client';
import { WetherspoonsAPI } from '../../lib/src/apis/jdw-apps';

import axios from 'axios';
axios.defaults.baseURL = 'https://static.wsstack.nn4maws.net';

const influxDB = new InfluxDB({ url: process.env.INFLUXDB_URL!, token: process.env.INFLUXDB_WRITE_API_TOKEN })

import { getTodaysDrinks } from '../../lib/src/wetherspoons';

export const handler = async (event: SQSEvent): Promise<void> => {
  const writeApi = influxDB.getWriteApi(process.env.INFLUXDB_ORG!, process.env.INFLUXDB_BUCKET!)

  for (const record of event.Records) {
    const notification = JSON.parse(record.body);
    const venue = WetherspoonsAPI.highLevelVenueSchema.parse(notification.Message);

    console.log(`inputData:`);
    console.log(venue);

    try {

      const drinks = await getTodaysDrinks(venue)

      for (const drink of drinks) {
        const point = new Point('drink')
          .tag('venueId', venue.venueRef.toString())
          .tag('venueName', venue.name)
          .tag('productId', drink.productId.toString())
          .tag('productName', drink.name)
          .floatField('price', drink.price)
          .floatField('units', drink.units)

        writeApi.writePoint(point)
      }
    } catch (error) {
      console.log(`Failed to get drinks data for ${venue.name} (${venue.id})`)
    }
  }

  await writeApi.close();

  return;
};
