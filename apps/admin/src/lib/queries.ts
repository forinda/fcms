/**
 * What the app asks the engine for, in one place.
 *
 * Keys rather than URLs at the call sites: a mutation invalidates
 * `["entries", type]` and every screen showing those rows refetches, which is
 * the thing a hand-rolled cache never quite gets right.
 */
import { queryOptions } from "@tanstack/react-query";

import { api, type Entry, type Spec, type Status } from "./api";

export const specQuery = queryOptions({
  queryKey: ["spec"],
  queryFn: () => api.get<{ spec: Spec }>("/api/spec").then((r) => r.spec),
  // The shape of the site changes when somebody edits it, which is rare and
  // never by accident. Holding it longer keeps every screen from re-asking.
  staleTime: 5 * 60_000,
});

export const statusQuery = queryOptions({
  queryKey: ["status"],
  queryFn: () => api.get<Status>("/api/status"),
});

export const entriesQuery = (typeKey: string) =>
  queryOptions({
    queryKey: ["entries", typeKey],
    queryFn: () => api.get<{ entries: Entry[] }>(`/api/entries/${typeKey}`).then((r) => r.entries),
  });
