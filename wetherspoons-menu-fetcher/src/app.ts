'use strict';

import { SQSEvent } from 'aws-lambda';
import { InfluxDB, Point } from '@influxdata/influxdb-client';

import axios from 'axios';
axios.defaults.baseURL = 'https://static.wsstack.nn4maws.net';

const influxDB = new InfluxDB({ url: process.env.INFLUXDB_URL!, token: process.env.INFLUXDB_API_TOKEN })

import { getTodaysDrinks } from '../../lib/src/wetherspoons';

export const handler = async (event: SQSEvent): Promise<void> => {
  const writeApi = influxDB.getWriteApi(process.env.INFLUXDB_ORG!, process.env.INFLUXDB_BUCKET!)

  for (const record of event.Records) {
    const notification = JSON.parse(record.body);
    const inputData = JSON.parse(notification.Message);

    console.log(`inputData:`);
    console.log(inputData);

    const drinks = await getTodaysDrinks(inputData.venueId, inputData.salesAreaId)

    for (const drink of drinks) {
      const point = new Point('drink')
        .tag('venueId', inputData.venueId)
        .tag('venueName', inputData.venueName)
        .tag('productId', drink.productId.toString())
        .tag('productName', drink.name)
        .floatField('price', drink.price)
        .floatField('units', drink.units)

      writeApi.writePoint(point)
    }
  }

  await writeApi.close();

  return;
};
