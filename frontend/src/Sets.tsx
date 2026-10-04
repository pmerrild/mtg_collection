import React, { useEffect, useState } from "react";
import { RefreshCw, Search } from "lucide-react";
import type { SetChecklist, SetProgress, ViewProps } from "./types";
import { api, date, Dialog, Empty, Pagination } from "./ui";
export function CollectionTabs({ active }: { active: "cards" | "sets" }) {
  return (
    <nav
      className="section-tabs collection-tabs"
      aria-label="Collection sections"
    >
      <a
        href="#collection"
        aria-current={active === "cards" ? "page" : undefined}
      >
        Cards
      </a>
      <a
        href="#collection/sets"
        aria-current={active === "sets" ? "page" : undefined}
      >
        Set progress
      </a>
    </nav>
  );
}
export function Sets({ state }: ViewProps) {
  const [result, setResult] = useState<{
      revision: number;
      items: SetProgress[];
    } | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [query, setQuery] = useState(""),
    [tick, setTick] = useState(0),
    [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<{
      code: string;
      page: number;
      view: "all" | "missing";
    } | null>(null),
    [detailResult, setDetailResult] = useState<{
      key: string;
      value: SetChecklist;
    } | null>(null),
    [detailError, setDetailError] = useState("");
  const items = result?.revision === state.revision ? result.items : [];
  const detailKey = selected
    ? `${state.revision}:${selected.code}:${selected.page}:${selected.view}:${tick}`
    : "";
  const detail = detailResult?.key === detailKey ? detailResult.value : null;
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api<{ items: SetProgress[] }>("/sets")
      .then((data) => {
        if (live) setResult({ revision: state.revision, items: data.items });
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [state.revision, tick]);
  useEffect(() => {
    if (!selected) return;
    let live = true;
    setDetailError("");
    api<SetChecklist>(
      `/sets/${selected.code}?page=${selected.page}&view=${selected.view}`,
    )
      .then((data) => {
        if (live) setDetailResult({ key: detailKey, value: data });
      })
      .catch((e) => {
        if (live) setDetailError(e.message);
      });
    return () => {
      live = false;
    };
  }, [detailKey]);
  useEffect(() => {
    setSelected((old) => (old ? { ...old, page: 0 } : null));
  }, [state.revision]);
  const rows = items
    .filter((item) =>
      `${item.code} ${item.name || ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    )
    .sort(
      (a, b) =>
        b.owned_printings - a.owned_printings || a.code.localeCompare(b.code),
    );
  const refresh = async () => {
    if (!selected) return;
    setRefreshing(true);
    setDetailError("");
    try {
      await api(`/sets/${selected.code}/refresh`, "POST");
      setSelected((old) => (old ? { ...old, page: 0, view: "all" } : null));
      setTick((n) => n + 1);
    } catch (e) {
      setDetailError((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Set progress</h1>
          <p className="subtitle">
            Distinct printings in each edition, with duplicate copies counted
            once.
          </p>
        </div>
      </div>
      <CollectionTabs active="sets" />
      <div className="set-intro">
        <p>
          Completion uses all English paper printings in the edition, including
          variants. Foil and nonfoil count once. Separate token and supplemental
          editions have their own checklists.
        </p>
        <p className="hint">
          Load a complete Scryfall checklist, then verify owned printings.
          Unknown completion is shown until both are available.
        </p>
        {!!state.summary.issues && (
          <p className="hint">
            Invalid workbook rows are excluded from ownership.{" "}
            <a href="#review">Review source issues</a> before treating progress
            as final.
          </p>
        )}
      </div>
      <section className="table-panel" aria-busy={loading}>
        <div className="table-toolbar">
          <label className="search-field">
            <Search size={18} />
            <input
              aria-label="Search owned sets"
              placeholder="Search set names or codes"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <span className="hint">{items.length} owned editions</span>
        </div>
        {loading && (
          <p className="set-status" role="status">
            Loading set progress…
          </p>
        )}
        {error && (
          <div className="notice danger" role="alert">
            {error}
            <button
              className="button secondary"
              onClick={() => setTick((n) => n + 1)}
            >
              Retry set progress
            </button>
          </div>
        )}
        <div className="set-list">
          {rows.map((item) => (
            <div className="set-row" key={item.code}>
              <button
                className="set-identity"
                onClick={() =>
                  setSelected({ code: item.code, page: 0, view: "all" })
                }
              >
                <strong>{item.name || item.code.toUpperCase()}</strong>
                <small>
                  {item.code.toUpperCase()} · {item.owned_printings} owned
                  printings · {item.copies} copies
                </small>
              </button>
              <div className="set-completion">
                <strong>
                  {item.percent === null ? "Unknown" : `${item.percent}%`}
                </strong>
                {item.percent !== null && (
                  <progress
                    max={100}
                    value={item.percent}
                    aria-label={`${item.name || item.code} completion`}
                  />
                )}
                <small>
                  {item.total === null
                    ? "Checklist not loaded"
                    : `${item.verified_owned} verified / ${item.total} catalog printings`}
                </small>
                {item.total !== null && item.needs_verification > 0 && (
                  <small>
                    {item.needs_verification} owned printings need verification
                  </small>
                )}
              </div>
              <button
                className="button secondary small"
                onClick={() =>
                  setSelected({ code: item.code, page: 0, view: "all" })
                }
              >
                Open set
              </button>
            </div>
          ))}
        </div>
        {!loading && !error && !rows.length && (
          <Empty
            title={items.length ? "No matching sets" : "No owned sets yet"}
          >
            <p>
              {items.length
                ? "Try another set name or code."
                : "Import your complete Input workbook to see owned editions."}
            </p>
            {items.length > 0 && (
              <button className="button secondary" onClick={() => setQuery("")}>
                Clear set search
              </button>
            )}
          </Empty>
        )}
      </section>
      {selected && (
        <Dialog
          title={detail?.name || selected.code.toUpperCase()}
          wide
          close={() => {
            if (!refreshing) setSelected(null);
          }}
        >
          <p className="hint">
            {selected.code.toUpperCase()} · All English paper printings,
            including variants. Finishes count once.
          </p>
          {detailError && (
            <p role="alert" className="notice danger">
              {detailError} Any previously cached complete checklist is
              retained.
            </p>
          )}
          {!detail && !detailError && <p role="status">Loading checklist…</p>}
          {detail && (
            <>
              <div className="set-detail-summary">
                <div>
                  <strong>
                    {detail.percent === null
                      ? "Completion unknown"
                      : `${detail.percent}% complete`}
                  </strong>
                  <p>
                    {detail.owned_printings} owned printings · {detail.copies}{" "}
                    copies
                  </p>
                  {detail.total !== null && (
                    <p>
                      {detail.verified_owned} verified / {detail.total} catalog
                      printings
                      {detail.missing_count !== null
                        ? ` · ${detail.missing_count} missing`
                        : ""}
                    </p>
                  )}
                </div>
                <button
                  className="button secondary"
                  disabled={refreshing}
                  onClick={refresh}
                >
                  <RefreshCw size={16} className={refreshing ? "spin" : ""} />
                  {refreshing
                    ? "Loading full checklist…"
                    : detail.total === null
                      ? "Load checklist"
                      : "Refresh checklist"}
                </button>
              </div>
              {detail.fetched_at && (
                <p className="hint">
                  Complete checklist cached {date(detail.fetched_at)}. Changes
                  in later printings require a refresh.
                </p>
              )}
              {detail.total === null ? (
                <p className="hint">
                  A complete checklist is required before calculating progress
                  or listing missing printings.
                </p>
              ) : detail.needs_verification > 0 ? (
                <p className="notice warning">
                  {detail.needs_verification} owned printings are unchecked or
                  outside this checklist. Verify the edition in Excel and Review
                  before calculating completion or a missing list.
                </p>
              ) : null}
              <div className="actions">
                <a
                  className="button secondary"
                  href={`#collection?sets=${encodeURIComponent(selected.code)}`}
                  onClick={() => setSelected(null)}
                >
                  View owned cards
                </a>
                {detail.needs_verification > 0 && (
                  <a
                    className="button secondary"
                    href="#review"
                    onClick={() => setSelected(null)}
                  >
                    Review printings
                  </a>
                )}
              </div>
              {detail.total !== null && (
                <>
                  <div
                    className="section-tabs"
                    role="group"
                    aria-label="Checklist view"
                  >
                    <button
                      aria-pressed={selected.view === "all"}
                      onClick={() =>
                        setSelected({ ...selected, page: 0, view: "all" })
                      }
                    >
                      All printings
                    </button>
                    <button
                      aria-pressed={selected.view === "missing"}
                      disabled={detail.percent === null}
                      onClick={() =>
                        setSelected({ ...selected, page: 0, view: "missing" })
                      }
                    >
                      Missing printings
                    </button>
                  </div>
                  <div className="checklist-items">
                    {detail.items.map((card) => (
                      <div key={card.id}>
                        <div>
                          <strong>{card.name}</strong>
                          <small>#{card.number}</small>
                        </div>
                        <span>
                          {card.owned
                            ? "Verified owned"
                            : detail.percent === null
                              ? "No verified copy"
                              : "Missing"}
                        </span>
                      </div>
                    ))}
                  </div>
                  {!detail.items.length && (
                    <p className="hint">
                      No missing printings in this checklist.
                    </p>
                  )}
                  <Pagination
                    page={Math.min(selected.page, detail.pages - 1)}
                    pages={detail.pages}
                    setPage={(page) => setSelected({ ...selected, page })}
                  />
                </>
              )}
            </>
          )}
          {detailError && !detail && (
            <button
              className="button secondary"
              onClick={() => setTick((n) => n + 1)}
            >
              Retry checklist
            </button>
          )}
        </Dialog>
      )}
    </>
  );
}
