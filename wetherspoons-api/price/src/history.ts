import { InfluxDB } from '@influxdata/influxdb-client';
import type { PriceRange } from './request';

export type PricePoint = { time: string, price: number };

export interface HistoryReader {
  read(venueId: string, productId: string, range: PriceRange): Promise<PricePoint[]>
}

export function buildPriceQuery(bucket: string, venueId: string, productId: string, range: PriceRange): string {
  return `from(bucket: ${JSON.stringify(bucket)})
  |> range(start: -${range}, stop: now())
  |> filter(fn: (r) => r["_measurement"] == "drink")
  |> filter(fn: (r) => r["productId"] == ${JSON.stringify(productId)})
  |> filter(fn: (r) => r["venueId"] == ${JSON.stringify(venueId)})
  |> filter(fn: (r) => r["_field"] == "price")
  |> keep(columns: ["_time", "_value"])`;
}

export function latestPerHour(points: PricePoint[]): PricePoint[] {
  const hourly = new Map<number, PricePoint>();
  for (const point of points) {
    const timestamp = Date.parse(point.time);
    if (!Number.isFinite(timestamp)) continue;
    const hour = Math.floor(timestamp / 3_600_000);
    const current = hourly.get(hour);
    if (!current || timestamp >= Date.parse(current.time)) hourly.set(hour, point);
  }
  return [...hourly.values()].sort((left, right) => left.time.localeCompare(right.time));
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
      // InfluxDB 2.7.12 can panic when aggregateWindow(last) is applied after
      // grouping old and new tag layouts. Collapse the already-filtered result
      // here instead, retaining the exact final observed price in each hour.
      return latestPerHour(points);
    },
  };
}
