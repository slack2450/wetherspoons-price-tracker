'use strict';

import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ReasonPhrases, StatusCodes } from 'http-status-codes';

import { InfluxDB } from '@influxdata/influxdb-client'

const influxDB = new InfluxDB({ url: process.env.INFLUXDB_URL!, token: process.env.INFLUXDB_READ_API_TOKEN! })

const queryApi = influxDB.getQueryApi(process.env.INFLUXDB_ORG!);

console.log('Fetching productIds');
const fetchProductIds = new Promise<Set<string>>((resolve, reject) => {
  const productIds = new Set<string>();

  queryApi.queryRows(`
import "influxdata/influxdb/schema"

schema.tagValues(
  bucket: "raw",
  tag: "productId",
  start: -1d,
  stop: now()
)
`
    , {
      next(row, tableMetadata) {
        const o = tableMetadata.toObject(row);
        productIds.add(o._value)
      },
      error(error: Error) {
        reject(error)
      },
      complete() {
        console.log(`Fetched ${productIds.size} productIds`)
        resolve(productIds)
      }
    });
});

console.log('Fetching venueIds');
const fetchVenueIds = new Promise<Set<string>>((resolve, reject) => {
  const venueIds = new Set<string>();

  queryApi.queryRows(`import "influxdata/influxdb/schema"

schema.tagValues(
  bucket: "raw",
  tag: "venueId",
  start: -1d,
  stop: now()
)
`
    , {
      next(row, tableMetadata) {
        const o = tableMetadata.toObject(row);
        venueIds.add(o._value)
      },
      error(error: Error) {
        reject(error)
      },
      complete() {
        console.log(`Fetched ${venueIds.size} venueIds`)
        resolve(venueIds)
      }
    });
});

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {

  console.log(event);

  if (!event.pathParameters || !event.queryStringParameters) {
    console.error('Missing path or query string parameters');
    return {
      statusCode: StatusCodes.BAD_REQUEST,
      body: ReasonPhrases.BAD_REQUEST
    }
  }

  const pathParameters = {
    venueId: event.pathParameters.venueId,
    productId: event.pathParameters.productId
  }
  if (typeof pathParameters.venueId !== "string" || typeof pathParameters.productId !== "string") {
    console.error('Missing venueId or productId');
    return {
      statusCode: StatusCodes.NOT_FOUND,
      body: ReasonPhrases.NOT_FOUND
    }
  }
  console.log('Path parameters:')
  console.log(pathParameters)

  const queryStringParameters = {
    range: event.queryStringParameters.range
  }
  if (typeof queryStringParameters.range !== "string") {
    console.error('Missing range query string')
    return {
      statusCode: StatusCodes.BAD_REQUEST,
      body: ReasonPhrases.BAD_REQUEST
    }
  }
  console.log('Query string parameters:')
  console.log(queryStringParameters)

  const productIds = await fetchProductIds;
  const venueIds = await fetchVenueIds;

  if (!productIds.has(pathParameters.productId) || !venueIds.has(pathParameters.venueId))
    return {
      statusCode: StatusCodes.NOT_FOUND,
      body: ReasonPhrases.NOT_FOUND
    }

  const timePeriods = new Set(['24h', '7d', '30d', '1y'])
  if (!timePeriods.has(queryStringParameters.range))
    return {
      statusCode: StatusCodes.BAD_REQUEST,
      body: ReasonPhrases.BAD_REQUEST
    }

  const query = `from(bucket: "raw")
  |> range(start: -${queryStringParameters.range}, stop: now())
  |> filter(fn: (r) => r["productId"] == "${pathParameters.productId}")
  |> filter(fn: (r) => r["venueId"] == "${pathParameters.venueId}")
  |> filter(fn: (r) => r["_field"] == "price")
  |> aggregateWindow(every: 60m, fn: mean, createEmpty: false)
  |> drop(columns: ["venueName", "productName", "productId", "venueId","_field", "_measurement", "_start", "_stop"])`

  const results = [];
  for await (const { values, tableMeta } of queryApi.iterateRows(query)) {
    const o = tableMeta.toObject(values);
    results.push({
      time: o._time,
      price: o._value
    })
  }

  return {
    statusCode: StatusCodes.OK,
    body: JSON.stringify(results)
  }
}
