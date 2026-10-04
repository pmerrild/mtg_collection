import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../dist/server/index.js";
import { freshState } from "../worker/domain.mjs";
const sql = new DatabaseSync(":memory:");
sql.exec(
  readFileSync(
    new URL("../drizzle/0000_tense_human_fly.sql", import.meta.url),
    "utf8",
  ),
);
function prepared(query, args = []) {
  return {
    bind(...values) {
      return prepared(query, values);
    },
    async first() {
      return sql.prepare(query).get(...args) || null;
    },
    async all() {
      return { results: sql.prepare(query).all(...args) };
    },
    async run() {
      const r = sql.prepare(query).run(...args);
      return { meta: { changes: Number(r.changes) } };
    },
  };
}
const DB = {
  prepare: (query) => prepared(query),
  async batch(statements) {
    sql.exec("BEGIN");
    try {
      const results = [];
      for (const s of statements) results.push(await s.run());
      sql.exec("COMMIT");
      return results;
    } catch (e) {
      sql.exec("ROLLBACK");
      throw e;
    }
  },
};
const blobs = new Map();
let onPut = null;
const BUCKET = {
  async put(key, value, options = {}) {
    blobs.set(key, { value, options });
    if (onPut) onPut(key);
  },
  async get(key) {
    const item = blobs.get(key);
    return item
      ? {
          json: async () => JSON.parse(item.value),
          text: async () => item.value,
        }
      : null;
  },
  async delete(key) {
    blobs.delete(key);
  },
  async list({ prefix, cursor, limit = 50 }) {
    const keys = [...blobs.keys()].filter((k) => k.startsWith(prefix)).sort(),
      start = Number(cursor) || 0,
      selected = keys.slice(start, start + limit);
    return {
      objects: selected.map((key) => ({
        key,
        size: blobs.get(key).value.length,
        uploaded: new Date().toISOString(),
        customMetadata: blobs.get(key).options.customMetadata,
      })),
      truncated: start + limit < keys.length,
      cursor: String(start + limit),
    };
  },
};
const env = { DB, BUCKET },
  ctx = { waitUntil() {} };
function reset() {
  sql.exec("DELETE FROM vault;DELETE FROM cards;DELETE FROM imports");
  blobs.clear();
  onPut = null;
  const s = freshState();
  s.settings.last_price_success = new Date().toISOString();
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
      card_type: "Artifact",
      color: "Colorless",
      rarity: "uncommon",
      deck_label: "",
      notes: "",
    },
  ];
  s.matches["cmm:1"] = { status: "unresolved" };
  sql
    .prepare("INSERT INTO vault (id,revision,payload) VALUES (1,0,?)")
    .run(JSON.stringify(s));
}
const revision = () =>
  sql.prepare("SELECT revision FROM vault WHERE id=1").get().revision;
const state = () =>
  JSON.parse(sql.prepare("SELECT payload FROM vault WHERE id=1").get().payload);
async function request(
  path,
  method = "GET",
  data,
  rev = revision(),
  raw = false,
) {
  return worker.fetch(
    new Request("https://vault.example/api" + path, {
      method,
      body: data === undefined ? undefined : raw ? data : JSON.stringify(data),
      headers: {
        "X-Vault-Revision": String(rev),
        ...(raw
          ? { "X-Workbook-Name": "sample.xlsx" }
          : { "Content-Type": "application/json" }),
      },
    }),
    env,
    ctx,
  );
}
async function good(path, method = "GET", data, rev = revision(), raw = false) {
  const r = await request(path, method, data, rev, raw),
    body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  return body;
}
test("Every changed snapshot waits for full review; unchanged and invalid files preserve ownership", async () => {
  reset();
  const raw = readFileSync(
    new URL("../sample-inventory.xlsx", import.meta.url),
  );
  const staged = await good("/upload", "POST", raw, revision(), true);
  assert.equal(staged.pending, true);
  assert.equal(
    state().holdings.reduce((n, h) => n + h.quantity, 0),
    1,
  );
  assert(state().pending_import.changes.some((c) => c.kind === "Added"));
  assert(state().pending_import.reductions.some((c) => c.kind === undefined));
  await good(`/import/${staged.id}/apply`, "POST", {});
  const count = state().holdings.reduce((n, h) => n + h.quantity, 0);
  assert(count > 1);
  assert((await good("/upload", "POST", raw, revision(), true)).unchanged);
  assert.equal(
    state().holdings.reduce((n, h) => n + h.quantity, 0),
    count,
  );
  assert.equal(
    (
      await request(
        "/upload",
        "POST",
        new TextEncoder().encode("bad"),
        revision(),
        true,
      )
    ).status,
    400,
  );
  assert.equal(
    state().holdings.reduce((n, h) => n + h.quantity, 0),
    count,
  );
  assert.equal(state().history[0].status, "failed");
});
test("Deck revisions recover edits/deletions and deleted IDs are not reused", async () => {
  reset();
  const payload = {
    name: "Original",
    format: "commander",
    active: true,
    list_confirmed: false,
    decklist: "1 Sol Ring",
  };
  const { id } = await good("/decks", "POST", payload);
  await good(`/decks/${id}`, "PUT", {
    ...payload,
    name: "Edited",
    decklist: "2 Sol Ring [foil]",
  });
  let history = await good(`/revisions?deck_id=${id}`);
  assert.equal(history.items.length, 1);
  let preview = await good("/revisions/preview", "POST", {
    key: history.items[0].key,
  });
  assert.equal(preview.after, 1);
  await good(
    "/revisions/apply",
    "POST",
    { key: preview.key },
    preview.revision,
  );
  assert.equal(state().decks[0].name, "Original");
  assert.equal(state().entries[0].quantity, 1);
  await good(`/decks/${id}`, "DELETE");
  assert.equal(state().decks.length, 0);
  const newer = await good("/decks", "POST", { ...payload, name: "Newer" });
  assert(newer.id > id);
  history = await good(`/revisions?deck_id=${id}`);
  const deleted = history.items.find((i) => i.reason === "Deck deleted");
  preview = await good("/revisions/preview", "POST", { key: deleted.key });
  assert.equal(preview.deleted, true);
  await good(
    "/revisions/apply",
    "POST",
    { key: preview.key },
    preview.revision,
  );
  assert.equal(state().decks.length, 2);
  assert.equal(
    new Set(state().entries.map((e) => e.id)).size,
    state().entries.length,
  );
});
test("Full restore validates input, restores cache and state atomically, and rejects stale previews", async () => {
  reset();
  const card = {
    id: "card",
    name: "Sol Ring",
    set: "cmm",
    collector_number: "1",
    prices: { eur: "2" },
  };
  sql
    .prepare("INSERT INTO cards (id,payload,fetched_at) VALUES (?,?,?)")
    .run(card.id, JSON.stringify(card), new Date().toISOString());
  const saved = await good("/backup");
  await good("/settings", "PATCH", { currency: "USD" });
  let preview = await good("/restore/preview", "POST", { backup: saved });
  await good("/settings", "PATCH", { currency: "EUR" });
  assert.equal(
    (
      await request(
        "/restore/apply",
        "POST",
        { id: preview.id },
        preview.revision,
      )
    ).status,
    409,
  );
  const invalid = structuredClone(saved);
  invalid.state.holdings[0].quantity = -1;
  assert.equal(
    (await request("/restore/preview", "POST", { backup: invalid })).status,
    400,
  );
  await good("/settings", "PATCH", { currency: "USD" });
  sql.exec("DELETE FROM cards");
  preview = await good("/restore/preview", "POST", { backup: saved });
  await good("/restore/apply", "POST", { id: preview.id }, preview.revision);
  assert.equal(state().settings.currency, "EUR");
  assert.equal(sql.prepare("SELECT count(*) AS n FROM cards").get().n, 1);
  assert(
    (await good("/backups")).items.some(
      (i) => i.reason === "Before restoring collection",
    ),
  );
});
test("A write racing with a restore leaves inventory and cached cards intact", async () => {
  reset();
  const backup = await good("/backup");
  const preview = await good("/restore/preview", "POST", { backup });
  sql.prepare("INSERT INTO cards (id,payload,fetched_at) VALUES (?,?,?)").run(
    "live-cache",
    JSON.stringify({
      id: "live-cache",
      name: "Current card",
      set: "abc",
      collector_number: "1",
    }),
    new Date().toISOString(),
  );
  onPut = (key) => {
    if (key.startsWith("backups/")) {
      const s = state();
      s.settings.currency = "USD";
      sql
        .prepare("UPDATE vault SET revision=revision+1,payload=? WHERE id=1")
        .run(JSON.stringify(s));
      onPut = null;
    }
  };
  const response = await request(
    "/restore/apply",
    "POST",
    { id: preview.id },
    preview.revision,
  );
  assert.equal(response.status, 409);
  assert.equal(state().settings.currency, "USD");
  assert.equal(state().holdings.length, 1);
  assert.equal(sql.prepare("SELECT id FROM cards").get().id, "live-cache");
});
test("Received acquisitions never change ownership; saved views and locations persist", async () => {
  reset();
  const collection = await good("/collection");
  await good("/locations", "PATCH", {
    key: collection[0].key,
    location: "Binder A",
  });
  await good("/filters", "POST", {
    name: "Foils",
    filters: { foil: "true", status: "unresolved" },
  });
  await good("/acquisitions", "POST", {
    name: "Sol Ring",
    quantity: 3,
    notes: "Shop order",
  });
  await good(`/acquisitions/${state().acquisitions[0].id}`, "PATCH", {
    status: "received",
  });
  const view = await good("/state");
  assert.equal(view.summary.copies, 1);
  assert.equal(view.saved_filters[0].name, "Foils");
  assert.equal(view.acquisitions[0].status, "received");
  assert.equal((await good("/collection"))[0].location, "Binder A");
  const exported = await request("/export?kind=collection&location=elsewhere");
  assert.equal(await exported.text(), "");
});

test("Bulk actions validate the whole selection, reject stale writes, persist keep preferences, and leave ownership unchanged", async () => {
  reset();
  const key = (await good("/collection"))[0].key;
  const holdings = JSON.stringify(state().holdings);
  assert.equal(
    (
      await request("/collection/bulk", "POST", {
        keys: [key, "missing"],
        action: "location",
        location: "A",
      })
    ).status,
    400,
  );
  assert.deepEqual(state().locations, {});
  assert.equal(
    (
      await request("/collection/bulk", "POST", {
        keys: [key, key],
        action: "keep",
        keep: 0,
      })
    ).status,
    400,
  );
  const before = revision();
  await good("/collection/bulk", "POST", {
    keys: [key],
    action: "location",
    location: "Bulk binder",
  });
  assert.equal(
    (
      await request(
        "/collection/bulk",
        "POST",
        { keys: [key], action: "keep", keep: 0 },
        before,
      )
    ).status,
    409,
  );
  assert.equal((await good("/collection"))[0].keep, 1);
  await good("/collection/bulk", "POST", {
    keys: [key],
    action: "keep",
    keep: 0,
  });
  assert.equal((await good("/collection"))[0].tradeable, 1);
  await good("/collection/bulk", "POST", {
    keys: [key],
    action: "acquisition",
    quantity: 2,
    finish: "foil",
    notes: "Another copy",
  });
  assert.equal(state().acquisitions[0].quantity, 2);
  assert.equal(state().acquisitions[0].finish, "foil");
  assert.equal(state().acquisitions[0].printing_key, "cmm:1");
  assert.equal(JSON.stringify(state().holdings), holdings);
  const backup = await good("/backup");
  assert.equal(backup.state.keep_preferences[key], 0);
  const restored = (await import("../worker/roadmap.mjs")).validateBackup(
    backup,
  );
  assert.equal(restored.state.keep_preferences[key], 0);
});
test("Advanced saved views and selected TXT/CSV exports share filter semantics; trade export uses candidate rather than owned quantity", async () => {
  reset();
  const s = state();
  s.holdings[0].quantity = 4;
  sql.prepare("UPDATE vault SET payload=? WHERE id=1").run(JSON.stringify(s));
  const key = (await good("/collection"))[0].key;
  const filters = {
    quantity_min: "2",
    sets: "cmm,other",
    type: "Artifact",
    match: "unresolved",
    reservation: "none",
    sort: "quantity",
  };
  await good("/filters", "POST", { name: "Duplicates", filters });
  assert.equal(state().saved_filters[0].filters.sort, "quantity");
  const txt = await request(
    "/export?" + new URLSearchParams({ kind: "collection", ...filters }),
  );
  assert.equal((await txt.text()).trim(), "4 Sol Ring");
  assert.equal(
    await (await request("/export?kind=collection&quantity_min=5")).text(),
    "",
  );
  const trade = await request("/export", "POST", {
    kind: "collection",
    keys: JSON.stringify([key]),
    view: "trade",
  });
  assert.equal((await trade.text()).trim(), "3 Sol Ring");
  const csv = await request("/export", "POST", {
    kind: "collection",
    keys: JSON.stringify([key]),
    view: "trade",
    format: "csv",
  });
  const csvText = await csv.text();
  assert.match(csvText, /"owned_quantity"/);
  assert.match(csvText, /"Sol Ring","3"/);
  assert.equal(
    (
      await request("/export", "POST", {
        kind: "collection",
        keys: JSON.stringify(["missing"]),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await request("/filters", "POST", {
        name: "Invalid",
        filters: { quantity_min: "5", quantity_max: "1" },
      })
    ).status,
    400,
  );
  assert.equal(state().saved_filters.length, 1);
});

test("Bulk undo restores exact prior location/keep values and refuses later writes, reuse, expiry, or missing tokens", async () => {
  reset();
  const key = (await good("/collection"))[0].key;
  const before = JSON.stringify(state().holdings);
  let result = await good("/collection/bulk", "POST", {
    keys: [key],
    action: "location",
    location: "New binder",
  });
  assert.equal(result.undo.revision, revision());
  assert.equal(state().locations[key], "New binder");
  await good(
    "/collection/bulk/undo",
    "POST",
    { token: result.undo.token },
    result.undo.revision,
  );
  assert.equal(Object.hasOwn(state().locations, key), false);
  assert.equal(
    (
      await request("/collection/bulk/undo", "POST", {
        token: result.undo.token,
      })
    ).status,
    400,
  );
  await good("/locations", "PATCH", { key, location: "Original binder" });
  result = await good("/collection/bulk", "POST", {
    keys: [key],
    action: "location",
    location: "",
  });
  await good(
    "/collection/bulk/undo",
    "POST",
    { token: result.undo.token },
    result.undo.revision,
  );
  assert.equal(state().locations[key], "Original binder");
  result = await good("/collection/bulk", "POST", {
    keys: [key],
    action: "keep",
    keep: 4,
  });
  await good(
    "/collection/bulk/undo",
    "POST",
    { token: result.undo.token },
    result.undo.revision,
  );
  assert.equal(Object.hasOwn(state().keep_preferences, key), false);
  assert.equal((await good("/collection"))[0].keep, 1);
  await good("/collection/bulk", "POST", {
    keys: [key],
    action: "keep",
    keep: 0,
  });
  result = await good("/collection/bulk", "POST", {
    keys: [key],
    action: "keep",
    keep: 3,
  });
  await good(
    "/collection/bulk/undo",
    "POST",
    { token: result.undo.token },
    result.undo.revision,
  );
  assert.equal(state().keep_preferences[key], 0);
  result = await good("/collection/bulk", "POST", {
    keys: [key],
    action: "location",
    location: "Intermediate",
  });
  await good("/locations", "PATCH", { key, location: "Later edit" });
  assert.equal(
    (
      await request("/collection/bulk/undo", "POST", {
        token: result.undo.token,
      })
    ).status,
    409,
  );
  assert.equal(state().locations[key], "Later edit");
  result = await good("/collection/bulk", "POST", {
    keys: [key],
    action: "keep",
    keep: 2,
  });
  const stored = blobs.get("bulk-undo/" + result.undo.token + ".json");
  const expired = JSON.parse(stored.value);
  expired.expires = Date.now() - 1;
  stored.value = JSON.stringify(expired);
  assert.equal(
    (
      await request("/collection/bulk/undo", "POST", {
        token: result.undo.token,
      })
    ).status,
    400,
  );
  assert.equal(state().keep_preferences[key], 2);
  assert.equal(
    (await request("/collection/bulk/undo", "POST", { token: "invalid" }))
      .status,
    400,
  );
  assert.equal(JSON.stringify(state().holdings), before);
});

test("Set checklist API uses complete catalog and matched printing IDs without modifying ownership", async () => {
  reset();
  const before = JSON.stringify(state().holdings),
    originalFetch = globalThis.fetch;
  const ids = [
    "00000000-0000-0000-0000-000000000001",
    "00000000-0000-0000-0000-000000000002",
  ];
  const cards = ids.map((id, index) => ({
    id,
    name: "Sol Ring",
    set: "cmm",
    collector_number: String(index + 1),
    lang: "en",
    games: ["paper"],
    prices: {},
  }));
  const uncached = await good("/sets/cmm");
  assert.equal(uncached.percent, null);
  assert.equal(uncached.total, null);
  globalThis.fetch = async (url) =>
    new Response(
      JSON.stringify(
        String(url).includes("/sets/cmm")
          ? { object: "set", code: "cmm", name: "Commander Masters" }
          : { object: "list", data: cards, total_cards: 2, has_more: false },
      ),
      { headers: { "Content-Type": "application/json" } },
    );
  try {
    await good("/sets/cmm/refresh", "POST");
    let value = await good("/sets/cmm");
    assert.equal(value.total, 2);
    assert.equal(value.percent, null);
    assert.equal(value.needs_verification, 1);
    assert.equal((await request("/sets/cmm?view=missing")).status, 400);
    const current = state();
    current.matches["cmm:1"] = { status: "matched", card_id: ids[0] };
    sql
      .prepare("UPDATE vault SET payload=?,revision=revision+1 WHERE id=1")
      .run(JSON.stringify(current));
    sql
      .prepare("INSERT INTO cards (id,payload,fetched_at) VALUES (?,?,?)")
      .run(ids[0], JSON.stringify(cards[0]), new Date().toISOString());
    value = await good("/sets/cmm?view=missing");
    assert.equal(value.percent, 50);
    assert.equal(value.items.length, 1);
    assert.equal(value.items[0].number, "2");
    assert.equal(value.items[0].name, "Sol Ring");
    assert.equal(value.items[0].owned, false);
    assert.equal((await good("/sets")).items[0].name, "Commander Masters");
    const saved = blobs.get("set-catalogs/cmm.json").value;
    globalThis.fetch = async () => {
      throw Error("offline");
    };
    assert.equal((await request("/sets/cmm/refresh", "POST")).status, 400);
    assert.equal(blobs.get("set-catalogs/cmm.json").value, saved);
    assert.equal(JSON.stringify(state().holdings), before);
    assert.equal((await request("/sets/unknown/refresh", "POST")).status, 400);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
