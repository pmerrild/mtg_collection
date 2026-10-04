import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import { Missing } from "./Missing";
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
  embedded = false,
}: ViewProps & { deck: Deck | null; close: () => void; embedded?: boolean }) {
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
    [validationError, setValidationError] = useState(""),
    [busy, setBusy] = useState(false),
    [guard, setGuard] = useState(false);
  const [query, setQuery] = useState(""),
    [cards, setCards] = useState<ScryCard[]>([]),
    [searching, setSearching] = useState(false),
    [exact, setExact] = useState(false),
    [addZone, setAddZone] = useState("main");
  const pendingAdd = useRef(false);
  const appendEntries: typeof setEntries = (next) => {
    pendingAdd.current = true;
    setEntries(next);
  };
  useLayoutEffect(() => {
    if (!pendingAdd.current) return;
    pendingAdd.current = false;
    const input = document.querySelector<HTMLInputElement>(
      `.deck-editor-workspace input[aria-label="Card name ${entries.length}"]`,
    );
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: "center" });
  }, [entries.length]);
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
      if (busy) {
        e.preventDefault();
        return;
      }
      if (dirty) {
        e.preventDefault();
        setGuard(true);
      }
    };
    window.addEventListener("mtg-before-navigate", guardNavigation);
    return () =>
      window.removeEventListener("mtg-before-navigate", guardNavigation);
  }, [dirty, busy]);
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
            setValidationError("");
          }
        })
        .catch((e) => {
          if (!cancelled) setValidationError(e.message);
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
  const Surface = embedded ? EditorSurface : Dialog;
  return (
    <>
      <Surface
        className="deck-editor-dialog"
        title={deck ? "Edit deck" : "Create a deck"}
        close={requestClose}
        wide
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="dialog-actions">
            {(error || validationError) && (
              <p role="alert" className="notice danger editor-save-error">
                {error || validationError}
              </p>
            )}
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
          <fieldset className="editor-fields" disabled={busy}>
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
            <div className="editor-tools">
              {" "}
              <div className="editor-add-row">
                {" "}
                <button
                  type="button"
                  className="button secondary"
                  aria-label="Add card row"
                  onClick={() =>
                    appendEntries((es) => [
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
                  <Plus size={16} /> Add card
                </button>
              </div>
              <details className="lookup editor-find">
                <summary>Find a card</summary>
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
                        appendEntries((es) => [
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
              </details>
              <details className="lookup editor-paste">
                <summary>Paste list</summary>
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
                  <details className="row-constraints">
                    <summary>
                      {entry.printing_key || entry.finish
                        ? "Restricted"
                        : "Any printing"}
                    </summary>
                    <div>
                      {" "}
                      <label className="field">
                        Printing requirement
                        <input
                          value={entry.printing_key || ""}
                          onChange={(e) =>
                            update(i, {
                              printing_key:
                                e.target.value.toLowerCase() || null,
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
                    </div>
                  </details>
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
            <details className="editor-deck-settings">
              <summary>List confirmation & reservations</summary>{" "}
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
                      {draft.readiness.list.entered} /{" "}
                      {draft.readiness.list.target} cards outside sideboard ·{" "}
                      {draft.readiness.list.label}
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
            </details>
          </fieldset>
        </form>
      </Surface>
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
function EditorSurface({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
  className?: string;
  wide?: boolean;
}) {
  return (
    <section className="deck-editor-workspace" aria-label="Deck editor">
      <div className="page-heading">
        <h1>{title}</h1>
      </div>
      {children}
    </section>
  );
}
export function Decks({
  state,
  run,
  busy,
  reload,
  exportList,
}: ViewProps & { exportList: (p: Record<string, string>) => void }) {
  const params = () => new URLSearchParams(location.hash.split("?")[1] || "");
  const [selected, setSelected] = useState<number | null>(
    () => Number(params().get("deck")) || null,
  );
  const [panel, setPanel] = useState(() =>
    params().get("view") === "missing" ? "missing" : "cards",
  );
  const [zone, setZone] = useState("all"),
    [history, setHistory] = useState(false),
    [priority, setPriority] = useState("");
  const [editor, setEditor] = useState<Deck | null | undefined>(() =>
    params().get("new") === "1"
      ? null
      : params().get("edit") === "1"
        ? state.decks.find((d) => d.id === Number(params().get("deck")))
        : undefined,
  );
  const [transfer, setTransfer] = useState<{
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
  const decksRef = useRef(state.decks);
  decksRef.current = state.decks;
  const beginEdit = (target: Deck | null) => {
    setEditor(target);
    historyReplaceEdit(target);
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  };
  const deck = state.decks.find((d) => d.id === selected);
  useEffect(() => {
    const create = () => beginEdit(null);
    const sync = () => {
      if (!location.hash.startsWith("#decks")) return;
      const q = params();
      const desired =
        q.get("new") === "1"
          ? null
          : q.get("edit") === "1"
            ? decksRef.current.find((d) => d.id === Number(q.get("deck")))
            : undefined;
      setEditor((current) =>
        current === null && desired === null
          ? current
          : current && desired && current.id === desired.id
            ? current
            : desired,
      );
      setSelected(Number(q.get("deck")) || null);
      setPanel(params().get("view") === "missing" ? "missing" : "cards");
    };
    window.addEventListener("mtg-new-deck", create);
    window.addEventListener("hashchange", sync);
    return () => {
      window.removeEventListener("mtg-new-deck", create);
      window.removeEventListener("hashchange", sync);
    };
  }, []);
  useEffect(() => {
    setPriority(String(deck?.priority || 0));
    setHistory(false);
    setZone("all");
  }, [deck?.id, deck?.priority]);
  const route = (id: number | null, view = "cards") => {
    setSelected(id);
    setPanel(view);
    const q = new URLSearchParams();
    if (id) q.set("deck", String(id));
    if (view !== "cards") q.set("view", view);
    window.history.replaceState(null, "", "#decks" + (q.size ? "?" + q : ""));
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  };
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
  const closeEditor = () => {
    setEditor(undefined);
    route(selected);
  };
  return (
    <>
      {editor !== undefined ? (
        <DeckEditor
          key={editor?.id || "new"}
          deck={editor}
          state={state}
          run={run}
          busy={busy}
          reload={reload}
          close={closeEditor}
          embedded
        />
      ) : (
        <>
          {!deck && panel !== "missing" ? (
            <>
              <div className="page-heading">
                <div>
                  <h1>Decks</h1>
                  <p className="subtitle">Your decklists.</p>
                </div>
                <button
                  className="button primary"
                  onClick={() => beginEdit(null)}
                >
                  <Plus size={16} />
                  New deck
                </button>
              </div>
              {!state.decks.length ? (
                <Empty title="Create your first deck">
                  <p>Add the cards you want to play.</p>
                  <button
                    className="button primary"
                    onClick={() => beginEdit(null)}
                  >
                    Create deck
                  </button>
                </Empty>
              ) : (
                <div className="deck-library">
                  {state.decks.map((d) => (
                    <button
                      className="deck-library-row"
                      key={d.id}
                      onClick={() => route(d.id)}
                    >
                      <span>
                        <strong>{d.name}</strong>
                        <small>
                          {formats[d.format]} · {d.total} cards listed
                        </small>
                      </span>
                      <span className="deck-library-status">
                        {!d.readiness.list.complete
                          ? "Incomplete list"
                          : !d.list_confirmed
                            ? "Unconfirmed list"
                            : d.missing_now
                              ? `${d.missing_now} unavailable`
                              : "Ready to assemble"}
                        <small>
                          {d.covered} / {d.total} owned
                        </small>
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <button
                className="text-button deck-compare"
                onClick={() => route(null, "missing")}
              >
                Compare missing cards & purchases
              </button>
            </>
          ) : (
            <>
              <button
                className="text-button back-link"
                onClick={() => route(null)}
              >
                Back to decks
              </button>
              <div className="page-heading">
                <div>
                  <h1>{deck?.name || "Missing cards"}</h1>
                  {deck && (
                    <p className="subtitle">
                      {formats[deck.format]} · {deck.readiness.list.entered} /{" "}
                      {deck.readiness.list.target} cards listed
                      {!deck.readiness.list.complete
                        ? ` · ${deck.readiness.list.unspecified} unspecified`
                        : !deck.list_confirmed
                          ? " · unconfirmed"
                          : ""}
                    </p>
                  )}
                </div>
              </div>
              {deck && (
                <div className="deck-tabs-row">
                  {" "}
                  <nav
                    className="section-tabs deck-tabs"
                    aria-label="Deck sections"
                  >
                    <button
                      aria-pressed={panel === "cards"}
                      onClick={() => route(deck.id)}
                    >
                      Cards
                    </button>
                    <button
                      aria-pressed={panel === "missing"}
                      onClick={() => route(deck.id, "missing")}
                    >
                      Missing cards{deck.missing ? ` (${deck.missing})` : ""}
                    </button>
                  </nav>
                  <button
                    className="button primary"
                    onClick={() => beginEdit(deck)}
                  >
                    Edit list
                  </button>
                </div>
              )}
              {panel === "missing" ? (
                <Missing
                  key={deck?.id || "all"}
                  state={state}
                  run={run}
                  busy={busy}
                  reload={reload}
                  initialDeck={deck?.id}
                  exportList={exportList}
                  embedded
                />
              ) : (
                deck && (
                  <>
                    <div className="deck-list-context">
                      <span>
                        {deck.covered} / {deck.total} owned
                        {deck.missing_now > deck.missing
                          ? ` · ${deck.missing_now - deck.missing} reserved elsewhere`
                          : ""}
                      </span>
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
                    <section
                      className="deck-card-list table-panel"
                      aria-label="Deck card list"
                    >
                      <div className="deck-list-labels">
                        <span>Qty</span>
                        <span>Card</span>
                        <span>Owned / needed</span>
                      </div>
                      {deck.entries
                        .filter((e) => zone === "all" || e.zone === zone)
                        .map((e) => (
                          <details className="deck-card-entry" key={e.id}>
                            <summary>
                              <strong>{e.quantity}</strong>
                              <span>
                                <strong>{e.name}</strong>
                                <small>
                                  {zones[e.zone]}
                                  {e.printing_key ? ` · ${e.printing_key}` : ""}
                                  {e.finish ? ` · ${e.finish}` : ""}
                                </small>
                              </span>
                              <span
                                className={
                                  e.owned < e.quantity ? "deck-shortage" : ""
                                }
                              >
                                {e.owned} / {e.quantity}
                                <small>
                                  {e.missing
                                    ? `${e.missing} to buy`
                                    : e.missing_now
                                      ? `${e.missing_now} reserved elsewhere`
                                      : "Owned"}
                                </small>
                              </span>
                            </summary>
                            <div className="deck-card-notes">
                              <p>
                                {e.printing_key || "Any printing"} ·{" "}
                                {e.finish || "Any finish"} · {e.available}{" "}
                                available after reservations.
                              </p>
                              {e.reserved_by.map((r, i) => (
                                <div key={i}>
                                  <span>
                                    {r.quantity} {r.finish} in {r.name} ·{" "}
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
                            </div>
                          </details>
                        ))}
                      {!deck.entries.length && (
                        <Empty title="No cards yet">
                          <button
                            className="button primary"
                            onClick={() => beginEdit(deck)}
                          >
                            Add your list
                          </button>
                        </Empty>
                      )}
                    </section>
                    <details className="deck-secondary">
                      <summary>Deck options</summary>
                      <div className="deck-options-body">
                        <div className="actions">
                          <button
                            className="button secondary"
                            onClick={() =>
                              exportList({
                                kind: "deck",
                                deck_id: String(deck.id),
                              })
                            }
                          >
                            Export
                          </button>
                          <button
                            className="button secondary"
                            disabled={busy}
                            onClick={() =>
                              run(
                                () =>
                                  api(`/decks/${deck.id}/duplicate`, "POST"),
                                "Deck duplicated as a draft",
                              )
                            }
                          >
                            Duplicate
                          </button>
                          <button
                            className="button secondary"
                            onClick={() => setHistory(!history)}
                          >
                            Revision history
                          </button>
                        </div>
                        <details className="deck-reservations">
                          <summary>Reservations</summary>
                          <p className="hint">
                            Planned reservations do not track physical storage.
                            Changes are previewed before applying.
                          </p>
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
                              />
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
                              disabled={
                                busy ||
                                Number(priority) === (deck.priority || 0)
                              }
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
                        </details>
                        <details className="deck-checks">
                          <summary>
                            Format checks ({deck.warnings.length})
                          </summary>
                          <p className="hint">
                            Advisory checks; special rules need manual review.
                          </p>
                          <ul>
                            {deck.warnings.map((w, i) => (
                              <li key={i}>{w}</li>
                            ))}
                          </ul>
                        </details>
                        <DeckAnalysis deck={deck} />
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
                          <Trash2 size={14} />
                          Delete deck
                        </button>
                      </div>
                    </details>
                  </>
                )
              )}
            </>
          )}
        </>
      )}
      {localError && (
        <p role="alert" className="notice danger">
          {localError}
        </p>
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

function historyReplaceEdit(deck: Deck | null) {
  window.history.replaceState(
    null,
    "",
    deck ? `#decks?deck=${deck.id}&edit=1` : "#decks?new=1",
  );
}
