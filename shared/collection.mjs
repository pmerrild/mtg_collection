// Shared by the collection UI and exports. Saved views remain string-valued.
export const filterDefaults = {
  q: "",
  color: "",
  color_mode: "any",
  type: "",
  type_mode: "any",
  sets: "",
  rarity: "",
  finish: "",
  reservation: "",
  match: "",
  deck_id: "",
  location: "",
  quantity_min: "",
  quantity_max: "",
  price_min: "",
  price_max: "",
  value_min: "",
  value_max: "",
  priced: "",
  view: "",
  sort: "name",
};
const choices = {
  color_mode: ["any", "all"],
  type_mode: ["any", "all"],
  finish: ["", "nonfoil", "foil", "both"],
  reservation: ["", "none", "partial", "full", "available"],
  match: [
    "",
    "unresolved",
    "lookup_failed",
    "not_found",
    "name_mismatch",
    "matched",
    "unmatched",
  ],
  priced: ["", "known", "unknown", "partial"],
  view: ["", "duplicates", "trade"],
  sort: ["name", "quantity", "value", "tradeable"],
};
export function normalizeFilters(raw = {}) {
  const f = { ...filterDefaults };
  for (const k of Object.keys(f))
    if (raw[k] !== undefined) {
      if (typeof raw[k] !== "string" || raw[k].length > 2000)
        throw Error("Invalid collection filters.");
      f[k] = raw[k].trim();
    }
  if (!raw.finish && raw.foil === "true") f.finish = "foil";
  if (!raw.match && raw.status === "unresolved") f.match = "unmatched";
  if (!raw.reservation && raw.status === "unreserved")
    f.reservation = "available";
  for (const [k, values] of Object.entries(choices))
    if (!values.includes(f[k])) throw Error("Invalid " + k + " filter.");
  for (const k of ["color", "type", "sets", "rarity"])
    f[k] = [
      ...new Set(
        f[k]
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ].join(",");
  for (const prefix of ["quantity", "price", "value"]) {
    for (const suffix of ["min", "max"]) {
      const k = prefix + "_" + suffix;
      if (
        f[k] &&
        (!/^\d+(?:\.\d+)?$/.test(f[k]) ||
          !Number.isFinite(Number(f[k])) ||
          (prefix === "quantity" && !Number.isSafeInteger(Number(f[k]))))
      )
        throw Error("Enter valid nonnegative " + prefix + " limits.");
    }
    if (
      f[prefix + "_min"] &&
      f[prefix + "_max"] &&
      Number(f[prefix + "_min"]) > Number(f[prefix + "_max"])
    )
      throw Error("Minimum " + prefix + " exceeds maximum.");
  }
  if (f.deck_id && !/^\d+$/.test(f.deck_id))
    throw Error("Invalid deck filter.");
  return f;
}
const lower = (x) =>
  String(x ?? "")
    .normalize("NFKC")
    .replaceAll("’", "'")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
export function filterCollection(cards, raw) {
  const f = normalizeFilters(raw);
  const selected = (k) => f[k].split(",").filter(Boolean).map(lower);
  const lists = Object.fromEntries(
    ["color", "type", "sets", "rarity"].map((k) => [k, selected(k)]),
  );
  const multi = (k, test) =>
    !lists[k].length ||
    (f[k + "_mode"] === "all" ? lists[k].every(test) : lists[k].some(test));
  const range = (k, n) =>
    (!f[k + "_min"] && !f[k + "_max"]) ||
    (n !== null &&
      (!f[k + "_min"] || n >= Number(f[k + "_min"])) &&
      (!f[k + "_max"] || n <= Number(f[k + "_max"])));
  return cards
    .filter((c) => {
      const colorTokens = new Set(
        lower(c.color)
          .split(/[^a-z]+/)
          .filter(Boolean),
      );
      const typeTokens = new Set(
        lower(c.card_type)
          .split(/[^a-z]+/)
          .filter(Boolean),
      );
      const unitPrices = [
        c.nonfoil > 0 ? c.prices.nonfoil : null,
        c.foil > 0 ? c.prices.foil : null,
      ].filter((n) => n !== null);
      const unit = unitPrices.length ? Math.min(...unitPrices) : null;
      return (
        (!f.q ||
          lower(
            `${c.name} ${c.set_code} ${c.card_type} ${c.location}`,
          ).includes(lower(f.q))) &&
        multi("color", (x) => colorTokens.has(x)) &&
        multi("type", (x) => typeTokens.has(x)) &&
        (!lists.sets.length || lists.sets.includes(lower(c.set_code))) &&
        (!lists.rarity.length || lists.rarity.includes(lower(c.rarity))) &&
        (!f.finish ||
          (f.finish === "both"
            ? c.foil > 0 && c.nonfoil > 0
            : c[f.finish] > 0)) &&
        (!f.reservation ||
          (f.reservation === "none"
            ? c.reserved === 0
            : f.reservation === "partial"
              ? c.reserved > 0 && c.reserved < c.quantity
              : f.reservation === "full"
                ? c.reserved === c.quantity
                : c.reserved < c.quantity)) &&
        (!f.match ||
          (f.match === "unmatched"
            ? c.match_status !== "matched"
            : c.match_status === f.match)) &&
        (!f.deck_id || c.needed_by.includes(Number(f.deck_id))) &&
        (!f.location || lower(c.location).includes(lower(f.location))) &&
        range("quantity", c.quantity) &&
        range("price", unit) &&
        range("value", c.value) &&
        (!f.priced ||
          (f.priced === "known"
            ? c.priced_copies === c.quantity
            : f.priced === "unknown"
              ? c.priced_copies === 0
              : c.priced_copies > 0 && c.priced_copies < c.quantity)) &&
        (!f.view ||
          (f.view === "duplicates"
            ? (c.identity_copies ?? c.quantity) > 1
            : c.tradeable > 0))
      );
    })
    .sort((a, b) => {
      const n =
        f.sort === "quantity"
          ? b.quantity - a.quantity
          : f.sort === "value"
            ? (b.value ?? -1) - (a.value ?? -1)
            : f.sort === "tradeable"
              ? b.tradeable - a.tradeable
              : 0;
      return n || a.name.localeCompare(b.name) || a.key.localeCompare(b.key);
    });
}
