import React, { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  FileSpreadsheet,
  Grid2X2,
  Layers3,
  List,
  RefreshCw,
  Search,
  Sparkles,
} from "lucide-react";
import type { Card, ViewProps } from "./types";
import { api, date, Dialog, Empty, money, Pagination, PriceState } from "./ui";
type Filters = {
  q: string;
  color: string;
  type: string;
  foil: string;
  status: string;
  deck_id: string;
  location: string;
};
const defaults: Filters = {
  q: "",
  color: "",
  type: "",
  foil: "false",
  status: "",
  deck_id: "",
  location: "",
};
function CardDetails({
  card,
  state,
  run,
  close,
}: ViewProps & { card: Card; close: () => void }) {
  const [face, setFace] = useState(0),
    [location, setLocation] = useState(card.location),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [expected] = useState(state.revision),
    [savedLocation, setSavedLocation] = useState(card.location);
  const image = card.image_faces.length
    ? card.image_faces[face]?.url
    : card.image_url;
  const dirty = location !== savedLocation;
  const requestClose = () => {
    if (dirty && !confirm("Discard the unsaved location change?")) return;
    close();
  };
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return (
    <Dialog title={card.name} close={requestClose} wide>
      <div className="card-details">
        <div className="card-art">
          {image ? (
            <img src={image} alt={card.image_faces[face]?.name || card.name} />
          ) : (
            <div className="art-empty">
              <Layers3 size={40} />
              <p>Match this printing to load its artwork.</p>
            </div>
          )}
          {card.image_faces.length > 1 && (
            <button
              className="button secondary"
              onClick={() => setFace((face + 1) % card.image_faces.length)}
            >
              Flip card
            </button>
          )}
        </div>
        <div>
          <p>
            {card.card_type} · {card.set_code.toUpperCase()} #
            {card.collector_number}
          </p>
          <p className="rules-text">{card.oracle_text}</p>
          <dl className="detail-list">
            <div>
              <dt>Owned</dt>
              <dd>
                {card.quantity} ({card.nonfoil} nonfoil / {card.foil} foil)
              </dd>
            </div>
            <div>
              <dt>Known value</dt>
              <dd>
                {money(card.value, state.settings.currency)}
                <PriceState
                  status={card.price_state}
                  refreshed={card.fetched_at}
                />
                <small>
                  {card.priced_copies} / {card.quantity} copies priced
                </small>
              </dd>
            </div>
            <div>
              <dt>Nonfoil / foil unit price</dt>
              <dd>
                {money(card.prices.nonfoil, state.settings.currency)} /{" "}
                {money(card.prices.foil, state.settings.currency)}
              </dd>
            </div>
            <div>
              <dt>Excel rows</dt>
              <dd>{card.source_rows.join(", ")}</dd>
            </div>
            <div>
              <dt>Price fetched</dt>
              <dd>{date(card.fetched_at)}</dd>
            </div>
          </dl>
          <h3>Planned reservations</h3>
          {card.reservations.length ? (
            <ul>
              {card.reservations.map((r, i) => (
                <li key={i}>
                  {r.quantity} {r.finish} · {r.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No copies reserved.</p>
          )}
          <p className="hint">
            {card.quantity - card.reserved} copies unreserved. Reservations do
            not track where physical cards are.
          </p>
          <h3>Excel Deck labels</h3>
          <p className="muted">
            {card.decks.join(", ") || "No workbook label"}
          </p>
          <p className="hint">
            Imported annotations; app reservations are managed separately.
          </p>
          <label className="field">
            Where is this card?
            <input
              maxLength={150}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. Binder A, page 8; or box 3"
            />
          </label>
          <button
            className="button secondary"
            disabled={saving || !dirty}
            onClick={async () => {
              setSaving(true);
              setError("");
              try {
                await api(
                  "/locations",
                  "PATCH",
                  { key: card.key, location },
                  expected,
                );
                setSavedLocation(location);
                await run(async () => {});
                close();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setSaving(false);
              }
            }}
          >
            Save location
          </button>
          {error && (
            <p role="alert" className="notice danger">
              {error}
            </p>
          )}
          {card.notes.length > 0 && (
            <>
              <h3>Workbook notes</h3>
              <p>{card.notes.join(" · ")}</p>
            </>
          )}
          {card.scryfall_url && (
            <p>
              <a href={card.scryfall_url} target="_blank" rel="noreferrer">
                View on Scryfall
              </a>
            </p>
          )}
        </div>
      </div>
    </Dialog>
  );
}
export function Collection({
  state,
  collection,
  run,
  busy,
  reload,
  openImport,
  exportList,
  review,
}: ViewProps & {
  collection: Card[];
  openImport: () => void;
  exportList: (p: Record<string, string>) => void;
  review: () => void;
}) {
  const [filters, setFilters] = useState<Filters>(() => ({
      ...defaults,
      q: new URLSearchParams(location.hash.split("?")[1] || "").get("q") || "",
    })),
    [page, setPage] = useState(0),
    [sort, setSort] = useState("name"),
    [grid, setGrid] = useState(false),
    [card, setCard] = useState<Card | null>(null),
    [savingFilter, setSavingFilter] = useState(false),
    [filterName, setFilterName] = useState("");
  const update = (k: keyof Filters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v }));
  useEffect(() => setPage(0), [filters, sort]);
  useEffect(() => {
    const search = (e: Event) => update("q", (e as CustomEvent<string>).detail);
    window.addEventListener("mtg-collection-search", search);
    return () => window.removeEventListener("mtg-collection-search", search);
  }, []);
  const selectedDeck = state.decks.find(
    (d) => d.id === Number(filters.deck_id),
  );
  const filtered = collection
    .filter(
      (c) =>
        (!filters.q ||
          `${c.name} ${c.set_code} ${c.card_type} ${c.location}`
            .toLowerCase()
            .includes(filters.q.toLowerCase())) &&
        (!filters.color || c.color.includes(filters.color)) &&
        (!filters.type || c.card_type.includes(filters.type)) &&
        (filters.foil !== "true" || c.foil > 0) &&
        (!filters.location ||
          c.location.toLowerCase().includes(filters.location.toLowerCase())) &&
        (!filters.status ||
          (filters.status === "unresolved" && c.match_status !== "matched") ||
          (filters.status === "unreserved" && c.reserved < c.quantity)) &&
        (!selectedDeck || c.needed_by.includes(selectedDeck.id)),
    )
    .sort((a, b) =>
      sort === "quantity"
        ? b.quantity - a.quantity
        : sort === "value"
          ? (b.value ?? -1) - (a.value ?? -1)
          : a.name.localeCompare(b.name),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / 30)),
    currentPage = Math.min(page, pages - 1),
    rows = filtered.slice(currentPage * 30, (currentPage + 1) * 30);
  return (
    <>
      <div className="page-heading collection-heading">
        <div>
          <p className="eyebrow">YOUR INVENTORY</p>
          <h1>Collection</h1>
          <p className="subtitle">
            Saved Excel ownership, with planned reservations and storage
            locations.
          </p>
        </div>
        <div className="actions">
          <button
            className="button secondary"
            onClick={() => exportList({ kind: "collection", ...filters })}
          >
            <ArrowDownToLine size={16} /> Export
          </button>
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => run(reload, "Saved collection reloaded")}
          >
            <RefreshCw size={16} /> Reload collection
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={openImport}
          >
            <FileSpreadsheet size={16} /> Import saved workbook
          </button>
        </div>
        <details className="mobile-actions">
          <summary>Workbook and exports</summary>
          <div className="actions">
            <button
              className="button secondary"
              onClick={() => exportList({ kind: "collection", ...filters })}
            >
              Export
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => run(reload, "Saved collection reloaded")}
            >
              Reload collection
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={openImport}
            >
              Import saved workbook
            </button>
          </div>
        </details>
      </div>
      <details className="collection-overview">
        <summary>
          {state.summary.copies.toLocaleString()} known copies ·{" "}
          {state.summary.foil_copies} foil · {state.summary.unresolved}{" "}
          unmatched printings
        </summary>
        <div className="metrics">
          <div className="metric">
            <span>Owned copies</span>
            <strong>{state.summary.copies}</strong>
            <small>
              {state.summary.issues
                ? "Invalid rows need review; total is incomplete."
                : "From the last accepted Input snapshot"}
            </small>
          </div>
          <div className="metric">
            <span>Unique cards</span>
            <strong>{state.summary.unique_cards}</strong>
            <small>{state.summary.printings} printings</small>
          </div>
          <div className="metric">
            <span>Known collection value</span>
            <strong>
              {state.summary.priced_copies
                ? money(state.summary.value, state.settings.currency)
                : "Unknown"}
            </strong>
            <small>
              {state.summary.priced_copies} / {state.summary.copies} copies
              priced; {state.summary.copies - state.summary.priced_copies}{" "}
              unpriced
            </small>
          </div>
          <button className="metric review-metric" onClick={review}>
            <span>Source issues</span>
            <strong>{state.summary.issues}</strong>
            <small>{state.summary.unresolved} printings awaiting a match</small>
          </button>
        </div>
      </details>
      <section className="table-panel collection-panel">
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={18} />
            <input
              aria-label="Search collection"
              placeholder="Search cards, sets, types, or locations"
              value={filters.q}
              onChange={(e) => update("q", e.target.value)}
            />
          </label>
          <div className="actions">
            <button
              className="icon-button"
              aria-label="List view"
              aria-pressed={!grid}
              onClick={() => setGrid(false)}
            >
              <List size={20} />
            </button>
            <button
              className="icon-button"
              aria-label="Artwork grid"
              aria-pressed={grid}
              onClick={() => setGrid(true)}
            >
              <Grid2X2 size={20} />
            </button>
            <select
              aria-label="Sort collection"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="name">Name</option>
              <option value="quantity">Quantity</option>
              <option value="value">Known value</option>
            </select>
          </div>
        </div>
        <details className="filter-options">
          <summary>Filters and saved views</summary>
          <div className="mobile-view-controls actions">
            <button
              className="button secondary"
              aria-pressed={!grid}
              onClick={() => setGrid(false)}
            >
              List view
            </button>
            <button
              className="button secondary"
              aria-pressed={grid}
              onClick={() => setGrid(true)}
            >
              Artwork grid
            </button>
            <select
              aria-label="Sort collection on mobile"
              value={sort}
              onChange={(e) => setSort(e.target.value)}
            >
              <option value="name">Name</option>
              <option value="quantity">Quantity</option>
              <option value="value">Known value</option>
            </select>
          </div>
          <div className="filters">
            <select
              aria-label="Filter by color"
              value={filters.color}
              onChange={(e) => update("color", e.target.value)}
            >
              <option value="">All colors</option>
              {["White", "Blue", "Black", "Red", "Green", "Colorless"].map(
                (c) => (
                  <option key={c}>{c}</option>
                ),
              )}
            </select>
            <select
              aria-label="Filter by type"
              value={filters.type}
              onChange={(e) => update("type", e.target.value)}
            >
              <option value="">All types</option>
              {[
                "Creature",
                "Instant",
                "Sorcery",
                "Artifact",
                "Enchantment",
                "Land",
                "Planeswalker",
              ].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <button
              className={`filter-chip ${filters.foil === "true" ? "selected" : ""}`}
              aria-pressed={filters.foil === "true"}
              onClick={() =>
                update("foil", filters.foil === "true" ? "false" : "true")
              }
            >
              <Sparkles size={15} /> Foil
            </button>
            <select
              aria-label="Reservation or match filter"
              value={filters.status}
              onChange={(e) => update("status", e.target.value)}
            >
              <option value="">All statuses</option>
              <option value="unreserved">Unreserved copies</option>
              <option value="unresolved">Unresolved printings</option>
            </select>
            <select
              aria-label="Needed by deck"
              value={filters.deck_id}
              onChange={(e) => update("deck_id", e.target.value)}
            >
              <option value="">Needed by any deck</option>
              {state.decks.map((d) => (
                <option key={d.id} value={d.id}>
                  Needed by {d.name}
                </option>
              ))}
            </select>
            <input
              aria-label="Filter by storage location"
              placeholder="Storage location"
              value={filters.location}
              onChange={(e) => update("location", e.target.value)}
            />
            <button
              className="text-button"
              onClick={() => setFilters(defaults)}
            >
              Clear filters
            </button>
          </div>
          <div className="saved-views">
            {state.saved_filters.map((f) => (
              <span key={f.id}>
                <button
                  className="button secondary small"
                  onClick={() => setFilters({ ...defaults, ...f.filters })}
                >
                  {f.name}
                </button>
                <button
                  className="icon-button"
                  aria-label={`Delete saved view ${f.name}`}
                  onClick={() => run(() => api(`/filters/${f.id}`, "DELETE"))}
                >
                  ×
                </button>
              </span>
            ))}
            <button
              className="text-button"
              onClick={() => setSavingFilter(true)}
            >
              Save current filters
            </button>
          </div>
        </details>
        <div className="table-caption">
          <span>
            {filtered.length} printings ·{" "}
            {filtered.reduce((n, c) => n + c.quantity, 0)} owned copies
          </span>
        </div>
        {grid ? (
          <div className="artwork-grid">
            {rows.map((c) => (
              <button
                className="artwork-card"
                key={c.key}
                onClick={() => setCard(c)}
              >
                {c.image_url ? (
                  <img src={c.image_url} alt={c.name} loading="lazy" />
                ) : (
                  <div className="art-placeholder">
                    <Layers3 />
                    <span>Awaiting artwork</span>
                  </div>
                )}
                <strong>{c.name}</strong>
                <small>
                  {c.set_code.toUpperCase()} #{c.collector_number} ·{" "}
                  {c.quantity} owned
                </small>
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="table-scroll desktop-collection">
              <table>
                <thead>
                  <tr>
                    <th>Card / location</th>
                    <th>Printing</th>
                    <th className="numeric">Owned</th>
                    <th>Planned reservations</th>
                    <th>Excel Deck labels</th>
                    <th className="numeric">Known value</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.key}>
                      <td>
                        <button
                          className="card-cell"
                          onClick={() => setCard(c)}
                        >
                          <div className="card-thumb">
                            {c.image_url ? (
                              <img src={c.image_url} alt="" loading="lazy" />
                            ) : (
                              <Layers3 size={17} />
                            )}
                          </div>
                          <span>
                            <strong>{c.name}</strong>
                            <small>{c.card_type}</small>
                            <small>
                              {c.location || "Location not recorded"}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        {c.set_code.toUpperCase()} #{c.collector_number}
                      </td>
                      <td className="numeric">
                        <strong>{c.quantity}</strong>
                        <small>
                          {c.nonfoil} nonfoil · {c.foil} foil
                        </small>
                      </td>
                      <td>
                        {c.reservations.length ? (
                          c.reservations.map((r, i) => (
                            <small key={i}>
                              {r.quantity} {r.finish} · {r.name}
                            </small>
                          ))
                        ) : (
                          <span className="muted">Unreserved</span>
                        )}
                      </td>
                      <td>{c.decks.join(", ") || "No label"}</td>
                      <td className="numeric">
                        {money(c.value, state.settings.currency)}
                        <PriceState
                          status={c.price_state}
                          refreshed={c.fetched_at}
                        />
                        {c.priced_copies < c.quantity && (
                          <small>
                            {c.quantity - c.priced_copies} unpriced copies
                          </small>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mobile-card-list">
              {rows.map((c) => (
                <button
                  className="mobile-card-row"
                  key={c.key}
                  onClick={() => setCard(c)}
                >
                  <strong>{c.name}</strong>
                  <span>
                    {c.quantity} owned · {c.foil} foil
                  </span>
                  <small>
                    {c.set_code.toUpperCase()} #{c.collector_number} ·{" "}
                    {c.location || "Location not recorded"}
                  </small>
                  <small>
                    {c.reserved} reserved · {c.quantity - c.reserved} unreserved
                  </small>
                  <span>{money(c.value, state.settings.currency)}</span>
                  <PriceState status={c.price_state} />
                </button>
              ))}
            </div>
          </>
        )}
        {!rows.length && (
          <Empty title="No matching cards">
            <p>Change filters or import a saved workbook.</p>
          </Empty>
        )}
        <div className="table-footer">
          <span>Imported {date(state.last_import?.created_at)}</span>
          <Pagination page={currentPage} pages={pages} setPage={setPage} />
        </div>
      </section>
      {card && (
        <CardDetails
          card={card}
          state={state}
          run={run}
          busy={busy}
          reload={reload}
          close={() => setCard(null)}
        />
      )}
      {savingFilter && (
        <Dialog
          title="Save collection view"
          close={() => setSavingFilter(false)}
        >
          <label className="field">
            View name
            <input
              value={filterName}
              maxLength={60}
              onChange={(e) => setFilterName(e.target.value)}
            />
          </label>
          <button
            className="button primary"
            disabled={busy || !filterName.trim()}
            onClick={async () => {
              if (
                await run(
                  () => api("/filters", "POST", { name: filterName, filters }),
                  "View saved",
                )
              ) {
                setSavingFilter(false);
                setFilterName("");
              }
            }}
          >
            Save view
          </button>
        </Dialog>
      )}
    </>
  );
}
