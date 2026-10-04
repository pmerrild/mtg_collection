import React from "react";
import { ArrowDownToLine, FileSpreadsheet, RefreshCw } from "lucide-react";
import type { ViewProps } from "./types";
import { api, date } from "./ui";
import { Recovery } from "./Recovery";
export function Settings({
  state,
  run,
  busy,
  reload,
  openImport,
}: ViewProps & { openImport: () => void }) {
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h1>Settings and recovery</h1>
          <p className="subtitle">
            Saved workbook, price confidence, backups, and deck revisions.
          </p>
        </div>
      </div>
      <div className="settings-layout">
        <section className="settings-panel table-panel">
          <h2>
            <FileSpreadsheet size={20} /> Excel ownership source
          </h2>
          <div className="workbook-file">
            <strong>{state.settings.workbook_path}</strong>
            <small>Imported {date(state.last_import?.created_at)}</small>
          </div>
          <button
            className="button primary"
            disabled={busy}
            onClick={openImport}
          >
            Import saved workbook
          </button>
          <p className="hint">
            Save Excel before uploading. Only Input is read. This site cannot
            watch your Mac. Each changed snapshot waits for review before
            replacing ownership; it is never a batch of purchases.
          </p>
          <div className="convention">
            <strong>Count includes all copies</strong>
            <p>
              Foil is the foil-copy count within Count. Blank Foil means zero.
              Edit ownership in Excel; edit target decklists here.
            </p>
          </div>
          <details>
            <summary>Import capacity</summary>
            <p className="hint">
              4 MiB uploaded workbook; 24 MiB expanded workbook; 20,000 Input
              rows; 1.2 MB parsed snapshot; 1.8 MB workspace state. Remove
              unused sheets/formatting to reduce file size, while keeping the
              full Input inventory. Do not split inventory across uploads. An
              oversized import preserves existing data.
            </p>
          </details>
          <a
            className="button secondary"
            href="/api/export?kind=collection&format=csv"
          >
            <ArrowDownToLine size={16} /> Inventory CSV
          </a>
        </section>
        <section className="settings-panel table-panel">
          <h2>Card data and prices</h2>
          <label className="field">
            Display currency
            <select
              aria-label="Display currency"
              value={state.settings.currency}
              onChange={(e) =>
                run(() =>
                  api("/settings", "PATCH", { currency: e.target.value }),
                )
              }
            >
              <option value="EUR">EUR · Euro</option>
              <option value="USD">USD · US dollar</option>
            </select>
          </label>
          <dl className="detail-list">
            <div>
              <dt>Matched printings</dt>
              <dd>
                {state.summary.printings - state.summary.unresolved} /{" "}
                {state.summary.printings}
              </dd>
            </div>
            <div>
              <dt>Priced copies</dt>
              <dd>
                {state.summary.priced_copies} / {state.summary.copies}
              </dd>
            </div>
            <div>
              <dt>Unpriced copies</dt>
              <dd>{state.summary.copies - state.summary.priced_copies}</dd>
            </div>
            <div>
              <dt>Last successful refresh</dt>
              <dd>{date(state.settings.last_price_success)}</dd>
            </div>
          </dl>
          <button
            className="button primary"
            disabled={busy || state.price_job.running}
            onClick={() =>
              run(
                () => api("/prices/refresh?force=true", "POST"),
                "Price refresh started",
              )
            }
          >
            <RefreshCw
              size={16}
              className={state.price_job.running ? "spin" : ""}
            />
            {state.price_job.running
              ? `Refreshing ${state.price_job.completed}/${state.price_job.total}`
              : "Refresh prices"}
          </button>
          {state.price_job.error && (
            <p className="notice warning">{state.price_job.error}</p>
          )}
          <p className="hint">
            Owned-card values use actual printing and finish. Acquisition
            estimates use the lowest compatible cached price, respecting any
            required printing or finish. These indicative prices exclude
            shipping and condition adjustments.
          </p>
        </section>
      </div>
      <div className="recovery-layout">
        <Recovery state={state} run={run} busy={busy} reload={reload} />
        <Recovery
          state={state}
          run={run}
          busy={busy}
          reload={reload}
          revisions
        />
      </div>
    </>
  );
}
