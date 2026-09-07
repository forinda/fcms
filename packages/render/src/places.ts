/**
 * Where a thing is, and how far it is from the visitor (ADR 0026).
 *
 * `computed` has six arithmetic operations and no functions, and haversine is
 * not going to be the seventh — a spec that could express great-circle distance
 * is a spec with a maths library in it. So the coordinate is a field and the
 * distance is something the platform provides, exactly as `nights` is.
 */
import type { ContentType } from "@forinda-cms/spec";

import type { Entry, RequestParams } from "./entries.js";

/**
 * Reserved on any type carrying a `geo` field.
 *
 * Kilometres, and named so: a number called `distance` is a unit argument
 * waiting to happen.
 */
export const DISTANCE_FIELD = "distanceKm";

/** The parameter a visitor's position arrives in: `?near=-1.2921,36.8219`. */
export const NEAR_PARAM = "near";

export interface Point {
  readonly lat: number;
  readonly lng: number;
}

/** A stored coordinate, or nothing when the value is not one. */
export function pointOf(value: unknown): Point | null {
  if (!value || typeof value !== "object") return null;
  const { lat, lng } = value as Record<string, unknown>;
  return typeof lat === "number" && typeof lng === "number" && isOnEarth(lat, lng)
    ? { lat, lng }
    : null;
}

/** `"-1.2921,36.8219"` from a query string. */
export function parsePoint(value: unknown): Point | null {
  const text = typeof value === "string" ? value : Array.isArray(value) ? value[0] : undefined;
  if (typeof text !== "string") return null;

  const [first, second, ...rest] = text.split(",");
  if (rest.length > 0 || second === undefined) return null;

  const lat = Number(first);
  const lng = Number(second);
  return Number.isFinite(lat) && Number.isFinite(lng) && isOnEarth(lat, lng) ? { lat, lng } : null;
}

function isOnEarth(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

const EARTH_KM = 6371;
const RAD = Math.PI / 180;

/**
 * Great-circle distance, in kilometres, rounded to a tenth.
 *
 * As the crow flies. A listing promising "2 km" for somewhere across a lake is
 * technically correct and practically wrong, which is worth knowing before an
 * owner writes it into a heading (ADR 0026, consequences).
 */
export function distanceKm(from: Point, to: Point): number {
  const dLat = (to.lat - from.lat) * RAD;
  const dLng = (to.lng - from.lng) * RAD;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(from.lat * RAD) * Math.cos(to.lat * RAD) * Math.sin(dLng / 2) ** 2;

  return Math.round(EARTH_KM * 2 * Math.asin(Math.sqrt(a)) * 10) / 10;
}

/** The first `geo` field on a type, which is the one distance is measured from. */
export function geoFieldOf(type: ContentType): string | null {
  return type.fields.find((field) => field.type === "geo")?.name ?? null;
}

/**
 * Add `distanceKm` to every row, when the visitor said where they are.
 *
 * Nothing is added without a `near` parameter: a stored distance is a distance
 * from somewhere nobody asked about, and a column of nulls sorts worse than an
 * absent one.
 */
export function addDistance(
  type: ContentType,
  rows: readonly Entry[],
  params: RequestParams,
): readonly Entry[] {
  const field = geoFieldOf(type);
  const from = field ? parsePoint(params[NEAR_PARAM]) : null;
  if (!field || !from) return rows;

  return rows.map((row) => {
    const to = pointOf(row[field]);
    // A row with no coordinate has no distance rather than a distance of zero,
    // which would sort it to the top of "nearest first".
    return { ...row, [DISTANCE_FIELD]: to ? distanceKm(from, to) : null };
  });
}
