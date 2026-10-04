import {
  Inventory,
  freshState,
  parseDecklist,
  deckText,
  reservationChange,
  normalized,
} from "./domain.mjs";
const stamp = () => new Date().toISOString();
const formats = new Set([
  "commander",
  "casual60",
  "standard",
  "modern",
  "pioneer",
  "legacy",
  "vintage",
  "pauper",
]);
const integer = (n, min, max) =>
  Number.isSafeInteger(n) && n >= min && n <= max;
export function upgrade(s) {
  s.schema_version = 2;
  s.reservations ??= [];
  s.locations ??= {};
  s.saved_filters ??= [];
  s.acquisitions ??= [];
  s.next_deck_id = Math.max(
    s.next_deck_id || 1,
    1 + Math.max(0, ...s.decks.map((d) => d.id)),
  );
  s.next_entry_id = Math.max(
    s.next_entry_id || 1,
    1 + Math.max(0, ...s.entries.map((e) => e.id)),
  );
  return s;
}
export function validatedEntries(data) {
  const entries =
    data.entries === undefined
      ? parseDecklist(data.decklist || "")
      : data.entries;
  if (!Array.isArray(entries) || entries.length > 1000)
    throw Error("A deck can contain up to 1,000 distinct entries.");
  const rows = entries.map((e) => {
    const name = String(e.name || "").trim();
    if (
      !name ||
      name.length > 200 ||
      /[\r\n]/.test(name) ||
      !integer(e.quantity, 1, 100000) ||
      !["main", "commander", "sideboard"].includes(e.zone) ||
      (e.printing_key &&
        !/^[a-z0-9]{2,8}:[^\s:]{1,30}$/.test(e.printing_key)) ||
      (e.finish && !["foil", "nonfoil"].includes(e.finish))
    )
      throw Error(
        "Each card needs a name, positive whole quantity, valid zone, and optional printing/finish.",
      );
    return {
      name,
      quantity: e.quantity,
      zone: e.zone,
      printing_key: e.printing_key || null,
      finish: e.finish || null,
    };
  });
  // Combine duplicate requirements without dropping printing or finish constraints.
  const groups = new Map();
  for (const e of rows) {
    const k = JSON.stringify([
        normalized(e.name),
        e.zone,
        e.printing_key,
        e.finish,
      ]),
      r = groups.get(k);
    if (r) r.quantity += e.quantity;
    else groups.set(k, e);
  }
  return [...groups.values()];
}
export function validateBackup(raw) {
  if (
    !raw ||
    raw.version !== 1 ||
    !raw.state ||
    !Array.isArray(raw.cards) ||
    raw.cards.length > 10000
  )
    throw Error("Choose a supported MTG Vault JSON backup.");
  const s = structuredClone(raw.state),
    base = freshState();
  for (const key of [
    "holdings",
    "issues",
    "decks",
    "entries",
    "seeded_labels",
    "history",
  ])
    if (!Array.isArray(s[key])) throw Error("Backup is missing " + key + ".");
  if (
    s.holdings.length > 40000 ||
    s.decks.length > 1000 ||
    s.entries.length > 20000 ||
    !s.matches ||
    typeof s.matches !== "object" ||
    Array.isArray(s.matches) ||
    !s.settings ||
    !["EUR", "USD"].includes(s.settings.currency)
  )
    throw Error("Backup inventory or settings are invalid.");
  const unique = (rows, key) =>
    new Set(rows.map((r) => r[key])).size === rows.length;
  if (
    !unique(s.holdings, "id") ||
    !unique(s.decks, "id") ||
    !unique(s.entries, "id")
  )
    throw Error("Backup contains duplicate identifiers.");
  for (const h of s.holdings)
    if (
      !integer(h.id, 1, Number.MAX_SAFE_INTEGER) ||
      !integer(h.quantity, 1, 100000000) ||
      !["foil", "nonfoil"].includes(h.finish) ||
      typeof h.name !== "string" ||
      !h.name.trim() ||
      typeof h.printing_key !== "string" ||
      typeof h.set_code !== "string"
    )
      throw Error("Backup contains an invalid holding.");
  for (const d of s.decks)
    if (
      !integer(d.id, 1, Number.MAX_SAFE_INTEGER) ||
      typeof d.name !== "string" ||
      !d.name.trim() ||
      !formats.has(d.format) ||
      ![0, 1].includes(d.active) ||
      (d.priority !== undefined && !integer(d.priority, 0, 999))
    )
      throw Error("Backup contains an invalid deck.");
  for (const e of s.entries) {
    validatedEntries({ entries: [e] });
    if (
      !integer(e.id, 1, Number.MAX_SAFE_INTEGER) ||
      !s.decks.some((d) => d.id === e.deck_id)
    )
      throw Error("Backup has an orphaned deck requirement.");
  }
  if (!unique(raw.cards, "id"))
    throw Error("Backup contains duplicate cached cards.");
  for (const c of raw.cards)
    if (
      typeof c.id !== "string" ||
      !c.id ||
      typeof c.name !== "string" ||
      typeof c.set !== "string" ||
      typeof c.collector_number !== "string" ||
      (c.card_faces !== undefined &&
        (!Array.isArray(c.card_faces) ||
          c.card_faces.some((f) => typeof f.name !== "string")))
    )
      throw Error("Backup card data is invalid.");
  for (const h of s.holdings) {
    for (const k of ["card_type", "color", "rarity", "notes", "deck_label"]) {
      if (h[k] !== undefined && typeof h[k] !== "string")
        throw Error("Backup holding metadata is invalid.");
      h[k] ??= "";
    }
    h.collector_number = String(h.collector_number || "");
  }
  for (const r of s.issues)
    if (
      !integer(r.source_row, 1, 1000000) ||
      typeof r.name !== "string" ||
      typeof r.message !== "string" ||
      !r.raw ||
      typeof r.raw !== "object"
    )
      throw Error("Backup source issues are invalid.");
  for (const m of Object.values(s.matches))
    if (
      !m ||
      ![
        "matched",
        "unresolved",
        "not_found",
        "name_mismatch",
        "lookup_failed",
      ].includes(m.status)
    )
      throw Error("Backup matches are invalid.");
  s.settings = { ...base.settings, ...s.settings };
  for (const key of ["workbook_path", "last_import_error"])
    if (typeof s.settings[key] !== "string")
      throw Error("Backup settings are invalid.");
  if (
    s.settings.last_price_success !== null &&
    typeof s.settings.last_price_success !== "string"
  )
    throw Error("Backup price timestamp is invalid.");
  for (const h of s.history)
    if (
      !h ||
      typeof h.source !== "string" ||
      typeof h.status !== "string" ||
      typeof h.created_at !== "string" ||
      (h.fingerprint !== undefined && typeof h.fingerprint !== "string")
    )
      throw Error("Backup import history is invalid.");
  s.price_job = { ...base.price_job, running: false };
  s.pending_import = null;
  upgrade(s);
  if (
    !Array.isArray(s.reservations) ||
    !Array.isArray(s.saved_filters) ||
    !Array.isArray(s.acquisitions) ||
    !s.locations ||
    typeof s.locations !== "object"
  )
    throw Error("Backup workspace data is invalid.");
  for (const [k, v] of Object.entries(s.locations))
    if (typeof v !== "string" || v.length > 150)
      throw Error("Backup locations are invalid.");
  for (const f of s.saved_filters)
    if (
      typeof f.id !== "string" ||
      typeof f.name !== "string" ||
      !f.filters ||
      typeof f.filters !== "object" ||
      Object.values(f.filters).some((v) => typeof v !== "string")
    )
      throw Error("Backup filters are invalid.");
  for (const a of s.acquisitions)
    if (
      typeof a.id !== "string" ||
      typeof a.name !== "string" ||
      !integer(a.quantity, 1, 100000) ||
      !["wanted", "ordered", "received"].includes(a.status) ||
      typeof a.notes !== "string"
    )
      throw Error("Backup acquisitions are invalid.");
  for (const r of s.reservations)
    if (
      !s.entries.some((e) => e.id === r.entry_id) ||
      typeof r.holding_key !== "string" ||
      !integer(r.quantity, 1, 100000000)
    )
      throw Error("Backup reservations are invalid.");
  if (new TextEncoder().encode(JSON.stringify(s)).length > 1800000)
    throw Error(
      "Backup exceeds this version’s collection capacity. Keep the full backup; do not split it into partial inventories.",
    );
  return { version: 1, state: s, cards: raw.cards };
}
async function revision(env, s, d, event) {
  if (!env.BUCKET) throw Error("Recovery storage is unavailable.");
  const key = `deck-revisions/${d.id}/${Date.now()}-${crypto.randomUUID()}.json`,
    created_at = stamp();
  const entries = s.entries.filter((e) => e.deck_id === d.id);
  await env.BUCKET.put(
    key,
    JSON.stringify({ version: 1, created_at, event, deck: d, entries }),
    {
      httpMetadata: { contentType: "application/json" },
      customMetadata: {
        name: d.name,
        created_at,
        event,
        deck_id: String(d.id),
      },
    },
  );
}
function impact(before, after, cards) {
  const a = new Inventory(before, cards),
    b = new Inventory(after, cards);
  return after.decks
    .map((d) => {
      const prev = before.decks.some((x) => x.id === d.id)
          ? a.deck(d.id)
          : null,
        next = b.deck(d.id);
      return {
        id: d.id,
        name: d.name,
        before: prev?.missing_now ?? null,
        after: next.missing_now,
      };
    })
    .filter((d) => d.before !== d.after);
}
async function list(env, prefix, cursor) {
  const result = await env.BUCKET.list({
    prefix,
    limit: 50,
    cursor: cursor || undefined,
    include: ["customMetadata"],
  });
  return {
    items: result.objects
      .map((o) => ({
        key: o.key,
        size: o.size,
        created_at: o.customMetadata?.created_at || o.uploaded,
        name: o.customMetadata?.name || "Collection backup",
        reason: o.customMetadata?.event || "Saved backup",
        deck_id: Number(o.customMetadata?.deck_id) || null,
      }))
      .reverse(),
    cursor: result.truncated ? result.cursor : null,
  };
}
export async function handleRoadmap({
  request,
  env,
  s,
  revision: rev,
  path,
  q,
  method,
  body,
  save,
  cardRows,
  backup,
  json,
}) {
  upgrade(s);
  const version = () => {
    if (
      request.headers.get("x-vault-revision") === null ||
      Number(request.headers.get("x-vault-revision")) !== rev
    )
      throw Error(
        "The collection changed in another tab. Reload and review the change again.",
      );
  };
  if (path === "/backups" && method === "GET")
    return json(await list(env, "backups/", q.get("cursor")));
  if (path === "/revisions" && method === "GET")
    return json(
      await list(
        env,
        q.get("deck_id")
          ? `deck-revisions/${Number(q.get("deck_id"))}/`
          : "deck-revisions/",
        q.get("cursor"),
      ),
    );
  if (path === "/restore/preview" && method === "POST") {
    const data = await body(),
      cards = await cardRows(env);
    let raw;
    if (data.key) {
      if (
        typeof data.key !== "string" ||
        !data.key.startsWith("backups/") ||
        data.key.includes("..")
      )
        throw Error("Choose a saved backup.");
      const object = await env.BUCKET.get(data.key);
      if (!object) throw Error("Backup not found.");
      raw = await object.json();
    } else raw = data.backup;
    const checked = validateBackup(raw),
      id = crypto.randomUUID();
    await env.BUCKET.put(
      `restore-previews/${id}.json`,
      JSON.stringify({
        ...checked,
        revision: rev,
        expires: Date.now() + 900000,
      }),
    );
    return json({
      id,
      revision: rev,
      before: {
        copies: s.holdings.reduce((n, h) => n + h.quantity, 0),
        decks: s.decks.length,
      },
      after: {
        copies: checked.state.holdings.reduce((n, h) => n + h.quantity, 0),
        decks: checked.state.decks.length,
      },
      impact: impact(s, checked.state, checked.cards),
      removed_decks: s.decks
        .filter((d) => !checked.state.decks.some((x) => x.id === d.id))
        .map((d) => d.name),
      message:
        "Replaces inventory, decklists, corrections, cached cards, saved filters, locations, and orders. Excel is unchanged. A backup of the current workspace is saved first.",
    });
  }
  if (path === "/restore/apply" && method === "POST") {
    version();
    const data = await body();
    if (!/^[0-9a-f-]{36}$/.test(data.id || ""))
      throw Error("Choose a valid restore preview.");
    const obj = await env.BUCKET.get(`restore-previews/${data.id}.json`);
    if (!obj) throw Error("Restore preview expired.");
    const raw = await obj.json();
    if (raw.revision !== rev || raw.expires < Date.now())
      throw Error(
        "The collection changed or the preview expired. Create a new preview.",
      );
    const checked = validateBackup(raw);
    await backup(env, s, "Before restoring collection");
    const restored = checked.state;
    restored.next_deck_id = Math.max(restored.next_deck_id, s.next_deck_id);
    restored.next_entry_id = Math.max(restored.next_entry_id, s.next_entry_id);
    restored.restore_token = crypto.randomUUID();
    const guard =
      "EXISTS (SELECT 1 FROM vault WHERE id=1 AND revision=? AND json_extract(payload,'$.restore_token')=?)";
    const statements = [
      env.DB.prepare(
        "UPDATE vault SET payload=?,revision=revision+1 WHERE id=1 AND revision=?",
      ).bind(JSON.stringify(restored), rev),
      env.DB.prepare("DELETE FROM cards WHERE " + guard).bind(
        rev + 1,
        restored.restore_token,
      ),
      ...checked.cards.map((c) =>
        env.DB.prepare(
          "INSERT INTO cards (id,payload,fetched_at) SELECT ?,?,? WHERE " +
            guard,
        ).bind(
          c.id,
          JSON.stringify(c),
          c.fetched_at || stamp(),
          rev + 1,
          restored.restore_token,
        ),
      ),
    ];
    const result = await env.DB.batch(statements);
    if (!result[0].meta.changes)
      throw Error(
        "The collection changed in another tab. Reload and preview again.",
      );
    await env.BUCKET.delete(`restore-previews/${data.id}.json`);
    return json({ restored: true });
  }
  if (path === "/revisions/preview" && method === "POST") {
    const data = await body();
    if (
      typeof data.key !== "string" ||
      !/^deck-revisions\/\d+\/[^/]+\.json$/.test(data.key)
    )
      throw Error("Choose a deck revision.");
    const obj = await env.BUCKET.get(data.key);
    if (!obj) throw Error("Revision not found.");
    const r = await obj.json();
    const entries = validatedEntries({ entries: r.entries });
    if (!r.deck || !formats.has(r.deck.format))
      throw Error("Revision is incompatible.");
    return json({
      key: data.key,
      revision: rev,
      name: r.deck.name,
      deck_id: r.deck.id,
      created_at: r.created_at,
      before: s.entries
        .filter((e) => e.deck_id === r.deck.id)
        .reduce((n, e) => n + e.quantity, 0),
      after: entries.reduce((n, e) => n + e.quantity, 0),
      decklist: deckText(entries),
      deleted: !s.decks.some((d) => d.id === r.deck.id),
    });
  }
  if (path === "/revisions/apply" && method === "POST") {
    version();
    const data = await body();
    if (
      typeof data.key !== "string" ||
      !/^deck-revisions\/\d+\/[^/]+\.json$/.test(data.key)
    )
      throw Error("Choose a deck revision.");
    const obj = await env.BUCKET.get(data.key);
    if (!obj) throw Error("Revision not found.");
    const r = await obj.json(),
      entries = validatedEntries({ entries: r.entries });
    if (!r.deck || !formats.has(r.deck.format))
      throw Error("Revision is incompatible.");
    const current = s.decks.find((d) => d.id === r.deck.id);
    if (current) await revision(env, s, current, "Before restoring revision");
    await backup(env, s, "Before restoring deck");
    s.decks = s.decks.filter((d) => d.id !== r.deck.id);
    s.decks.push({ ...r.deck, updated_at: stamp() });
    const removed = new Set(
      s.entries.filter((e) => e.deck_id === r.deck.id).map((e) => e.id),
    );
    s.entries = s.entries.filter((e) => e.deck_id !== r.deck.id);
    s.reservations = s.reservations.filter((r) => !removed.has(r.entry_id));
    for (const e of entries)
      s.entries.push({ ...e, id: s.next_entry_id++, deck_id: r.deck.id });
    s.next_deck_id = Math.max(s.next_deck_id, r.deck.id + 1);
    await save(env, s, rev);
    return json({ id: r.deck.id, restored: true });
  }
  if (path === "/reservations/preview" && method === "POST") {
    const data = await body(),
      cards = await cardRows(env),
      result = reservationChange(s, cards, data);
    return json({
      revision: rev,
      impact: result.impact,
      message:
        data.operation === "priority"
          ? "Lower numbers reserve first. Changing priority clears manual copy transfers and recomputes all reservations."
          : "Changes planned reservations only. Move physical cards separately; ownership and Excel annotations stay unchanged.",
    });
  }
  if (path === "/reservations/apply" && method === "POST") {
    version();
    const data = await body(),
      cards = await cardRows(env),
      result = reservationChange(s, cards, data);
    await backup(env, s, "Before changing reservations");
    await save(env, result.state, rev);
    return json({ updated: true });
  }
  if (path === "/decks/validate" && method === "POST") {
    const data = await body();
    if (!formats.has(data.format)) throw Error("Choose a supported format.");
    const entries = validatedEntries(data),
      temp = structuredClone(s),
      id = Number(data.id) || -1;
    temp.decks = temp.decks.filter((d) => d.id !== id);
    temp.decks.push({
      id,
      name: data.name || "Draft",
      format: data.format,
      active: 0,
      seeded: 0,
      list_confirmed: Boolean(data.list_confirmed),
    });
    temp.entries = temp.entries.filter((e) => e.deck_id !== id);
    entries.forEach((e, i) =>
      temp.entries.push({ ...e, id: -(i + 1), deck_id: id }),
    );
    return json(new Inventory(temp, await cardRows(env)).deck(id));
  }
  const deck = path.match(/^\/decks(?:\/(\d+))?(\/(active|duplicate))?$/);
  if (deck && ["POST", "PUT", "DELETE"].includes(method)) {
    let d = deck[1] ? s.decks.find((d) => d.id === Number(deck[1])) : null;
    if (deck[1] && !d) throw Error("Deck not found.");
    if (deck[3] === "active") {
      throw Error("Preview reservation changes before saving.");
    }
    if (method === "DELETE") {
      version();
      await revision(env, s, d, "Deck deleted");
      await backup(env, s, "Before deleting " + d.name);
      const ids = new Set(
        s.entries.filter((e) => e.deck_id === d.id).map((e) => e.id),
      );
      s.decks = s.decks.filter((x) => x.id !== d.id);
      s.entries = s.entries.filter((e) => e.deck_id !== d.id);
      s.reservations = s.reservations.filter((r) => !ids.has(r.entry_id));
    } else if (deck[3] === "duplicate") {
      version();
      const source = d;
      d = {
        ...d,
        id: s.next_deck_id++,
        name: (d.name + " copy").slice(0, 100),
        active: 0,
        source_label: null,
        updated_at: stamp(),
      };
      s.decks.push(d);
      for (const e of s.entries.filter((e) => e.deck_id === source.id))
        s.entries.push({ ...e, id: s.next_entry_id++, deck_id: d.id });
    } else {
      const data = await body(),
        name = String(data.name || "").trim();
      if (
        !name ||
        name.length > 100 ||
        !formats.has(data.format) ||
        typeof data.active !== "boolean"
      )
        throw Error("Give the deck a name, format, and reservation state.");
      const entries = validatedEntries(data);
      if (d) {
        version();
        await revision(env, s, d, "Before editing deck");
      } else {
        d = { id: s.next_deck_id++, priority: 0, source_label: null };
        s.decks.push(d);
      }
      const old = s.entries.filter((e) => e.deck_id === d.id),
        key = (e) =>
          JSON.stringify([
            normalized(e.name),
            e.zone,
            e.printing_key || null,
            e.finish || null,
          ]);
      Object.assign(d, {
        name,
        format: data.format,
        active: Number(data.active),
        seeded: 0,
        list_confirmed: Boolean(data.list_confirmed),
        updated_at: stamp(),
      });
      s.entries = s.entries.filter((e) => e.deck_id !== d.id);
      for (const e of entries) {
        const previous = old.find((x) => key(x) === key(e));
        s.entries.push({
          ...e,
          id: previous?.id || s.next_entry_id++,
          deck_id: d.id,
        });
      }
      s.reservations = s.reservations.filter((r) =>
        s.entries.some((e) => e.id === r.entry_id),
      );
    }
    await save(env, s, rev);
    return json({ id: d?.id, updated: true });
  }
  if (path === "/locations" && method === "PATCH") {
    version();
    const data = await body();
    if (
      typeof data.key !== "string" ||
      !new Inventory(s).collection().some((c) => c.key === data.key) ||
      typeof data.location !== "string" ||
      data.location.length > 150
    )
      throw Error(
        "Choose a collection card and a location of up to 150 characters.",
      );
    s.locations[data.key] = data.location.trim();
    await save(env, s, rev);
    return json({ updated: true });
  }
  if (path === "/filters" && method === "POST") {
    const data = await body();
    if (
      typeof data.name !== "string" ||
      !data.name.trim() ||
      data.name.length > 60 ||
      !data.filters ||
      typeof data.filters !== "object" ||
      s.saved_filters.length >= 20
    )
      throw Error(
        "Save up to 20 filters, each with a name of up to 60 characters.",
      );
    const allowed = [
      "q",
      "color",
      "type",
      "foil",
      "status",
      "deck_id",
      "location",
    ];
    const filters = Object.fromEntries(
      allowed
        .filter((k) => data.filters[k] !== undefined)
        .map((k) => [k, String(data.filters[k]).slice(0, 200)]),
    );
    s.saved_filters.push({
      id: crypto.randomUUID(),
      name: data.name.trim(),
      filters,
    });
    await save(env, s, rev);
    return json({ updated: true });
  }
  if (path.startsWith("/filters/") && method === "DELETE") {
    s.saved_filters = s.saved_filters.filter(
      (f) => f.id !== path.split("/")[2],
    );
    await save(env, s, rev);
    return json({ updated: true });
  }
  if (path === "/acquisitions" && method === "POST") {
    const data = await body();
    if (
      typeof data.name !== "string" ||
      !data.name.trim() ||
      data.name.length > 200 ||
      !integer(data.quantity, 1, 100000) ||
      s.acquisitions.length >= 500
    )
      throw Error(
        "Enter a card name and a positive quantity. Up to 500 order records are supported.",
      );
    s.acquisitions.push({
      id: crypto.randomUUID(),
      name: data.name.trim(),
      quantity: data.quantity,
      printing_key: String(data.printing_key || "").slice(0, 40),
      finish:
        data.finish === "foil"
          ? "foil"
          : data.finish === "nonfoil"
            ? "nonfoil"
            : null,
      status: "wanted",
      notes: String(data.notes || "").slice(0, 300),
      updated_at: stamp(),
    });
    await save(env, s, rev);
    return json({ updated: true });
  }
  const acquisition = path.match(/^\/acquisitions\/([^/]+)$/);
  if (acquisition && ["PATCH", "DELETE"].includes(method)) {
    version();
    const item = s.acquisitions.find((a) => a.id === acquisition[1]);
    if (!item) throw Error("Order record not found.");
    if (method === "DELETE")
      s.acquisitions = s.acquisitions.filter((a) => a.id !== item.id);
    else {
      const data = await body();
      if (!["wanted", "ordered", "received"].includes(data.status))
        throw Error("Choose wanted, ordered, or received.");
      item.status = data.status;
      item.updated_at = stamp();
    }
    await save(env, s, rev);
    return json({ updated: true });
  }
  return null;
}
