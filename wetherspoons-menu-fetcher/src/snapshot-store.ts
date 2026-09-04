import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { DrinksResult } from 'wetherspoons-api';

export interface MenuSnapshot {
  observedAt: string
  venueId: string
  venueName: string
  result: DrinksResult
}

export type SendS3 = (command: GetObjectCommand | PutObjectCommand) => Promise<unknown>;

function key(runId: string, venueId: string): string {
  return `runs/${encodeURIComponent(runId)}/venues/${encodeURIComponent(venueId)}.json`;
}

function isMissing(error: unknown): boolean {
  const name = (error as { name?: string }).name;
  return name === 'NoSuchKey' || name === 'NotFound';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseSnapshot(value: unknown): MenuSnapshot {
  if (!isRecord(value)
    || typeof value.observedAt !== 'string'
    || Number.isNaN(Date.parse(value.observedAt))
    || typeof value.venueId !== 'string'
    || !/^\d{1,10}$/.test(value.venueId)
    || typeof value.venueName !== 'string'
    || value.venueName.length === 0
    || !isRecord(value.result)
    || !Array.isArray(value.result.drinks)) {
    throw new Error('Snapshot has invalid canonical identity or result data');
  }

  const result = value.result;
  if (result.status !== 'available' && result.status !== 'unavailable') {
    throw new Error('Snapshot has an invalid menu status');
  }
  const drinks = result.drinks as unknown[];
  for (const drink of drinks) {
    if (!isRecord(drink)
      || typeof drink.name !== 'string'
      || drink.name.length === 0
      || typeof drink.productId !== 'number'
      || !Number.isSafeInteger(drink.productId)
      || drink.productId <= 0
      || typeof drink.price !== 'number'
      || !Number.isFinite(drink.price)
      || typeof drink.units !== 'number'
      || !Number.isFinite(drink.units)) {
      throw new Error('Snapshot contains invalid Influx identity or field data');
    }
  }
  return value as unknown as MenuSnapshot;
}

export async function loadSnapshotWith(
  send: SendS3,
  bucket: string,
  runId: string,
  venueId: string,
): Promise<MenuSnapshot | undefined> {
  try {
    const response = await send(new GetObjectCommand({ Bucket: bucket, Key: key(runId, venueId) })) as {
      Body?: { transformToString(): Promise<string> }
    };
    if (!response.Body) throw new Error('Snapshot object had no body');
    return parseSnapshot(JSON.parse(await response.Body.transformToString()) as unknown);
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export async function saveSnapshotWith(
  send: SendS3,
  bucket: string,
  runId: string,
  venueId: string,
  snapshot: MenuSnapshot,
): Promise<void> {
  try {
    await send(new PutObjectCommand({
      Bucket: bucket,
      Key: key(runId, venueId),
      Body: JSON.stringify(snapshot),
      ContentType: 'application/json',
      IfNoneMatch: '*',
    }));
  } catch (error) {
    if ((error as { name?: string }).name !== 'PreconditionFailed') throw error;
  }
}

const client = new S3Client({ region: 'eu-west-2' });
const bucket = (): string => process.env.MENU_SNAPSHOT_BUCKET!;

export const loadSnapshot = (runId: string, venueId: string): Promise<MenuSnapshot | undefined> =>
  loadSnapshotWith(command => client.send(command), bucket(), runId, venueId);

export const saveSnapshot = (
  runId: string,
  venueId: string,
  snapshot: MenuSnapshot,
): Promise<void> => saveSnapshotWith(command => client.send(command), bucket(), runId, venueId, snapshot);
