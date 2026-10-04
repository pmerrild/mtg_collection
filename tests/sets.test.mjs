import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SET_SCOPE,
  setProgress,
  validateCatalog,
  refreshCatalog,
} from "../worker/sets.mjs";
const ids = [
  "00000000-0000-0000-0000-000000000001",
  "00000000-0000-0000-0000-000000000002",
  "00000000-0000-0000-0000-000000000003",
];
const catalog = () => ({
  version: 1,
  scope: SET_SCOPE,
  complete: true,
  code: "abc",
  name: "Test edition",
  fetched_at: "2026-10-04T10:00:00Z",
  cards: ids.map((id, i) => ({
    id,
    name: i < 2 ? "Same card" : "Another card",
    number: String(i + 1),
  })),
});
const row = (number, id, status = "matched", quantity = 1) => ({
  set_code: "abc",
  printing_key: `abc:${number}`,
  scryfall_id: id,
  match_status: status,
  quantity,
});
test("Set scope counts finishes/copies once, keeps variants distinct, and derives exact missing count", () => {
  const value = setProgress(
    [
      row(1, ids[0], "matched", 5),
      row(1, ids[0], "matched", 2),
      row(2, ids[1]),
    ],
    validateCatalog(catalog(), "abc"),
  );
  assert.equal(value.owned_printings, 2);
  assert.equal(value.copies, 8);
  assert.equal(value.verified_owned, 2);
  assert.equal(value.total, 3);
  assert.equal(value.percent, 66.7);
  assert.equal(value.missing_count, 1);
});
test("Unknown catalogs and unverified/conflicting/out-of-edition holdings never produce false percentages or missing totals", () => {
  for (const status of [
    "unresolved",
    "lookup_failed",
    "name_mismatch",
    "not_found",
  ]) {
    const value = setProgress(
      [row(1, ids[0]), row(2, ids[1], status)],
      catalog(),
    );
    assert.equal(value.verified_owned, 1);
    assert.equal(value.percent, null);
    assert.equal(value.missing_count, null);
    assert.equal(value.needs_verification, 1);
  }
  const outside = setProgress([row(9, "different-edition")], catalog());
  assert.equal(outside.percent, null);
  const absent = setProgress([row(1, ids[0])]);
  assert.equal(absent.total, null);
  assert.equal(absent.percent, null);
});
test("Catalog validation rejects partial, wrong scope, duplicate IDs and collector numbers, and invalid cards", () => {
  for (const mutate of [
    (c) => (c.complete = false),
    (c) => (c.scope = "base-only"),
    (c) => (c.code = "other"),
    (c) => (c.cards[1].id = c.cards[0].id),
    (c) => (c.cards[1].number = "01"),
    (c) => (c.cards[1].name = ""),
    (c) => (c.fetched_at = "invalid"),
  ]) {
    const c = catalog();
    mutate(c);
    assert.throws(() => validateCatalog(c, "abc"));
  }
});
test("Complete paginated catalog is written once; partial failure, unsafe next URL and duplicate data preserve previous cache", async () => {
  const blobs = new Map([["set-catalogs/abc.json", "previous complete cache"]]);
  let writes = 0;
  const env = {
    BUCKET: {
      put: async (k, v) => {
        writes++;
        blobs.set(k, v);
      },
    },
  };
  const cards = catalog().cards.map((c) => ({
    id: c.id,
    name: c.name,
    collector_number: c.number,
    set: "abc",
    lang: "en",
    games: ["paper"],
  }));
  const metadata = { object: "set", code: "abc", name: "Test edition" };
  const query = "set:abc game:paper lang:en";
  const next =
    "https://api.scryfall.com/cards/search?" +
    new URLSearchParams({ q: query, unique: "prints", page: "2" });
  const complete = await refreshCatalog(env, "abc", async (path) =>
    path === "/sets/abc"
      ? metadata
      : path.includes("page=2")
        ? {
            object: "list",
            data: cards.slice(2),
            total_cards: 3,
            has_more: false,
          }
        : {
            object: "list",
            data: cards.slice(0, 2),
            total_cards: 3,
            has_more: true,
            next_page: next,
          },
  );
  assert.equal(complete.cards.length, 3);
  assert.equal(writes, 1);
  const previous = blobs.get("set-catalogs/abc.json");
  for (const variation of [
    "failed-page",
    "unsafe-url",
    "duplicate",
    "wrong-edition",
    "truncated",
  ]) {
    let calls = 0;
    await assert.rejects(() =>
      refreshCatalog(env, "abc", async (path) => {
        calls++;
        if (path === "/sets/abc") return metadata;
        if (variation === "wrong-edition")
          return {
            object: "list",
            data: [{ ...cards[0], set: "xyz" }],
            total_cards: 1,
            has_more: false,
          };
        if (variation === "duplicate")
          return {
            object: "list",
            data: [cards[0], cards[0]],
            total_cards: 2,
            has_more: false,
          };
        if (variation === "truncated")
          return {
            object: "list",
            data: cards.slice(0, 2),
            total_cards: 3,
            has_more: false,
          };
        if (path.includes("page=2")) throw Error("offline");
        return {
          object: "list",
          data: cards.slice(0, 2),
          total_cards: 3,
          has_more: true,
          next_page:
            variation === "unsafe-url"
              ? "https://elsewhere.example/cards/search"
              : next,
        };
      }),
    );
    assert.equal(blobs.get("set-catalogs/abc.json"), previous);
    assert.equal(writes, 1);
    if (variation === "unsafe-url") assert.equal(calls, 2);
  }
});
