import type { Card } from "../frontend/src/types";
export type CollectionFilters = Record<
  | "q"
  | "color"
  | "color_mode"
  | "type"
  | "type_mode"
  | "sets"
  | "rarity"
  | "finish"
  | "reservation"
  | "match"
  | "deck_id"
  | "location"
  | "quantity_min"
  | "quantity_max"
  | "price_min"
  | "price_max"
  | "value_min"
  | "value_max"
  | "priced"
  | "view"
  | "sort",
  string
>;
export const filterDefaults: CollectionFilters;
export function normalizeFilters(
  raw?: Record<string, string>,
): CollectionFilters;
export function filterCollection(
  cards: Card[],
  raw: Record<string, string>,
): Card[];
