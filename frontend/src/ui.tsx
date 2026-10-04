import React, { useEffect, useId, useRef, useState } from "react";
import {
  ArrowDownToLine,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  X,
} from "lucide-react";
import type { Impact } from "./types";
let revision: number | undefined;
export const setRevision = (value: number) => {
  revision = value;
};
export async function api<T = Record<string, unknown>>(
  url: string,
  method = "GET",
  data?: unknown,
  expectedRevision = revision,
): Promise<T> {
  const response = await fetch("/api" + url, {
    method,
    headers: {
      ...(data === undefined ? {} : { "Content-Type": "application/json" }),
      ...(expectedRevision === undefined
        ? {}
        : { "X-Vault-Revision": String(expectedRevision) }),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  if (!response.ok) {
    const payload = await response
      .json()
      .catch(() => ({ detail: response.statusText }));
    throw new Error(
      typeof payload.detail === "string"
        ? payload.detail
        : "This request could not be completed.",
    );
  }
  return response.json();
}
export const money = (value: number | null, currency = "EUR") =>
  value === null
    ? "Unknown"
    : new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
        value,
      );
export const date = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "Not yet";
export function Dialog({
  title,
  children,
  close,
  wide = false,
  className = "",
}: {
  title: string;
  children: React.ReactNode;
  close: () => void;
  wide?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    titleId = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={(wide ? "dialog wide" : "dialog") + " " + className}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="Close dialog"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function ImpactList({ items }: { items: Impact[] }) {
  return items.length ? (
    <ul className="impact-list">
      {items.map((i) => (
        <li key={i.id}>
          <strong>{i.name}</strong>
          <span>
            Short to assemble: {i.before ?? "New deck"} → {i.after} copies
          </span>
        </li>
      ))}
    </ul>
  ) : (
    <p className="hint">No deck shortages change.</p>
  );
}
export function ConfirmChange({
  title,
  message,
  impact = [],
  apply,
  close,
  children,
}: {
  title: string;
  message: string;
  impact?: Impact[];
  apply: () => Promise<void>;
  close: () => void;
  children?: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <Dialog
      title={title}
      close={() => {
        if (!busy) close();
      }}
    >
      <p>{message}</p>
      {children}
      <ImpactList items={impact} />
      {error && (
        <p role="alert" className="notice danger">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button disabled={busy} className="button secondary" onClick={close}>
          Cancel
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await apply();
              close();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <Loader2 className="spin" size={16} />} Apply change
        </button>
      </div>
    </Dialog>
  );
}
export function ExportDialog({
  params,
  close,
  notify,
}: {
  params: Record<string, string>;
  close: () => void;
  notify: (text: string) => void;
}) {
  const [zone, setZone] = useState("all"),
    [text, setText] = useState(""),
    [error, setError] = useState(""),
    [format, setFormat] = useState("txt");
  useEffect(() => {
    const controller = new AbortController();
    setText("");
    setError("");
    const options = { ...params, zone, format };
    fetch(
      params.keys
        ? "/api/export"
        : "/api/export?" + new URLSearchParams(options),
      {
        signal: controller.signal,
        ...(params.keys
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(options),
            }
          : {}),
      },
    )
      .then(async (r) => {
        if (!r.ok) {
          const error = await r.json();
          throw new Error(
            error.detail || error.error || "Could not prepare this export.",
          );
        }
        setText(await r.text());
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [params, zone, format]);
  const download = () => {
    const url = URL.createObjectURL(
        new Blob([text], {
          type:
            format === "csv"
              ? "text/csv;charset=utf-8"
              : "text/plain;charset=utf-8",
        }),
      ),
      link = document.createElement("a");
    link.href = url;
    link.download = `${params.kind}-${params.view === "trade" ? "trade-candidates" : zone}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <Dialog title="Export for Scryfall" close={close}>
      <p>
        {params.view === "trade"
          ? "Exporting suggested trade quantities. Review protection and finishes before trading."
          : "TXT combines card names for Scryfall’s deck importer; CSV retains printing details."}
      </p>
      <label className="field">
        File format
        <select
          aria-label="Export file format"
          value={format}
          onChange={(e) => setFormat(e.target.value)}
        >
          <option value="txt">TXT for Scryfall</option>
          <option value="csv">CSV with printing details</option>
        </select>
      </label>
      {params.kind === "deck" && (
        <label className="field">
          Zone
          <select
            aria-label="Export zone"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
          >
            {Object.entries({
              all: "All cards",
              commander: "Command zone",
              main: "Main deck",
              sideboard: "Sideboard",
            }).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}
      {error && <p role="alert">{error}</p>}
      <textarea
        className="export-text"
        readOnly
        value={text}
        aria-label="Exported decklist"
      />
      <p className="hint">
        Name-only export combines printings and finishes. Designate commanders
        and sideboards in Scryfall, or export zones separately. CSV preserves
        detailed requirements.
      </p>
      <div className="dialog-actions">
        <a
          className="button secondary"
          href="https://scryfall.com/decks"
          target="_blank"
          rel="noreferrer"
        >
          Scryfall <ExternalLink size={14} />
        </a>
        <button
          className="button secondary"
          disabled={!text}
          onClick={download}
        >
          <ArrowDownToLine size={16} /> Download
        </button>
        <button
          className="button primary"
          disabled={!text}
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              notify("Decklist copied");
            } catch {
              setError(
                "Select the text or download the file; clipboard access is unavailable.",
              );
            }
          }}
        >
          <Copy size={16} /> Copy list
        </button>
      </div>
    </Dialog>
  );
}
export function Pagination({
  page,
  pages,
  setPage,
  label = "Page",
}: {
  page: number;
  pages: number;
  setPage: (n: number) => void;
  label?: string;
}) {
  return (
    <div className="pagination">
      <button
        className="button secondary small"
        disabled={!page}
        onClick={() => setPage(page - 1)}
        aria-label={`Previous ${label.toLowerCase()}`}
      >
        Previous
      </button>
      <span>
        {label} {page + 1} of {Math.max(1, pages)}
      </span>
      <button
        className="button secondary small"
        disabled={page + 1 >= pages}
        onClick={() => setPage(page + 1)}
        aria-label={`Next ${label.toLowerCase()}`}
      >
        Next
      </button>
    </div>
  );
}
export function PriceState({
  status,
  refreshed,
}: {
  status: string;
  refreshed?: string | null;
}) {
  const labels: Record<string, string> = {
    unmatched: "Printing not matched",
    unknown: "No price for this finish/currency",
    stale: "Cached price · over 24 hours old",
    failed: "Lookup failed · review in Settings",
    current: "Cached Scryfall price",
  };
  return (
    <small
      className={`price-state ${status}`}
      title={refreshed ? `Last fetched ${date(refreshed)}` : undefined}
    >
      {labels[status] || status}
    </small>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <CheckCircle2 size={28} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
