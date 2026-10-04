import { Inventory, printingKey } from "./domain.mjs";
export const SET_SCOPE = "english-paper-all-printings-v1";
const validCode = (code) => /^[a-z0-9]{2,8}$/.test(code);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function validateCatalog(catalog, code) {
  if (
    !catalog ||
    catalog.version !== 1 ||
    catalog.scope !== SET_SCOPE ||
    catalog.code !== code ||
    catalog.complete !== true ||
    typeof catalog.name !== "string" ||
    !catalog.name ||
    catalog.name.length > 200 ||
    !Number.isFinite(Date.parse(catalog.fetched_at)) ||
    !Array.isArray(catalog.cards) ||
    !catalog.cards.length ||
    catalog.cards.length > 10000
  )
    throw Error("The set checklist is incomplete or incompatible.");
  const ids = new Set(),
    numbers = new Set();
  for (const card of catalog.cards) {
    if (
      !card ||
      typeof card.id !== "string" ||
      !uuid.test(card.id) ||
      typeof card.name !== "string" ||
      !card.name ||
      card.name.length > 200 ||
      typeof card.number !== "string" ||
      !card.number ||
      card.number.length > 30 ||
      ids.has(card.id) ||
      numbers.has(printingKey(code, card.number))
    )
      throw Error("The set checklist contains invalid or duplicate printings.");
    ids.add(card.id);
    numbers.add(printingKey(code, card.number));
  }
  return catalog;
}
export function setProgress(rows, catalog = null) {
  const ownedPrintings = new Set(rows.map((c) => c.printing_key)).size;
  const summary = {
    code: rows[0].set_code,
    name: catalog?.name || null,
    owned_printings: ownedPrintings,
    copies: rows.reduce((n, c) => n + c.quantity, 0),
    total: null,
    verified_owned: 0,
    needs_verification: ownedPrintings,
    percent: null,
    missing_count: null,
    fetched_at: catalog?.fetched_at || null,
    scope: SET_SCOPE,
  };
  if (!catalog) return summary;
  const catalogIds = new Set(catalog.cards.map((c) => c.id)),
    verified = new Set(),
    unverified = new Set();
  for (const row of rows) {
    if (row.match_status === "matched" && catalogIds.has(row.scryfall_id))
      verified.add(row.scryfall_id);
    else unverified.add(row.printing_key);
  }
  const certain = unverified.size === 0;
  return {
    ...summary,
    total: catalog.cards.length,
    verified_owned: verified.size,
    needs_verification: unverified.size,
    percent: certain
      ? Math.round((verified.size / catalog.cards.length) * 1000) / 10
      : null,
    missing_count: certain ? catalog.cards.length - verified.size : null,
  };
}
export async function readCatalog(env, code) {
  const object = await env.BUCKET.get(`set-catalogs/${code}.json`);
  if (!object) return null;
  try {
    return validateCatalog(await object.json(), code);
  } catch {
    return null;
  }
}
export async function refreshCatalog(env, code, scryfall) {
  const metadata = await scryfall(`/sets/${code}`);
  if (
    metadata.object !== "set" ||
    metadata.code !== code ||
    typeof metadata.name !== "string"
  )
    throw Error("Scryfall did not return the selected edition.");
  const query = `set:${code} game:paper lang:en`;
  let path =
      "/cards/search?" +
      new URLSearchParams({
        q: query,
        unique: "prints",
        order: "set",
        include_extras: "true",
      }),
    total = null;
  const cards = [],
    visited = new Set();
  for (let page = 0; page < 40; page++) {
    if (visited.has(path))
      throw Error(
        "The checklist pagination repeated. Previous data is retained.",
      );
    visited.add(path);
    const response = await scryfall(path);
    if (
      response.object !== "list" ||
      !Array.isArray(response.data) ||
      !response.data.length ||
      typeof response.has_more !== "boolean" ||
      !Number.isSafeInteger(response.total_cards) ||
      response.total_cards < 1 ||
      response.total_cards > 10000 ||
      (total !== null && total !== response.total_cards)
    )
      throw Error(
        "Scryfall returned an incomplete checklist. Previous data is retained.",
      );
    total = response.total_cards;
    for (const card of response.data) {
      if (
        card.set !== code ||
        card.lang !== "en" ||
        !Array.isArray(card.games) ||
        !card.games.includes("paper")
      )
        throw Error("The checklist does not match the English paper scope.");
      cards.push({
        id: card.id,
        name: card.name,
        number: card.collector_number,
      });
    }
    if (cards.length > total)
      throw Error("The checklist contains too many entries.");
    if (!response.has_more) {
      if (cards.length !== total)
        throw Error(
          "The checklist is only partially loaded. Previous data is retained.",
        );
      const catalog = validateCatalog(
        {
          version: 1,
          complete: true,
          scope: SET_SCOPE,
          code,
          name: metadata.name,
          fetched_at: new Date().toISOString(),
          cards,
        },
        code,
      );
      await env.BUCKET.put(
        `set-catalogs/${code}.json`,
        JSON.stringify(catalog),
        { httpMetadata: { contentType: "application/json" } },
      );
      return catalog;
    }
    let next;
    try {
      next = new URL(response.next_page);
    } catch {
      throw Error("The checklist has an invalid next page.");
    }
    if (
      next.origin !== "https://api.scryfall.com" ||
      next.pathname !== "/cards/search" ||
      next.searchParams.get("q") !== query ||
      next.searchParams.get("unique") !== "prints"
    )
      throw Error("The checklist has an unsafe or inconsistent next page.");
    path = next.pathname + next.search;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw Error(
    "This checklist exceeds the supported page limit. Previous data is retained.",
  );
}
export async function handleSets({
  env,
  s,
  path,
  q,
  method,
  json,
  cardRows,
  scryfall,
}) {
  if (path !== "/sets" && !path.startsWith("/sets/")) return null;
  const rows = new Inventory(s, await cardRows(env)).collection();
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.set_code) || [];
    group.push(row);
    groups.set(row.set_code, group);
  }
  if (path === "/sets" && method === "GET") {
    const codes = [...groups.keys()].sort(),
      items = [];
    for (let index = 0; index < codes.length; index += 8)
      items.push(
        ...(await Promise.all(
          codes
            .slice(index, index + 8)
            .map(async (code) =>
              setProgress(
                groups.get(code),
                validCode(code) ? await readCatalog(env, code) : null,
              ),
            ),
        )),
      );
    return json({ items });
  }
  const match = path.match(/^\/sets\/([a-z0-9]{2,8})(\/refresh)?$/);
  if (!match || !groups.has(match[1]))
    throw Error("Choose an edition in your collection.");
  const code = match[1];
  if (match[2] && method === "POST") {
    await refreshCatalog(env, code, scryfall);
    return json({ catalog_loaded: true });
  }
  if (!match[2] && method === "GET") {
    const catalog = await readCatalog(env, code),
      progress = setProgress(groups.get(code), catalog);
    const verified = new Set(
      groups
        .get(code)
        .filter((c) => c.match_status === "matched")
        .map((c) => c.scryfall_id),
    );
    const mode = q.get("view") || "all";
    if (
      !["all", "missing"].includes(mode) ||
      (mode === "missing" && progress.percent === null)
    )
      throw Error(
        "Verify owned printings before viewing the missing checklist.",
      );
    const page = Number(q.get("page") || 0);
    if (!Number.isSafeInteger(page) || page < 0)
      throw Error("Choose a valid checklist page.");
    const entries = (catalog?.cards || [])
      .filter((c) => mode !== "missing" || !verified.has(c.id))
      .sort(
        (a, b) =>
          a.number.localeCompare(b.number, undefined, { numeric: true }) ||
          a.id.localeCompare(b.id),
      );
    return json({
      ...progress,
      items: entries
        .slice(page * 30, (page + 1) * 30)
        .map((c) => ({ ...c, owned: verified.has(c.id) })),
      count: entries.length,
      pages: Math.max(1, Math.ceil(entries.length / 30)),
    });
  }
  return json({ detail: "Unsupported set action." }, 405);
}
