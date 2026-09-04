import { InfluxDB } from '@influxdata/influxdb-client';
import type { PriceRange } from './request';

export type PricePoint = { time: string, price: number };

export interface HistoryReader {
  read(venueId: string, productId: string, range: PriceRange): Promise<PricePoint[]>
}

export function buildPriceQuery(bucket: string, venueId: string, productId: string, range: PriceRange): string {
  return `from(bucket: ${JSON.stringify(bucket)})
  |> range(start: -${range}, stop: now())
  |> filter(fn: (r) => r["productId"] == ${JSON.stringify(productId)})
  |> filter(fn: (r) => r["venueId"] == ${JSON.stringify(venueId)})
  |> filter(fn: (r) => r["_field"] == "price")
  |> group(columns: [])
  |> aggregateWindow(every: 60m, fn: last, createEmpty: false)
  |> keep(columns: ["_time", "_value"])
  |> sort(columns: ["_time"])`;
}

export function createHistoryReader(): HistoryReader {
  const influx = new InfluxDB({
    url: process.env.INFLUXDB_URL!, token: process.env.INFLUXDB_READ_API_TOKEN!, timeout: 15_000,
  });
  const queryApi = influx.getQueryApi(process.env.INFLUXDB_ORG!);
  const bucket = process.env.INFLUXDB_BUCKET!;
  return {
    async read(venueId, productId, range) {
      const points: PricePoint[] = [];
      for await (const { values, tableMeta } of queryApi.iterateRows(
        buildPriceQuery(bucket, venueId, productId, range),
      )) {
        const row = tableMeta.toObject(values);
        if (typeof row._time === 'string' && typeof row._value === 'number') {
          points.push({ time: row._time, price: row._value });
        }
      }
      return points;
    },
  };
}
