import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Archive,
  BookOpen,
  CheckCircle2,
  CircleAlert,
  FileSpreadsheet,
  Layers3,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldCheck,
  X,
} from "lucide-react";
import type { BulkUndo, Card, Snapshot } from "./types";
import { api, date, ExportDialog, setRevision } from "./ui";
import { Collection } from "./Collection";
import { Decks } from "./Decks";
import { Missing } from "./Missing";
import { Review } from "./Review";
import { Settings } from "./Settings";
import { ThemeControl, useTheme } from "./theme";
import "./theme.css";
import "./styles.css";
type Page = "collection" | "decks" | "missing" | "review" | "settings";
const pages: Page[] = ["collection", "decks", "missing", "review", "settings"];
const fromHash = (): Page => {
  const p = location.hash.slice(1).split("?")[0] as Page;
  return pages.includes(p) ? p : "collection";
};
function App() {
  useTheme();
  const [page, updatePage] = useState<Page>(fromHash),
    [state, setState] = useState<Snapshot | null>(null),
    [collection, setCollection] = useState<Card[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [toast, setToast] = useState(""),
    [bulkUndo, setBulkUndo] = useState<BulkUndo | null>(null),
    [undoError, setUndoError] = useState(""),
    [undoBusy, setUndoBusy] = useState(false),
    [exportParams, setExportParams] = useState<Record<string, string> | null>(
      null,
    ),
    [missingDeck, setMissingDeck] = useState<number | undefined>();
  const fileRef = useRef<HTMLInputElement>(null),
    lastHash = useRef(location.hash || "#collection"),
    toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 6000);
  }, []);
  const load = useCallback(async () => {
    const [snapshot, cards] = await Promise.all([
      api<Snapshot>("/state"),
      api<Card[]>("/collection"),
    ]);
    setRevision(snapshot.revision);
    setState(snapshot);
    setCollection(cards);
  }, []);
  const navigate = useCallback((next: Page) => {
    const event = new Event("mtg-before-navigate", { cancelable: true });
    if (!window.dispatchEvent(event)) return;
    location.hash = next;
  }, []);
  useEffect(() => {
    const change = (hashEvent: HashChangeEvent) => {
      const previousHash = hashEvent.oldURL
        ? new URL(hashEvent.oldURL).hash
        : lastHash.current;
      const event = new Event("mtg-before-navigate", { cancelable: true });
      if (!window.dispatchEvent(event)) {
        history.replaceState(null, "", previousHash || "#collection");
        lastHash.current = previousHash || "#collection";
        return;
      }
      lastHash.current = location.hash;
      updatePage(fromHash());
    };
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  useEffect(() => {
    let live = true;
    load().catch((e) => {
      if (live) setError(e.message);
    });
    const timer = setInterval(
      () =>
        load().catch((e) => {
          if (live) setError(e.message);
        }),
      15000,
    );
    return () => {
      live = false;
      clearInterval(timer);
      clearTimeout(toastTimer.current);
    };
  }, [load]);
  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: {
          registerTool: (tool: unknown, options: unknown) => unknown;
        };
      }
    ).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: unknown) => {
      try {
        Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {
        /* Registry is optional in ordinary browsers. */
      }
    };
    register({
      name: "search_collection",
      title: "Search collection",
      description: "Search owned collection cards and show matching cards.",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: { query?: unknown }) => {
        if (typeof input.query !== "string") throw Error("query must be text");
        location.hash = "collection?q=" + encodeURIComponent(input.query);
        window.dispatchEvent(
          new CustomEvent("mtg-collection-search", { detail: input.query }),
        );
        return (await api<Card[]>("/collection"))
          .filter((c) =>
            `${c.name} ${c.set_code} ${c.card_type}`
              .toLowerCase()
              .includes(String(input.query).toLowerCase()),
          )
          .map((c) => ({
            name: c.name,
            quantity: c.quantity,
            foil: c.foil,
            printing: c.printing_key,
          }));
      },
    });
    register({
      name: "start_deck_creation",
      title: "Start deck creation",
      description: "Open the target-list editor without saving a deck.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: async (input: Record<string, unknown>) => {
        if (!input || Object.keys(input).length)
          throw Error("No arguments are accepted");
        location.hash = "decks?new=1";
        window.dispatchEvent(new Event("mtg-new-deck"));
        return { opened: true };
      },
    });
    return () => lifecycle.abort();
  }, []);
  const run = async (fn: () => Promise<unknown>, message?: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      await load();
      if (message) notify(message);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const nav = [
    { page: "collection" as Page, label: "Collection", icon: Archive },
    { page: "decks" as Page, label: "Decks", icon: Layers3 },
    { page: "missing" as Page, label: "Missing", icon: BookOpen },
    { page: "review" as Page, label: "Review", icon: FileSpreadsheet },
    { page: "settings" as Page, label: "Settings", icon: Settings2 },
  ];
  if (!state)
    return (
      <div className="startup">
        <Layers3 size={36} />
        <h1>MTG Vault</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="button primary" onClick={() => run(load)}>
              Try again
            </button>
          </>
        ) : (
          <div role="status" aria-live="polite" aria-busy="true">
            <p>
              <Loader2 className="spin" size={18} /> Opening your collection…
            </p>
            <div className="loading-preview" aria-hidden="true">
              {Array.from({ length: 4 }, (_, i) => (
                <div className="skeleton-row" key={i}>
                  <i />
                  <span />
                  <span />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  const props = { state, run, busy, reload: load },
    openImport = () => fileRef.current?.click();
  return (
    <div className="app-shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to workspace
      </a>
      <aside className="sidebar">
        <div className="mobile-theme">
          <ThemeControl />
        </div>
        <div className="brand">
          <div className="brand-symbol">
            <Layers3 size={23} />
          </div>
          <div>
            <strong>MTG Vault</strong>
            <span>COLLECTION WORKSPACE</span>
          </div>
        </div>
        <nav aria-label="Main navigation">
          {nav.map((n) => (
            <button
              key={n.page}
              className={`nav-item ${page === n.page ? "active" : ""}`}
              onClick={() => navigate(n.page)}
              aria-current={page === n.page ? "page" : undefined}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={20} />
          <div>
            <strong>Private collection</strong>
            <span>Excel + saved target lists</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <span>
            Workspace /{" "}
            <strong>{nav.find((n) => n.page === page)?.label}</strong>
          </span>
          <div className="topbar-meta">
            <span className="topbar-status">
              Saved workbook · {date(state.last_import?.created_at)}
            </span>
            <ThemeControl />
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {error && (
            <div role="alert" className="notice danger">
              <CircleAlert size={18} />
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={18} />
              </button>
            </div>
          )}
          {state.pending_import && page !== "review" && (
            <div className="notice warning">
              <span>A complete workbook snapshot is waiting for review.</span>
              <button
                className="button secondary small"
                onClick={() => navigate("review")}
              >
                Review snapshot
              </button>
            </div>
          )}
          {page === "collection" && (
            <Collection
              {...props}
              collection={collection}
              openImport={openImport}
              exportList={setExportParams}
              offerUndo={(undo) => {
                setBulkUndo(undo);
                setUndoError("");
                if (!undo) notify("Wanted records saved; ownership unchanged");
              }}
              review={() => navigate("review")}
            />
          )}
          {page === "decks" && (
            <Decks
              {...props}
              exportList={setExportParams}
              openMissing={(id) => {
                setMissingDeck(id);
                navigate("missing");
              }}
            />
          )}
          {page === "missing" && (
            <Missing
              {...props}
              initialDeck={missingDeck}
              exportList={setExportParams}
            />
          )}
          {page === "review" && <Review {...props} openImport={openImport} />}
          {page === "settings" && (
            <Settings {...props} openImport={openImport} />
          )}
        </main>
        <footer className="app-footer">
          <span>Input imported {date(state.last_import?.created_at)}</span>
          <button className="text-button" onClick={() => navigate("settings")}>
            <RefreshCw size={14} />
            {state.price_job.running
              ? `Refreshing Scryfall ${state.price_job.completed}/${state.price_job.total}`
              : state.price_job.error
                ? "Scryfall request failed · cached data retained"
                : `Prices fetched ${date(state.settings.last_price_success)}`}
          </button>
        </footer>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx"
        hidden
        aria-label="Import saved Excel workbook"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          await run(async () => {
            if (file.size > 4 * 1024 * 1024)
              throw Error(
                "Workbook exceeds 4 MiB. Keep the complete Input inventory and remove unused sheets or formatting; do not split ownership across uploads.",
              );
            const response = await fetch("/api/upload", {
                method: "POST",
                headers: {
                  "Content-Type": "application/octet-stream",
                  "X-Workbook-Name": file.name,
                },
                body: file,
              }),
              result = await response.json();
            if (!response.ok)
              throw Error(
                result.detail ||
                  "Workbook import failed; current inventory is retained.",
              );
            if (result.unchanged) notify("Workbook unchanged; no copies added");
            else {
              notify("Snapshot staged; review all changes before applying");
              navigate("review");
            }
          });
          e.target.value = "";
        }}
      />
      {toast && !bulkUndo && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
        </div>
      )}
      {bulkUndo && (
        <div className="undo-bar">
          <div role="status">
            {bulkUndo.action === "location" ? "Location" : "Keep preference"}{" "}
            updated for {bulkUndo.count} printings.
            <small className="undo-limit">
              Undo is available for 15 minutes, until another vault change.
            </small>
          </div>
          <button
            className="button secondary small"
            disabled={undoBusy || busy}
            onClick={async () => {
              setUndoBusy(true);
              setUndoError("");
              try {
                await api(
                  "/collection/bulk/undo",
                  "POST",
                  { token: bulkUndo.token },
                  bulkUndo.revision,
                );
                setBulkUndo(null);
                await run(async () => {}, "Previous values restored");
              } catch (e) {
                setUndoError((e as Error).message);
              } finally {
                setUndoBusy(false);
              }
            }}
          >
            {undoBusy ? "Undoing…" : "Undo"}
          </button>
          <button
            className="icon-button"
            aria-label="Dismiss undo"
            onClick={() => {
              setBulkUndo(null);
              setUndoError("");
            }}
          >
            <X size={17} />
          </button>
          {undoError && <p role="alert">{undoError}</p>}
        </div>
      )}
      {exportParams && (
        <ExportDialog
          params={exportParams}
          close={() => setExportParams(null)}
          notify={notify}
        />
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
