export const normalized = (s) =>
  String(s ?? "")
    .normalize("NFKC")
    .replaceAll("’", "'")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
export const collector = (s) =>
  /^\d+$/.test(String(s)) ? String(Number(s)) : String(s ?? "").trim();
export const printingKey = (s, n) =>
  `${String(s ?? "")
    .trim()
    .toLowerCase()}:${collector(n)}`;
export function parseDecklist(text) {
  const grouped = new Map();
  let zone = "main";
  for (const [i, raw] of String(text).split("\n").entries()) {
    let line = raw.trim();
    if (!line) continue;
    const head = line
      .replace(/^\/\//, "")
      .replace(/^[\[:]+|[\]:]+$/g, "")
      .trim()
      .toLowerCase();
    if (
      [
        "commander",
        "commanders",
        "command zone",
        "sideboard",
        "main",
        "mainboard",
        "deck",
        "maindeck",
      ].includes(head)
    ) {
      zone = head.startsWith("command")
        ? "commander"
        : head === "sideboard"
          ? "sideboard"
          : "main";
      continue;
    }
    if (line.startsWith("#") || line.startsWith("//")) continue;
    const m = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 100000)
      throw Error(
        `Line ${i + 1}: use a positive quantity followed by a card name.`,
      );
    let name = m[2].trim(),
      key = null,
      finish = null;
    const ending = name.match(/\s+\[(foil|nonfoil)\]$/i);
    if (ending) {
      finish = ending[1].toLowerCase();
      name = name.slice(0, ending.index).trim();
    }
    const exact = name.match(
      /^(.+?)\s+\(([A-Za-z0-9]{2,8})\)\s+([0-9]+[A-Za-z★]*)$/,
    );
    if (exact) {
      name = exact[1].trim();
      key = printingKey(exact[2], exact[3]);
    }
    const k = JSON.stringify([normalized(name), zone, key, finish]);
    const e = grouped.get(k) || {
      name,
      zone,
      printing_key: key,
      finish,
      quantity: 0,
    };
    e.quantity += Number(m[1]);
    grouped.set(k, e);
  }
  return [...grouped.values()];
}
export const freshState = () => ({
  schema_version: 2,
  reservations: [],
  locations: {},
  saved_filters: [],
  acquisitions: [],
  settings: {
    workbook_path: "MagicTheGatheringInventory.xlsx",
    currency: "EUR",
    auto_watch: false,
    foil_mode: "total",
    last_import_error: "",
    last_price_success: null,
  },
  holdings: [],
  issues: [],
  matches: {},
  decks: [],
  entries: [],
  seeded_labels: [],
  next_deck_id: 1,
  next_entry_id: 1,
  history: [],
  pending_import: null,
  price_job: { running: false, completed: 0, total: 0, error: "", message: "" },
});
export function counts(holdings) {
  const out = {};
  for (const h of holdings) {
    const k = JSON.stringify([h.printing_key, h.finish, normalized(h.name)]);
    out[k] = (out[k] || 0) + h.quantity;
  }
  return out;
}
export function reductions(old, next) {
  const a = counts(old),
    b = counts(next);
  return Object.entries(a)
    .filter(([k, n]) => (b[k] || 0) < n)
    .map(([k, n]) => {
      const [printing_key, finish, name] = JSON.parse(k);
      return { name, printing_key, finish, before: n, after: b[k] || 0 };
    });
}
export function applySnapshot(s, p, id) {
  s.holdings = p.holdings.map((h, i) => ({ ...h, id: i + 1 }));
  s.issues = p.issues.map((r, i) => ({ ...r, id: i + 1 }));
  for (const h of s.holdings)
    s.matches[h.printing_key] ??= {
      status: "unresolved",
      message: "",
      card_id: null,
    };
  const labels = new Map();
  for (const h of s.holdings) {
    if (!h.deck_label) continue;
    const group = labels.get(h.deck_label) || new Map();
    group.set(h.name, (group.get(h.name) || 0) + h.quantity);
    labels.set(h.deck_label, group);
  }
  for (const [label, group] of labels) {
    if (s.seeded_labels.includes(label)) continue;
    const did = Math.max(
      s.next_deck_id || 1,
      Math.max(0, ...s.decks.map((d) => d.id)) + 1,
    );
    s.next_deck_id = did + 1;
    s.decks.push({
      id: did,
      name: label,
      format: label.toLowerCase().includes("commander")
        ? "commander"
        : "casual60",
      active: 1,
      priority: 0,
      source_label: label,
      seeded: 1,
      list_confirmed: false,
      updated_at: new Date().toISOString(),
    });
    for (const [name, quantity] of group)
      s.entries.push({
        id: Math.max(0, ...s.entries.map((e) => e.id)) + 1,
        deck_id: did,
        name,
        quantity,
        zone: "main",
        printing_key: null,
      });
    s.seeded_labels.push(label);
  }
  s.reservations = [];
  s.settings.workbook_path = p.source;
  s.settings.last_import_error = "";
  s.pending_import = null;
  s.fingerprint = p.fingerprint;
  s.last_import = {
    id,
    source: p.source,
    created_at: new Date().toISOString(),
  };
}
export class Inventory {
  constructor(s, cards = []) {
    this.s = s;
    this.cards = new Map(cards.map((c) => [c.id, c]));
    this.names = new Map();
    for (const c of cards)
      for (const name of [c.name, ...(c.card_faces || []).map((f) => f.name)])
        this.names.set(normalized(name), c);
    this.holdings = s.holdings.map((h) => ({
      ...h,
      identity: this.identity(h.name, this.card(h.printing_key)),
    }));
    this.entries = s.entries.map((e) => {
      const card = e.printing_key
        ? this.card(e.printing_key)
        : this.names.get(normalized(e.name));
      return {
        ...e,
        identity: this.identity(e.name, card),
        card,
        canonical_name: card?.name || e.name,
      };
    });
    this.decks = s.decks;
    this.holdingById = new Map(this.holdings.map((h) => [h.id, h]));
    this.entriesByIdentity = new Map();
    for (const e of this.entries) {
      const es = this.entriesByIdentity.get(e.identity) || [];
      es.push(e);
      this.entriesByIdentity.set(e.identity, es);
    }
  }
  card(key) {
    const m = this.s.matches[key];
    return m?.status === "matched" ? this.cards.get(m.card_id) : null;
  }
  identity(name, card) {
    card ??= this.names.get(normalized(name));
    return card?.oracle_id
      ? `oracle:${card.oracle_id}`
      : `name:${normalized(card?.name || name)}`;
  }
  effective(key) {
    const c = this.card(key);
    return c ? printingKey(c.set, c.collector_number) : key;
  }
  compatible(e, h) {
    return (
      e.identity === h.identity &&
      (!e.printing_key ||
        this.effective(e.printing_key) === this.effective(h.printing_key)) &&
      (!e.finish || e.finish === h.finish)
    );
  }
  unit(h) {
    const c = this.card(h.printing_key);
    const k =
      (this.s.settings.currency === "EUR" ? "eur" : "usd") +
      (h.finish === "foil" ? "_foil" : "");
    const raw = c?.prices?.[k];
    return raw != null &&
      raw !== "" &&
      Number.isFinite(Number(raw)) &&
      Number(raw) >= 0
      ? Number(raw)
      : null;
  }
  estimate(e) {
    const prices = this.holdings
      .filter((h) => this.compatible(e, h))
      .map((h) => this.unit(h));
    const candidates = e.printing_key
      ? [this.card(e.printing_key)]
      : [...this.cards.values()].filter(
          (c) => this.identity(c.name, c) === e.identity,
        );
    for (const c of candidates) {
      if (!c) continue;
      for (const finish of e.finish ? [e.finish] : ["nonfoil", "foil"]) {
        const k =
          (this.s.settings.currency === "EUR" ? "eur" : "usd") +
          (finish === "foil" ? "_foil" : "");
        const n = c.prices?.[k];
        if (
          n != null &&
          n !== "" &&
          Number.isFinite(Number(n)) &&
          Number(n) >= 0
        )
          prices.push(Number(n));
      }
    }
    const known = prices.filter((n) => n !== null && n >= 0);
    return known.length ? Math.min(...known) : null;
  }
  allocate(ids) {
    const remaining = new Map(this.holdings.map((h) => [h.id, h.quantity])),
      out = new Map(),
      needs = new Map();
    const entries = this.entries
      .filter((e) => ids.has(e.deck_id))
      .sort(
        (a, b) =>
          (this.decks.find((d) => d.id === a.deck_id)?.priority || 0) -
            (this.decks.find((d) => d.id === b.deck_id)?.priority || 0) ||
          Number(Boolean(b.printing_key)) * 2 +
            Number(Boolean(b.finish)) -
            (Number(Boolean(a.printing_key)) * 2 + Number(Boolean(a.finish))) ||
          a.deck_id - b.deck_id ||
          a.id - b.id,
      );
    for (const e of entries) {
      out.set(e.id, []);
      needs.set(e.id, e.quantity);
    }
    const take = (e, h, n) => {
      n = Math.min(n, needs.get(e.id), remaining.get(h.id));
      if (n > 0) {
        out.get(e.id).push([h.id, n]);
        remaining.set(h.id, remaining.get(h.id) - n);
        needs.set(e.id, needs.get(e.id) - n);
      }
      return n;
    };
    for (const r of this.s.reservations || []) {
      const e = entries.find((e) => e.id === r.entry_id);
      if (!e) continue;
      let n = r.quantity;
      for (const h of this.holdings.filter(
        (h) => holdingKey(h) === r.holding_key && this.compatible(e, h),
      )) {
        n -= take(e, h, n);
        if (n <= 0) break;
      }
    }
    for (const e of entries) {
      const d = this.decks.find((d) => d.id === e.deck_id);
      const holdings = this.holdings
        .filter((h) => this.compatible(e, h))
        .sort(
          (a, b) =>
            Number(a.deck_label !== (d.source_label || d.name)) -
              Number(b.deck_label !== (d.source_label || d.name)) ||
            a.id - b.id,
        );
      for (const h of holdings) {
        take(e, h, needs.get(e.id));
        if (!needs.get(e.id)) break;
      }
    }
    return out;
  }
  collection() {
    const groups = new Map(),
      groupHoldings = new Map();
    for (const h of this.holdings) {
      const key = `${h.printing_key}|${normalized(h.name)}`,
        c = this.card(h.printing_key),
        m = this.s.matches[h.printing_key];
      let row = groups.get(key);
      if (!row) {
        row = {
          key,
          printing_key: h.printing_key,
          name: c?.name || h.name,
          set_code: h.set_code,
          collector_number: h.collector_number,
          quantity: 0,
          nonfoil: 0,
          foil: 0,
          card_type: c?.type_line || h.card_type || "",
          color: h.color || "",
          rarity: h.rarity || "",
          value: 0,
          priced_copies: 0,
          prices: { nonfoil: null, foil: null },
          decks: [],
          notes: [],
          source_rows: [],
          match_status: m?.status || "unresolved",
          match_message: m?.message || "",
          image_url:
            c?.image_uris?.normal ||
            c?.card_faces?.find((f) => f.image_uris)?.image_uris?.normal ||
            null,
          scryfall_url: c?.scryfall_uri || null,
          oracle_text:
            c?.oracle_text ||
            (c?.card_faces || []).map((f) => f.oracle_text || "").join("\n\n"),
          mana_cost: c?.mana_cost || "",
          fetched_at: c?.fetched_at || null,
          reservations: [],
        };
        groups.set(key, row);
        groupHoldings.set(key, []);
      }
      groupHoldings.get(key).push(h);
      row.quantity += h.quantity;
      row[h.finish] += h.quantity;
      const price = this.unit(h);
      if (price !== null) {
        row.prices[h.finish] = price;
        row.value += (Math.round(price * 100) * h.quantity) / 100;
        row.priced_copies += h.quantity;
      }
      for (const [k, v] of [
        ["decks", h.deck_label],
        ["notes", h.notes],
        ["source_rows", h.source_row],
      ])
        if (v && !row[k].includes(v)) row[k].push(v);
    }
    const allocated = this.allocate(
        new Set(this.decks.filter((d) => d.active).map((d) => d.id)),
      ),
      decks = new Map(this.decks.map((d) => [d.id, d]));
    for (const e of this.entries)
      for (const [hid, n] of allocated.get(e.id) || []) {
        const h = this.holdingById.get(hid),
          row = groups.get(`${h.printing_key}|${normalized(h.name)}`),
          d = decks.get(e.deck_id);
        const r = row.reservations.find(
          (r) => r.deck_id === d.id && r.finish === h.finish,
        );
        if (r) r.quantity += n;
        else
          row.reservations.push({
            deck_id: d.id,
            name: d.name,
            quantity: n,
            finish: h.finish,
          });
      }
    return [...groups.values()]
      .map((c) => {
        const artwork = this.card(c.printing_key),
          holdings = groupHoldings.get(c.key),
          requirements = this.entriesByIdentity.get(holdings[0].identity) || [];
        return {
          ...c,
          value: c.priced_copies ? Math.round(c.value * 100) / 100 : null,
          reserved: c.reservations.reduce((n, r) => n + r.quantity, 0),
          location: this.s.locations?.[c.key] || "",
          needed_by: [
            ...new Set(
              requirements
                .filter((e) => holdings.some((h) => this.compatible(e, h)))
                .map((e) => e.deck_id),
            ),
          ],
          image_faces: (artwork?.card_faces || [])
            .filter((f) => f.image_uris?.normal)
            .map((f) => ({ name: f.name, url: f.image_uris.normal })),
          price_state:
            c.match_status !== "matched"
              ? c.match_status === "lookup_failed"
                ? "failed"
                : "unmatched"
              : !c.priced_copies
                ? "unknown"
                : c.fetched_at &&
                    Date.now() - new Date(c.fetched_at).getTime() > 86400000
                  ? "stale"
                  : "current",
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  warnings(d, entries) {
    const out = [],
      total = entries
        .filter((e) => e.zone !== "sideboard")
        .reduce((a, e) => a + e.quantity, 0);
    if (d.seeded)
      out.push(
        "Started from workbook assignments. Save the intended target list, including cards you do not own.",
      );
    if (d.format === "commander") {
      if (total !== 100)
        out.push(
          `This list contains ${total} cards outside the sideboard; a typical Commander deck has 100.`,
        );
      const cmd = entries.filter((e) => e.zone === "commander");
      if (!cmd.length)
        out.push("No commander is designated. Add a Commander section.");
      if (cmd.reduce((a, e) => a + e.quantity, 0) > 1)
        out.push("Review multiple-commander pairing rules manually.");
      if (cmd.length && cmd.every((e) => e.card)) {
        const colors = new Set(cmd.flatMap((e) => e.card.color_identity || []));
        const outside = entries.filter(
          (e) =>
            e.card && (e.card.color_identity || []).some((c) => !colors.has(c)),
        );
        if (outside.length)
          out.push(
            "Outside commander color identity: " +
              outside.map((e) => e.canonical_name).join(", "),
          );
      }
    } else {
      const main = entries
        .filter((e) => e.zone === "main")
        .reduce((n, e) => n + e.quantity, 0);
      if (main < 60)
        out.push(
          `Main deck has ${main} cards; a typical 60-card format requires at least 60.`,
        );
      if (entries.some((e) => e.zone === "commander"))
        out.push("The command zone is only supported for Commander decks.");
      if (
        d.format !== "casual60" &&
        entries
          .filter((e) => e.zone === "sideboard")
          .reduce((n, e) => n + e.quantity, 0) > 15
      )
        out.push("Sideboard exceeds the usual 15-card limit.");
    }
    const groups = new Map();
    for (const e of entries) {
      const g = groups.get(e.identity) || [];
      g.push(e);
      groups.set(e.identity, g);
    }
    for (const group of groups.values()) {
      const e = group[0],
        c = e.card,
        n = group.reduce((a, x) => a + x.quantity, 0);
      const basic =
        /Basic.*Land/.test(c?.type_line || "") ||
        /^(Snow-Covered )?(Plains|Island|Swamp|Mountain|Forest|Wastes)$/.test(
          e.name,
        );
      const limit = d.format === "commander" ? 1 : 4;
      if (
        n > limit &&
        !basic &&
        !/a deck can have (any number|up to)/i.test(c?.oracle_text || "")
      )
        out.push(
          `${e.canonical_name}: ${n} copies exceed the usual ${limit}-copy limit. Check card-specific exceptions.`,
        );
      const legal = c?.legalities?.[d.format];
      if (d.format !== "casual60" && ["banned", "not_legal"].includes(legal))
        out.push(
          `${e.canonical_name} is ${legal.replace("_", " ")} in ${d.format}.`,
        );
      if (legal === "restricted" && n > 1)
        out.push(`${e.canonical_name} is restricted to one copy.`);
    }
    const unknown = entries
      .filter((e) => !e.card)
      .reduce((a, e) => a + e.quantity, 0);
    if (unknown)
      out.push(
        `Rules and legality metadata are unavailable for ${unknown} copies. Format checks are incomplete.`,
      );
    return out;
  }
  deck(id) {
    const d = this.decks.find((d) => d.id === id);
    if (!d) throw Error("Deck not found.");
    const entries = this.entries.filter((e) => e.deck_id === id),
      own = this.allocate(new Set([id])),
      allocated = this.allocate(
        new Set([...this.decks.filter((d) => d.active).map((d) => d.id), id]),
      );
    const owners = new Map();
    for (const other of this.entries.filter((e) => e.deck_id !== id))
      for (const [hid, n] of allocated.get(other.id) || []) {
        const list = owners.get(hid) || [];
        list.push({ deck_id: other.deck_id, quantity: n });
        owners.set(hid, list);
      }
    const rows = entries.map((e) => {
      const holdings = this.holdings.filter((h) => this.compatible(e, h)),
        owned = holdings.reduce((a, h) => a + h.quantity, 0),
        reserved_by = [];
      for (const h of holdings) {
        for (const other of owners.get(h.id) || []) {
          const n = other.quantity,
            deck = this.decks.find((d) => d.id === other.deck_id);
          let r = reserved_by.find(
            (r) =>
              r.deck_id === deck.id &&
              r.printing_key === h.printing_key &&
              r.finish === h.finish,
          );
          if (r) r.quantity += n;
          else
            reserved_by.push({
              deck_id: deck.id,
              name: deck.name,
              printing_key: h.printing_key,
              finish: h.finish,
              quantity: n,
            });
        }
      }
      const other = reserved_by.reduce((a, r) => a + r.quantity, 0),
        covered = (own.get(e.id) || []).reduce((a, p) => a + p[1], 0),
        assigned = (allocated.get(e.id) || []).reduce((a, p) => a + p[1], 0);
      return {
        id: e.id,
        name: e.canonical_name,
        quantity: e.quantity,
        zone: e.zone,
        printing_key: e.printing_key,
        finish: e.finish || null,
        owned,
        available: owned - other,
        in_other_decks: other,
        reserved_by,
        covered,
        assigned,
        missing: e.quantity - covered,
        missing_now: e.quantity - assigned,
        estimate: this.estimate(e),
        card: e.card
          ? {
              mana_value: e.card.cmc,
              type_line: e.card.type_line,
              color_identity: e.card.color_identity,
              mana_cost: e.card.mana_cost,
              image_url:
                e.card.image_uris?.small ||
                e.card.card_faces?.[0]?.image_uris?.small,
            }
          : null,
      };
    });
    const warnings = this.warnings(d, entries),
      entered = rows
        .filter((e) => e.zone !== "sideboard")
        .reduce((a, e) => a + e.quantity, 0),
      target = d.format === "commander" ? 100 : 60;
    const sizeOK = d.format === "commander" ? entered === 100 : entered >= 60;
    const confirmed =
      d.list_confirmed === true || (!d.seeded && d.list_confirmed !== false);
    const complete = confirmed && sizeOK;
    const readiness = {
      list: {
        complete,
        confirmed,
        entered,
        target,
        unspecified: Math.max(0, target - entered),
        label: !sizeOK
          ? "Target list incomplete"
          : !confirmed
            ? "Confirm intended list"
            : "Target list complete",
      },
      ownership: {
        covered: rows.reduce((a, e) => a + e.covered, 0),
        required: rows.reduce((a, e) => a + e.quantity, 0),
      },
      availability: { short: rows.reduce((a, e) => a + e.missing_now, 0) },
      format: {
        status: warnings.length ? "Review required" : "Advisory checks passed",
      },
    };
    return {
      ...d,
      list_confirmed: confirmed,
      entries: rows,
      decklist: deckText(entries),
      warnings,
      readiness,
      total: rows.reduce((a, e) => a + e.quantity, 0),
      covered: readiness.ownership.covered,
      missing: rows.reduce((a, e) => a + e.missing, 0),
      missing_now: readiness.availability.short,
      analysis: analyzeDeck(entries),
    };
  }
  wishlist(ids, mode = "assembled") {
    if (
      mode === "shared" &&
      this.entries.some((e) => ids.has(e.deck_id) && e.finish)
    )
      return sharedWishlist(this, ids);
    if (!["assembled", "shared"].includes(mode))
      throw Error("Choose assembled or shared decks.");
    const entries = this.entries.filter((e) => ids.has(e.deck_id)),
      items = [];
    const push = (e, quantity, dids) => {
      if (quantity > 0)
        items.push({
          name: e.canonical_name,
          printing_key: e.printing_key,
          finish: e.finish || null,
          quantity,
          estimate: this.estimate(e),
          decks: [...dids].map(
            (id) => this.decks.find((d) => d.id === id)?.name || "",
          ),
        });
    };
    if (mode === "assembled") {
      const a = this.allocate(ids),
        groups = new Map();
      for (const e of entries) {
        const n =
          e.quantity - (a.get(e.id) || []).reduce((a, p) => a + p[1], 0);
        if (!n) continue;
        const key = JSON.stringify([
            e.identity,
            e.printing_key,
            e.finish || null,
          ]),
          g = groups.get(key) || { e, n: 0, ids: new Set() };
        g.n += n;
        g.ids.add(e.deck_id);
        groups.set(key, g);
      }
      for (const g of groups.values()) push(g.e, g.n, g.ids);
    } else {
      const groups = new Map();
      for (const e of entries) {
        const g = groups.get(e.identity) || [];
        g.push(e);
        groups.set(e.identity, g);
      }
      for (const [identity, group] of groups) {
        const totals = new Map(),
          exact = new Map(),
          owned = new Map();
        for (const e of group) {
          totals.set(e.deck_id, (totals.get(e.deck_id) || 0) + e.quantity);
          if (e.printing_key) {
            const k = this.effective(e.printing_key),
              g = exact.get(k) || new Map();
            g.set(e.deck_id, (g.get(e.deck_id) || 0) + e.quantity);
            exact.set(k, g);
          }
        }
        for (const h of this.holdings.filter((h) => h.identity === identity)) {
          const k = this.effective(h.printing_key);
          owned.set(k, (owned.get(k) || 0) + h.quantity);
        }
        let shortages = 0;
        for (const [k, demands] of exact) {
          const n = Math.max(
            0,
            Math.max(...demands.values()) - (owned.get(k) || 0),
          );
          shortages += n;
          push(
            group.find(
              (e) => e.printing_key && this.effective(e.printing_key) === k,
            ),
            n,
            new Set(demands.keys()),
          );
        }
        const extra = Math.max(
          0,
          Math.max(...totals.values()) -
            [...owned.values()].reduce((a, n) => a + n, 0) -
            shortages,
        );
        push(
          {
            ...(group.find((e) => !e.printing_key) || group[0]),
            printing_key: null,
          },
          extra,
          new Set(totals.keys()),
        );
      }
    }
    return {
      items: items.sort((a, b) => a.name.localeCompare(b.name)),
      copies: items.reduce((a, e) => a + e.quantity, 0),
      estimate: items.reduce((a, e) => a + (e.estimate ?? 0) * e.quantity, 0),
      priced_copies: items
        .filter((e) => e.estimate !== null)
        .reduce((a, e) => a + e.quantity, 0),
      mode,
    };
  }
}
export function textExport(rows) {
  const map = new Map();
  for (const r of rows)
    if (r.quantity > 0) map.set(r.name, (map.get(r.name) || 0) + r.quantity);
  return (
    [...map]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, n]) => `${n} ${name}`)
      .join("\n") + (map.size ? "\n" : "")
  );
}

export const holdingKey = (h) =>
  JSON.stringify([h.printing_key, h.finish, normalized(h.name)]);
export function deckText(entries) {
  const lines = [];
  for (const zone of ["commander", "main", "sideboard"]) {
    const rows = entries.filter((e) => e.zone === zone);
    if (!rows.length) continue;
    if (lines.length) lines.push("");
    lines.push(
      { commander: "Commander", main: "Deck", sideboard: "Sideboard" }[zone],
    );
    for (const e of rows)
      lines.push(
        `${e.quantity} ${e.name}${e.printing_key ? " (" + e.printing_key.split(":")[0].toUpperCase() + ") " + e.printing_key.split(":")[1] : ""}${e.finish ? " [" + e.finish + "]" : ""}`,
      );
  }
  return lines.join("\n");
}
export function analyzeDeck(entries) {
  const curve = Array(8).fill(0),
    types = {},
    colors = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
  let lands = 0,
    known = 0,
    unknown = 0;
  for (const e of entries.filter((e) => e.zone !== "sideboard")) {
    const c = e.card;
    if (!c) {
      unknown += e.quantity;
      continue;
    }
    known += e.quantity;
    const land = /\bLand\b/.test(c.type_line || "");
    if (land) lands += e.quantity;
    else
      curve[Math.min(7, Math.max(0, Math.floor(Number(c.cmc) || 0)))] +=
        e.quantity;
    for (const type of [
      "Creature",
      "Instant",
      "Sorcery",
      "Artifact",
      "Enchantment",
      "Land",
      "Planeswalker",
      "Battle",
    ])
      if ((c.type_line || "").includes(type))
        types[type] = (types[type] || 0) + e.quantity;
    for (const symbol of (
      c.mana_cost || (c.card_faces || []).map((f) => f.mana_cost || "").join("")
    ).matchAll(/\{([^}]+)\}/g))
      for (const color of new Set(symbol[1].split("/")))
        if (color in colors) colors[color] += e.quantity;
  }
  return { curve, types, colors, lands, known, unknown };
}
export function snapshotChanges(old, next) {
  const a = counts(old),
    b = counts(next),
    keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys]
    .filter((k) => (a[k] || 0) !== (b[k] || 0))
    .map((k) => {
      const [printing_key, finish, name] = JSON.parse(k);
      return {
        name,
        printing_key,
        finish,
        before: a[k] || 0,
        after: b[k] || 0,
        kind: !a[k] ? "Added" : !b[k] ? "Removed" : "Quantity changed",
        source_rows: next
          .filter((h) => holdingKey(h) === k)
          .map((h) => h.source_row),
      };
    });
}
export function reservationChange(s, cards, data) {
  const inv = new Inventory(s, cards),
    ids = new Set(s.decks.filter((d) => d.active).map((d) => d.id)),
    before = s.decks.map((d) => inv.deck(d.id));
  const next = structuredClone(s),
    d = next.decks.find((d) => d.id === Number(data.deck_id));
  if (!d) throw Error("Deck not found.");
  if (data.operation === "priority") {
    if (
      !Number.isSafeInteger(data.priority) ||
      data.priority < 0 ||
      data.priority > 999
    )
      throw Error("Priority must be a whole number from 0 to 999.");
    d.priority = data.priority;
    next.reservations = [];
  } else if (data.operation === "active") {
    if (typeof data.active !== "boolean")
      throw Error("Choose reserved or draft.");
    d.active = Number(data.active);
    next.reservations = (next.reservations || []).filter(
      (r) => next.entries.find((e) => e.id === r.entry_id)?.deck_id !== d.id,
    );
  } else if (data.operation === "transfer") {
    if (!d.active)
      throw Error("Reserve the destination deck before moving copies.");
    const e = inv.entries.find(
        (e) => e.id === Number(data.entry_id) && e.deck_id === d.id,
      ),
      from = Number(data.from_deck_id);
    if (!e || from === d.id || !ids.has(from))
      throw Error("Choose an active source deck and target requirement.");
    const qty = Number(data.quantity);
    if (!Number.isSafeInteger(qty) || qty < 1)
      throw Error("Move a positive whole number of copies.");
    const allocation = inv.allocate(ids),
      assigned = (allocation.get(e.id) || []).reduce((n, p) => n + p[1], 0);
    if (qty > e.quantity - assigned)
      throw Error(
        "The target requirement does not need that many additional copies.",
      );
    let remaining = qty;
    const received = [];
    for (const other of inv.entries.filter((x) => x.deck_id === from)) {
      for (const pair of allocation.get(other.id) || []) {
        const h = inv.holdings.find((h) => h.id === pair[0]);
        if (
          !inv.compatible(e, h) ||
          h.printing_key !== data.printing_key ||
          h.finish !== data.finish
        )
          continue;
        const n = Math.min(remaining, pair[1]);
        pair[1] -= n;
        remaining -= n;
        if (n) received.push([h.id, n]);
      }
    }
    if (remaining)
      throw Error(
        "Those compatible copies are no longer reserved by the source deck. Reload and try again.",
      );
    allocation.set(e.id, [...(allocation.get(e.id) || []), ...received]);
    const grouped = new Map();
    for (const [eid, pairs] of allocation)
      for (const [hid, n] of pairs) {
        if (!n) continue;
        const key = holdingKey(inv.holdings.find((h) => h.id === hid)),
          rk = JSON.stringify([eid, key]),
          r = grouped.get(rk) || {
            entry_id: eid,
            holding_key: key,
            quantity: 0,
          };
        r.quantity += n;
        grouped.set(rk, r);
      }
    next.reservations = [...grouped.values()];
  } else throw Error("Choose a reservation action.");
  const after = next.decks.map((d) => new Inventory(next, cards).deck(d.id));
  return {
    state: next,
    impact: after
      .map((a) => ({
        id: a.id,
        name: a.name,
        before: before.find((b) => b.id === a.id).missing_now,
        after: a.missing_now,
      }))
      .filter((r) => r.before !== r.after),
  };
}

// Build a reusable compatible copy pool. Resolve the most constrained shortages
// first; each selected deck is allocated independently against the same pool.
function sharedWishlist(inv, ids) {
  const state = structuredClone(inv.s),
    cards = [...inv.cards.values()],
    items = new Map();
  let nextId = Math.max(0, ...state.holdings.map((h) => h.id)) + 1;
  const original = inv.entries.filter((e) => ids.has(e.deck_id));
  for (let step = 0; step <= original.length * 2 + 1; step++) {
    const current = new Inventory(state, cards),
      missing = [];
    for (const id of ids) {
      const allocation = current.allocate(new Set([id]));
      for (const e of current.entries.filter((e) => e.deck_id === id)) {
        const short =
          e.quantity -
          (allocation.get(e.id) || []).reduce((n, p) => n + p[1], 0);
        if (short) missing.push({ ...e, short });
      }
    }
    if (!missing.length) break;
    missing.sort(
      (a, b) =>
        Number(Boolean(b.printing_key)) * 2 +
        Number(Boolean(b.finish)) -
        (Number(Boolean(a.printing_key)) * 2 + Number(Boolean(a.finish))),
    );
    const e = missing[0];
    const keys = e.printing_key
      ? [e.printing_key]
      : [
          ...new Set([
            ...missing
              .filter((x) => x.identity === e.identity && x.printing_key)
              .map((x) => x.printing_key),
            ...current.holdings
              .filter((h) => h.identity === e.identity)
              .map((h) => h.printing_key),
            "wishlist:0",
          ]),
        ];
    const candidates = keys.flatMap((key) =>
      (e.finish ? [e.finish] : ["nonfoil", "foil"]).map((finish) => ({
        id: nextId,
        name: e.name,
        printing_key: key,
        set_code: key.split(":")[0],
        collector_number: key.split(":")[1],
        finish,
        quantity: 0,
        identity: e.identity,
      })),
    );
    candidates.sort(
      (a, b) =>
        missing
          .filter((x) => x.identity === e.identity && current.compatible(x, b))
          .reduce((n, x) => n + x.short, 0) -
        missing
          .filter((x) => x.identity === e.identity && current.compatible(x, a))
          .reduce((n, x) => n + x.short, 0),
    );
    const h = candidates[0],
      quantity = Math.max(
        ...missing
          .filter(
            (x) =>
              x.identity === e.identity &&
              (x.printing_key || null) === (e.printing_key || null) &&
              (x.finish || null) === (e.finish || null),
          )
          .map((x) => x.short),
      );
    state.holdings.push({
      ...h,
      id: nextId++,
      quantity,
      source_row: 0,
      deck_label: "",
      notes: "",
    });
    const key = JSON.stringify([
        e.identity,
        e.printing_key || null,
        e.finish || null,
      ]),
      item = items.get(key) || {
        name: e.canonical_name,
        printing_key: e.printing_key || null,
        finish: e.finish || null,
        quantity: 0,
        estimate: inv.estimate(e),
        decks: [],
      };
    item.quantity += quantity;
    item.decks = [
      ...new Set([
        ...item.decks,
        ...missing
          .filter((x) => x.identity === e.identity)
          .map((x) => inv.decks.find((d) => d.id === x.deck_id).name),
      ]),
    ];
    items.set(key, item);
    if (step === original.length * 2 + 1)
      throw Error(
        "These sharing constraints need review. Use assembled mode or simplify conflicting requirements.",
      );
  }
  const rows = [...items.values()].sort((a, b) => a.name.localeCompare(b.name));
  return {
    items: rows,
    copies: rows.reduce((n, e) => n + e.quantity, 0),
    estimate: rows.reduce((n, e) => n + (e.estimate ?? 0) * e.quantity, 0),
    priced_copies: rows
      .filter((e) => e.estimate !== null)
      .reduce((n, e) => n + e.quantity, 0),
    mode: "shared",
  };
}
