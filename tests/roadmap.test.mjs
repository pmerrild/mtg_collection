import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Inventory,
  freshState,
  parseDecklist,
  reservationChange,
  snapshotChanges,
} from "../worker/domain.mjs";
import { validateBackup } from "../worker/roadmap.mjs";
function fixture() {
  const s = freshState();
  s.holdings = [
    {
      id: 1,
      source_row: 2,
      name: "Sol Ring",
      printing_key: "cmm:1",
      set_code: "cmm",
      collector_number: "1",
      quantity: 1,
      finish: "nonfoil",
      deck_label: "",
      notes: "",
    },
    {
      id: 2,
      source_row: 3,
      name: "Sol Ring",
      printing_key: "cmm:1",
      set_code: "cmm",
      collector_number: "1",
      quantity: 1,
      finish: "foil",
      deck_label: "",
      notes: "",
    },
  ];
  s.matches["cmm:1"] = { status: "unresolved" };
  s.decks = [
    {
      id: 1,
      name: "A",
      format: "commander",
      priority: 0,
      active: 1,
      seeded: 1,
    },
    {
      id: 2,
      name: "B",
      format: "commander",
      priority: 0,
      active: 1,
      seeded: 0,
    },
  ];
  s.entries = [
    {
      id: 1,
      deck_id: 1,
      name: "Sol Ring",
      quantity: 2,
      printing_key: null,
      zone: "main",
    },
    {
      id: 2,
      deck_id: 2,
      name: "Sol Ring",
      quantity: 1,
      printing_key: null,
      zone: "main",
    },
  ];
  return s;
}
test("Ownership coverage does not mark incomplete targets ready", () => {
  const s = fixture(),
    deck = new Inventory(s).deck(1);
  assert.equal(deck.covered, 2);
  assert.equal(deck.readiness.list.complete, false);
  assert.equal(deck.readiness.list.unspecified, 98);
  assert.equal(deck.missing, 0);
  assert.match(deck.readiness.list.label, /incomplete/);
  assert.equal(deck.readiness.format.status, "Review required");
});
test("Transfer previews source shortages, keeps printing/finish, and conserves holdings", () => {
  const s = fixture(),
    initial = JSON.stringify(s.holdings);
  const blocked = new Inventory(s).deck(2).entries[0];
  assert.equal(blocked.reserved_by[0].name, "A");
  const result = reservationChange(s, [], {
    operation: "transfer",
    deck_id: 2,
    entry_id: 2,
    from_deck_id: 1,
    printing_key: "cmm:1",
    finish: "foil",
    quantity: 1,
  });
  assert.equal(new Inventory(result.state).deck(2).missing_now, 0);
  assert.equal(new Inventory(result.state).deck(1).missing_now, 1);
  assert.equal(JSON.stringify(result.state.holdings), initial);
  assert.deepEqual(
    result.impact.map((r) => [r.id, r.before, r.after]),
    [
      [1, 0, 1],
      [2, 1, 0],
    ],
  );
  const allocations = new Inventory(result.state).allocate(new Set([1, 2]));
  assert.equal(
    [...allocations.values()].flat().reduce((n, p) => n + p[1], 0),
    2,
  );
  assert.throws(() =>
    reservationChange(s, [], {
      operation: "transfer",
      deck_id: 2,
      entry_id: 2,
      from_deck_id: 1,
      printing_key: "cmm:1",
      finish: "foil",
      quantity: 2,
    }),
  );
});
test("Priority changes recompute reservations without changing ownership", () => {
  const s = fixture();
  s.decks[0].priority = 10;
  const result = reservationChange(s, [], {
    operation: "priority",
    deck_id: 2,
    priority: 0,
  });
  assert.equal(new Inventory(result.state).deck(2).missing_now, 0);
  assert.equal(new Inventory(result.state).deck(1).missing_now, 1);
  assert.deepEqual(result.state.holdings, s.holdings);
});
test("Shared and simultaneous wishlists respect foil requirements without allocating copies twice", () => {
  const s = fixture();
  s.entries = [
    {
      id: 1,
      deck_id: 1,
      name: "Sol Ring",
      quantity: 2,
      printing_key: null,
      zone: "main",
      finish: "foil",
    },
    {
      id: 2,
      deck_id: 2,
      name: "Sol Ring",
      quantity: 1,
      printing_key: null,
      zone: "main",
      finish: "foil",
    },
  ];
  const inv = new Inventory(s);
  assert.equal(inv.wishlist(new Set([1, 2]), "shared").copies, 1);
  assert.equal(inv.wishlist(new Set([1, 2]), "assembled").copies, 2);
  assert.equal(inv.wishlist(new Set([1, 2]), "shared").items[0].finish, "foil");
});
test("Finish-specific acquisition pricing does not use nonfoil prices for foil targets", () => {
  const s = fixture();
  s.matches["cmm:1"] = { status: "matched", card_id: "card" };
  s.entries[0].finish = "foil";
  const card = {
    id: "card",
    oracle_id: "ring",
    name: "Sol Ring",
    set: "cmm",
    collector_number: "1",
    prices: { eur: "1", eur_foil: "7" },
  };
  assert.equal(new Inventory(s, [card]).deck(1).entries[0].estimate, 7);
  assert.equal(parseDecklist("1 Sol Ring (CMM) 1 [foil]")[0].finish, "foil");
});
test("Snapshot review includes additions, removals and finish changes", () => {
  const s = fixture(),
    next = structuredClone(s.holdings);
  next[0].quantity = 3;
  next[1].quantity = 0;
  next.push({
    ...next[0],
    name: "New card",
    printing_key: "abc:2",
    quantity: 1,
  });
  const rows = snapshotChanges(s.holdings, next);
  assert.equal(rows.length, 3);
  assert(rows.some((r) => r.kind === "Added"));
  assert(rows.some((r) => r.kind === "Removed"));
  assert(
    rows.some((r) => r.finish === "nonfoil" && r.before === 1 && r.after === 3),
  );
});
test("Backup validation accepts old snapshots and rejects corrupt ownership and references", () => {
  const s = fixture(),
    backup = { version: 1, state: s, cards: [] };
  delete s.locations;
  delete s.saved_filters;
  delete s.acquisitions;
  delete s.reservations;
  assert.equal(validateBackup(backup).state.schema_version, 2);
  const bad = structuredClone(backup);
  bad.state.holdings[0].quantity = -1;
  assert.throws(() => validateBackup(bad));
  const orphan = structuredClone(backup);
  orphan.state.entries[0].deck_id = 90;
  assert.throws(() => validateBackup(orphan));
  assert.throws(() => validateBackup({ version: 99, state: s, cards: [] }));
});
