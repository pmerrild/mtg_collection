import React, { useEffect, useState } from "react";
import { ArrowDownToLine, Plus, Trash2 } from "lucide-react";
import type { ViewProps, Wish } from "./types";
import { api, date, Dialog, Empty, money } from "./ui";
export function Missing({
  state,
  run,
  busy,
  exportList,
  initialDeck,
}: ViewProps & {
  exportList: (p: Record<string, string>) => void;
  initialDeck?: number;
}) {
  const [selected, setSelected] = useState<number[]>(
      initialDeck ? [initialDeck] : state.decks.map((d) => d.id),
    ),
    [mode, setMode] = useState("assembled"),
    [wish, setWish] = useState<Wish | null>(null),
    [error, setError] = useState(""),
    [newOrder, setNewOrder] = useState<{
      name: string;
      quantity: number;
      printing_key?: string | null;
      finish?: string | null;
      notes: string;
    } | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<Wish>(
      "/wishlist?" +
        new URLSearchParams({ deck_ids: selected.join(","), mode }),
    )
      .then((r) => {
        if (!cancelled) {
          setWish(r);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, mode, state]);
  const incomplete = state.decks.filter(
    (d) => selected.includes(d.id) && !d.readiness.list.complete,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PLAN YOUR NEXT ADDITIONS</p>
          <h1>Missing cards and acquisitions</h1>
          <p className="subtitle">
            Specified targets compared with ownership; orders stay separate.
          </p>
        </div>
        <button
          className="button secondary"
          disabled={!wish?.items.length}
          onClick={() =>
            exportList({ kind: "missing", deck_ids: selected.join(","), mode })
          }
        >
          <ArrowDownToLine size={16} /> Export for Scryfall
        </button>
      </div>
      <section className="wishlist-controls table-panel">
        <div>
          <h3>Include decks</h3>
          <div className="deck-pills">
            {state.decks.map((d) => (
              <label
                className={`deck-pill ${selected.includes(d.id) ? "selected" : ""}`}
                key={d.id}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(d.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, d.id]
                        : selected.filter((id) => id !== d.id),
                    )
                  }
                />
                {d.name}
              </label>
            ))}
          </div>
        </div>
        <div>
          <h3>How will you use these decks?</h3>
          <div className="segmented">
            <button
              aria-pressed={mode === "assembled"}
              className={mode === "assembled" ? "selected" : ""}
              onClick={() => setMode("assembled")}
            >
              Assembled together
            </button>
            <button
              aria-pressed={mode === "shared"}
              className={mode === "shared" ? "selected" : ""}
              onClick={() => setMode("shared")}
            >
              Share copies
            </button>
          </div>
          <p className="hint">
            {mode === "assembled"
              ? "One owned copy serves one selected deck at a time."
              : "Copies can move between selected decks. Printing and finish requirements still apply."}
          </p>
        </div>
      </section>
      {!!incomplete.length && (
        <p className="notice warning">
          Incomplete target lists: {incomplete.map((d) => d.name).join(", ")}.
          Unspecified slots are excluded from this wishlist.
        </p>
      )}
      {error && (
        <p role="alert" className="notice danger">
          {error}
        </p>
      )}
      <div className="wishlist-summary">
        <strong>{wish?.copies ?? "…"} specified copies to acquire</strong>
        <span>
          {wish?.priced_copies
            ? money(wish.estimate, state.settings.currency)
            : "Unknown estimate"}{" "}
          · {wish?.priced_copies ?? 0} priced /{" "}
          {(wish?.copies || 0) - (wish?.priced_copies || 0)} unpriced copies
        </span>
      </div>
      <section className="table-panel">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Card / requirement</th>
                <th>Missing</th>
                <th>Needed by</th>
                <th>Unit estimate</th>
                <th>Acquisition</th>
              </tr>
            </thead>
            <tbody>
              {wish?.items.map((item, i) => (
                <tr key={i}>
                  <td>
                    <strong>{item.name}</strong>
                    <small>
                      {item.printing_key || "Any printing"} ·{" "}
                      {item.finish || "Any finish"}
                    </small>
                  </td>
                  <td>{item.quantity}</td>
                  <td>{item.decks.join(", ")}</td>
                  <td>
                    {money(item.estimate, state.settings.currency)}
                    {item.estimate === null && (
                      <small>No compatible cached price</small>
                    )}
                  </td>
                  <td>
                    <button
                      className="button secondary small"
                      onClick={() => setNewOrder({ ...item, notes: "" })}
                    >
                      Track wanted
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {wish && !wish.items.length && (
          <Empty
            title={
              selected.length
                ? "Collection covers the entered requirements"
                : "Select decks to compare"
            }
          >
            <p>
              Complete and confirm each target list before calling a deck ready.
            </p>
          </Empty>
        )}
      </section>
      <p className="footnote">
        Estimates use the lowest compatible cached printing/finish price.
        Owned-card valuation still uses your actual printing and finish. Totals
        exclude unpriced cards, shipping, and condition adjustments.
      </p>
      <section className="review-panel table-panel">
        <div className="section-heading">
          <h2>Acquisition tracking</h2>
          <button
            className="button secondary"
            onClick={() => setNewOrder({ name: "", quantity: 1, notes: "" })}
          >
            <Plus size={16} /> Add wanted card
          </button>
        </div>
        <p className="hint">
          Wanted → ordered → received tracks your purchases. Even received
          records do not change ownership: record receipt in Excel and import
          the saved workbook. Orders are not subtracted from the ownership
          wishlist.
        </p>
        <div className="acquisition-list">
          {state.acquisitions.map((item) => (
            <div className="acquisition-row" key={item.id}>
              <div>
                <strong>
                  {item.quantity} {item.name}
                </strong>
                <small>
                  {item.printing_key || "Any printing"} ·{" "}
                  {item.finish || "Any finish"} · {date(item.updated_at)}
                </small>
                {item.notes && <p>{item.notes}</p>}
              </div>
              <select
                aria-label={`Acquisition status for ${item.name}`}
                value={item.status}
                disabled={busy}
                onChange={(e) =>
                  run(() =>
                    api(`/acquisitions/${item.id}`, "PATCH", {
                      status: e.target.value,
                    }),
                  )
                }
              >
                <option value="wanted">Wanted</option>
                <option value="ordered">Ordered</option>
                <option value="received">Received · record in Excel</option>
              </select>
              <button
                className="icon-button danger-text"
                aria-label={`Delete acquisition ${item.name}`}
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "Delete this tracking record? Inventory quantities stay unchanged.",
                    )
                  )
                    run(() => api(`/acquisitions/${item.id}`, "DELETE"));
                }}
              >
                <Trash2 size={18} />
              </button>
            </div>
          ))}
        </div>
        {!state.acquisitions.length && <p>No acquisitions tracked yet.</p>}
      </section>
      {newOrder && (
        <Dialog title="Track a wanted card" close={() => setNewOrder(null)}>
          <label className="field">
            Card name
            <input
              maxLength={200}
              value={newOrder.name}
              onChange={(e) =>
                setNewOrder({ ...newOrder, name: e.target.value })
              }
            />
          </label>
          <label className="field">
            Quantity
            <input
              type="number"
              min={1}
              max={100000}
              value={newOrder.quantity}
              onChange={(e) =>
                setNewOrder({ ...newOrder, quantity: Number(e.target.value) })
              }
            />
          </label>
          <label className="field">
            Notes
            <input
              maxLength={300}
              value={newOrder.notes}
              onChange={(e) =>
                setNewOrder({ ...newOrder, notes: e.target.value })
              }
              placeholder="Shop, expected delivery, or budget"
            />
          </label>
          <button
            className="button primary"
            disabled={busy || !newOrder.name.trim()}
            onClick={async () => {
              if (
                await run(
                  () => api("/acquisitions", "POST", newOrder),
                  "Wanted card saved; ownership unchanged",
                )
              )
                setNewOrder(null);
            }}
          >
            Save tracking record
          </button>
        </Dialog>
      )}
    </>
  );
}
