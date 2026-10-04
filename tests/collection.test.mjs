import { test } from "node:test";
import assert from "node:assert/strict";
import { filterCollection, normalizeFilters } from "../shared/collection.mjs";
import { freshState, Inventory } from "../worker/domain.mjs";
const card = (overrides = {}) => ({
  key: "a",
  name: "Alpha",
  quantity: 4,
  nonfoil: 3,
  foil: 1,
  color: "Blue, Black",
  card_type: "Artifact Creature — Wizard",
  rarity: "R",
  set_code: "one",
  location: "Binder A",
  reserved: 2,
  match_status: "matched",
  needed_by: [1],
  prices: { nonfoil: 2, foil: 7 },
  value: 13,
  priced_copies: 4,
  tradeable: 1,
  ...overrides,
});
const rows = [
  card(),
  card({
    key: "b",
    name: "Beta",
    quantity: 1,
    nonfoil: 1,
    foil: 0,
    color: "Blue",
    card_type: "Creature",
    set_code: "two",
    rarity: "U",
    reserved: 0,
    match_status: "lookup_failed",
    prices: { nonfoil: null, foil: null },
    value: null,
    priced_copies: 0,
    needed_by: [],
    tradeable: 0,
  }),
  card({
    key: "c",
    name: "Gamma",
    quantity: 2,
    nonfoil: 0,
    foil: 2,
    color: "Red",
    card_type: "Instant",
    set_code: "three",
    reserved: 2,
    match_status: "name_mismatch",
    prices: { nonfoil: null, foil: 0 },
    value: 0,
    priced_copies: 2,
    tradeable: 0,
  }),
];
const keys = (f) => filterCollection(rows, f).map((c) => c.key);
test("Independent filter groups intersect; any/all matches tokens and preserves multicolor and multi-type semantics", () => {
  assert.deepEqual(keys({ color: "Blue,Red" }), ["a", "b", "c"]);
  assert.deepEqual(keys({ color: "Blue,Black", color_mode: "all" }), ["a"]);
  assert.deepEqual(keys({ type: "Artifact,Creature", type_mode: "all" }), [
    "a",
  ]);
  assert.deepEqual(
    keys({
      sets: "one,two",
      rarity: "R",
      finish: "both",
      reservation: "partial",
      deck_id: "1",
      location: "binder",
    }),
    ["a"],
  );
  assert.deepEqual(keys({ reservation: "none" }), ["b"]);
  assert.deepEqual(keys({ reservation: "full" }), ["c"]);
  assert.deepEqual(keys({ match: "lookup_failed" }), ["b"]);
  assert.deepEqual(keys({ match: "name_mismatch" }), ["c"]);
});
test("Unknown prices stay distinct from zero and ranges only include known values for owned finishes", () => {
  assert.deepEqual(keys({ priced: "unknown" }), ["b"]);
  assert.deepEqual(keys({ value_max: "0" }), ["c"]);
  assert.deepEqual(keys({ price_max: "1" }), ["c"]);
  assert.deepEqual(
    keys({
      quantity_min: "2",
      quantity_max: "4",
      price_min: "1",
      price_max: "3",
    }),
    ["a"],
  );
  assert.deepEqual(keys({ priced: "partial" }), []);
  assert.deepEqual(
    filterCollection([card({ priced_copies: 3 })], { priced: "partial" }).map(
      (c) => c.key,
    ),
    ["a"],
  );
  assert.throws(() =>
    normalizeFilters({ quantity_min: "2", quantity_max: "1" }),
  );
  assert.throws(() => normalizeFilters({ value_min: "NaN" }));
  assert.throws(() => normalizeFilters({ quantity_min: "1.5" }));
});
test("Legacy saved views migrate; new saved filters round-trip with sort and exact status", () => {
  assert.deepEqual(keys({ foil: "true", status: "unresolved" }), ["c"]);
  const f = normalizeFilters({
    sets: "one,two",
    color: "Blue,Black",
    color_mode: "all",
    sort: "quantity",
    match: "matched",
  });
  assert.deepEqual(normalizeFilters(JSON.parse(JSON.stringify(f))), f);
  assert.deepEqual(keys({ sort: "quantity" }), ["a", "c", "b"]);
  assert.deepEqual(keys({ view: "duplicates" }), ["a", "c"]);
  assert.deepEqual(keys({ view: "trade" }), ["a"]);
  assert.equal(
    filterCollection([card({ quantity: 1, identity_copies: 2 })], {
      view: "duplicates",
    }).length,
    1,
  );
});
test("Trade candidates protect inactive exact finish targets, current reservations, and keep minimum without double counting", () => {
  const s = freshState();
  s.holdings = [
    {
      id: 1,
      name: "Ring",
      printing_key: "one:1",
      set_code: "one",
      collector_number: "1",
      finish: "nonfoil",
      quantity: 4,
    },
    {
      id: 2,
      name: "Ring",
      printing_key: "one:1",
      set_code: "one",
      collector_number: "1",
      finish: "foil",
      quantity: 2,
    },
    {
      id: 3,
      name: "Ring",
      printing_key: "two:1",
      set_code: "two",
      collector_number: "1",
      finish: "nonfoil",
      quantity: 3,
    },
  ];
  s.decks = [
    { id: 1, name: "Active", active: 1, priority: 0 },
    { id: 2, name: "Inactive", active: 0, priority: 1 },
  ];
  s.entries = [
    {
      id: 1,
      deck_id: 1,
      name: "Ring",
      quantity: 2,
      printing_key: null,
      finish: null,
    },
    {
      id: 2,
      deck_id: 2,
      name: "Ring",
      quantity: 2,
      printing_key: "one:1",
      finish: "foil",
    },
  ];
  let row = new Inventory(s)
    .collection()
    .find((c) => c.printing_key === "one:1");
  assert.equal(row.reserved, 2);
  assert.equal(row.target_protected, 4);
  assert.equal(row.tradeable, 2);
  s.keep_preferences[row.key] = 5;
  row = new Inventory(s).collection().find((c) => c.printing_key === "one:1");
  assert.equal(row.tradeable, 1);
  s.keep_preferences[row.key] = 0;
  row = new Inventory(s).collection().find((c) => c.printing_key === "one:1");
  assert.equal(row.tradeable, 2);
  s.keep_preferences[row.key] = 10;
  assert.equal(
    new Inventory(s).collection().find((c) => c.printing_key === "one:1")
      .tradeable,
    0,
  );
  assert.equal(
    s.holdings.reduce((n, h) => n + h.quantity, 0),
    9,
  );
});
test("Trade protection conservatively retains copies when inactive priority shifts the chosen printing", () => {
  const s = freshState();
  s.holdings = [
    {
      id: 1,
      name: "Ring",
      printing_key: "one:1",
      set_code: "one",
      collector_number: "1",
      finish: "foil",
      quantity: 1,
    },
    {
      id: 2,
      name: "Ring",
      printing_key: "two:1",
      set_code: "two",
      collector_number: "1",
      finish: "nonfoil",
      quantity: 1,
    },
  ];
  s.decks = [
    { id: 1, name: "Active", active: 1, priority: 10 },
    { id: 2, name: "Inactive", active: 0, priority: 0 },
  ];
  s.entries = [
    { id: 1, deck_id: 1, name: "Ring", quantity: 1 },
    { id: 2, deck_id: 2, name: "Ring", quantity: 1, finish: "foil" },
  ];
  s.keep_preferences = { "one:1|ring": 0, "two:1|ring": 0 };
  assert(new Inventory(s).collection().every((c) => c.tradeable === 0));
});

test("An unfilled constrained target protects alternative finishes that flexible targets could use after rearrangement", () => {
  const s = freshState();
  s.holdings = [
    {
      id: 1,
      name: "Ring",
      printing_key: "one:1",
      set_code: "one",
      collector_number: "1",
      finish: "foil",
      quantity: 1,
    },
    {
      id: 2,
      name: "Ring",
      printing_key: "one:1",
      set_code: "one",
      collector_number: "1",
      finish: "nonfoil",
      quantity: 2,
    },
  ];
  s.decks = [
    { id: 1, name: "Active", active: 1, priority: 0 },
    { id: 2, name: "Inactive", active: 0, priority: 1 },
  ];
  s.entries = [
    { id: 1, deck_id: 1, name: "Ring", quantity: 2 },
    { id: 2, deck_id: 2, name: "Ring", quantity: 1, finish: "foil" },
  ];
  s.keep_preferences = { "one:1|ring": 0 };
  const row = new Inventory(s).collection()[0];
  assert.equal(row.reserved, 2);
  assert.equal(row.target_protected, 3);
  assert.equal(row.tradeable, 0);
});
