import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  Ellipsis,
  FileSpreadsheet,
  Layers3,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Settings2,
} from "lucide-react";
import type { BulkUndo, Card, ViewProps } from "./types";
import { api, date, Dialog, Empty, money, Pagination, PriceState } from "./ui";
import {
  filterDefaults as defaults,
  filterCollection,
  normalizeFilters,
  type CollectionFilters as Filters,
} from "../../shared/collection.mjs";
import {
  CollectionFiltersPanel,
  FilterChips,
  BulkCollectionDialog,
} from "./CollectionTools";
import { usePreference } from "./theme";
import { CollectionTabs } from "./Sets";
import {
  CardIdentity,
  CardTraits,
  CollectionActions,
  DisplayDialog,
  displayDefaults,
  MatchBadge,
  validateDisplay,
} from "./CollectionChrome";
const readFilters = () =>
  normalizeFilters(
    Object.fromEntries(new URLSearchParams(location.hash.split("?")[1] || "")),
  );
function CardDetails({
  card,
  state,
  run,
  close,
  position,
  count,
  navigate,
  revision,
}: ViewProps & {
  card: Card;
  close: () => void;
  position: number;
  count: number;
  navigate: (step: number) => void;
  revision: number;
}) {
  const [face, setFace] = useState(0),
    [location, setLocation] = useState(card.location),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const [expected] = useState(revision),
    [savedLocation, setSavedLocation] = useState(card.location);
  const image = card.image_faces.length
    ? card.image_faces[face]?.url
    : card.image_url;
  const dirty = location !== savedLocation;
  const requestClose = () => {
    if (saving) return;
    if (dirty && !confirm("Discard the unsaved location change?")) return;
    close();
  };
  useEffect(() => {
    const guardNavigation = (event: Event) => {
      if (saving) {
        event.preventDefault();
        return;
      }
      if (dirty) {
        if (!confirm("Discard the unsaved location change?"))
          event.preventDefault();
        else close();
      }
    };
    window.addEventListener("mtg-before-navigate", guardNavigation);
    return () =>
      window.removeEventListener("mtg-before-navigate", guardNavigation);
  }, [dirty, saving]);
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
      <div className="printing-navigation">
        <button
          className="button secondary"
          disabled={position === 0 || saving}
          onClick={() => {
            if (!dirty || confirm("Discard the unsaved location change?"))
              navigate(-1);
          }}
        >
          Previous result
        </button>
        <span aria-live="polite">
          Result {position + 1} of {count}
        </span>
        <button
          className="button secondary"
          disabled={position === count - 1 || saving}
          onClick={() => {
            if (!dirty || confirm("Discard the unsaved location change?"))
              navigate(1);
          }}
        >
          Next result
        </button>
      </div>
      <p className="hint">
        Navigation follows the results captured when you opened details.
      </p>
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
            {card.quantity - card.reserved} copies unreserved.{" "}
            {card.target_protected} deck-protected · keep at least {card.keep} ·{" "}
            {card.tradeable} trade candidates. Reservations do not track where
            physical cards are.
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
  offerUndo,
}: ViewProps & {
  collection: Card[];
  openImport: () => void;
  exportList: (p: Record<string, string>) => void;
  review: () => void;
  offerUndo: (undo: BulkUndo | null) => void;
}) {
  const [filters, setFilters] = useState<Filters>(() => {
      try {
        return readFilters();
      } catch {
        return defaults;
      }
    }),
    [draft, setDraft] = useState<Filters>(filters),
    [panel, setPanel] = useState(false),
    [displayOpen, setDisplayOpen] = useState(false),
    [actionsOpen, setActionsOpen] = useState(false),
    [page, setPage] = useState(0),
    [inspection, setInspection] = useState<{
      cards: Card[];
      index: number;
      revision: number;
    } | null>(null),
    [savingFilter, setSavingFilter] = useState(false),
    [filterName, setFilterName] = useState(""),
    [selected, setSelected] = useState<Set<string>>(new Set()),
    [bulkAction, setBulkAction] = useState("");
  const [display, setDisplay] = usePreference(
    "mtg-vault-display",
    displayDefaults,
    validateDisplay,
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const pendingPage = useRef(false);
  useLayoutEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const measure = () =>
      controls.parentElement?.style.setProperty(
        "--collection-controls-height",
        `${controls.getBoundingClientRect().height}px`,
      );
    const observer = new ResizeObserver(measure);
    observer.observe(controls);
    measure();
    return () => observer.disconnect();
  }, []);
  const update = (k: keyof Filters, v: string) =>
    setFilters((f) => ({ ...f, [k]: v }));
  const updateDraft = (k: keyof Filters, v: string) =>
    setDraft((f) => ({ ...f, [k]: v }));
  const openFilters = () => {
    setDraft({ ...filters });
    setPanel(true);
  };
  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [filters]);
  useEffect(() => {
    const search = (e: Event) => update("q", (e as CustomEvent<string>).detail);
    const hash = () => {
      if (location.hash.startsWith("#collection"))
        try {
          setFilters(readFilters());
        } catch {
          setFilters(defaults);
        }
    };
    const shortcut = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        e.key === "/" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !target.closest('input,textarea,select,[contenteditable="true"]') &&
        !document.querySelector("dialog[open]")
      ) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("mtg-collection-search", search);
    window.addEventListener("hashchange", hash);
    window.addEventListener("keydown", shortcut);
    return () => {
      window.removeEventListener("mtg-collection-search", search);
      window.removeEventListener("hashchange", hash);
      window.removeEventListener("keydown", shortcut);
    };
  }, []);
  useEffect(() => {
    if (!location.hash.startsWith("#collection")) return;
    const params = new URLSearchParams(
      Object.entries(filters).filter(
        ([k, v]) => v !== defaults[k as keyof Filters],
      ),
    );
    history.replaceState(
      null,
      "",
      "#collection" + (params.size ? "?" + params : ""),
    );
  }, [filters]);
  let filterError = "",
    draftError = "";
  let filtered: Card[] = [],
    preview: Card[] = [];
  try {
    filtered = filterCollection(collection, filters);
  } catch (e) {
    filterError = (e as Error).message;
  }
  try {
    preview = filterCollection(collection, draft);
  } catch (e) {
    draftError = (e as Error).message;
  }
  const card = inspection?.cards[inspection.index];
  const openCard = (c: Card) =>
    setInspection({
      cards: [...filtered],
      index: filtered.findIndex((row) => row.key === c.key),
      revision: state.revision,
    });
  const selectAll = () => setSelected(new Set(filtered.map((c) => c.key)));
  const selectedCards = filtered.filter((c) => selected.has(c.key));
  const toggle = (key: string) =>
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else if (next.size < 1000) next.add(key);
      return next;
    });
  const selection = (c: Card) => (
    <label className="printing-select">
      <input
        type="checkbox"
        aria-label={`Select ${c.name} ${c.printing_key}`}
        checked={selected.has(c.key)}
        onChange={() => toggle(c.key)}
      />
      <span className="sr-only">Select printing</span>
    </label>
  );
  const exportParams = () => ({ kind: "collection", ...filters });
  const exportSelected = () =>
    exportList({
      kind: "collection",
      view: filters.view,
      sort: filters.sort,
      keys: JSON.stringify(selectedCards.map((c) => c.key)),
    });
  const pages = Math.max(1, Math.ceil(filtered.length / 30)),
    currentPage = Math.min(page, pages - 1),
    rows = filtered.slice(currentPage * 30, (currentPage + 1) * 30);
  useLayoutEffect(() => {
    if (!pendingPage.current) return;
    pendingPage.current = false;
    const results = resultsRef.current;
    const main = document.getElementById("main-content");
    if (!results || !main) return;
    results.focus({ preventScroll: true });
    main.scrollTop +=
      results.getBoundingClientRect().top -
      main.getBoundingClientRect().top -
      (controlsRef.current?.getBoundingClientRect().height || 0);
  }, [currentPage]);
  const paginate = (next: number) => {
    pendingPage.current = true;
    setPage(next);
  };
  const bulkToolbar = (
    <div className="bulk-toolbar">
      <label>
        <input
          type="checkbox"
          aria-label="Select current page"
          disabled={!rows.length}
          ref={(input) => {
            if (input)
              input.indeterminate =
                rows.some((c) => selected.has(c.key)) &&
                !rows.every((c) => selected.has(c.key));
          }}
          checked={rows.length > 0 && rows.every((c) => selected.has(c.key))}
          onChange={(e) => {
            const checked = e.target.checked;
            setSelected((previous) => {
              const next = new Set(previous);
              for (const c of rows) {
                if (checked && next.size < 1000) next.add(c.key);
                else if (!checked) next.delete(c.key);
              }
              return next;
            });
          }}
        />
        <span className="sr-only">Select page</span>
      </label>
      {selectedCards.length ? (
        <>
          <strong aria-live="polite">{selectedCards.length} selected</strong>
          <button
            className="text-button"
            onClick={() => setSelected(new Set())}
          >
            Clear<span className="sr-only"> selection</span>
          </button>
          <button
            className="button primary small"
            aria-haspopup="dialog"
            onClick={() => setActionsOpen(true)}
          >
            Actions
          </button>
        </>
      ) : (
        <>
          <span className="result-count">
            {filtered.length} printings ·{" "}
            {filtered.reduce((n, c) => n + c.quantity, 0)} copies
          </span>
          <button
            className="text-button"
            disabled={!filtered.length || filtered.length > 1000}
            onClick={selectAll}
          >
            Select all {filtered.length}
          </button>
        </>
      )}
    </div>
  );
  const activeCount = Object.entries(filters).filter(
    ([k, v]) =>
      !["q", "sort", "view", "color_mode", "type_mode"].includes(k) &&
      v !== defaults[k as keyof Filters],
  ).length;
  const columns = display.columns;
  const candidates = (c: Card) => (
    <small className="candidate-summary">
      {c.tradeable} candidates · {c.target_protected} deck-protected · keep{" "}
      {c.keep}
    </small>
  );
  const reservations = (c: Card) =>
    c.reservations.length ? (
      c.reservations.map((r, i) => (
        <small key={i}>
          {r.quantity} {r.finish} · {r.name}
        </small>
      ))
    ) : (
      <span className="muted">Unreserved</span>
    );
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
        <details
          className="collection-menu"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              e.currentTarget.removeAttribute("open");
          }}
        >
          <summary className="button secondary" aria-label="Collection actions">
            <Ellipsis size={18} aria-hidden="true" />
            Manage
          </summary>
          <div
            className="collection-menu-options"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest("button")) {
                const menu = e.currentTarget.closest("details");
                menu?.removeAttribute("open");
                menu?.querySelector("summary")?.focus();
              }
            }}
          >
            <button
              className="button secondary"
              disabled={!!filterError}
              onClick={() => exportList(exportParams())}
            >
              <ArrowDownToLine size={16} />
              Export
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => run(reload, "Saved collection reloaded")}
            >
              <RefreshCw size={16} className={busy ? "spin" : ""} />
              {busy ? "Updating…" : "Reload collection"}
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={openImport}
            >
              <FileSpreadsheet size={16} />
              Import saved workbook
            </button>
          </div>
        </details>
      </div>
      <CollectionTabs active="cards" />
      <section
        className={`table-panel collection-panel density-${display.density}`}
        aria-busy={busy}
      >
        <div className="collection-controls" ref={controlsRef}>
          <div className="table-toolbar">
            <label className="search-field">
              <Search size={18} />
              <input
                ref={searchRef}
                aria-label="Search collection"
                placeholder="Search cards, sets, types, or locations"
                maxLength={200}
                value={filters.q}
                onChange={(e) => update("q", e.target.value)}
              />
              <kbd aria-hidden="true">/</kbd>
            </label>
            <div className="collection-toolbar-actions">
              <button
                className={`button secondary ${activeCount ? "has-filters" : ""}`}
                aria-haspopup="dialog"
                onClick={openFilters}
              >
                <SlidersHorizontal size={16} />
                Filters
                {activeCount > 0 && (
                  <span className="control-count">{activeCount}</span>
                )}
              </button>
              <select
                aria-label="Sort collection"
                value={filters.sort}
                onChange={(e) => update("sort", e.target.value)}
              >
                <option value="name">Name</option>
                <option value="quantity">Quantity</option>
                <option value="value">Known value</option>
                <option value="tradeable">Candidate quantity</option>
              </select>
              <button
                className="button secondary"
                aria-haspopup="dialog"
                onClick={() => setDisplayOpen(true)}
              >
                <Settings2 size={16} />
                Display
              </button>
            </div>
          </div>
          {bulkToolbar}
        </div>
        <FilterChips
          filters={filters}
          update={update}
          state={state}
          clear={() => setFilters({ ...defaults, sort: filters.sort })}
        />
        {filterError && (
          <p role="alert" className="notice danger">
            {filterError}
          </p>
        )}
        {filters.view && (
          <details className="trade-explanation">
            <summary>
              {filters.view === "duplicates"
                ? "How duplicate copies are counted"
                : "How trade candidates are protected"}
            </summary>
            <p>
              Duplicates include the same card across printings. Trade
              candidates keep at least one copy per printing and protect current
              reservations and allocation across all saved targets, including
              inactive decks. An unfilled target protects every copy of that
              card. Incomplete lists can leave future needs unprotected. Review
              finishes and locations before trading. “Keep copies” sets a
              minimum total; trade exports contain candidate quantities.
            </p>
          </details>
        )}
        <div
          ref={resultsRef}
          className="collection-results"
          role="region"
          tabIndex={-1}
          aria-label={`Collection results, page ${currentPage + 1} of ${pages}`}
        >
          <span className="sr-only" role="status">
            Page {currentPage + 1} of {pages}
          </span>
          {display.grid ? (
            <div className="artwork-grid">
              {rows.map((c) => (
                <div className="selectable-artwork" key={c.key}>
                  {selection(c)}
                  <button className="artwork-card" onClick={() => openCard(c)}>
                    {c.image_url ? (
                      <img src={c.image_url} alt={c.name} loading="lazy" />
                    ) : (
                      <div className="art-placeholder">
                        <Layers3 />
                        <span>No cached artwork</span>
                      </div>
                    )}
                    <strong>{c.name}</strong>
                    <small>
                      {c.set_code.toUpperCase()} #{c.collector_number} ·{" "}
                      {c.quantity} owned
                    </small>
                  </button>
                  <CardTraits card={c} />
                  <MatchBadge card={c} />
                  {filters.view && candidates(c)}
                </div>
              ))}
            </div>
          ) : (
            <>
              <div className="table-scroll desktop-collection">
                <table>
                  <colgroup>
                    <col className="select-column" />
                    <col />
                    <col className="printing-column" />
                    <col className="owned-column" />
                    {columns.reservations && (
                      <col className="reservations-column" />
                    )}
                    {columns.labels && <col className="labels-column" />}
                    {columns.value && <col className="value-column" />}
                  </colgroup>
                  <thead>
                    <tr>
                      <th>
                        <span className="sr-only">Select</span>
                      </th>
                      <th>Card{columns.location ? " / location" : ""}</th>
                      <th>Printing</th>
                      <th className="numeric">Owned</th>
                      {columns.reservations && <th>Reservations</th>}
                      {columns.labels && <th>Excel Deck labels</th>}
                      {columns.value && (
                        <th className="numeric">Known value</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.key}>
                        <td>{selection(c)}</td>
                        <td>
                          <CardIdentity
                            card={c}
                            location={columns.location}
                            open={() => openCard(c)}
                          />
                        </td>
                        <td className="printing-cell">
                          {c.set_code.toUpperCase()} #{c.collector_number}
                          <MatchBadge card={c} />
                        </td>
                        <td className="numeric owned-cell">
                          <strong className="owned-quantity">
                            {c.quantity}
                          </strong>
                          <small className="finish-counts">
                            {c.nonfoil > 0 ? `${c.nonfoil} nonfoil` : ""}
                            {c.nonfoil && c.foil ? " · " : ""}
                            {c.foil > 0 ? `${c.foil} foil` : ""}
                          </small>
                          {filters.view && candidates(c)}
                        </td>
                        {columns.reservations && <td>{reservations(c)}</td>}
                        {columns.labels && (
                          <td>{c.decks.join(", ") || "No label"}</td>
                        )}
                        {columns.value && (
                          <td className="numeric">
                            {money(c.value, state.settings.currency)}
                            {c.match_status === "matched" && (
                              <PriceState
                                status={c.price_state}
                                refreshed={c.fetched_at}
                              />
                            )}{" "}
                            {c.priced_copies > 0 &&
                              c.priced_copies < c.quantity && (
                                <small>
                                  {c.quantity - c.priced_copies} unpriced copies
                                </small>
                              )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mobile-card-list">
                {rows.map((c) => (
                  <div className="selectable-mobile" key={c.key}>
                    {selection(c)}
                    <button
                      className="mobile-card-row"
                      onClick={() => openCard(c)}
                    >
                      <strong>{c.name}</strong>
                      <span className="owned-quantity">{c.quantity} owned</span>
                      <small className="printing-line">
                        {c.set_code.toUpperCase()} #{c.collector_number} ·{" "}
                        {c.nonfoil > 0 ? `${c.nonfoil} nonfoil` : ""}
                        {c.nonfoil && c.foil ? " · " : ""}
                        {c.foil > 0 ? `${c.foil} foil` : ""}
                      </small>
                      <CardTraits card={c} showFoil={false} />
                      {columns.location && c.location && (
                        <small className="card-location" title={c.location}>
                          {c.location}
                        </small>
                      )}
                      {columns.reservations && c.reserved > 0 && (
                        <small>
                          {c.reserved} reserved · {c.quantity - c.reserved}{" "}
                          unreserved
                        </small>
                      )}
                      {filters.view && candidates(c)}
                      {columns.labels && (
                        <small>
                          {c.decks.join(", ") || "No Excel Deck label"}
                        </small>
                      )}
                      {columns.value && (
                        <span>{money(c.value, state.settings.currency)}</span>
                      )}
                      <MatchBadge card={c} />
                      {columns.value && c.match_status === "matched" && (
                        <PriceState status={c.price_state} />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          {!rows.length && !filterError && (
            <Empty
              title={
                collection.length
                  ? "No matching cards"
                  : "Your collection is empty"
              }
            >
              {collection.length ? (
                <>
                  <p>Try another search or remove filters.</p>
                  <button
                    className="button secondary"
                    onClick={() =>
                      setFilters({ ...defaults, sort: filters.sort })
                    }
                  >
                    Clear filters
                  </button>
                </>
              ) : (
                <>
                  <p>Import your complete saved Input workbook to start.</p>
                  <button className="button primary" onClick={openImport}>
                    Import saved workbook
                  </button>
                </>
              )}
            </Empty>
          )}
        </div>
        <div className="table-footer">
          <span>Imported {date(state.last_import?.created_at)}</span>
          <Pagination page={currentPage} pages={pages} setPage={paginate} />
        </div>
      </section>
      {panel && (
        <Dialog
          title="Filters and saved views"
          className="filter-dialog"
          close={() => setPanel(false)}
        >
          <div className="filter-dialog-body">
            <p className="hint">
              Changes apply when you show results. Closing discards unapplied
              filters.
            </p>
            <CollectionFiltersPanel
              filters={draft}
              update={updateDraft}
              collection={collection}
              state={state}
            />
            <h3>Saved views</h3>
            <div className="saved-views">
              {state.saved_filters.map((f) => (
                <span key={f.id}>
                  <button
                    className="button secondary small"
                    onClick={() => {
                      setDraft(normalizeFilters(f.filters));
                    }}
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
                disabled={!!draftError}
                onClick={() => setSavingFilter(true)}
              >
                Save current filters
              </button>
            </div>
            {selectedCards.length > 0 && (
              <p className="hint">
                Applying filters clears {selectedCards.length} selected
                printings.
              </p>
            )}
            {draftError && (
              <p role="alert" className="notice danger">
                {draftError}
              </p>
            )}
          </div>
          <div className="filter-dialog-footer">
            <button
              className="text-button"
              onClick={() => setDraft({ ...defaults, sort: draft.sort })}
            >
              Reset filters
            </button>
            <div className="actions">
              <button
                className="button secondary"
                onClick={() => setPanel(false)}
              >
                Cancel
              </button>
              <button
                className="button primary"
                disabled={!!draftError}
                onClick={() => {
                  setFilters(normalizeFilters(draft));
                  setPanel(false);
                }}
              >
                Show {preview.length} printings
              </button>
            </div>
          </div>
        </Dialog>
      )}
      {displayOpen && (
        <DisplayDialog
          value={display}
          setValue={setDisplay}
          close={() => setDisplayOpen(false)}
        />
      )}
      {actionsOpen && selectedCards.length > 0 && (
        <CollectionActions
          count={selectedCards.length}
          resultCount={filtered.length}
          selectAll={selectAll}
          busy={busy}
          exportSelected={exportSelected}
          action={setBulkAction}
          close={() => setActionsOpen(false)}
        />
      )}
      {bulkAction && selectedCards.length > 0 && (
        <BulkCollectionDialog
          cards={selectedCards}
          action={bulkAction}
          state={state}
          run={run}
          completed={offerUndo}
          close={() => setBulkAction("")}
        />
      )}
      {card && inspection && (
        <CardDetails
          key={card.key}
          card={card}
          position={inspection.index}
          count={inspection.cards.length}
          revision={inspection.revision}
          navigate={(step) =>
            setInspection((current) =>
              current ? { ...current, index: current.index + step } : null,
            )
          }
          state={state}
          run={run}
          busy={busy}
          reload={reload}
          close={() => setInspection(null)}
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
            disabled={busy || !filterName.trim() || !!draftError}
            onClick={async () => {
              if (
                await run(
                  () =>
                    api("/filters", "POST", {
                      name: filterName,
                      filters: normalizeFilters(draft),
                    }),
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
