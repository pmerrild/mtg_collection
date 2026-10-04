import React, { useEffect, useState } from "react";
import { ArrowDownToLine, FileSpreadsheet, RefreshCw } from "lucide-react";
import type { ViewProps } from "./types";
import { api, date } from "./ui";
import { ThemeControl } from "./theme";
import { Recovery } from "./Recovery";
const sections = ["preferences", "data", "recovery"] as const;
export function Settings({
  state,
  run,
  busy,
  reload,
  openImport,
}: ViewProps & { openImport: () => void }) {
  const [section, setSection] = useState<(typeof sections)[number]>(() => {
    const value = new URLSearchParams(location.hash.split("?")[1] || "").get(
      "section",
    );
    return sections.includes(value as (typeof sections)[number])
      ? (value as (typeof sections)[number])
      : "preferences";
  });
  useEffect(() => {
    const sync = () => {
      if (!location.hash.startsWith("#settings")) return;
      const value = new URLSearchParams(location.hash.split("?")[1] || "").get(
        "section",
      );
      setSection(
        sections.includes(value as (typeof sections)[number])
          ? (value as (typeof sections)[number])
          : "preferences",
      );
      document.getElementById("main-content")?.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const [revisions, setRevisions] = useState(false);
  const choose = (value: (typeof sections)[number]) => {
    setSection(value);
    history.replaceState(null, "", `#settings?section=${value}`);
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Settings</h1>
        </div>
      </div>
      <div
        className="section-tabs"
        role="tablist"
        aria-label="Settings sections"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const index = sections.indexOf(section);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? 2
                : (index + (event.key === "ArrowRight" ? 1 : 2)) % 3;
          choose(sections[next]);
          document.getElementById(`settings-${sections[next]}-tab`)?.focus();
        }}
      >
        {sections.map((value) => (
          <button
            role="tab"
            key={value}
            id={`settings-${value}-tab`}
            aria-selected={section === value}
            aria-controls={`settings-${value}-panel`}
            tabIndex={section === value ? 0 : -1}
            onClick={() => choose(value)}
          >
            {value === "preferences"
              ? "Preferences"
              : value === "data"
                ? "Data & prices"
                : "Recovery"}
          </button>
        ))}
      </div>
      <div
        className="settings-content"
        id={`settings-${section}-panel`}
        role="tabpanel"
        aria-labelledby={`settings-${section}-tab`}
      >
        {section === "preferences" && (
          <section className="table-panel settings-section">
            <div className="setting-row">
              <div>
                <h2>Appearance</h2>
                <p className="hint">
                  Applies to this browser. System follows your device’s
                  appearance.
                </p>
              </div>
              <ThemeControl />
            </div>
            <div className="setting-row">
              <div>
                <h2>Display currency</h2>
                <p className="hint">
                  Applies across your vault. Prices stay specific to each
                  printing and finish.
                </p>
              </div>
              <label className="field">
                <span className="sr-only">Display currency</span>
                <select
                  aria-label="Display currency"
                  disabled={busy}
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
            </div>
            <div className="setting-row">
              <div>
                <h2>Collection display</h2>
                <p className="hint">
                  Choose list or grid, density, and visible details from
                  Collection → Display. These preferences are remembered in this
                  browser.
                </p>
              </div>
              <a className="button secondary" href="#collection">
                Open collection
              </a>
            </div>
          </section>
        )}
        {section === "data" && (
          <div className="settings-data-grid">
            <section className="table-panel settings-section">
              <div className="section-heading">
                <h2>
                  <FileSpreadsheet size={20} /> Workbook
                </h2>
              </div>
              <p className="file-name">
                {state.settings.workbook_path || "No workbook imported"}
              </p>
              <p className="hint">
                Last accepted import: {date(state.last_import?.created_at)}
              </p>
              <div className="actions">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={openImport}
                >
                  Import saved workbook
                </button>
                <a
                  className="button secondary"
                  href="/api/export?kind=collection&format=csv"
                >
                  <ArrowDownToLine size={16} /> Inventory CSV
                </a>
              </div>
              <p className="hint">
                Save your workbook, then upload it here. Changes wait for review
                before replacing the complete Input inventory.
              </p>
              <a className="text-button" href="#review?view=workbook">
                {state.pending_import
                  ? "Review workbook changes"
                  : `Source issues & import history${state.summary.issues ? ` (${state.summary.issues})` : ""}`}
              </a>
              <details className="settings-disclosure">
                <summary>Ownership rules and import limits</summary>
                <p className="hint">
                  Count includes all copies; Foil counts foil copies within
                  Count. Blank Foil means zero. Edit ownership in Excel and
                  targets in the app. Importing the same snapshot adds no
                  copies.
                </p>
                <p className="hint">
                  Up to 4 MiB uploaded, 24 MiB expanded, 20,000 Input rows, and
                  a 1.2 MB parsed snapshot. Keep the complete inventory in one
                  upload. Oversized or invalid imports preserve existing data.
                </p>
              </details>
            </section>
            <section className="table-panel settings-section">
              <h2>Card data & prices</h2>
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
                  <dt>Last successful refresh</dt>
                  <dd>{date(state.settings.last_price_success)}</dd>
                </div>
              </dl>
              <div className="actions">
                <button
                  className="button primary"
                  disabled={busy || state.price_job.running}
                  onClick={() =>
                    run(
                      () => api("/prices/refresh?force=true", "POST"),
                      "Card data refresh started",
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
                <a className="button secondary" href="#review?view=matching">
                  Review matches
                </a>
              </div>
              {state.price_job.error && (
                <p role="alert" className="notice warning">
                  {state.price_job.error}
                </p>
              )}
              <p className="hint">
                Cached values remain available if a request fails. Missing
                prices stay unknown.
              </p>
              <details className="settings-disclosure">
                <summary>How values are calculated</summary>
                <p className="hint">
                  Owned values use your exact printing and finish. Acquisition
                  estimates use the lowest compatible cached price. Prices
                  exclude shipping, condition adjustments, and guaranteed sale
                  proceeds.
                </p>
              </details>
            </section>
          </div>
        )}
        {section === "recovery" && (
          <>
            <p className="hint">
              Review a restore before applying it. Your current data is backed
              up first.
            </p>
            <div
              className="actions recovery-choice"
              role="group"
              aria-label="Recovery type"
            >
              <button
                className={`button ${!revisions ? "primary" : "secondary"}`}
                aria-pressed={!revisions}
                onClick={() => setRevisions(false)}
              >
                Collection backups
              </button>
              <button
                className={`button ${revisions ? "primary" : "secondary"}`}
                aria-pressed={revisions}
                onClick={() => setRevisions(true)}
              >
                Deck revisions
              </button>
            </div>
            <Recovery
              key={String(revisions)}
              state={state}
              run={run}
              busy={busy}
              reload={reload}
              revisions={revisions}
            />
          </>
        )}
      </div>
    </>
  );
}
