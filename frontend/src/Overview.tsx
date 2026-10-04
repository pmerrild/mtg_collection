import React from "react";
import { ArrowDownToLine, FileSpreadsheet } from "lucide-react";
import type { Card, Snapshot } from "./types";
import { date, money } from "./ui";
export function Overview({
  state,
  collection,
  openImport,
}: {
  state: Snapshot;
  collection: Card[];
  openImport: () => void;
}) {
  const { summary } = state;
  const conflicts = collection.filter(
    (c) => c.match_status === "name_mismatch",
  ).length;
  const failures = collection.filter((c) =>
    ["lookup_failed", "not_found"].includes(c.match_status),
  ).length;
  const incomplete = state.decks.filter(
    (d) => !d.readiness.list.complete || !d.list_confirmed,
  ).length;
  const ready = state.decks.filter(
    (d) => d.readiness.list.complete && d.list_confirmed && d.missing_now === 0,
  ).length;
  const tasks = [
    ...(state.pending_import
      ? [
          {
            label: "Workbook snapshot waiting for review",
            detail: "Review the changes before replacing ownership.",
            href: "#review",
          },
        ]
      : []),
    ...(summary.issues
      ? [
          {
            label: `${summary.issues} source ${summary.issues === 1 ? "row needs" : "rows need"} attention`,
            detail:
              "Known totals exclude invalid rows. Confirm them in your workbook.",
            href: "#review",
          },
        ]
      : []),
    ...(conflicts
      ? [
          {
            label: `${conflicts} printing identity conflicts`,
            detail: "These printings are excluded from valuation.",
            href: "#review",
          },
        ]
      : []),
    ...(failures
      ? [
          {
            label: `${failures} printing lookups need attention`,
            detail: "Review failed or missing matches.",
            href: "#review",
          },
        ]
      : []),
    ...(state.price_job.error
      ? [
          {
            label: "Card data refresh failed",
            detail: "Cached data was retained. Retry from Data & prices.",
            href: "#settings?section=data",
          },
        ]
      : []),
  ];
  const decks = [...state.decks]
    .sort(
      (a, b) =>
        Number(b.active) - Number(a.active) ||
        (a.priority || 0) - (b.priority || 0) ||
        a.id - b.id,
    )
    .slice(0, 6);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Overview</h1>
          <p className="subtitle">
            Your collection, priorities, and deck progress.
          </p>
        </div>
        <button className="button secondary" onClick={openImport}>
          <FileSpreadsheet size={16} /> Import workbook
        </button>
      </div>
      <div className="overview-metrics">
        <a className="overview-metric table-panel" href="#collection">
          <span>Known owned copies</span>
          <strong>{summary.copies.toLocaleString()}</strong>
          <small>
            {summary.foil_copies} foil
            {summary.issues ? " · total incomplete" : ""}
          </small>
        </a>
        <a className="overview-metric table-panel" href="#collection">
          <span>Unique cards</span>
          <strong>{summary.unique_cards.toLocaleString()}</strong>
          <small>{summary.printings.toLocaleString()} owned printings</small>
        </a>
        <a
          className="overview-metric table-panel"
          href="#settings?section=data"
        >
          <span>Known collection value</span>
          <strong>
            {summary.priced_copies
              ? money(summary.value, state.settings.currency)
              : "Unknown"}
          </strong>
          <small>
            {summary.priced_copies} / {summary.copies} copies priced
          </small>
        </a>
        <a className="overview-metric table-panel" href="#decks">
          <span>Decks ready to assemble</span>
          <strong>
            {ready} <em>/ {state.decks.length}</em>
          </strong>
          <small>{incomplete} targets incomplete or unconfirmed</small>
        </a>
      </div>
      <div className="overview-grid">
        <section className="table-panel overview-section">
          <div className="section-heading">
            <h2>Needs attention</h2>
            <a href="#review">Open review</a>
          </div>
          {tasks.length ? (
            <ul className="attention-list">
              {tasks.map((task) => (
                <li key={task.label}>
                  <a href={task.href}>
                    <strong>{task.label}</strong>
                    <span>{task.detail}</span>
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="hint">No source or matching errors recorded.</p>
          )}
          <div className="overview-coverage">
            <h3>Card data coverage</h3>
            <p>
              {summary.printings - summary.unresolved} / {summary.printings}{" "}
              printings matched
            </p>
            <p className="hint">
              {summary.unresolved
                ? `${summary.unresolved} printings still need checking. Artwork, prices, and set completion depend on exact matches.`
                : "Printing identities are matched. Price availability may still vary."}
            </p>
            <div className="actions">
              <a className="button secondary" href="#review">
                Check printings
              </a>
              <a className="button secondary" href="#collection/sets">
                View set progress
              </a>
            </div>
          </div>
        </section>
        <section className="table-panel overview-section">
          <div className="section-heading">
            <h2>Deck progress</h2>
            <a href="#decks">All decks</a>
          </div>
          {decks.length ? (
            <div className="overview-decks">
              {decks.map((deck) => (
                <div className="overview-deck" key={deck.id}>
                  <div>
                    <a href={`#decks?deck=${deck.id}`}>
                      <strong>{deck.name}</strong>
                    </a>
                    <span className="deck-status">
                      {!deck.readiness.list.complete
                        ? "Target list incomplete"
                        : !deck.list_confirmed
                          ? "Target list unconfirmed"
                          : deck.missing_now
                            ? `${deck.missing_now} copies short to assemble`
                            : "Ready to assemble"}
                    </span>
                    <small>
                      {deck.covered} / {deck.total} entered targets owned
                      {!deck.active ? " · reservations inactive" : ""}
                    </small>
                  </div>
                  <a
                    className="text-button"
                    href={`#decks?deck=${deck.id}&edit=1`}
                  >
                    Edit list
                  </a>
                  <a className="text-button" href={`#missing?deck=${deck.id}`}>
                    View missing
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <p className="hint">
              Create a target decklist to compare it with your ownership.
            </p>
          )}
          <p className="hint">
            Ready to assemble requires a complete, confirmed list and no
            reservation shortage. Format checks and physical assembly are
            separate.
          </p>
        </section>
      </div>
      <section className="table-panel overview-section overview-source">
        <div>
          <h2>Workbook</h2>
          <p className="file-name">
            {state.settings.workbook_path || "No accepted workbook"}
          </p>
          <p className="hint">
            Last accepted import: {date(state.last_import?.created_at)}
          </p>
        </div>
        <div>
          <h2>Acquisition records</h2>
          <p>
            {["wanted", "ordered", "received"]
              .map(
                (status) =>
                  `${state.acquisitions.filter((a) => a.status === status).length} ${status}`,
              )
              .join(" · ")}
          </p>
          <p className="hint">Tracking records do not change ownership.</p>
          <a className="text-button" href="#missing">
            Open acquisitions
          </a>
        </div>
        <a className="button secondary" href="/api/backup">
          <ArrowDownToLine size={16} /> Download backup
        </a>
      </section>
    </>
  );
}
