import React from "react";
import { Diamond, Layers3, Sparkles } from "lucide-react";
import type { Card } from "./types";
import { Dialog } from "./ui";
export type DisplayPreferences = {
  grid: boolean;
  density: "comfortable" | "compact";
  columns: {
    location: boolean;
    reservations: boolean;
    labels: boolean;
    value: boolean;
  };
};
export const displayDefaults: DisplayPreferences = {
  grid: false,
  density: "comfortable",
  columns: { location: true, reservations: false, labels: false, value: true },
};
export function validateDisplay(value: unknown): DisplayPreferences {
  const v = value as Partial<DisplayPreferences> | null;
  return {
    grid: v?.grid === true,
    density: v?.density === "compact" ? "compact" : "comfortable",
    columns: Object.fromEntries(
      Object.entries(displayDefaults.columns).map(([k, defaultValue]) => [
        k,
        typeof v?.columns?.[k as keyof DisplayPreferences["columns"]] ===
        "boolean"
          ? v.columns[k as keyof DisplayPreferences["columns"]]
          : defaultValue,
      ]),
    ) as DisplayPreferences["columns"],
  };
}
const manaNames: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
  X: "Variable",
  S: "Snow",
  P: "Phyrexian",
};
export function ManaCost({ cost }: { cost: string }) {
  const tokens = [...cost.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  return tokens.length ? (
    <span
      className="mana-cost"
      aria-label={`Mana cost ${tokens
        .map((t) =>
          t
            .split("/")
            .map((x) => manaNames[x] || x)
            .join(" or "),
        )
        .join(", ")}`}
    >
      {tokens.map((t, i) => (
        <span className={`mana-symbol mana-${t}`} aria-hidden="true" key={i}>
          {t}
        </span>
      ))}
    </span>
  ) : null;
}
export function CardTraits({
  card,
  showFoil = true,
}: {
  card: Card;
  showFoil?: boolean;
}) {
  const rarity =
    (
      {
        C: "Common",
        U: "Uncommon",
        R: "Rare",
        M: "Mythic rare",
        L: "Land",
        T: "Token",
      } as Record<string, string>
    )[card.rarity] || card.rarity;
  return (
    <span className="card-traits">
      <ManaCost cost={card.mana_cost} />
      {rarity && (
        <span>
          <Diamond size={13} aria-hidden="true" />
          {rarity}
        </span>
      )}
      {showFoil && card.foil > 0 && (
        <span>
          <Sparkles size={13} aria-hidden="true" />
          {card.foil} foil
        </span>
      )}
    </span>
  );
}
export function MatchBadge({ card }: { card: Card }) {
  const labels: Record<string, string> = {
    unresolved: "Unchecked",
    lookup_failed: "Request failed",
    not_found: "Printing not found",
    name_mismatch: "Identity conflict",
  };
  return card.match_status === "matched" ||
    card.match_status === "unresolved" ? null : (
    <span
      className={`match-badge ${card.match_status === "name_mismatch" ? "conflict" : card.match_status === "lookup_failed" || card.match_status === "not_found" ? "attention" : "neutral"}`}
    >
      {labels[card.match_status] || "Unchecked"}
    </span>
  );
}
export function CardIdentity({
  card,
  location,
  open,
}: {
  card: Card;
  location: boolean;
  open: () => void;
}) {
  return (
    <button className="card-cell" onClick={open}>
      {card.image_url && (
        <span className="card-thumb">
          <img src={card.image_url} alt="" loading="lazy" />
        </span>
      )}
      <span>
        <strong>{card.name}</strong>
        <small className="card-type">{card.card_type}</small>
        <CardTraits card={card} showFoil={false} />
        {location && card.location && (
          <small className="card-location" title={card.location}>
            {card.location}
          </small>
        )}
      </span>
    </button>
  );
}
export function DisplayDialog({
  value,
  setValue,
  close,
}: {
  value: DisplayPreferences;
  setValue: (value: DisplayPreferences) => void;
  close: () => void;
}) {
  return (
    <Dialog title="Collection display" close={close}>
      <fieldset className="filter-group">
        <legend>Layout</legend>
        <div className="actions">
          {[
            [false, "List view"],
            [true, "Artwork grid"],
          ].map(([grid, label]) => (
            <button
              className={`button ${value.grid === grid ? "primary" : "secondary"}`}
              aria-pressed={value.grid === grid}
              key={String(label)}
              onClick={() => setValue({ ...value, grid: grid as boolean })}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="field">
        Row density
        <select
          aria-label="Row density"
          value={value.density}
          onChange={(e) =>
            setValue({
              ...value,
              density: e.target.value as DisplayPreferences["density"],
            })
          }
        >
          <option value="comfortable">Comfortable</option>
          <option value="compact">Compact</option>
        </select>
      </label>
      <fieldset className="filter-group">
        <legend>Optional list details</legend>
        <p className="hint">
          Card, printing, and owned quantities always remain visible.
        </p>
        {Object.entries({
          location: "Storage location",
          reservations: "Reservations",
          labels: "Excel Deck labels",
          value: "Known value",
        }).map(([key, label]) => (
          <label className="checkbox-row" key={key}>
            <input
              type="checkbox"
              checked={
                value.columns[key as keyof DisplayPreferences["columns"]]
              }
              onChange={(e) =>
                setValue({
                  ...value,
                  columns: { ...value.columns, [key]: e.target.checked },
                })
              }
            />
            {label}
          </label>
        ))}
      </fieldset>
      <p className="hint">
        Display preferences are remembered in this browser. They do not change
        exports.
      </p>
      <div className="dialog-actions">
        <button className="button primary" onClick={close}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
export function CollectionActions({
  count,
  resultCount,
  selectAll,
  busy,
  exportSelected,
  action,
  close,
}: {
  count: number;
  resultCount: number;
  selectAll: () => void;
  busy: boolean;
  exportSelected: () => void;
  action: (value: string) => void;
  close: () => void;
}) {
  return (
    <Dialog
      title="Selected printing actions"
      className="actions-dialog"
      close={close}
    >
      <p>{count} selected printings</p>
      <div className="selection-actions">
        <button
          className="button secondary"
          disabled={resultCount > 1000 || count === resultCount}
          onClick={selectAll}
        >
          Select all {resultCount} results
        </button>
        {resultCount > 1000 && (
          <p className="hint">
            Narrow the results to select all. Each bulk action supports up to
            1,000 printings.
          </p>
        )}
        <button
          className="button secondary"
          onClick={() => {
            close();
            exportSelected();
          }}
        >
          Export selected
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            close();
            action("location");
          }}
        >
          Set location
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            close();
            action("keep");
          }}
        >
          Keep copies
        </button>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => {
            close();
            action("acquisition");
          }}
        >
          Track wanted
        </button>
      </div>
    </Dialog>
  );
}
