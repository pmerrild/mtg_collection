import React, { useEffect, useRef, useState } from "react";
import { Check, Loader2, Search } from "lucide-react";
import type { Issues, ScryCard, ViewProps } from "./types";
import { api, date, Dialog, Empty, ImpactList, Pagination } from "./ui";
const statuses: Record<string, string> = {
  unresolved: "Not yet checked",
  lookup_failed: "Request failed · retry",
  not_found: "No printing found",
  name_mismatch: "Identity conflict",
  matched: "Matched",
};
function MatchDialog({
  item,
  close,
  reload,
  openingRevision,
}: {
  item: Issues["matches"][number];
  close: () => void;
  reload: () => Promise<void>;
  openingRevision: number;
}) {
  const [query, setQuery] = useState(item.name),
    [cards, setCards] = useState<ScryCard[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <Dialog
      title="Confirm a printing"
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      <p>
        {item.name} · {item.printing_key} · Excel rows {item.source_rows}.
        Choose the printing you physically own. Excel stays unchanged.
      </p>
      <form
        className="search-row"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
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
            setBusy(false);
          }
        }}
      >
        <input
          aria-label="Find printing"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="button primary" disabled={busy}>
          <Search size={16} /> Search
        </button>
      </form>
      {error && (
        <p role="alert" className="notice danger">
          {error}
        </p>
      )}
      <p className="hint">
        Search returns up to 50 printings. Narrow the query with set:SET or a
        collector number if needed.
      </p>
      <div className="search-results printings">
        {cards.map((c) => (
          <button
            key={c.id}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(
                  "/matches/confirm",
                  "POST",
                  {
                    printing_key: item.printing_key,
                    card_id: c.id,
                  },
                  openingRevision,
                );
                await reload();
                close();
              } catch (e) {
                setError((e as Error).message);
                setBusy(false);
              }
            }}
          >
            {(c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small) && (
              <img
                src={
                  c.image_uris?.small || c.card_faces?.[0]?.image_uris?.small
                }
                alt=""
              />
            )}
            <span>
              <strong>{c.name}</strong>
              <small>
                {c.set_name} ({c.set.toUpperCase()}) #{c.collector_number}
              </small>
            </span>
            <span>
              Confirm <Check size={14} />
            </span>
          </button>
        ))}
      </div>
    </Dialog>
  );
}
export function Review({
  state,
  run,
  busy,
  reload,
  openImport,
}: ViewProps & { openImport: () => void }) {
  const readRoute = () => {
    const p = new URLSearchParams(location.hash.split("?")[1] || "");
    return {
      view: p.get("view") === "matching" ? "matching" : "workbook",
      query: p.get("q") || "",
      status: p.get("status") || "",
    };
  };
  const [view, setView] = useState(readRoute().view),
    [retry, setRetry] = useState(0);
  const resultsRef = useRef<HTMLDivElement>(null);
  const [review, setReview] = useState<Issues | null>(null),
    [error, setError] = useState(""),
    [match, setMatch] = useState<{
      item: Issues["matches"][number];
      revision: number;
    } | null>(null),
    [query, setQuery] = useState(readRoute().query),
    [status, setStatus] = useState(readRoute().status),
    [page, setPage] = useState(0),
    [changePage, setChangePage] = useState(0),
    [rowPage, setRowPage] = useState(0),
    [historyPage, setHistoryPage] = useState(0),
    [changeQuery, setChangeQuery] = useState("");
  useEffect(() => {
    let cancelled = false;
    api<Issues>("/issues")
      .then((r) => {
        if (!cancelled) {
          setReview(r);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [state, retry]);
  useEffect(() => {
    const sync = () => {
      if (!location.hash.startsWith("#review")) return;
      const route = readRoute();
      setView(route.view);
      setQuery(route.query);
      setStatus(route.status);
      setPage(0);
      document.getElementById("main-content")?.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const updateFilter = (q: string, st: string) => {
    setQuery(q);
    setStatus(st);
    const params = new URLSearchParams({ view: "matching" });
    if (q) params.set("q", q);
    if (st) params.set("status", st);
    history.replaceState(null, "", "#review?" + params);
  };
  const matchingPage = (next: number) => {
    setPage(next);
    requestAnimationFrame(() => {
      resultsRef.current?.focus();
      resultsRef.current?.scrollIntoView({ block: "start" });
    });
  };
  useEffect(() => setPage(0), [query, status]);
  useEffect(() => setChangePage(0), [changeQuery, state.pending_import?.id]);
  const matches = (review?.matches || []).filter(
    (m) =>
      (!query ||
        `${m.name} ${m.printing_key} ${m.source_rows}`
          .toLowerCase()
          .includes(query.toLowerCase())) &&
      (!status || m.status === status),
  );
  const pages = Math.max(1, Math.ceil(matches.length / 20)),
    currentPage = Math.min(page, pages - 1),
    pending = state.pending_import;
  const changes = (pending?.changes || pending?.reductions || []).filter(
    (c) =>
      !changeQuery ||
      `${c.name} ${c.printing_key} ${c.kind || ""}`
        .toLowerCase()
        .includes(changeQuery.toLowerCase()),
  );
  const changePages = Math.max(1, Math.ceil(changes.length / 20)),
    cp = Math.min(changePage, changePages - 1);
  const rowPages = Math.max(1, Math.ceil((review?.rows.length || 0) / 20)),
    rp = Math.min(rowPage, rowPages - 1);
  return (
    <div className="review-workspace">
      <div className="page-heading">
        <h1>Review</h1>
        <button className="button primary" disabled={busy} onClick={openImport}>
          Import workbook
        </button>
      </div>
      <nav className="section-tabs" aria-label="Review views">
        <a
          href="#review?view=workbook"
          className={view === "workbook" ? "active" : ""}
          aria-current={view === "workbook" ? "page" : undefined}
        >
          Workbook
        </a>
        <a
          href="#review?view=matching"
          className={view === "matching" ? "active" : ""}
          aria-current={view === "matching" ? "page" : undefined}
        >
          Matching
        </a>
      </nav>
      {error && (
        <div role="alert" className="notice danger">
          <span>{error}</span>
          <button
            className="button secondary"
            onClick={() => setRetry((r) => r + 1)}
          >
            Retry review
          </button>
        </div>
      )}
      {!review && !error && <p role="status">Loading review…</p>}
      {view === "workbook" && (
        <div>
          {pending && (
            <section className="review-panel table-panel">
              <h2>Review {pending.source}</h2>
              <p>
                {pending.before_copies ?? state.summary.copies} current copies →{" "}
                {pending.copies} proposed known copies across {pending.rows}{" "}
                rows.
              </p>
              <p className="hint">
                Applying replaces the full Input inventory, including changes
                outside this search. Deck targets and printing corrections stay
                saved. Reservations are recalculated and a backup is saved.
              </p>
              <label className="search-field">
                <Search size={18} />
                <input
                  aria-label="Search snapshot changes"
                  placeholder="Search changes"
                  value={changeQuery}
                  onChange={(e) => setChangeQuery(e.target.value)}
                />
              </label>
              <div className="table-scroll">
                <table className="review-changes">
                  <thead>
                    <tr>
                      <th>Change</th>
                      <th>Card / printing</th>
                      <th>Finish</th>
                      <th>Before</th>
                      <th>After</th>
                      <th>New Excel rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changes.slice(cp * 20, (cp + 1) * 20).map((c, i) => (
                      <tr key={i}>
                        <td data-label="Change">{c.kind || "Reduction"}</td>
                        <td>
                          {c.name}
                          <small>{c.printing_key}</small>
                        </td>
                        <td data-label="Finish">{c.finish}</td>
                        <td data-label="Before">{c.before}</td>
                        <td data-label="After">{c.after}</td>
                        <td data-label="Excel rows">
                          {c.source_rows?.join(", ") || "Removed"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!changes.length && (
                <p>
                  No quantity or finish changes match. Source annotations or
                  invalid rows may still differ.
                </p>
              )}
              <Pagination
                page={cp}
                pages={changePages}
                setPage={setChangePage}
                label="Change page"
              />
              <h3>Affected decks</h3>
              <ImpactList items={pending.affected_decks || []} />
              {!!pending.issues?.length && (
                <details>
                  <summary>
                    {pending.issues.length} invalid rows in the proposed
                    workbook
                  </summary>
                  {pending.issues.map((r, i) => (
                    <div className="source-issue" key={i}>
                      <strong>
                        Input row {r.source_row}: {r.name}
                      </strong>
                      <p>{r.message}</p>
                    </div>
                  ))}
                </details>
              )}
              <div className="actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api(`/import/${pending.id}/dismiss`, "POST"),
                      "Import dismissed; inventory preserved",
                    )
                  }
                >
                  Keep current inventory
                </button>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => api(`/import/${pending.id}/apply`, "POST"),
                      "Complete snapshot applied",
                    )
                  }
                >
                  Apply complete snapshot
                </button>
              </div>
            </section>
          )}
          {!pending && (
            <div className="review-file">
              <strong>
                {state.settings.workbook_path || "No workbook imported"}
              </strong>
              <p className="hint">
                Last accepted import: {date(state.last_import?.created_at)}
              </p>
            </div>
          )}
          {review && (
            <section className="review-panel table-panel">
              <h2>
                Workbook issues
                {review.rows.length ? ` · ${review.rows.length}` : ""}
              </h2>
              {!!review.rows.length && (
                <p className="hint">
                  Fix these rows in Excel, then save and import again. Unknown
                  quantities are excluded from owned totals.
                </p>
              )}
              {review?.rows.slice(rp * 20, (rp + 1) * 20).map((r, i) => (
                <div className="source-issue" key={r.id || i}>
                  <div className="row-number">{r.source_row}</div>
                  <div>
                    <strong>{r.name}</strong>
                    <p>{r.message}</p>
                    <details>
                      <summary>Source cells</summary>
                      <small>
                        Input · Count: {String(r.raw.Count ?? "(blank)")} ·
                        Foil: {String(r.raw.Foil ?? "(blank)")} · Set:{" "}
                        {String(r.raw.Set ?? "(blank)")} · Collector:{" "}
                        {String(r.raw["Set#"] ?? "(blank)")}
                      </small>
                    </details>
                  </div>
                </div>
              ))}
              {review && !review.rows.length && (
                <p className="positive">No invalid source rows.</p>
              )}
              {rowPages > 1 && (
                <Pagination
                  page={rp}
                  pages={rowPages}
                  setPage={setRowPage}
                  label="Source issue page"
                />
              )}
            </section>
          )}
          <details className="review-history">
            <summary>Import history</summary>
            <section className="review-panel table-panel">
              <div className="history-list">
                {review?.history
                  .slice(historyPage * 20, (historyPage + 1) * 20)
                  .map((h) => (
                    <div key={h.id}>
                      <strong>{h.source}</strong>
                      <span className="status-tag">{h.status}</span>
                      <small>
                        {date(h.created_at)} · {h.copies ?? "Unknown"} known
                        copies · {h.rows ?? "Unknown"} rows
                      </small>
                      {h.fingerprint && (
                        <small title={h.fingerprint}>
                          Fingerprint: {h.fingerprint.slice(0, 16)}…
                        </small>
                      )}
                    </div>
                  ))}
              </div>
              <Pagination
                page={historyPage}
                pages={Math.max(
                  1,
                  Math.ceil((review?.history.length || 0) / 20),
                )}
                setPage={setHistoryPage}
                label="Import history page"
              />
              <p className="hint">
                The latest 100 import records are retained. Saved backups
                contain earlier workspace history.
              </p>
            </section>
          </details>
        </div>
      )}
      {view === "matching" && (
        <section className="review-panel table-panel">
          <div className="section-heading">
            <h2>
              Printing matches{review ? ` · ${review.matches.length}` : ""}
            </h2>
            <button
              className="button secondary"
              disabled={busy || state.price_job.running}
              onClick={() =>
                run(
                  () => api("/prices/refresh?force=true", "POST"),
                  "Full collection matching started",
                )
              }
            >
              {state.price_job.running && (
                <Loader2 className="spin" size={16} />
              )}{" "}
              {state.price_job.running
                ? `Matching ${state.price_job.completed}/${state.price_job.total}`
                : "Refresh matches"}
            </button>
          </div>
          {state.price_job.error && (
            <p role="alert" className="notice warning">
              {state.price_job.error}
            </p>
          )}
          <div className="search-row">
            <input
              aria-label="Search unresolved printings"
              placeholder="Name, printing, or Excel row"
              value={query}
              onChange={(e) => updateFilter(e.target.value, status)}
            />
            <select
              aria-label="Filter match status"
              value={status}
              onChange={(e) => updateFilter(query, e.target.value)}
            >
              <option value="">All unresolved states</option>
              {Object.entries(statuses)
                .filter(([k]) => k !== "matched")
                .map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
            </select>
          </div>
          {review && <p className="hint">{matches.length} results</p>}
          <div
            className="match-list"
            ref={resultsRef}
            tabIndex={-1}
            role="region"
            aria-label={`Printing matches, page ${currentPage + 1} of ${pages}`}
          >
            {matches
              .slice(currentPage * 20, (currentPage + 1) * 20)
              .map((m) => (
                <div className="match-row" key={m.printing_key}>
                  <div>
                    <strong>{m.name}</strong>
                    <small>
                      {m.printing_key} · Input rows {m.source_rows}
                    </small>
                    {m.message && <p>{m.message}</p>}
                  </div>
                  <span className={`status-tag match-status-${m.status}`}>
                    {statuses[m.status] || m.status}
                  </span>
                  <button
                    className="button secondary small"
                    onClick={() =>
                      setMatch({ item: m, revision: state.revision })
                    }
                  >
                    Find printing
                  </button>
                </div>
              ))}
          </div>
          {review && !matches.length && (
            <Empty title="No matches need review in this view" />
          )}
          <Pagination
            page={currentPage}
            pages={pages}
            setPage={matchingPage}
            label="Matching page"
          />
        </section>
      )}
      {match && (
        <MatchDialog
          item={match.item}
          openingRevision={match.revision}
          close={() => setMatch(null)}
          reload={reload}
        />
      )}
    </div>
  );
}
