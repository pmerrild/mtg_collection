import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Archive, ArrowDownToLine, ArrowUpDown, BookOpen, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Copy, Database, ExternalLink, FileSpreadsheet, FolderOpen, Layers3, Loader2, Plus, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import './styles.css';

type Entry = { id: number; name: string; quantity: number; zone: string; printing_key: string | null; owned: number; available: number; in_other_decks: number; covered: number; assigned: number; missing: number; missing_now: number; estimate: number | null };
type Deck = { id: number; name: string; format: string; active: number; seeded: number; total: number; covered: number; missing: number; missing_now: number; decklist: string; entries: Entry[]; warnings: string[] };
type Card = { key: string; name: string; printing_key: string; set_code: string; collector_number: string; quantity: number; nonfoil: number; foil: number; card_type: string; color: string; rarity: string; value: number | null; priced_copies: number; prices: { nonfoil: number | null; foil: number | null }; decks: string[]; notes: string[]; source_rows: number[]; match_status: string; match_message: string; image_url: string | null; scryfall_url: string | null; oracle_text: string; mana_cost: string; fetched_at: string | null };
type Snapshot = { settings: { workbook_path: string; currency: string; auto_watch: boolean; foil_mode: string; last_import_error: string; last_price_success: string | null }; summary: { copies: number; unique_cards: number; printings: number; foil_copies: number; value: number; priced_copies: number; unresolved: number; issues: number }; decks: Deck[]; last_import: { created_at: string; source: string } | null; pending_import: { id: number; copies: number; rows: number; reductions: { name: string; before: number; after: number; finish: string }[] } | null; price_job: { running: boolean; completed: number; total: number; error: string; message: string } };
type Wish = { items: { name: string; printing_key: string | null; quantity: number; estimate: number | null; decks: string[] }[]; copies: number; estimate: number; priced_copies: number };
type Issues = { rows: { id: number; source_row: number; name: string; message: string; raw: Record<string, unknown> }[]; matches: { printing_key: string; name: string; source_rows: string; status: string; message: string }[]; history: { id: number; created_at: string; source: string; status: string }[] };
type ScryCard = { id: string; name: string; set: string; set_name: string; collector_number: string; type_line: string; image_uris?: { small?: string }; card_faces?: { image_uris?: { small?: string } }[] };
type Page = 'collection' | 'decks' | 'missing' | 'review' | 'settings';
const formats: Record<string, string> = { commander: 'Commander', casual60: 'Casual 60-card', standard: 'Standard', modern: 'Modern', pioneer: 'Pioneer', legacy: 'Legacy', vintage: 'Vintage', pauper: 'Pauper' };

async function api<T>(url: string, method = 'GET', data?: unknown): Promise<T> {
  const response = await fetch('/api' + url, { method, headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(typeof payload.detail === 'string' ? payload.detail : 'This request could not be completed.');
  }
  return response.json();
}
const money = (value: number | null, currency = 'EUR') => value === null ? '—' : new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
const date = (value?: string | null) => value ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Not yet';
const zones: Record<string, string> = { all: 'All cards', commander: 'Command zone', main: 'Main deck', sideboard: 'Sideboard' };

function Dialog({ title, children, close, wide = false }: { title: string; children: React.ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={wide ? 'dialog wide' : 'dialog'} onCancel={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="dialog-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={close}><X size={20} /></button></div>{children}
  </dialog>;
}

function ExportDialog({ params, close, notify }: { params: Record<string, string>; close: () => void; notify: (text: string) => void }) {
  const [zone, setZone] = useState('all');
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/export?' + new URLSearchParams({ ...params, zone }), { signal: controller.signal }).then(async r => { if (!r.ok) throw new Error('Could not prepare this export.'); setText(await r.text()); }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [params, zone]);
  const download = () => {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = params.kind === 'deck' ? `deck-${zone}.txt` : `${params.kind}.txt`; link.click(); URL.revokeObjectURL(url);
  };
  return <Dialog title="Export for Scryfall" close={close}>
    <p className="muted">Copy this quantity-and-name list into Scryfall’s deck importer, or download it as a text file.</p>
    {params.kind === 'deck' && <label className="field">Cards to export<select aria-label="Cards to export" value={zone} onChange={e => setZone(e.target.value)}>{Object.entries(zones).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>}
    {error && <div className="notice danger">{error}</div>}
    <textarea className="export-text" readOnly value={text} aria-label="Exported decklist" />
    <p className="hint">Name-only export combines printings. After importing, designate your commander and sideboard in Scryfall. Export zones separately when needed. Detailed inventory fields are available through CSV.</p>
    <div className="dialog-actions"><a className="button secondary" href="https://scryfall.com/decks" target="_blank" rel="noreferrer">Scryfall <ExternalLink size={14} /></a><button className="button secondary" disabled={!text} onClick={download}><ArrowDownToLine size={16} /> Download .txt</button><button className="button primary" disabled={!text} onClick={async () => { try { await navigator.clipboard.writeText(text); notify('Decklist copied'); } catch { setError('Clipboard access is unavailable. Select the text or download the file.'); } }}><Copy size={16} /> Copy list</button></div>
  </Dialog>;
}

function CardDialog({ card, close, currency }: { card: Card; close: () => void; currency: string }) {
  return <Dialog title={card.name} close={close} wide>
    <div className="card-details">
      <div className="card-art">{card.image_url ? <img src={card.image_url} alt={card.name} /> : <div className="art-empty"><Layers3 size={40} /><span>Card artwork appears after a Scryfall match.</span></div>}</div>
      <div><p className="eyebrow">{card.set_code.toUpperCase()} · #{card.collector_number}</p><p>{card.card_type}</p>{card.oracle_text && <p className="rules-text">{card.oracle_text}</p>}
        <dl className="detail-list"><div><dt>Owned</dt><dd>{card.quantity} copies</dd></div><div><dt>Nonfoil / foil</dt><dd>{card.nonfoil} / {card.foil}</dd></div><div><dt>Nonfoil unit price</dt><dd>{money(card.prices.nonfoil, currency)}</dd></div><div><dt>Foil unit price</dt><dd>{money(card.prices.foil, currency)}</dd></div><div><dt>Known value</dt><dd>{money(card.value, currency)}</dd></div><div><dt>Excel rows</dt><dd>{card.source_rows.join(', ')}</dd></div><div><dt>Price refreshed</dt><dd>{date(card.fetched_at)}</dd></div></dl>
        {card.decks.length > 0 && <><h3>Workbook assignments</h3>{card.decks.map(d => <p className="muted" key={d}>{d}</p>)}</>}
        {card.notes.length > 0 && <><h3>Notes</h3><p className="muted">{card.notes.join(' · ')}</p></>}
        {card.scryfall_url && <a className="button secondary" href={card.scryfall_url} target="_blank" rel="noreferrer">View on Scryfall <ExternalLink size={14} /></a>}
      </div>
    </div>
  </Dialog>;
}

function DeckEditor({ deck, close, saved }: { deck: Deck | null; close: () => void; saved: () => Promise<void> }) {
  const [name, setName] = useState(deck?.name || '');
  const [format, setFormat] = useState(deck?.format || 'commander');
  const [active, setActive] = useState(deck ? Boolean(deck.active) : true);
  const [list, setList] = useState(deck?.decklist || '');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''), [cards, setCards] = useState<ScryCard[]>([]), [searching, setSearching] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { await api(deck ? `/decks/${deck.id}` : '/decks', deck ? 'PUT' : 'POST', { name, format, active, decklist: list }); await saved(); close(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <Dialog title={deck ? 'Edit deck' : 'Create a deck'} close={close} wide>
    <form onSubmit={submit}>
      <div className="field-row"><label className="field">Deck name<input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ramos Guildgates" /></label><label className="field">Format<select aria-label="Format" value={format} onChange={e => setFormat(e.target.value)}>{Object.entries(formats).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div>
      <label className="checkbox-row"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Reserve copies for this deck when comparing active decks</label>
      <label className="field">Target decklist<textarea className="decklist-input" value={list} onChange={e => setList(e.target.value)} placeholder={'Commander\n1 Ramos, Dragon Engine\n\nDeck\n1 Sol Ring\n\nSideboard\n1 Arcane Signet'} /></label>
      <p className="hint">One quantity and name per line. Optional section headings: Commander, Deck, Sideboard. To require an edition, use “1 Card Name (SET) 123”. Include cards you plan to acquire.</p>
      <details className="lookup"><summary>Find a card on Scryfall</summary><div className="search-row"><input aria-label="Search Scryfall" value={query} onChange={e => setQuery(e.target.value)} placeholder="Card name or Scryfall search" /><button type="button" className="button secondary" disabled={searching || !query.trim()} onClick={async () => { setSearching(true); setError(''); try { setCards(await api('/cards/search?q=' + encodeURIComponent(query))); } catch (e) { setError((e as Error).message); } finally { setSearching(false); } }}>{searching ? <Loader2 className="spin" size={16} /> : <Search size={16} />} Search</button></div><div className="search-results">{cards.map(c => <button key={c.id} type="button" onClick={() => setList(list.trimEnd() + `\n1 ${c.name}`)}><span><strong>{c.name}</strong><small>{c.set_name} · {c.collector_number}</small></span><Plus size={16} /></button>)}</div></details>
      {error && <div role="alert" className="notice danger">{error}</div>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={busy}>{busy && <Loader2 className="spin" size={16} />} Save deck</button></div>
    </form>
  </Dialog>;
}

function MatchDialog({ item, close, saved }: { item: Issues['matches'][number]; close: () => void; saved: () => Promise<void> }) {
  const [query, setQuery] = useState(item.name), [cards, setCards] = useState<ScryCard[]>([]), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <Dialog title="Confirm a printing" close={close} wide>
    <p className="muted">Source: {item.name} · {item.printing_key} · Excel rows {item.source_rows}. Choose the edition you own. This stores a matching correction without editing Excel.</p>
    <form className="search-row" onSubmit={async e => { e.preventDefault(); setBusy(true); setError(''); try { setCards(await api('/cards/search?q=' + encodeURIComponent(query))); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}><input aria-label="Find printing" value={query} onChange={e => setQuery(e.target.value)} /><button className="button primary" disabled={busy}>{busy ? <Loader2 className="spin" size={16} /> : <Search size={16} />} Search</button></form>
    {error && <div className="notice danger">{error}</div>}
    <div className="search-results printings">{cards.map(c => <button key={c.id} disabled={busy} onClick={async () => { setBusy(true); try { await api('/matches/confirm', 'POST', { printing_key: item.printing_key, card_id: c.id }); await saved(); close(); } catch (e) { setError((e as Error).message); setBusy(false); } }}><span><strong>{c.name}</strong><small>{c.set_name} ({c.set.toUpperCase()}) · #{c.collector_number}</small></span><span className="confirm-label">Confirm <Check size={16} /></span></button>)}</div>
  </Dialog>;
}

function App() {
  const [page, setPage] = useState<Page>('collection');
  const [state, setState] = useState<Snapshot | null>(null), [collection, setCollection] = useState<Card[]>([]), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [color, setColor] = useState(''), [type, setType] = useState(''), [foilOnly, setFoilOnly] = useState(false), [sort, setSort] = useState('name'), [pagination, setPagination] = useState(0);
  const [card, setCard] = useState<Card | null>(null), [editor, setEditor] = useState<Deck | null | undefined>(undefined), [exportParams, setExportParams] = useState<Record<string, string> | null>(null);
  const [deckId, setDeckId] = useState<number | null>(null), [deckZone, setDeckZone] = useState('all');
  const [selected, setSelected] = useState<number[]>([]), [mode, setMode] = useState('assembled'), [wish, setWish] = useState<Wish | null>(null), [wishError, setWishError] = useState('');
  const [review, setReview] = useState<Issues | null>(null), [match, setMatch] = useState<Issues['matches'][number] | null>(null);
  const [toast, setToast] = useState(''), [busy, setBusy] = useState(false), [workbookPath, setWorkbookPath] = useState('');
  const fileRef = useRef<HTMLInputElement>(null), initialized = useRef(false), toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((text: string) => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 5000); }, []);
  const load = useCallback(async () => {
    const [snapshot, cards] = await Promise.all([api<Snapshot>('/state'), api<Card[]>('/collection')]);
    setState(snapshot); setCollection(cards); setError('');
    if (!initialized.current) { setSelected(snapshot.decks.map(d => d.id)); setDeckId(snapshot.decks[0]?.id || null); setWorkbookPath(snapshot.settings.workbook_path); initialized.current = true; }
  }, []);
  useEffect(() => { load().catch(e => setError(e.message)); const timer = setInterval(() => load().catch(e => setError(e.message)), 8000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { setPagination(0); }, [query, color, type, foilOnly, sort]);
  useEffect(() => {
    if (page !== 'missing') return;
    let canceled = false; setWishError(''); setWish(null);
    api<Wish>('/wishlist?' + new URLSearchParams({ deck_ids: selected.join(','), mode })).then(r => { if (!canceled) setWish(r); }).catch(e => { if (!canceled) setWishError(e.message); });
    return () => { canceled = true; };
  }, [page, selected, mode, state]);
  useEffect(() => { if (page === 'review') api<Issues>('/issues').then(setReview).catch(e => setError(e.message)); }, [page, state]);
  const run = async (fn: () => Promise<unknown>, message?: string) => { setBusy(true); setError(''); try { await fn(); await load(); if (message) notify(message); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const importWorkbook = () => run(async () => { const result = await api<{ unchanged?: boolean; reductions?: unknown[] }>('/import', 'POST', {}); notify(result.unchanged ? 'Workbook is unchanged' : result.reductions?.length ? 'Review quantity reductions before applying' : 'Collection refreshed from Excel'); });
  const currency = state?.settings.currency || 'EUR';
  const filtered = collection.filter(c => (!query || `${c.name} ${c.set_code} ${c.card_type}`.toLowerCase().includes(query.toLowerCase())) && (!color || c.color.includes(color)) && (!type || c.card_type.includes(type)) && (!foilOnly || c.foil > 0)).sort((a, b) => sort === 'quantity' ? b.quantity - a.quantity : sort === 'value' ? (b.value ?? -1) - (a.value ?? -1) : a.name.localeCompare(b.name));
  const limit = 35, totalPages = Math.max(1, Math.ceil(filtered.length / limit)), visiblePage = Math.min(pagination, totalPages - 1), visible = filtered.slice(visiblePage * limit, (visiblePage + 1) * limit);
  const deck = state?.decks.find(d => d.id === deckId) || state?.decks[0];
  const nav: { page: Page; label: string; icon: typeof Archive; count?: number }[] = [{ page: 'collection', label: 'Collection', icon: Archive }, { page: 'decks', label: 'Decks', icon: Layers3, count: state?.decks.length }, { page: 'missing', label: 'Missing cards', icon: BookOpen }, { page: 'review', label: 'Import review', icon: FileSpreadsheet, count: state?.summary.issues }, { page: 'settings', label: 'Settings', icon: Settings2 }];
  if (!state) return <div className="startup"><div className="brand-symbol"><Layers3 /></div><h1>MTG Vault</h1>{error ? <><p role="alert">{error}</p><button className="button primary" onClick={() => load().catch(e => setError(e.message))}>Try again</button></> : <p><Loader2 className="spin" size={18} /> Opening your collection…</p>}</div>;

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-symbol"><Layers3 size={23} /></div><div><strong>MTG Vault</strong><span>COLLECTION WORKSPACE</span></div></div>
      <div className="nav-label">YOUR CARDS</div><nav aria-label="Main navigation">{nav.map(n => <button key={n.page} className={page === n.page ? 'nav-item active' : 'nav-item'} onClick={() => setPage(n.page)} aria-current={page === n.page ? 'page' : undefined}><n.icon size={19} /><span>{n.label}</span>{Boolean(n.count) && <span className="nav-count">{n.count}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><ShieldCheck size={20} /><div><strong>Local collection</strong><span>Excel + saved decklists</span></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div><span className="breadcrumb">Workspace</span><span className="breadcrumb-divider">/</span><strong>{nav.find(n => n.page === page)?.label}</strong></div><div className="topbar-status"><Database size={14} /><span>SQLite storage</span></div></header>
      <main>
        {error && <div role="alert" className="notice danger"><CircleAlert size={18} /><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}
        {state.settings.last_import_error && <div className="notice warning"><CircleAlert size={18} /><span>Workbook refresh: {state.settings.last_import_error}. Your last successful import is preserved.</span></div>}
        {state.pending_import && <div className="notice warning"><CircleAlert size={18} /><span>A saved workbook reduces existing quantities. Review {state.pending_import.reductions.length} changes before applying.</span><button className="text-button" onClick={() => setPage('review')}>Review changes</button></div>}

        {page === 'collection' && <>
          <div className="page-heading"><div><p className="eyebrow">YOUR INVENTORY</p><h1>Collection</h1><p className="subtitle">Every printing. Every copy. One place.</p></div><div className="actions"><button className="button secondary" onClick={() => setExportParams({ kind: 'collection' })}><ArrowDownToLine size={16} /> Export</button><button className="button primary" disabled={busy} onClick={importWorkbook}><RefreshCw size={16} className={busy ? 'spin' : ''} /> Refresh workbook</button></div></div>
          <div className="metrics"><div className="metric"><span>Owned copies <Archive size={16} /></span><strong>{state.summary.copies.toLocaleString()}</strong><small>{state.summary.foil_copies} foil copies</small></div><div className="metric"><span>Unique cards <Layers3 size={16} /></span><strong>{state.summary.unique_cards.toLocaleString()}</strong><small>{state.summary.printings} distinct printings</small></div><div className="metric"><span>Known collection value <Sparkles size={16} /></span><strong>{state.summary.priced_copies ? money(state.summary.value, currency) : '—'}</strong><small>{state.summary.priced_copies} of {state.summary.copies} copies priced · {currency}</small></div><button className="metric review-metric" onClick={() => setPage('review')}><span>Import issues <CircleAlert size={16} /></span><strong>{state.summary.issues}</strong><small>{state.summary.unresolved} printings awaiting a match</small></button></div>
          <div className="table-panel collection-panel"><div className="table-toolbar"><label className="search-field"><Search size={18} /><input aria-label="Search collection" placeholder="Search cards, sets, or types…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="Clear search" className="icon-button" onClick={() => setQuery('')}><X size={15} /></button>}</label><div className="filters"><select aria-label="Filter by color" value={color} onChange={e => setColor(e.target.value)}><option value="">All colors</option>{['White', 'Blue', 'Black', 'Red', 'Green', 'Colorless'].map(c => <option key={c}>{c}</option>)}</select><select aria-label="Filter by type" value={type} onChange={e => setType(e.target.value)}><option value="">All types</option>{['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Planeswalker'].map(t => <option key={t}>{t}</option>)}</select><button className={foilOnly ? 'filter-chip selected' : 'filter-chip'} onClick={() => setFoilOnly(!foilOnly)} aria-pressed={foilOnly}><Sparkles size={14} /> Foil</button></div></div>
            <div className="table-caption"><span>{filtered.length} printings <span className="muted">· {filtered.reduce((n, c) => n + c.quantity, 0)} copies</span></span><label><ArrowUpDown size={14} /><select aria-label="Sort collection" value={sort} onChange={e => setSort(e.target.value)}><option value="name">Name</option><option value="quantity">Quantity</option><option value="value">Known value</option></select></label></div>
            <div className="table-scroll"><table><thead><tr><th>Card</th><th>Printing</th><th className="numeric">Owned</th><th className="numeric">Foil</th><th>Assigned to</th><th className="numeric">Known value</th></tr></thead><tbody>{visible.map(c => <tr key={c.key}><td><button className="card-cell" onClick={() => setCard(c)}><div className={'card-thumb ' + c.color.split(',')[0].toLowerCase()}>{c.image_url ? <img src={c.image_url} alt="" loading="lazy" /> : <Layers3 size={17} />}</div><span><strong>{c.name}</strong><small>{c.card_type}</small></span></button></td><td><span className="set-tag">{c.set_code.toUpperCase()}</span><span className="collector">#{c.collector_number}</span></td><td className="numeric count">{c.quantity}</td><td className="numeric">{c.foil ? <span className="foil-number"><Sparkles size={12} /> {c.foil}</span> : <span className="muted">—</span>}</td><td><span className="deck-assignment" title={c.decks.join(', ')}>{c.decks.length ? c.decks.length === 1 ? c.decks[0] : `${c.decks.length} decks` : <span className="muted">Unassigned</span>}</span></td><td className="numeric"><span>{money(c.value, currency)}</span>{c.value !== null && c.priced_copies < c.quantity && <small className="partial">Partial</small>}</td></tr>)}</tbody></table></div>
            {!visible.length && <div className="empty"><Search size={28} /><h3>No matching cards</h3><p>Change your filters or import your workbook.</p></div>}
            <div className="table-footer"><span>Last imported {date(state.last_import?.created_at)}</span><div><span>{visiblePage + 1} of {totalPages}</span><button className="icon-button" disabled={visiblePage === 0} aria-label="Previous page" onClick={() => setPagination(visiblePage - 1)}><ChevronLeft size={18} /></button><button className="icon-button" disabled={visiblePage + 1 >= totalPages} aria-label="Next page" onClick={() => setPagination(visiblePage + 1)}><ChevronRight size={18} /></button></div></div>
          </div><div className="source-footer"><FileSpreadsheet size={15} /><span>Source: Input worksheet</span><span className="separator-dot">·</span><span>Ownership is edited in Excel</span><button className="text-button" onClick={() => setPage('settings')}>Change workbook</button></div>
        </>}

        {page === 'decks' && <>
          <div className="page-heading"><div><p className="eyebrow">BUILD WITH WHAT YOU OWN</p><h1>Decks</h1><p className="subtitle">Target lists, collection coverage, and copies available now.</p></div><button className="button primary" onClick={() => setEditor(null)}><Plus size={16} /> New deck</button></div>
          {!state.decks.length ? <div className="empty table-panel"><Layers3 size={34} /><h3>Your first deck starts here</h3><p>Paste a decklist to see which cards you already own.</p><button className="button primary" onClick={() => setEditor(null)}>Create a deck</button></div> : <div className="deck-layout"><div className="deck-selector">{state.decks.map(d => <button className={d.id === deck?.id ? 'deck-tile selected' : 'deck-tile'} key={d.id} onClick={() => { setDeckId(d.id); setDeckZone('all'); }}><div><span className="format-tag">{formats[d.format]}</span><span className={d.active ? 'active-label' : 'muted'}>{d.active ? 'Reserved' : 'Draft'}</span></div><strong>{d.name}</strong><div className="progress"><span style={{ width: `${d.total ? d.covered / d.total * 100 : 0}%` }} /></div><small>{d.covered} / {d.total} owned <span>{d.missing ? `${d.missing} missing` : 'Covered'}</span></small></button>)}</div>
            {deck && <section className="deck-detail table-panel"><div className="deck-heading"><div><span className="format-tag">{formats[deck.format]}</span><h2>{deck.name}</h2></div><div className="actions"><button className="button secondary small" onClick={() => setExportParams({ kind: 'deck', deck_id: String(deck.id) })}><ArrowDownToLine size={14} /> Export</button><button className="button secondary small" onClick={() => setEditor(deck)}>Edit list</button></div></div>
              <div className="deck-stats"><div><strong>{deck.total}</strong><span>Target copies</span></div><div><strong className="positive">{deck.covered}</strong><span>Covered by collection</span></div><div><strong className={deck.missing_now ? 'amber-text' : ''}>{deck.missing_now}</strong><span>Short with active decks</span></div></div>
              <div className="deck-options"><label className="checkbox-row"><input type="checkbox" checked={Boolean(deck.active)} onChange={e => run(() => api(`/decks/${deck.id}/active`, 'POST', { active: e.target.checked }))} /> Reserve copies for this deck</label><select aria-label="Deck zone" value={deckZone} onChange={e => setDeckZone(e.target.value)}>{Object.entries(zones).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
              <div className="table-scroll"><table className="deck-table"><thead><tr><th>Card</th><th className="numeric">Need</th><th className="numeric">Own</th><th className="numeric">Available</th><th className="numeric">Other decks</th><th className="numeric">Missing</th></tr></thead><tbody>{deck.entries.filter(e => deckZone === 'all' || e.zone === deckZone).map(e => <tr key={e.id}><td><strong>{e.name}</strong><small>{zones[e.zone]}{e.printing_key && ` · ${e.printing_key}`}</small></td><td className="numeric">{e.quantity}</td><td className="numeric">{e.owned}</td><td className="numeric">{e.available}</td><td className="numeric">{e.in_other_decks || '—'}</td><td className="numeric">{e.missing ? <span className="missing-badge">{e.missing}</span> : e.missing_now ? <span title="Owned but reserved elsewhere" className="amber-text">Move {e.missing_now}</span> : <Check size={16} className="positive inline-icon" />}</td></tr>)}</tbody></table></div>
              <details className="deck-warnings"><summary><CircleAlert size={15} /> {deck.warnings.length} deck checks to review <ChevronDown size={14} /></summary><ul>{deck.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul><p className="hint">Checks are advisory. Pairing, companion, and card-specific exceptions may require manual review.</p></details>
              <div className="deck-bottom"><button className="text-button" onClick={() => { setSelected([deck.id]); setPage('missing'); }}>View missing cards</button><button className="text-button danger-text" onClick={() => { if (confirm(`Delete ${deck.name}? A database backup will be saved.`)) run(() => api(`/decks/${deck.id}`, 'DELETE'), 'Deck deleted'); }}><Trash2 size={14} /> Delete deck</button></div>
            </section>}
          </div>}
        </>}

        {page === 'missing' && <>
          <div className="page-heading"><div><p className="eyebrow">PLAN YOUR NEXT ADDITIONS</p><h1>Missing cards</h1><p className="subtitle">A combined wishlist compared with your entire collection.</p></div><button className="button secondary" disabled={!wish?.items.length} onClick={() => setExportParams({ kind: 'missing', deck_ids: selected.join(','), mode })}><ArrowDownToLine size={16} /> Export for Scryfall</button></div>
          <div className="wishlist-controls table-panel"><div><h3>Include decks</h3><div className="deck-pills">{state.decks.map(d => <label className={selected.includes(d.id) ? 'deck-pill selected' : 'deck-pill'} key={d.id}><input type="checkbox" checked={selected.includes(d.id)} onChange={e => setSelected(e.target.checked ? [...selected, d.id] : selected.filter(x => x !== d.id))} />{d.name}</label>)}</div></div><div className="sharing-controls"><h3>How will you use these decks?</h3><div className="segmented"><button className={mode === 'assembled' ? 'selected' : ''} onClick={() => setMode('assembled')}>Assembled together</button><button className={mode === 'shared' ? 'selected' : ''} onClick={() => setMode('shared')}>Share copies</button></div><p className="hint">{mode === 'assembled' ? 'Each physical copy can serve one selected deck at a time.' : 'Cards can move between decks. Use the largest demand, while respecting required editions.'}</p></div></div>
          {wishError && <div className="notice danger">{wishError}</div>}
          <div className="wishlist-summary"><strong>{wish?.copies ?? '…'} copies to acquire</strong><span>{wish?.items.length ?? 0} distinct requirements</span><span>Known estimate: {wish?.priced_copies ? money(wish.estimate, currency) : '—'} <small>({wish?.priced_copies ?? 0} copies priced)</small></span></div>
          <div className="table-panel"><div className="table-scroll"><table><thead><tr><th>Card</th><th className="numeric">Missing copies</th><th>Needed by</th><th className="numeric">Indicative unit price</th></tr></thead><tbody>{wish?.items.map((item, i) => <tr key={i}><td><strong>{item.name}</strong><small>{item.printing_key || 'Any printing'}</small></td><td className="numeric"><span className="missing-badge">{item.quantity}</span></td><td><span className="muted">{item.decks.join(', ')}</span></td><td className="numeric">{money(item.estimate, currency)}</td></tr>)}</tbody></table></div>{wish && !wish.items.length && <div className="empty"><CheckCircle2 size={32} /><h3>{selected.length ? 'Your collection covers these lists' : 'Choose decks to compare'}</h3><p>{selected.length ? 'Add the intended target cards to incomplete lists before treating a deck as complete.' : 'Select one or more decks above to build a wishlist.'}</p></div>}</div>
          <p className="footnote">Estimates use available cached printing prices. They exclude shipping and condition adjustments; missing prices remain unknown.</p>
        </>}

        {page === 'review' && <>
          <div className="page-heading"><div><p className="eyebrow">KEEP YOUR INVENTORY ACCURATE</p><h1>Import review</h1><p className="subtitle">Source issues and card matches that need your attention.</p></div><button className="button primary" disabled={busy} onClick={importWorkbook}><RefreshCw size={16} /> Refresh workbook</button></div>
          {state.pending_import && <section className="review-panel table-panel"><h2>Quantity changes awaiting approval</h2><p className="muted">The new snapshot has {state.pending_import.copies} known copies across {state.pending_import.rows} rows. Deck targets will be preserved.</p><div className="table-scroll"><table><thead><tr><th>Card</th><th>Finish</th><th className="numeric">Before</th><th className="numeric">After</th></tr></thead><tbody>{state.pending_import.reductions.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.finish}</td><td className="numeric">{r.before}</td><td className="numeric amber-text">{r.after}</td></tr>)}</tbody></table></div><div className="actions"><button className="button secondary" onClick={() => run(() => api(`/import/${state.pending_import!.id}/dismiss`, 'POST'), 'Import dismissed')}>Keep current inventory</button><button className="button primary" onClick={() => run(() => api(`/import/${state.pending_import!.id}/apply`, 'POST'), 'New snapshot applied')}><Check size={16} /> Apply snapshot</button></div></section>}
          <section className="review-panel table-panel"><h2>Workbook rows <span className="count-label">{review?.rows.length || 0}</span></h2><p className="muted">Fix these cells in Excel and save. Unknown quantities are excluded from owned totals.</p>{review?.rows.map(r => <div className="source-issue" key={r.id}><div className="row-number">{r.source_row}</div><div><strong>{r.name}</strong><p>{r.message}</p><small>Input worksheet · Count: {String(r.raw.Count ?? '(blank)')} · Set: {String(r.raw.Set ?? '(blank)')} · Collector: {String(r.raw['Set#'] ?? '(blank)')}</small></div></div>)}{review && !review.rows.length && <p className="positive"><CheckCircle2 size={16} className="inline-icon" /> No invalid source rows</p>}</section>
          <section className="review-panel table-panel"><div className="section-heading"><h2>Printing matches <span className="count-label">{review?.matches.length || 0}</span></h2><button className="button secondary small" disabled={state.price_job.running} onClick={() => run(() => api('/prices/refresh', 'POST'), 'Scryfall refresh started')}><RefreshCw size={14} className={state.price_job.running ? 'spin' : ''} /> Match with Scryfall</button></div><p className="muted">Prices are shown only after a printing is matched. Name mismatches require confirmation.</p><div className="match-list">{review?.matches.slice(0, 50).map(m => <div className="match-row" key={m.printing_key}><div><strong>{m.name}</strong><small>{m.printing_key} · rows {m.source_rows}</small>{m.message && <p>{m.message}</p>}</div><span className="status-tag">{m.status.replace('_', ' ')}</span><button className="button secondary small" onClick={() => setMatch(m)}>Find printing</button></div>)}</div>{review && review.matches.length > 50 && <p className="hint">Showing the first 50 unresolved printings. Matching with Scryfall processes the full collection.</p>}</section>
        </>}

        {page === 'settings' && <>
          <div className="page-heading"><div><p className="eyebrow">YOUR LOCAL WORKSPACE</p><h1>Settings</h1><p className="subtitle">Connect your workbook and choose how your collection is displayed.</p></div></div>
          <div className="settings-layout"><section className="settings-panel table-panel"><div className="section-heading"><h2><FileSpreadsheet size={20} /> Excel workbook</h2><span className="status-tag">Input only</span></div><p className="muted">Use the full path to your original workbook to follow saved changes. The included workbook is a starting snapshot.</p><form onSubmit={e => { e.preventDefault(); run(async () => { await api('/settings', 'PATCH', { workbook_path: workbookPath }); await api('/import', 'POST', { path: workbookPath }); }, 'Workbook connected'); }}><label className="field">Workbook path<input value={workbookPath} onChange={e => setWorkbookPath(e.target.value)} placeholder="/Users/you/Documents/MagicTheGatheringInventory.xlsx" spellCheck={false} /></label><div className="actions"><button className="button primary" disabled={busy}><FolderOpen size={16} /> Connect workbook</button><button type="button" className="button secondary" onClick={() => fileRef.current?.click()}>Upload snapshot</button></div></form><input ref={fileRef} type="file" accept=".xlsx" hidden onChange={async e => { const file = e.target.files?.[0]; if (!file) return; await run(async () => { const response = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }); const data = await response.json(); if (!response.ok) throw new Error(data.detail); setWorkbookPath(data.applied ? data.applied.source || '' : ''); const s = await api<Snapshot>('/state'); setWorkbookPath(s.settings.workbook_path); }, 'Workbook snapshot imported'); e.target.value = ''; }} /><label className="checkbox-row"><input type="checkbox" checked={state.settings.auto_watch} onChange={e => run(() => api('/settings', 'PATCH', { auto_watch: e.target.checked }))} /> Refresh automatically after Excel saves</label><div className="convention"><strong>Your import convention</strong><p>Count = all copies. Foil = foil copies within that total. Blank Foil = 0. Excel stays the ownership source.</p></div><p className="hint">Unsaved edits are not visible. Uploads are copies and do not follow the original file. Reductions require review.</p></section>
            <section className="settings-panel table-panel"><h2><Sparkles size={20} /> Card data and prices</h2><label className="field">Display currency<select aria-label="Display currency" value={currency} onChange={e => run(() => api('/settings', 'PATCH', { currency: e.target.value }))}><option value="EUR">EUR · Euro</option><option value="USD">USD · US dollar</option></select></label><p className="muted">Scryfall data is cached locally. Stale prices refresh daily while the app runs.</p><dl className="detail-list"><div><dt>Matched printings</dt><dd>{state.summary.printings - state.summary.unresolved} / {state.summary.printings}</dd></div><div><dt>Priced copies</dt><dd>{state.summary.priced_copies} / {state.summary.copies}</dd></div><div><dt>Last successful refresh</dt><dd>{date(state.settings.last_price_success)}</dd></div></dl><button className="button primary" disabled={state.price_job.running} onClick={() => run(() => api('/prices/refresh?force=true', 'POST'), 'Price refresh started')}><RefreshCw size={16} className={state.price_job.running ? 'spin' : ''} /> {state.price_job.running ? `Refreshing ${state.price_job.completed}/${state.price_job.total}` : 'Refresh card data and prices'}</button>{state.price_job.error && <div className="notice warning">{state.price_job.error}</div>}<p className="hint">Indicative marketplace prices, matched to printing and finish. Unknown prices are never counted as zero-value cards.</p></section>
            <section className="settings-panel table-panel"><h2><Database size={20} /> Backups and exports</h2><p className="muted">Decks, matching corrections, cached prices, and import history live in a local SQLite database. Backups are saved before replacing inventory or deleting decks.</p><div className="actions"><a className="button secondary" href="/api/backup"><ArrowDownToLine size={16} /> Download database backup</a><a className="button secondary" href="/api/export?kind=collection&format=csv"><ArrowDownToLine size={16} /> Inventory CSV</a></div><p className="hint">To restore a database backup, stop the app and follow the instructions in README.md. Keep your Excel workbook backed up separately.</p></section>
          </div>
        </>}
      </main>
      <footer className="app-footer"><span><span className="connection-indicator" /> Workbook {state.last_import ? 'imported' : 'not imported'} · {date(state.last_import?.created_at)}</span><button className="text-button" onClick={() => setPage('settings')}>{state.price_job.running ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}{state.price_job.running ? `Scryfall ${state.price_job.completed}/${state.price_job.total}` : state.price_job.error ? 'Scryfall unavailable · cached data retained' : 'Prices: ' + date(state.settings.last_price_success)}</button></footer>
    </div>
    {toast && <div className="toast" role="status"><CheckCircle2 size={18} />{toast}</div>}
    {card && <CardDialog card={card} currency={currency} close={() => setCard(null)} />}
    {editor !== undefined && <DeckEditor deck={editor} close={() => setEditor(undefined)} saved={load} />}
    {exportParams && <ExportDialog params={exportParams} close={() => setExportParams(null)} notify={notify} />}
    {match && <MatchDialog item={match} close={() => setMatch(null)} saved={load} />}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
