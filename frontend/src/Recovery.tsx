import React, { useCallback, useEffect, useState } from "react";
import { ArrowDownToLine, History, RotateCcw } from "lucide-react";
import type { Impact, ViewProps } from "./types";
import { api, ConfirmChange, date, Empty } from "./ui";
type Saved = {
  key: string;
  created_at: string;
  name: string;
  reason: string;
  deck_id: number | null;
  size: number;
};
type Preview = {
  id?: string;
  key?: string;
  revision: number;
  message?: string;
  impact?: Impact[];
  before: number | { copies: number; decks: number };
  after: number | { copies: number; decks: number };
  name?: string;
  decklist?: string;
  deleted?: boolean;
};
export function Recovery({
  state,
  run,
  busy,
  reload,
  deckId,
  revisions = false,
}: ViewProps & { deckId?: number; revisions?: boolean }) {
  const [items, setItems] = useState<Saved[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [preview, setPreview] = useState<Preview | null>(null),
    [generation, setGeneration] = useState(0);
  const fetchList = useCallback(
    async (next?: string) => {
      setLoading(true);
      setError("");
      try {
        const result = await api<{ items: Saved[]; cursor: string | null }>(
          (revisions ? "/revisions" : "/backups") +
            "?" +
            new URLSearchParams({
              ...(deckId ? { deck_id: String(deckId) } : {}),
              ...(next ? { cursor: next } : {}),
            }),
        );
        setItems((old) => (next ? [...old, ...result.items] : result.items));
        setCursor(result.cursor);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [deckId, revisions],
  );
  useEffect(() => {
    fetchList();
  }, [fetchList, generation]);
  const prepare = async (data: unknown) => {
    setLoading(true);
    setError("");
    try {
      setPreview(
        await api<Preview>(
          revisions ? "/revisions/preview" : "/restore/preview",
          "POST",
          data,
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <section className="settings-panel table-panel">
      <div className="section-heading">
        <h2>
          <History size={20} />{" "}
          {revisions
            ? "Deck revisions and deleted decks"
            : "Collection recovery"}
        </h2>
        <button
          className="button secondary small"
          disabled={loading}
          onClick={() => fetchList()}
        >
          Reload history
        </button>
      </div>
      <p className="hint">
        {revisions
          ? "Restore an earlier target list or recover a deleted deck. Current inventory and other decks are preserved."
          : "Validate and preview a full restore before applying it. A backup of the current workspace is saved first."}
      </p>
      {!revisions && (
        <div className="actions">
          <a className="button secondary" href="/api/backup">
            <ArrowDownToLine size={16} /> Download full backup
          </a>
          <label className="button secondary file-button">
            Open JSON backup
            <input
              type="file"
              accept=".json,application/json"
              disabled={loading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  if (file.size > 16000000)
                    throw Error("This backup exceeds the supported size.");
                  await prepare({ backup: JSON.parse(await file.text()) });
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            />
          </label>
        </div>
      )}
      {error && (
        <p role="alert" className="notice danger">
          {error}
        </p>
      )}
      <div className="recovery-list">
        {items.map((i) => (
          <div className="recovery-item" key={i.key}>
            <div>
              <strong>{i.name}</strong>
              <small>
                {i.reason} · {date(i.created_at)}
              </small>
            </div>
            <button
              className="button secondary small"
              disabled={busy || loading}
              onClick={() => prepare({ key: i.key })}
            >
              <RotateCcw size={14} /> Preview restore
            </button>
          </div>
        ))}
      </div>
      {!items.length && !loading && (
        <Empty
          title={
            revisions ? "No earlier deck versions yet" : "No saved backups yet"
          }
        >
          <p>
            {revisions
              ? "A revision is saved before each deck edit or deletion."
              : "Backups are saved before imports, deletions, reservation changes, and restores."}
          </p>
        </Empty>
      )}
      {cursor && (
        <button
          className="button secondary"
          disabled={loading}
          onClick={() => fetchList(cursor)}
        >
          Load more saved versions
        </button>
      )}
      {loading && <p role="status">Loading saved versions…</p>}
      {preview && (
        <ConfirmChange
          title={
            revisions ? `Restore ${preview.name}` : "Restore collection backup"
          }
          message={
            preview.message ||
            (preview.deleted
              ? "Recover this deleted deck. A backup will be saved first."
              : "Replace this deck’s current target list with the saved revision. A revision of the current deck will be saved first.")
          }
          impact={preview.impact || []}
          close={() => setPreview(null)}
          apply={async () => {
            await api(
              revisions ? "/revisions/apply" : "/restore/apply",
              "POST",
              revisions ? { key: preview.key } : { id: preview.id },
              preview.revision,
            );
            await reload();
            setGeneration((n) => n + 1);
          }}
        >
          <p>
            {typeof preview.before === "number"
              ? `${preview.before} current target copies → ${preview.after} restored target copies`
              : `${preview.before.copies} owned copies / ${preview.before.decks} decks → ${(preview.after as { copies: number; decks: number }).copies} owned copies / ${(preview.after as { copies: number; decks: number }).decks} decks`}
          </p>
          {preview.decklist && (
            <textarea
              readOnly
              className="export-text"
              aria-label="Revision target list"
              value={preview.decklist}
            />
          )}
        </ConfirmChange>
      )}
    </section>
  );
}
