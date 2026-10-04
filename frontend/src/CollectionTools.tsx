import React, { useState } from "react";
import type { BulkUndo, Card, ViewProps } from "./types";
import { api, Dialog } from "./ui";
import {
  filterDefaults,
  type CollectionFilters,
} from "../../shared/collection.mjs";
export function CollectionFiltersPanel({
  filters,
  update,
  collection,
  state,
}: {
  filters: CollectionFilters;
  update: (k: keyof CollectionFilters, v: string) => void;
  collection: Card[];
  state: ViewProps["state"];
}) {
  const [setSearch, setSetSearch] = useState("");
  const selectedSets = filters.sets.split(",").filter(Boolean);
  const multi = (
    key: "color" | "type" | "sets" | "rarity",
    label: string,
    options: string[],
  ) => (
    <fieldset className="filter-group">
      <legend>
        {label}
        {key === "sets" && ` · ${selectedSets.length} selected`}
      </legend>
      {key === "sets" && (
        <>
          <label className="field">
            Search sets
            <input
              type="search"
              value={setSearch}
              maxLength={50}
              placeholder="Search set codes"
              onChange={(e) => setSetSearch(e.target.value)}
            />
          </label>
          {selectedSets.length > 0 && (
            <div className="filter-chip-list" aria-label="Selected sets">
              {selectedSets.map((value) => (
                <button
                  type="button"
                  className="filter-chip selected"
                  key={value}
                  aria-label={`Remove selected set ${value}`}
                  onClick={() =>
                    update(
                      "sets",
                      selectedSets.filter((x) => x !== value).join(","),
                    )
                  }
                >
                  {value.toUpperCase()} ×
                </button>
              ))}
            </div>
          )}
          {!options.some((value) =>
            value.toLowerCase().includes(setSearch.trim().toLowerCase()),
          ) && (
            <p className="hint">
              No sets match your search. Selected sets remain included.
            </p>
          )}
        </>
      )}
      {(key === "color" || key === "type") && (
        <label className="field">
          Match selected {label.toLowerCase()}
          <select
            aria-label={`${label} match mode`}
            value={filters[(key + "_mode") as keyof CollectionFilters]}
            onChange={(e) =>
              update((key + "_mode") as keyof CollectionFilters, e.target.value)
            }
          >
            <option value="any">Any selected</option>
            <option value="all">All selected</option>
          </select>
        </label>
      )}
      <div className="filter-choice-list">
        {options
          .filter(
            (value) =>
              key !== "sets" ||
              value.toLowerCase().includes(setSearch.trim().toLowerCase()),
          )
          .map((value) => (
            <label key={value}>
              <input
                type="checkbox"
                checked={filters[key].split(",").includes(value)}
                onChange={(e) =>
                  update(
                    key,
                    e.target.checked
                      ? [
                          ...filters[key].split(",").filter(Boolean),
                          value,
                        ].join(",")
                      : filters[key]
                          .split(",")
                          .filter((x) => x !== value)
                          .join(","),
                  )
                }
              />
              {key === "rarity"
                ? (
                    {
                      C: "Common (C)",
                      U: "Uncommon (U)",
                      R: "Rare (R)",
                      M: "Mythic (M)",
                      L: "Land (L)",
                      T: "Token (T)",
                    } as Record<string, string>
                  )[value] || value
                : value}
            </label>
          ))}
      </div>
    </fieldset>
  );
  const select = (
    key: keyof CollectionFilters,
    label: string,
    options: Record<string, string>,
  ) => (
    <label className="field">
      {label}
      <select
        aria-label={label}
        value={filters[key]}
        onChange={(e) => update(key, e.target.value)}
      >
        <option value="">All</option>
        {Object.entries(options).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
  const ranges = (key: "quantity" | "price" | "value", label: string) => (
    <fieldset className="filter-group">
      <legend>{label}</legend>
      <div className="range-fields">
        {["min", "max"].map((suffix) => (
          <label className="field" key={suffix}>
            {suffix === "min" ? "Minimum" : "Maximum"}
            <input
              aria-label={`${label} ${suffix}`}
              type="number"
              min="0"
              step={key === "quantity" ? "1" : "0.01"}
              value={filters[(key + "_" + suffix) as keyof CollectionFilters]}
              onChange={(e) =>
                update(
                  (key + "_" + suffix) as keyof CollectionFilters,
                  e.target.value,
                )
              }
            />
          </label>
        ))}
      </div>
    </fieldset>
  );
  return (
    <>
      <p className="hint">
        Filter groups combine with AND. Sets and rarities match any selection.
        Color and type groups can match any or all selections.
      </p>
      <div className="advanced-filters">
        <label className="field">
          View
          <select
            aria-label="Collection view"
            value={filters.view}
            onChange={(e) => update("view", e.target.value)}
          >
            <option value="">All cards</option>
            <option value="duplicates">Duplicates</option>
            <option value="trade">Trade candidates</option>
          </select>
        </label>
        {multi("color", "Colors", [
          "White",
          "Blue",
          "Black",
          "Red",
          "Green",
          "Colorless",
        ])}
        {multi("type", "Types", [
          "Creature",
          "Instant",
          "Sorcery",
          "Artifact",
          "Enchantment",
          "Land",
          "Planeswalker",
          "Battle",
        ])}
        {multi(
          "sets",
          "Sets",
          [...new Set(collection.map((c) => c.set_code))].sort(),
        )}
        {multi(
          "rarity",
          "Rarities",
          [...new Set(collection.map((c) => c.rarity).filter(Boolean))].sort(),
        )}
        {select("finish", "Owned finishes", {
          nonfoil: "Contains nonfoil",
          foil: "Contains foil",
          both: "Contains both finishes",
        })}
        {select("reservation", "Reservations", {
          none: "Fully unreserved",
          partial: "Partly reserved",
          full: "Fully reserved",
          available: "Has unreserved copies",
        })}
        {select("match", "Printing match", {
          unresolved: "Unchecked",
          lookup_failed: "Request failed",
          not_found: "Printing not found",
          name_mismatch: "Identity conflict",
          matched: "Matched",
          unmatched: "Any unresolved status",
        })}
        {select("priced", "Price coverage", {
          known: "All copies priced",
          partial: "Some copies priced",
          unknown: "No known prices",
        })}
        {ranges("quantity", "Owned copies")}
        {ranges(
          "price",
          `Lowest known unit price (${state.settings.currency})`,
        )}
        {ranges("value", `Known printing value (${state.settings.currency})`)}
        <label className="field">
          Needed by deck
          <select
            aria-label="Needed by deck"
            value={filters.deck_id}
            onChange={(e) => update("deck_id", e.target.value)}
          >
            <option value="">Any deck or no requirement</option>
            {state.decks.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Storage location
          <input
            value={filters.location}
            maxLength={150}
            onChange={(e) => update("location", e.target.value)}
          />
        </label>
      </div>
      <p className="hint">
        Price limits exclude unknown prices. Unit price uses the lowest known
        price among owned finishes; printing value may cover only some copies.
        Prices follow the display currency.
      </p>
    </>
  );
}
export function FilterChips({
  filters,
  update,
  clear,
  state,
}: {
  filters: CollectionFilters;
  update: (k: keyof CollectionFilters, v: string) => void;
  clear: () => void;
  state: ViewProps["state"];
}) {
  const labels: Record<string, string> = {
    q: "Search",
    color: "Colors",
    type: "Types",
    sets: "Sets",
    rarity: "Rarities",
    finish: "Finish",
    reservation: "Reservations",
    match: "Match",
    deck_id: "Deck",
    location: "Location",
    quantity_min: "Copies ≥",
    quantity_max: "Copies ≤",
    price_min: "Unit price ≥",
    price_max: "Unit price ≤",
    value_min: "Value ≥",
    value_max: "Value ≤",
    priced: "Price coverage",
    view: "View",
  };
  const describe = (key: string, value: string) => {
    const labels: Record<string, Record<string, string>> = {
      finish: {
        foil: "contains foil",
        nonfoil: "contains nonfoil",
        both: "both finishes",
      },
      reservation: {
        none: "fully unreserved",
        partial: "partly reserved",
        full: "fully reserved",
        available: "has unreserved copies",
      },
      match: {
        unresolved: "unchecked",
        lookup_failed: "request failed",
        not_found: "not found",
        name_mismatch: "identity conflict",
        matched: "matched",
        unmatched: "any unresolved status",
      },
      priced: {
        known: "all copies priced",
        partial: "some copies priced",
        unknown: "no known prices",
      },
      view: { duplicates: "duplicates", trade: "trade candidates" },
    };
    if (key === "sets") {
      const codes = value.split(",").filter(Boolean);
      return codes.length > 3
        ? `${codes.length} sets`
        : codes.join(", ").toUpperCase();
    }
    return key === "deck_id"
      ? state.decks.find((d) => String(d.id) === value)?.name || value
      : labels[key]?.[value] || value;
  };
  const entries = Object.entries(filters).filter(
    ([k, v]) => v !== filterDefaults[k as keyof CollectionFilters] && labels[k],
  );
  return entries.length > 0 ? (
    <div className="active-filters" aria-label="Active filters">
      {entries.map(([k, v]) => (
        <button
          key={k}
          className="filter-chip selected"
          aria-label={`Remove ${labels[k]} filter`}
          title={`${labels[k]} ${v}`}
          onClick={() =>
            update(
              k as keyof CollectionFilters,
              filterDefaults[k as keyof CollectionFilters],
            )
          }
        >
          <span>
            {labels[k]} {describe(k, v)}
            {k === "color" || k === "type"
              ? ` (${filters[(k + "_mode") as keyof CollectionFilters]})`
              : ""}{" "}
          </span>
          <span aria-hidden="true">×</span>
        </button>
      ))}
      <button className="text-button" onClick={clear}>
        Clear filters
      </button>
    </div>
  ) : null;
}
export function BulkCollectionDialog({
  cards,
  action,
  state,
  run,
  close,
  completed,
}: {
  cards: Card[];
  action: string;
  close: () => void;
  completed: (undo: BulkUndo | null) => void;
} & Pick<ViewProps, "state" | "run">) {
  const [expected] = useState(state.revision),
    [location, setLocation] = useState(""),
    [quantity, setQuantity] = useState("1"),
    [finish, setFinish] = useState("any"),
    [notes, setNotes] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const title =
    action === "location"
      ? "Set storage location"
      : action === "keep"
        ? "Set copies to keep"
        : "Track wanted copies";
  return (
    <Dialog
      title={title}
      close={() => {
        if (!saving) close();
      }}
    >
      <p>
        {cards.length} selected printings ·{" "}
        {cards.reduce((n, c) => n + c.quantity, 0)} owned copies
      </p>
      <details>
        <summary>Review selected printings</summary>
        <ul className="bulk-review">
          {cards.map((c) => (
            <li key={c.key}>
              {c.name} · {c.set_code.toUpperCase()} #{c.collector_number} ·{" "}
              {c.quantity} owned
              {action === "location"
                ? ` · ${c.location || "No location"}`
                : action === "keep"
                  ? ` · keep ${c.keep}`
                  : ""}
            </li>
          ))}
        </ul>
      </details>
      {action === "location" ? (
        <>
          <label className="field">
            New storage location
            <input
              maxLength={150}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Binder A, page 8"
            />
          </label>
          <p className="hint">
            Replaces the location on every selected printing. Leave empty to
            clear it.
          </p>
        </>
      ) : (
        <>
          <label className="field">
            {action === "keep"
              ? "Keep at least this many copies per printing"
              : "Wanted quantity per printing"}
            <input
              type="number"
              min={action === "keep" ? 0 : 1}
              max="100000"
              step="1"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </label>
          {action === "acquisition" ? (
            <>
              <label className="field">
                Finish
                <select
                  aria-label="Finish"
                  value={finish}
                  onChange={(e) => setFinish(e.target.value)}
                >
                  <option value="any">Either finish</option>
                  <option value="nonfoil">Nonfoil</option>
                  <option value="foil">Foil</option>
                </select>
              </label>
              <label className="field">
                Notes
                <input
                  maxLength={300}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <p className="hint">
                Adds one wanted record for each selected printing, including
                printings already tracked. Received records change ownership
                only after a new Excel import.
              </p>
            </>
          ) : (
            <p className="hint">
              This is a minimum total, including copies protected for decks.
              Deck targets still protect their required copies. The default is
              one per printing.
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="notice danger">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="button secondary" disabled={saving} onClick={close}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={
            saving ||
            (action !== "location" &&
              (!/^\d+$/.test(quantity) ||
                Number(quantity) > 100000 ||
                Number(quantity) < (action === "keep" ? 0 : 1)))
          }
          onClick={async () => {
            setSaving(true);
            setError("");
            try {
              const result = await api<{ undo: BulkUndo | null }>(
                "/collection/bulk",
                "POST",
                {
                  keys: cards.map((c) => c.key),
                  action,
                  location,
                  keep: Number(quantity),
                  quantity: Number(quantity),
                  finish,
                  notes,
                },
                expected,
              );
              completed(result.undo);
              await run(async () => {});
              close();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? "Applying…" : `Apply to ${cards.length} printings`}
        </button>
      </div>
    </Dialog>
  );
}
