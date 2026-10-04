import React, { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  Copy,
  Layers3,
  Loader2,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import type { Deck, Entry, Impact, ScryCard, ViewProps } from "./types";
import { formats, zones } from "./types";
import { api, ConfirmChange, Dialog, Empty } from "./ui";
import { Recovery } from "./Recovery";
type Editable = Pick<
  Entry,
  "name" | "quantity" | "zone" | "printing_key" | "finish"
> & { image?: string };
function DeckEditor({
  deck,
  state,
  reload,
  close,
}: ViewProps & { deck: Deck | null; close: () => void }) {
  const [name, setName] = useState(deck?.name || ""),
    [format, setFormat] = useState(deck?.format || "commander"),
    [active, setActive] = useState(Boolean(deck?.active)),
    [confirmed, setConfirmed] = useState(Boolean(deck?.list_confirmed));
  const [entries, setEntries] = useState<Editable[]>(
    () =>
      deck?.entries.map((e) => ({
        name: e.name,
        quantity: e.quantity,
        zone: e.zone,
        printing_key: e.printing_key,
        finish: e.finish || null,
        image: e.card?.image_url,
      })) || [],
  );
  const [initial] = useState(
      JSON.stringify({ name, format, active, confirmed, entries }),
    ),
    [expected] = useState(state.revision);
  const [list, setList] = useState(deck?.decklist || ""),
    [parsed, setParsed] = useState<Deck | null>(null),
    [draft, setDraft] = useState<Deck | null>(null),
    [bulkPending, setBulkPending] = useState(false),
    [bulkError, setBulkError] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [guard, setGuard] = useState(false);
  const [query, setQuery] = useState(""),
    [cards, setCards] = useState<ScryCard[]>([]),
    [searching, setSearching] = useState(false),
    [exact, setExact] = useState(false),
    [addZone, setAddZone] = useState("main");
  const dirty =
    JSON.stringify({ name, format, active, confirmed, entries }) !== initial ||
    list !== (deck?.decklist || "");
  const requestClose = () => {
    if (busy) return;
    if (dirty) setGuard(true);
    else close();
  };
  useEffect(() => {
    const guardNavigation = (e: Event) => {
      if (dirty) {
        e.preventDefault();
        setGuard(true);
      }
    };
    window.addEventListener("mtg-before-navigate", guardNavigation);
    return () =>
      window.removeEventListener("mtg-before-navigate", guardNavigation);
  }, [dirty]);
  const update = (i: number, values: Partial<Editable>) =>
    setEntries((rows) =>
      rows.map((e, n) => (n === i ? { ...e, ...values } : e)),
    );
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
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      api<Deck>("/decks/validate", "POST", {
        id: deck?.id,
        name,
        format,
        entries,
        list_confirmed: confirmed,
      })
        .then((d) => {
          if (!cancelled) {
            setDraft(d);
            setError("");
          }
        })
        .catch((e) => {
          if (!cancelled) setError(e.message);
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [deck?.id, name, format, entries, confirmed]);
  const save = async () => {
    if (bulkPending) {
      setError(
        "Preview and apply the pasted list to card rows before saving, or discard that pasted text.",
      );
      setGuard(false);
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api(
        deck ? `/decks/${deck.id}` : "/decks",
        deck ? "PUT" : "POST",
        { name, format, active, entries, list_confirmed: confirmed },
        expected,
      );
      await reload();
      close();
    } catch (e) {
      setError((e as Error).message);
      setGuard(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Dialog
        title={deck ? "Edit target decklist" : "Create a deck"}
        close={requestClose}
        wide
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="field-row">
            <label className="field">
              Deck name
              <input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              Format
              <select
                aria-label="Format"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                {Object.entries(formats).map(([k, v]) => (
                  <option value={k} key={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />{" "}
            Reserve copies for this deck
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            This is my intended target list, including cards I do not own
          </label>
          <div className="editor-validation" aria-live="polite">
            {draft ? (
              <>
                <strong>
                  {draft.readiness.list.entered} / {draft.readiness.list.target}{" "}
                  cards outside sideboard · {draft.readiness.list.label}
                </strong>
                <details>
                  <summary>
                    {draft.warnings.length} advisory format checks
                  </summary>
                  <ul>
                    {draft.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              "Checking target list…"
            )}
          </div>
          <h3>Card rows</h3>
          <div className="edit-rows">
            {entries.map((entry, i) => (
              <div className="edit-card" key={i}>
                {entry.image && <img src={entry.image} alt="" />}
                <label className="field">
                  Card name
                  <input
                    aria-label={`Card name ${i + 1}`}
                    value={entry.name}
                    onChange={(e) =>
                      update(i, { name: e.target.value, image: undefined })
                    }
                  />
                </label>
                <label className="field">
                  Quantity
                  <input
                    aria-label={`Quantity for ${entry.name || "row " + (i + 1)}`}
                    type="number"
                    min={1}
                    max={100000}
                    required
                    value={entry.quantity}
                    onChange={(e) =>
                      update(i, { quantity: Number(e.target.value) })
                    }
                  />
                </label>
                <label className="field">
                  Zone
                  <select
                    aria-label={`Zone for ${entry.name || "row " + (i + 1)}`}
                    value={entry.zone}
                    onChange={(e) => update(i, { zone: e.target.value })}
                  >
                    {Object.entries(zones).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  Printing requirement
                  <input
                    value={entry.printing_key || ""}
                    onChange={(e) =>
                      update(i, {
                        printing_key: e.target.value.toLowerCase() || null,
                      })
                    }
                    placeholder="Any, or set:number"
                  />
                </label>
                <label className="field">
                  Finish
                  <select
                    aria-label={`Finish for ${entry.name || "row " + (i + 1)}`}
                    value={entry.finish || ""}
                    onChange={(e) =>
                      update(i, { finish: e.target.value || null })
                    }
                  >
                    <option value="">Any finish</option>
                    <option value="nonfoil">Nonfoil</option>
                    <option value="foil">Foil</option>
                  </select>
                </label>
                <button
                  type="button"
                  className="icon-button danger-text"
                  aria-label={`Remove ${entry.name || "row " + (i + 1)}`}
                  onClick={() =>
                    setEntries((es) => es.filter((_, n) => n !== i))
                  }
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              setEntries((es) => [
                ...es,
                {
                  name: "",
                  quantity: 1,
                  zone: "main",
                  printing_key: null,
                  finish: null,
                },
              ])
            }
          >
            <Plus size={16} /> Add card row
          </button>
          <section className="lookup">
            <h3>Find a card on Scryfall</h3>
            <div className="search-row">
              <input
                aria-label="Search Scryfall"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Card name or Scryfall query"
              />
              <button
                type="button"
                className="button secondary"
                disabled={searching || !query.trim()}
                onClick={async () => {
                  setSearching(true);
                  setError("");
                  try {
                    setCards(
                      await api<ScryCard[]>(
                        "/cards/search?q=" + encodeURIComponent(query),
                      ),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setSearching(false);
                  }
                }}
              >
                <Search size={16} /> Search
              </button>
            </div>
            <div className="field-row">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={exact}
                  onChange={(e) => setExact(e.target.checked)}
                />{" "}
                Require this exact printing
              </label>
              <label className="field">
                Add to
                <select
                  aria-label="Add to zone"
                  value={addZone}
                  onChange={(e) => setAddZone(e.target.value)}
                >
                  {Object.entries(zones).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="search-results">
              {cards.map((c) => (
                <button
                  type="button"
                  key={c.id}
                  onClick={() =>
                    setEntries((es) => [
                      ...es,
                      {
                        name: c.name,
                        quantity: 1,
                        zone: addZone,
                        printing_key: exact
                          ? `${c.set}:${c.collector_number}`
                          : null,
                        finish: null,
                        image:
                          c.image_uris?.small ||
                          c.card_faces?.[0]?.image_uris?.small,
                      },
                    ])
                  }
                >
                  {(c.image_uris?.small ||
                    c.card_faces?.[0]?.image_uris?.small) && (
                    <img
                      src={
                        c.image_uris?.small ||
                        c.card_faces?.[0]?.image_uris?.small
                      }
                      alt=""
                    />
                  )}
                  <span>
                    <strong>{c.name}</strong>
                    <small>
                      {c.set_name} #{c.collector_number}
                    </small>
                  </span>
                  <Plus size={16} />
                </button>
              ))}
            </div>
          </section>
          <details className="lookup">
            <summary>Paste or replace a bulk decklist</summary>
            <label className="field">
              Quantity-and-name list
              <textarea
                className="decklist-input"
                value={list}
                onChange={(e) => {
                  setList(e.target.value);
                  setParsed(null);
                  setBulkPending(true);
                }}
                placeholder={
                  "Commander\n1 Ramos, Dragon Engine\nDeck\n1 Sol Ring (CMM) 1 [foil]"
                }
              />
            </label>
            <p className="hint">
              Headings: Commander, Deck, Sideboard. Optional edition: (SET)
              number. Optional finish: [foil] or [nonfoil].
            </p>
            <button
              type="button"
              className="button secondary"
              onClick={async () => {
                setBulkError("");
                try {
                  setParsed(
                    await api<Deck>("/decks/validate", "POST", {
                      format,
                      name,
                      decklist: list,
                      list_confirmed: confirmed,
                    }),
                  );
                } catch (e) {
                  setBulkError((e as Error).message);
                }
              }}
            >
              Preview pasted list
            </button>
            {bulkError && <p role="alert">{bulkError}</p>}
            {parsed && (
              <div className="notice warning">
                <span>
                  {parsed.total} target copies in {parsed.entries.length}{" "}
                  requirements. Replaces the {entries.length} current rows.
                </span>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setEntries(
                      parsed.entries.map((e) => ({
                        name: e.name,
                        quantity: e.quantity,
                        zone: e.zone,
                        printing_key: e.printing_key,
                        finish: e.finish,
                      })),
                    );
                    setParsed(null);
                    setBulkPending(false);
                  }}
                >
                  Apply parsed list to editor
                </button>
              </div>
            )}
          </details>
          {error && (
            <p role="alert" className="notice danger">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button
              type="button"
              className="button secondary"
              onClick={requestClose}
            >
              Cancel
            </button>
            <button className="button primary" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="spin" size={16} />} Save deck
            </button>
          </div>
        </form>
      </Dialog>
      {guard && (
        <Dialog title="Unsaved deck changes" close={() => setGuard(false)}>
          <p>
            Save your card-row edits, discard the draft, or continue editing.
            Pasted text must be applied to card rows before saving.
          </p>
          <div className="dialog-actions">
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => setGuard(false)}
            >
              Continue editing
            </button>
            <button
              className="button secondary danger-text"
              disabled={busy}
              onClick={close}
            >
              Discard changes
            </button>
            <button
              className="button primary"
              disabled={busy || !name.trim()}
              onClick={save}
            >
              Save changes
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
function DeckAnalysis({ deck }: { deck: Deck }) {
  const a = deck.analysis,
    max = Math.max(1, ...a.curve);
  return (
    <details className="deck-analysis">
      <summary>
        Deck analysis · {a.lands} known lands · {a.unknown} copies lack metadata
      </summary>
      <p className="hint">
        Main deck and command zone only. Results cover {a.known} resolved
        copies; unknown cards are excluded. Color counts are printed mana
        symbols, including hybrid options.
      </p>
      <h3>Mana curve (nonland)</h3>
      <div className="mana-curve">
        {a.curve.map((n, i) => (
          <div key={i}>
            <span>{n}</span>
            <div
              className="curve-bar"
              style={{ height: `${Math.max(3, (n / max) * 100)}px` }}
            />
            <span>{i === 7 ? "7+" : i}</span>
          </div>
        ))}
      </div>
      <div className="analysis-counts">
        <div>
          <h3>Card types</h3>
          {Object.entries(a.types).map(([k, n]) => (
            <p key={k}>
              {k}: {n}
            </p>
          ))}
        </div>
        <div>
          <h3>Colored mana symbols</h3>
          {Object.entries(a.colors).map(([k, n]) => (
            <p key={k}>
              {k}: {n}
            </p>
          ))}
        </div>
      </div>
    </details>
  );
}
export function Decks({
  state,
  run,
  busy,
  reload,
  exportList,
  openMissing,
}: ViewProps & {
  exportList: (p: Record<string, string>) => void;
  openMissing: (id: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(
      () =>
        Number(
          new URLSearchParams(location.hash.split("?")[1] || "").get("deck"),
        ) || null,
    ),
    [zone, setZone] = useState("all"),
    [editor, setEditor] = useState<Deck | null | undefined>(() =>
      new URLSearchParams(location.hash.split("?")[1] || "").get("new") === "1"
        ? null
        : undefined,
    ),
    [history, setHistory] = useState(false),
    [priority, setPriority] = useState(""),
    [transfer, setTransfer] = useState<{
      entry: Entry;
      source: Entry["reserved_by"][number];
      quantity: number;
    } | null>(null);
  const [preview, setPreview] = useState<{
      data: Record<string, unknown>;
      revision: number;
      impact: Impact[];
      message: string;
    } | null>(null),
    [localError, setLocalError] = useState("");
  const deck = state.decks.find((d) => d.id === selected) || state.decks[0];
  useEffect(() => {
    const create = () => setEditor(null);
    window.addEventListener("mtg-new-deck", create);
    return () => window.removeEventListener("mtg-new-deck", create);
  }, []);
  useEffect(() => {
    setPriority(String(deck?.priority || 0));
    setHistory(false);
  }, [deck?.id, deck?.priority]);
  const prepare = async (data: Record<string, unknown>) => {
    setLocalError("");
    try {
      const p = await api<{
        revision: number;
        impact: Impact[];
        message: string;
      }>("/reservations/preview", "POST", data);
      setPreview({ ...p, data });
      setTransfer(null);
    } catch (e) {
      setLocalError((e as Error).message);
    }
  };
  const choose = (id: number) => {
    setSelected(id);
    setZone("all");
    historyReplaceDeck(id);
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">BUILD WITH WHAT YOU OWN</p>
          <h1>Decks</h1>
          <p className="subtitle">
            Target completeness, ownership, availability, and format checks.
          </p>
        </div>
        <button className="button primary" onClick={() => setEditor(null)}>
          <Plus size={16} /> New deck
        </button>
      </div>
      {localError && (
        <p role="alert" className="notice danger">
          {localError}
        </p>
      )}
      {!deck ? (
        <Empty title="Create your first target list">
          <p>Include cards you intend to acquire.</p>
          <button className="button primary" onClick={() => setEditor(null)}>
            Create deck
          </button>
        </Empty>
      ) : (
        <div className="deck-layout">
          <div className="deck-selector">
            {state.decks.map((d) => (
              <button
                className={`deck-tile ${deck.id === d.id ? "selected" : ""}`}
                key={d.id}
                onClick={() => choose(d.id)}
              >
                <div>
                  <span>{formats[d.format]}</span>
                  <span>
                    {d.active
                      ? `Reserved · priority ${d.priority || 0}`
                      : "Draft"}
                  </span>
                </div>
                <strong>{d.name}</strong>
                <p
                  className={
                    d.readiness.list.complete ? "positive" : "amber-text"
                  }
                >
                  {d.readiness.list.label}
                </p>
                <small>
                  {d.covered} / {d.total} entered targets owned
                </small>
                <small>
                  {d.missing_now} short to assemble · {d.warnings.length} format
                  checks
                </small>
              </button>
            ))}
          </div>
          <section className="deck-detail table-panel">
            <div className="deck-heading">
              <div>
                <span className="format-tag">{formats[deck.format]}</span>
                <h2>{deck.name}</h2>
              </div>
              <div className="actions">
                <button
                  className="button secondary small"
                  onClick={() =>
                    exportList({ kind: "deck", deck_id: String(deck.id) })
                  }
                >
                  <ArrowDownToLine size={14} /> Export
                </button>
                <button
                  className="button primary small"
                  onClick={() => setEditor(deck)}
                >
                  Edit list
                </button>
                <button
                  className="button secondary small"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api(`/decks/${deck.id}/duplicate`, "POST"),
                      "Deck duplicated as a draft",
                    )
                  }
                >
                  <Copy size={14} /> Duplicate
                </button>
              </div>
            </div>
            <div className="readiness-grid">
              <div>
                <span>Target list</span>
                <strong
                  className={
                    deck.readiness.list.complete ? "positive" : "amber-text"
                  }
                >
                  {deck.readiness.list.label}
                </strong>
                <small>
                  {deck.readiness.list.entered} entered ·{" "}
                  {deck.readiness.list.unspecified} unspecified slots
                </small>
              </div>
              <div>
                <span>Ownership</span>
                <strong>
                  {deck.covered} / {deck.total} targets owned
                </strong>
                <small>{deck.missing} specified copies to acquire</small>
              </div>
              <div>
                <span>Availability</span>
                <strong>
                  {deck.missing_now
                    ? `${deck.missing_now} copies short`
                    : "Entered targets available"}
                </strong>
                <small>After other active reservations</small>
              </div>
              <div>
                <span>Format</span>
                <strong>{deck.readiness.format.status}</strong>
                <small>Advisory; review special rules manually</small>
              </div>
            </div>
            {!deck.readiness.list.complete && (
              <p className="notice warning readiness-note">
                {deck.readiness.list.unspecified
                  ? `${deck.readiness.list.unspecified} slots are unspecified, not a shopping list. Add your intended cards before treating this deck as complete.`
                  : "Confirm the intended target list in the editor. Workbook assignments alone do not establish a complete deck."}
              </p>
            )}
            <details
              className="deck-warnings"
              open={!deck.readiness.list.complete}
            >
              <summary>{deck.warnings.length} deck checks to review</summary>
              <ul>
                {deck.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
            <div className="reservation-controls">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(deck.active)}
                  disabled={busy}
                  onChange={(e) =>
                    prepare({
                      operation: "active",
                      deck_id: deck.id,
                      active: e.target.checked,
                    })
                  }
                />{" "}
                Reserve copies for this deck
              </label>
              <label>
                Priority (lower first)
                <input
                  aria-label="Deck reservation priority"
                  type="number"
                  min={0}
                  max={999}
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                />
              </label>
              <button
                className="button secondary small"
                disabled={busy || Number(priority) === (deck.priority || 0)}
                onClick={() =>
                  prepare({
                    operation: "priority",
                    deck_id: deck.id,
                    priority: Number(priority),
                  })
                }
              >
                Preview priority change
              </button>
            </div>
            <p className="hint inset">
              Planned reservations are separate from Excel Deck labels and
              physical storage. Manual moves are reconciled when a new inventory
              snapshot is accepted.
            </p>
            <div className="deck-options">
              <label>
                Zone
                <select
                  aria-label="Deck zone"
                  value={zone}
                  onChange={(e) => setZone(e.target.value)}
                >
                  <option value="all">All zones</option>
                  {Object.entries(zones).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="deck-requirements">
              {deck.entries
                .filter((e) => zone === "all" || e.zone === zone)
                .map((e) => (
                  <div className="requirement-row" key={e.id}>
                    <div>
                      <strong>{e.name}</strong>
                      <small>
                        {zones[e.zone]} · {e.printing_key || "Any printing"} ·{" "}
                        {e.finish || "Any finish"}
                      </small>
                    </div>
                    <dl>
                      <div>
                        <dt>Need</dt>
                        <dd>{e.quantity}</dd>
                      </div>
                      <div>
                        <dt>Own</dt>
                        <dd>{e.owned}</dd>
                      </div>
                      <div>
                        <dt>Available</dt>
                        <dd>{e.available}</dd>
                      </div>
                      <div>
                        <dt>To buy</dt>
                        <dd>{e.missing}</dd>
                      </div>
                    </dl>
                    <div className="reservation-detail">
                      {e.reserved_by.length ? (
                        <>
                          <span>
                            {e.in_other_decks} compatible copies reserved
                            elsewhere:
                          </span>
                          {e.reserved_by.map((r, i) => (
                            <div key={i}>
                              <span>
                                {r.name}: {r.quantity} {r.finish} ·{" "}
                                {r.printing_key}
                              </span>
                              {deck.active && e.missing_now > 0 && (
                                <button
                                  className="button secondary small"
                                  onClick={() =>
                                    setTransfer({
                                      entry: e,
                                      source: r,
                                      quantity: Math.min(
                                        e.missing_now,
                                        r.quantity,
                                      ),
                                    })
                                  }
                                >
                                  Move from {r.name}
                                </button>
                              )}
                            </div>
                          ))}
                        </>
                      ) : (
                        <span>
                          {e.missing_now
                            ? `${e.missing_now} copies short to assemble`
                            : "Entered requirement available"}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
            </div>
            <DeckAnalysis deck={deck} />
            <div className="deck-bottom">
              <button
                className="text-button"
                onClick={() => openMissing(deck.id)}
              >
                View missing cards
              </button>
              <button
                className="text-button"
                onClick={() => setHistory(!history)}
              >
                Revision history
              </button>
              <button
                className="text-button danger-text"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      `Delete ${deck.name}? Its list can be recovered from revision history.`,
                    )
                  )
                    run(
                      () => api(`/decks/${deck.id}`, "DELETE"),
                      "Deck deleted; revision saved",
                    );
                }}
              >
                <Trash2 size={14} /> Delete deck
              </button>
            </div>
            {history && (
              <Recovery
                state={state}
                run={run}
                busy={busy}
                reload={reload}
                revisions
                deckId={deck.id}
              />
            )}
          </section>
        </div>
      )}
      {editor !== undefined && (
        <DeckEditor
          deck={editor}
          state={state}
          run={run}
          busy={busy}
          reload={reload}
          close={() => setEditor(undefined)}
        />
      )}
      {transfer && (
        <Dialog
          title={`Move copies from ${transfer.source.name}`}
          close={() => setTransfer(null)}
        >
          <p>
            {transfer.entry.name} · {transfer.source.printing_key} ·{" "}
            {transfer.source.finish}
          </p>
          <label className="field">
            Copies to move
            <input
              type="number"
              min={1}
              max={Math.min(
                transfer.entry.missing_now,
                transfer.source.quantity,
              )}
              value={transfer.quantity}
              onChange={(e) =>
                setTransfer({ ...transfer, quantity: Number(e.target.value) })
              }
            />
          </label>
          <button
            className="button primary"
            onClick={() =>
              prepare({
                operation: "transfer",
                deck_id: deck!.id,
                entry_id: transfer.entry.id,
                from_deck_id: transfer.source.deck_id,
                printing_key: transfer.source.printing_key,
                finish: transfer.source.finish,
                quantity: transfer.quantity,
              })
            }
          >
            Preview reservation move
          </button>
        </Dialog>
      )}
      {preview && (
        <ConfirmChange
          title="Review reservation change"
          message={preview.message}
          impact={preview.impact}
          close={() => setPreview(null)}
          apply={async () => {
            await api(
              "/reservations/apply",
              "POST",
              preview.data,
              preview.revision,
            );
            await reload();
          }}
        />
      )}
    </>
  );
}
function historyReplaceDeck(id: number) {
  window.history.replaceState(null, "", `#decks?deck=${id}`);
}
