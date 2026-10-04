import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Archive, ArrowDownToLine, ArrowUpDown, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleAlert, Copy, Database, ExternalLink, FileSpreadsheet, FolderOpen, Layers3, LayoutDashboard, Loader2, Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react';
import './styles.css';

type Entry = { id: number; name: string; quantity: number; zone: string; printing_key: string | null; owned: number; available: number; in_other_decks: number; covered: number; assigned: number; missing: number; missing_now: number; estimate: number | null };
type Deck = { id: number; name: string; format: string; active: number; seeded: number; total: number; covered: number; missing: number; missing_now: number; decklist: string; entries: Entry[]; warnings: string[] };
type Card = { key: string; name: string; printing_key: string; set_code: string; collector_number: string; quantity: number; nonfoil: number; foil: number; card_type: string; color: string; rarity: string; value: number | null; priced_copies: number; prices: { nonfoil: number | null; foil: number | null }; decks: string[]; notes: string[]; source_rows: number[]; match_status: string; match_message: string; image_url: string | null; scryfall_url: string | null; oracle_text: string; mana_cost: string; fetched_at: string | null };
type Snapshot = { hosted?: boolean; settings: { workbook_path: string; currency: string; auto_watch: boolean; foil_mode: string; last_import_error: string; last_price_success: string | null }; summary: { copies: number; unique_cards: number; printings: number; foil_copies: number; value: number; priced_copies: number; unresolved: number; issues: number }; decks: Deck[]; last_import: { created_at: string; source: string } | null; pending_import: { id: number; copies: number; rows: number; reductions: { name: string; before: number; after: number; finish: string }[] } | null; price_job: { running: boolean; completed: number; total: number; error: string; message: string } };
type OneDriveStatus = { connected: boolean; email: string | null; connected_at: string | null; workbook: { name: string; path: string | null } | null };
type AppFolderWorkbook = { drive_id: string; item_id: string; name: string; path: string; size: number | null; last_modified: string | null };
type ImportPreview = {
  id: number; unchanged: boolean; applied: boolean; pending_review: boolean; needs_reduction_review: boolean; rows: number; copies: number; issue_count: number;
  issue_samples: { source_row: number; name: string; message: string }[];
  reductions: { name: string; printing_key: string; finish: string; before: number; after: number }[];
};
type Issues = { rows: { id: number; source_row: number; name: string; message: string; raw: Record<string, unknown> }[]; matches: { printing_key: string; name: string; source_rows: string; status: string; message: string }[]; history: { id: number; created_at: string; source: string; status: string }[] };
type ScryCard = { id: string; name: string; set: string; set_name: string; collector_number: string; type_line: string; image_uris?: { small?: string }; card_faces?: { image_uris?: { small?: string } }[] };
type ScryfallSyncResult = { total: number; updated: number; matched: number; needs_review: number; not_found: number; synced_at: string };
type Page = 'overview' | 'collection' | 'decks' | 'review' | 'settings';
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

function deckTargetSize(format: string): number {
  return format === 'commander' ? 100 : 60;
}

function specifiedDeckCards(entries: Entry[]): number {
  return entries.filter((entry) => entry.zone !== 'sideboard').reduce((sum, entry) => sum + entry.quantity, 0);
}

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

function CardDialog({ card, close, currency, findPrinting }: { card: Card; close: () => void; currency: string; findPrinting: () => void }) {
  return <Dialog title={card.name} close={close} wide>
    <div className="card-details">
      <div className="card-art">{card.image_url ? <img src={card.image_url} alt={card.name} /> : <div className="art-empty"><Layers3 size={40} /><span>Card artwork appears after a Scryfall match.</span></div>}</div>
      <div><p className="eyebrow">{card.set_code.toUpperCase()} · #{card.collector_number}</p><p>{card.card_type}</p>{card.oracle_text && <p className="rules-text">{card.oracle_text}</p>}
        <dl className="detail-list"><div><dt>Owned</dt><dd>{card.quantity} copies</dd></div><div><dt>Nonfoil / foil</dt><dd>{card.nonfoil} / {card.foil}</dd></div><div><dt>Nonfoil unit price</dt><dd>{money(card.prices.nonfoil, currency)}</dd></div><div><dt>Foil unit price</dt><dd>{money(card.prices.foil, currency)}</dd></div><div><dt>Known value</dt><dd>{money(card.value, currency)}</dd></div><div><dt>Excel rows</dt><dd>{card.source_rows.join(', ')}</dd></div><div><dt>Price refreshed</dt><dd>{date(card.fetched_at)}</dd></div></dl>
        {card.decks.length > 0 && <><h3>Workbook assignments</h3>{card.decks.map(d => <p className="muted" key={d}>{d}</p>)}</>}
        {card.notes.length > 0 && <><h3>Notes</h3><p className="muted">{card.notes.join(' · ')}</p></>}
        {card.match_status !== 'matched' && <button className="button secondary" onClick={findPrinting}><Search size={15} /> Find printing on Scryfall</button>}
        {card.scryfall_url && <a className="button secondary" href={card.scryfall_url} target="_blank" rel="noreferrer">View on Scryfall <ExternalLink size={14} /></a>}
      </div>
    </div>
  </Dialog>;
}

function normalizedDeckCardName(name: string): string {
  return name.normalize('NFKC').replace(/’/g, "'").toLowerCase().trim().split(/\s+/).filter(Boolean).join(' ');
}

function CollectionFilterFields({
  color, type, setCode, foilOnly, setColor, setType, setSetCode, setFoilOnly, setCodes,
}: {
  color: string; type: string; setCode: string; foilOnly: boolean;
  setColor: (value: string) => void; setType: (value: string) => void; setSetCode: (value: string) => void;
  setFoilOnly: (value: boolean) => void; setCodes: string[];
}) {
  return <>
    <label className="field collection-filter-field">Color<select aria-label="Filter by color" value={color} onChange={event => setColor(event.target.value)}><option value="">All colors</option>{['White', 'Blue', 'Black', 'Red', 'Green', 'Colorless'].map(value => <option key={value}>{value}</option>)}</select></label>
    <label className="field collection-filter-field">Type<select aria-label="Filter by type" value={type} onChange={event => setType(event.target.value)}><option value="">All types</option>{['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Land', 'Planeswalker'].map(value => <option key={value}>{value}</option>)}</select></label>
    <label className="field collection-filter-field">Set<select aria-label="Filter by set" value={setCode} onChange={event => setSetCode(event.target.value)}><option value="">All sets</option>{setCodes.map(code => <option key={code} value={code.toLowerCase()}>{code.toUpperCase()}</option>)}</select></label>
    <label className="foil-toggle"><input type="checkbox" checked={foilOnly} onChange={event => setFoilOnly(event.target.checked)} /><Sparkles size={15} /><span>Foil only</span></label>
  </>;
}

function DeckTargetDialog({
  entry, deckName, ownedCards, close, openOwned,
}: { entry: Entry; deckName: string; ownedCards: Card[]; close: () => void; openOwned: (card: Card) => void }) {
  const [query, setQuery] = useState(entry.name);
  const [results, setResults] = useState<ScryCard[]>([]);
  const [selected, setSelected] = useState<ScryCard | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try { setResults(await api('/cards/search?q=' + encodeURIComponent(query))); }
    catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  return <Dialog title={entry.name} close={close} wide>
    <p className="eyebrow">{deckName} · {zones[entry.zone]}{entry.printing_key ? ` · ${entry.printing_key}` : ' · Any printing'}</p>
    <div className="deck-target-stats"><div><small>Need</small><strong>{entry.quantity}</strong></div><div><small>Owned</small><strong>{entry.owned}</strong></div><div><small>Available</small><strong>{entry.available}</strong></div><div><small>Not in collection</small><strong>{entry.missing}</strong></div><div><small>Short now</small><strong>{entry.missing_now}</strong></div></div>
    <section className="deck-target-owned"><h3>Owned printings</h3>{ownedCards.length ? ownedCards.map(card => <button key={card.key} className="deck-owned-printing" onClick={() => openOwned(card)}><span className="card-thumb">{card.image_url ? <img src={card.image_url} alt="" /> : <Layers3 size={16} />}</span><span><strong>{card.set_code.toUpperCase()} · #{card.collector_number}</strong><small>{card.quantity} owned · {card.nonfoil} nonfoil · {card.foil} foil</small></span><ChevronRight size={16} /></button>) : <p className="muted">No matching printing is currently in the collection.</p>}</section>
    <section className="deck-target-scryfall"><h3>Find on Scryfall</h3><form className="search-row" onSubmit={search}><input aria-label="Search Scryfall for deck card" value={query} onChange={event => setQuery(event.target.value)} /><button className="button secondary" disabled={busy || !query.trim()}>{busy ? <Loader2 size={15} className="spin" /> : <Search size={15} />} Search</button></form>
      {error && <div className="notice danger" role="alert">{error}</div>}
      <div className="search-results">{results.map(card => <button key={card.id} type="button" className="deck-scryfall-result" onClick={() => setSelected(card)}><span className="search-card-preview">{cardImage(card) ? <img src={cardImage(card)!} alt="" loading="lazy" /> : <Layers3 size={18} />}</span><span className="search-card-name"><strong>{card.name}</strong><small>{card.set_name} ({card.set.toUpperCase()}) · #{card.collector_number}</small></span><ChevronRight size={16} /></button>)}</div>
      {selected && <div className="deck-scryfall-preview"><span className="search-card-preview">{cardImage(selected) ? <img src={cardImage(selected)!} alt={selected.name} /> : <Layers3 size={18} />}</span><span><strong>{selected.name}</strong><small>{selected.type_line}</small><a href={`https://scryfall.com/card/${encodeURIComponent(selected.set)}/${encodeURIComponent(selected.collector_number)}`} target="_blank" rel="noreferrer">Open printing on Scryfall <ExternalLink size={13} /></a></span></div>}
    </section>
  </Dialog>;
}

type EditableDeckEntry = { rowKey: string; name: string; quantity: string; zone: 'commander' | 'main' | 'sideboard'; printingKey: string | null; imageUrl: string | null };

function draftKey(): string {
  return crypto.randomUUID();
}

function draftEntriesFromDeck(deck: Deck | null): EditableDeckEntry[] {
  return (deck?.entries || []).map((entry) => ({
    rowKey: `entry-${entry.id}`, name: entry.name, quantity: String(entry.quantity),
    zone: entry.zone as EditableDeckEntry['zone'], printingKey: entry.printing_key, imageUrl: null,
  }));
}

function parseDecklist(text: string): { entries: EditableDeckEntry[]; errors: string[] } {
  const entries: EditableDeckEntry[] = [];
  const errors: string[] = [];
  if (text.length > 200_000) return { entries, errors: ['The decklist exceeds the 200 KB limit.'] };
  let zone: EditableDeckEntry['zone'] = 'main';
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('//')) continue;
    const header = line.replace(/^\/+/, '').replace(/[\[\]:]/g, '').trim().toLowerCase();
    if (['commander', 'commanders', 'command zone', 'sideboard', 'main', 'mainboard', 'deck', 'maindeck'].includes(header)) {
      zone = ['commander', 'commanders', 'command zone'].includes(header) ? 'commander'
        : header === 'sideboard' ? 'sideboard' : 'main';
      continue;
    }
    const match = line.match(/^(\d+)\s*x?\s+(.+)$/i);
    const quantity = match ? Number(match[1]) : NaN;
    if (!match || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100_000) {
      errors.push(`Line ${index + 1}: enter a positive quantity followed by a card name.`);
      continue;
    }
    let name = match[2].trim();
    let printingKey: string | null = null;
    const exact = name.match(/^(.+?)\s+\(([A-Za-z0-9]{2,8})\)\s+([0-9]+[A-Za-z*]*)$/);
    if (exact) {
      name = exact[1].trim();
      const collector = /^\d+$/.test(exact[3]) ? String(Number(exact[3])) : exact[3];
      printingKey = `${exact[2].toLowerCase()}:${collector}`;
    }
    entries.push({ rowKey: draftKey(), name, quantity: String(quantity), zone, printingKey, imageUrl: null });
  }
  return { entries, errors };
}

function serializeDeckEntries(entries: EditableDeckEntry[]): string {
  const lines: string[] = [];
  for (const zone of ['commander', 'main', 'sideboard'] as const) {
    const rows = entries.filter((entry) => entry.zone === zone && entry.name.trim());
    if (!rows.length) continue;
    if (lines.length) lines.push('');
    lines.push(zone === 'commander' ? 'Commander' : zone === 'sideboard' ? 'Sideboard' : 'Deck');
    for (const row of rows) {
      const exact = row.printingKey ? ` (${row.printingKey.split(':')[0].toUpperCase()}) ${row.printingKey.split(':').slice(1).join(':')}` : '';
      lines.push(`${row.quantity} ${row.name.trim()}${exact}`);
    }
  }
  return lines.join('\n');
}

function validateDeckEntries(entries: EditableDeckEntry[]): string[] {
  const errors: string[] = [];
  entries.forEach((entry, index) => {
    if (!entry.name.trim()) errors.push(`Row ${index + 1}: enter a card name.`);
    const quantity = Number(entry.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100_000) {
      errors.push(`Row ${index + 1}: quantity must be a whole number from 1 to 100,000.`);
    }
  });
  return errors;
}

function cardImage(card: ScryCard): string | null {
  return card.image_uris?.small || card.card_faces?.find((face) => face.image_uris?.small)?.image_uris?.small || null;
}

function cardPrintingKey(card: ScryCard): string {
  const collector = /^\d+$/.test(card.collector_number) ? String(Number(card.collector_number)) : card.collector_number;
  return `${card.set.toLowerCase()}:${collector}`;
}

function DeckEditor({ deck, close, saved }: { deck: Deck | null; close: () => void; saved: () => Promise<void> }) {
  const [name, setName] = useState(deck?.name || '');
  const [format, setFormat] = useState(deck?.format || 'commander');
  const [active, setActive] = useState(deck ? Boolean(deck.active) : true);
  const [mode, setMode] = useState<'rows' | 'paste'>('rows');
  const [entries, setEntries] = useState<EditableDeckEntry[]>(() => draftEntriesFromDeck(deck));
  const [list, setList] = useState(deck?.decklist || '');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [query, setQuery] = useState(''), [cards, setCards] = useState<ScryCard[]>([]), [searching, setSearching] = useState(false);
  const parsedPaste = parseDecklist(list);
  const draftRows = mode === 'rows' ? entries : parsedPaste.entries;
  const errors = mode === 'rows' ? validateDeckEntries(entries) : parsedPaste.errors;
  const specified = draftRows.filter((entry) => entry.zone !== 'sideboard').reduce((sum, entry) => sum + (Number(entry.quantity) || 0), 0);
  const target = deckTargetSize(format);
  const duplicateCount = draftRows.filter((entry, index, rows) => rows.findIndex((other) => other.name.trim().toLowerCase() === entry.name.trim().toLowerCase()
    && other.zone === entry.zone && other.printingKey === entry.printingKey) !== index).length;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (errors.length) return;
    setBusy(true); setError('');
    try {
      const decklist = mode === 'rows' ? serializeDeckEntries(entries) : list;
      await api(deck ? `/decks/${deck.id}` : '/decks', deck ? 'PUT' : 'POST', { name, format, active, decklist });
      await saved(); close();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };

  const addCard = (card: ScryCard) => {
    if (mode === 'paste') {
      const exact = ` (${card.set.toUpperCase()}) ${card.collector_number}`;
      setList((current) => `${current.trimEnd()}${current.trim() ? '\n' : ''}1 ${card.name}${exact}`);
      return;
    }
    setEntries((current) => [...current, {
      rowKey: draftKey(), name: card.name, quantity: '1', zone: 'main',
      printingKey: cardPrintingKey(card), imageUrl: cardImage(card),
    }]);
  };

  const changeEntry = (rowKey: string, patch: Partial<EditableDeckEntry>) => {
    setEntries((current) => current.map((entry) => entry.rowKey === rowKey ? { ...entry, ...patch } : entry));
  };

  return <Dialog title={deck ? 'Edit deck' : 'Create a deck'} close={close} wide>
    <form onSubmit={submit}>
      <div className="field-row"><label className="field">Deck name<input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ramos Guildgates" /></label><label className="field">Format<select aria-label="Format" value={format} onChange={e => setFormat(e.target.value)}>{Object.entries(formats).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label></div>
      <label className="checkbox-row"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Reserve copies for this deck when comparing active decks</label>
      <div className="editor-toolbar"><div className="editor-mode" role="tablist" aria-label="Deck entry method"><button type="button" role="tab" aria-selected={mode === 'rows'} className={mode === 'rows' ? 'selected' : ''} disabled={mode === 'paste' && parsedPaste.errors.length > 0} onClick={() => { if (parsedPaste.errors.length) return; setEntries(parsedPaste.entries); setMode('rows'); }}>Edit rows</button><button type="button" role="tab" aria-selected={mode === 'paste'} className={mode === 'paste' ? 'selected' : ''} onClick={() => { setList(serializeDeckEntries(entries)); setMode('paste'); }}>Paste list</button></div>{mode === 'rows' && <button type="button" className="button secondary small" onClick={() => setEntries((current) => [...current, { rowKey: draftKey(), name: '', quantity: '1', zone: 'main', printingKey: null, imageUrl: null }])}><Plus size={15} /> Add card</button>}</div>
      {mode === 'rows' ? <div className="editable-entry-list" aria-label="Editable target card rows">
        {!entries.length && <div className="empty-entries"><Layers3 size={22} /><span>No target cards yet. Add a card or search Scryfall.</span></div>}
        {entries.map((entry, index) => <div className="editable-entry" key={entry.rowKey}>
          <div className="entry-preview">{entry.imageUrl ? <img src={entry.imageUrl} alt={`${entry.name} card preview`} /> : <Layers3 size={20} />}</div>
          <label className="field entry-name">Card name<input aria-label={`Card name row ${index + 1}`} value={entry.name} onChange={e => changeEntry(entry.rowKey, { name: e.target.value })} /></label>
          <label className="field entry-quantity">Qty<input aria-label={`Quantity row ${index + 1}`} type="number" min="1" max="100000" step="1" value={entry.quantity} onChange={e => changeEntry(entry.rowKey, { quantity: e.target.value })} /></label>
          <label className="field entry-zone">Zone<select aria-label={`Zone row ${index + 1}`} value={entry.zone} onChange={e => changeEntry(entry.rowKey, { zone: e.target.value as EditableDeckEntry['zone'] })}><option value="commander">Commander</option><option value="main">Main deck</option><option value="sideboard">Sideboard</option></select></label>
          <button type="button" className="icon-button entry-delete" aria-label={`Remove ${entry.name || `row ${index + 1}`}`} onClick={() => setEntries((current) => current.filter((candidate) => candidate.rowKey !== entry.rowKey))}><Trash2 size={17} /></button>
          {entry.printingKey && <small className="entry-printing">Exact printing: {entry.printingKey}<button type="button" className="text-button" onClick={() => changeEntry(entry.rowKey, { printingKey: null })}>Any printing</button></small>}
        </div>)}
      </div> : <label className="field">Paste or edit decklist<textarea className="decklist-input" value={list} onChange={e => setList(e.target.value)} placeholder={'Commander\n1 Ramos, Dragon Engine\n\nDeck\n1 Sol Ring\n\nSideboard\n1 Arcane Signet'} /></label>}
      <div className={errors.length ? 'editor-validation invalid' : 'editor-validation'} role="status" aria-live="polite">
        {errors.length ? <><strong>{errors.length} list issue{errors.length === 1 ? '' : 's'}</strong><span>{errors.slice(0, 3).join(' ')}</span></> : <><strong>{specified} / {target} cards specified</strong><span>{specified < target ? `${target - specified} slots unspecified; they are not necessarily cards to acquire.` : 'Target list reaches its format size.'}</span></>}
        {duplicateCount > 0 && <small>Duplicate target rows are grouped when saved.</small>}
      </div>
      <details className="lookup"><summary>Find a card on Scryfall</summary><div className="search-row"><input aria-label="Search Scryfall" value={query} onChange={e => setQuery(e.target.value)} placeholder="Card name or Scryfall search" /><button type="button" className="button secondary" disabled={searching || !query.trim()} onClick={async () => { setSearching(true); setError(''); try { setCards(await api('/cards/search?q=' + encodeURIComponent(query))); } catch (e) { setError((e as Error).message); } finally { setSearching(false); } }}>{searching ? <Loader2 className="spin" size={16} /> : <Search size={16} />} Search</button></div><div className="search-results">{cards.map(card => <button key={card.id} type="button" onClick={() => addCard(card)}><span className="search-card-preview">{cardImage(card) ? <img src={cardImage(card)!} alt="" loading="lazy" /> : <Layers3 size={18} />}</span><span className="search-card-name"><strong>{card.name}</strong><small>{card.set_name} ({card.set.toUpperCase()}) · #{card.collector_number}</small></span><Plus size={16} /></button>)}</div></details>
      {error && <div role="alert" className="notice danger">{error}</div>}
      <div className="dialog-actions"><button type="button" className="button secondary" onClick={close}>Cancel</button><button className="button primary" disabled={busy || errors.length > 0 || !name.trim()}>{busy && <Loader2 className="spin" size={16} />} Save deck</button></div>
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
  const [page, setPage] = useState<Page>('overview');
  const [state, setState] = useState<Snapshot | null>(null), [collection, setCollection] = useState<Card[]>([]), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [color, setColor] = useState(''), [type, setType] = useState(''), [setCode, setSetCode] = useState(''), [foilOnly, setFoilOnly] = useState(false), [sort, setSort] = useState('name'), [pagination, setPagination] = useState(0);
  const [card, setCard] = useState<Card | null>(null), [editor, setEditor] = useState<Deck | null | undefined>(undefined), [exportParams, setExportParams] = useState<Record<string, string> | null>(null);
  const [deckId, setDeckId] = useState<number | null>(null), [deckZone, setDeckZone] = useState('all');
  const [deckEntry, setDeckEntry] = useState<{ entry: Entry; deckName: string } | null>(null);
  const [review, setReview] = useState<Issues | null>(null), [match, setMatch] = useState<Issues['matches'][number] | null>(null);
  const [toast, setToast] = useState(''), [busy, setBusy] = useState(false), [workbookPath, setWorkbookPath] = useState('');
  const [collectionError, setCollectionError] = useState(''), [setupCollectionPage, setSetupCollectionPage] = useState(0);
  const [oneDrive, setOneDrive] = useState<OneDriveStatus | null>(null), [workbooks, setWorkbooks] = useState<AppFolderWorkbook[]>([]);
  const [selectedWorkbookKey, setSelectedWorkbookKey] = useState(''), [setupBusy, setSetupBusy] = useState(false), [setupError, setSetupError] = useState(''), [setupMessage, setSetupMessage] = useState('');
  const [scryfallSyncResult, setScryfallSyncResult] = useState<ScryfallSyncResult | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const fileRef = useRef<HTMLInputElement>(null), initialized = useRef(false), toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const notify = useCallback((text: string) => { setToast(text); clearTimeout(toastTimer.current); toastTimer.current = setTimeout(() => setToast(''), 5000); }, []);
  const load = useCallback(async () => {
    const [snapshotResult, cardsResult] = await Promise.allSettled([api<Snapshot>('/state'), api<Card[]>('/collection')]);
    if (cardsResult.status === 'fulfilled') {
      setCollection(cardsResult.value);
      setCollectionError('');
    } else {
      setCollectionError((cardsResult.reason as Error).message);
    }
    if (snapshotResult.status === 'rejected') throw snapshotResult.reason;
    const snapshot = snapshotResult.value;
    setState(snapshot); setError('');
    if (!initialized.current) { setDeckId(snapshot.decks[0]?.id || null); setWorkbookPath(snapshot.settings.workbook_path); initialized.current = true; }
  }, []);
  useEffect(() => { load().catch(e => setError(e.message)); const timer = setInterval(() => load().catch(e => setError(e.message)), 8000); return () => clearInterval(timer); }, [load]);
  useEffect(() => {
    let canceled = false;
    api<OneDriveStatus>('/onedrive/status').then(status => { if (!canceled) setOneDrive(status); })
      .catch(e => { if (!canceled) setSetupError((e as Error).message); });
    return () => { canceled = true; };
  }, []);
  useEffect(() => { setPagination(0); }, [query, color, type, foilOnly, sort]);
  useEffect(() => { if (page === 'review') api<Issues>('/issues').then(setReview).catch(e => setError(e.message)); }, [page, state]);
  const run = async (fn: () => Promise<unknown>, message?: string) => { setBusy(true); setError(''); try { await fn(); await load(); if (message) notify(message); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } };
  const syncScryfall = async () => {
    setBusy(true); setError('');
    try {
      const result = await api<ScryfallSyncResult>('/scryfall/sync', 'POST', {});
      setScryfallSyncResult(result);
      await load();
      notify(`${result.updated} printings synced · ${result.needs_review} need review`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const duplicateDeck = async (source: Deck) => {
    setBusy(true); setError('');
    try {
      const copy = await api<{ id: number }>('/decks', 'POST', {
        name: `${source.name} (copy)`.slice(0, 120), format: source.format, active: false, decklist: source.decklist,
      });
      setDeckId(copy.id);
      await load();
      notify('Deck duplicated as a draft');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const importWorkbook = async () => {
    setBusy(true); setError('');
    try {
      const result = await api<ImportPreview>('/onedrive/import/preview', 'POST', {});
      if (result.unchanged) {
        setImportPreview(result);
        await load();
        notify('Workbook is unchanged');
      } else {
        setImportPreview(result);
        setPage('review');
        notify(result.needs_reduction_review ? 'Review quantity reductions before applying' : 'Review the workbook snapshot before applying');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const scanAppFolder = async () => {
    setSetupBusy(true); setSetupError(''); setSetupMessage('');
    try {
      const result = await api<{ workbooks: AppFolderWorkbook[] }>('/onedrive/workbooks');
      setWorkbooks(result.workbooks);
      setSelectedWorkbookKey(result.workbooks[0] ? `${result.workbooks[0].drive_id}:${result.workbooks[0].item_id}` : '');
      if (!result.workbooks.length) setSetupMessage('No .xlsx files were found in Apps/MTG Vault OneDrive.');
    } catch (e) {
      setSetupError((e as Error).message);
    } finally {
      setSetupBusy(false);
    }
  };
  const pinWorkbook = async () => {
    const workbook = workbooks.find(candidate => `${candidate.drive_id}:${candidate.item_id}` === selectedWorkbookKey);
    if (!workbook) { setSetupError('Choose a workbook from the list.'); return; }
    setSetupBusy(true); setSetupError(''); setSetupMessage('');
    try {
      await api('/onedrive/workbook', 'POST', { drive_id: workbook.drive_id, item_id: workbook.item_id });
      setOneDrive(await api<OneDriveStatus>('/onedrive/status'));
      setWorkbooks([]);
      setImportPreview(null);
      setSetupMessage('Workbook pinned. Its contents have not been imported.');
    } catch (e) {
      setSetupError((e as Error).message);
    } finally {
      setSetupBusy(false);
    }
  };
  const previewWorkbookImport = async () => {
    setSetupBusy(true); setSetupError(''); setSetupMessage(''); setImportPreview(null);
    try {
      const result = await api<ImportPreview>('/onedrive/import/preview', 'POST', {});
      setImportPreview(result);
      if (result.applied) setSetupMessage(result.unchanged ? 'Workbook is unchanged.' : 'Workbook snapshot imported.');
      else setSetupMessage(result.needs_reduction_review ? 'Review quantity reductions before applying this snapshot.' : 'Preview is ready. Confirm to import the workbook snapshot.');
    } catch (e) {
      setSetupError((e as Error).message);
    } finally {
      setSetupBusy(false);
    }
  };
  const applyWorkbookImport = async () => {
    if (!importPreview) return;
    setSetupBusy(true); setSetupError(''); setSetupMessage('');
    try {
      await api(`/onedrive/imports/${importPreview.id}/apply`, 'POST', {});
      setImportPreview({ ...importPreview, applied: true, pending_review: false });
      await load();
      setSetupMessage('Reviewed workbook snapshot applied.');
      notify('Workbook snapshot applied');
    } catch (e) {
      setSetupError((e as Error).message);
    } finally {
      setSetupBusy(false);
    }
  };
  const dismissWorkbookImport = async () => {
    if (!importPreview) return;
    setSetupBusy(true); setSetupError(''); setSetupMessage('');
    try {
      await api(`/onedrive/imports/${importPreview.id}/dismiss`, 'POST', {});
      setImportPreview(null);
      await load();
      setSetupMessage(importPreview.needs_reduction_review ? 'Quantity reductions dismissed; the current collection was kept.' : 'Workbook import cancelled; the current collection was kept.');
    } catch (e) {
      setSetupError((e as Error).message);
    } finally {
      setSetupBusy(false);
    }
  };
  const currency = state?.settings.currency || 'EUR';
  const filtered = collection.filter(c => (!query || `${c.name} ${c.set_code} ${c.card_type}`.toLowerCase().includes(query.toLowerCase())) && (!color || c.color.includes(color)) && (!type || c.card_type.includes(type)) && (!setCode || c.set_code.toLowerCase() === setCode) && (!foilOnly || c.foil > 0)).sort((a, b) => sort === 'quantity' ? b.quantity - a.quantity : sort === 'value' ? (b.value ?? -1) - (a.value ?? -1) : a.name.localeCompare(b.name));
  const activeFilterCount = Number(Boolean(color)) + Number(Boolean(type)) + Number(Boolean(setCode)) + Number(foilOnly);
  const collectionSetCodes = [...new Set(collection.map(item => item.set_code).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  const limit = 35, totalPages = Math.max(1, Math.ceil(filtered.length / limit)), visiblePage = Math.min(pagination, totalPages - 1), visible = filtered.slice(visiblePage * limit, (visiblePage + 1) * limit);
  const setupLimit = 50, setupPages = Math.max(1, Math.ceil(collection.length / setupLimit));
  const visibleSetupCollection = collection.slice(setupCollectionPage * setupLimit, (setupCollectionPage + 1) * setupLimit);
  const setupCopies = collection.reduce((sum, item) => sum + item.quantity, 0);
  const deck = state?.decks.find(d => d.id === deckId) || state?.decks[0];
  const deckEntryOwnedCards = deckEntry ? collection.filter(card => normalizedDeckCardName(card.name) === normalizedDeckCardName(deckEntry.entry.name)
    && (!deckEntry.entry.printing_key || card.printing_key.toLowerCase() === deckEntry.entry.printing_key.toLowerCase())) : [];
  const deckSpecifiedCount = deck ? specifiedDeckCards(deck.entries) : 0;
  const deckTarget = deck ? deckTargetSize(deck.format) : 0;
  const deckListComplete = deckSpecifiedCount >= deckTarget;
  const deckAvailableNow = deck ? Math.max(0, deck.total - deck.missing_now) : 0;
  const nav: { page: Page; label: string; icon: typeof Archive; count?: number }[] = [{ page: 'overview', label: 'Overview', icon: LayoutDashboard }, { page: 'collection', label: 'Collection', icon: Archive }, { page: 'decks', label: 'Decks', icon: Layers3, count: state?.decks.length }, { page: 'review', label: 'Import review', icon: FileSpreadsheet, count: state?.summary.issues }, { page: 'settings', label: 'Settings', icon: Settings2 }];
  if (!state) {
    const connectionResult = new URLSearchParams(window.location.search).get('onedrive');
    const connectionMessage = connectionResult === 'connected' ? 'OneDrive authorization succeeded.'
      : connectionResult === 'wrong-account' ? 'Choose the Microsoft account allowed for this vault.'
        : connectionResult === 'error' ? 'OneDrive authorization failed. Check configuration and try again.' : '';
    return <div className="startup"><div className="brand-symbol"><Layers3 /></div><h1>MTG Vault</h1>
      {connectionMessage && <p role="status">{connectionMessage}</p>}
      <section className="setup-panel" aria-labelledby="onedrive-setup-title">
        <div className="setup-heading"><div><p className="eyebrow">APPS / MTG VAULT ONEDRIVE</p><h2 id="onedrive-setup-title">Workbook selection</h2></div><span className={oneDrive?.connected ? 'status-tag positive' : 'status-tag'}>{oneDrive === null ? 'Checking' : oneDrive.connected ? 'Connected' : 'Not connected'}</span></div>
        {oneDrive === null ? <p className="muted">Checking OneDrive connection…</p> : oneDrive.connected ? <>
          <p className="muted">Connected as {oneDrive.email}. Scan the app folder and pin the workbook to use.</p>
          {oneDrive.workbook && <div className="setup-pinned"><FileSpreadsheet size={18} /><div><strong>{oneDrive.workbook.name}</strong><small>{oneDrive.workbook.path}</small></div><button className="button secondary small" disabled={setupBusy} onClick={scanAppFolder}>Change</button></div>}
          {!workbooks.length && <button className="button secondary" disabled={setupBusy} onClick={scanAppFolder}>{setupBusy ? <Loader2 className="spin" size={16} /> : <FolderOpen size={16} />} {oneDrive.workbook ? 'Choose another workbook' : 'Scan app folder'}</button>}
          {workbooks.length > 0 && <div className="setup-picker"><label className="field">Excel workbook<select aria-label="Excel workbook" value={selectedWorkbookKey} onChange={e => setSelectedWorkbookKey(e.target.value)}>{workbooks.map(file => <option key={`${file.drive_id}:${file.item_id}`} value={`${file.drive_id}:${file.item_id}`}>{file.path}</option>)}</select></label><button className="button primary" disabled={setupBusy || !selectedWorkbookKey} onClick={pinWorkbook}>{setupBusy ? <Loader2 className="spin" size={16} /> : <Check size={16} />} Pin workbook</button></div>}
          {oneDrive.workbook && !workbooks.length && <button className="button primary" disabled={setupBusy} onClick={previewWorkbookImport}>{setupBusy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />} {setupBusy ? 'Reading workbook…' : 'Preview workbook import'}</button>}
          {importPreview && <div className="import-preview" aria-live="polite">
            <div className="import-preview-heading"><strong>{importPreview.unchanged ? 'No workbook changes' : importPreview.applied ? 'Import complete' : importPreview.needs_reduction_review ? 'Review quantity reductions' : 'Import preview'}</strong><span>{importPreview.rows} rows · {importPreview.copies} copies</span></div>
            {importPreview.issue_count > 0 && <div className="import-issues"><strong>{importPreview.issue_count} rows need attention</strong>{importPreview.issue_samples.slice(0, 8).map(issue => <p key={issue.source_row}>Row {issue.source_row}: {issue.name} · {issue.message}</p>)}</div>}
            {importPreview.reductions.length > 0 && <div className="import-reductions"><strong>{importPreview.reductions.length} quantity reductions</strong>{importPreview.reductions.slice(0, 20).map((reduction, index) => <p key={`${reduction.printing_key}-${reduction.finish}-${index}`}>{reduction.name} · {reduction.finish}: {reduction.before} to {reduction.after}</p>)}{importPreview.reductions.length > 20 && <small>Showing 20 reductions.</small>}</div>}
            {importPreview.pending_review && <div className="actions"><button className="button secondary" disabled={setupBusy} onClick={dismissWorkbookImport}>{importPreview.needs_reduction_review ? 'Keep current collection' : 'Cancel import'}</button><button className="button primary" disabled={setupBusy} onClick={applyWorkbookImport}>{setupBusy && <Loader2 className="spin" size={16} />} {importPreview.needs_reduction_review ? 'Apply reductions' : 'Apply snapshot'}</button></div>}
          </div>}
        </> : <><p className="muted">Connect the Microsoft account to list workbooks in the app folder.</p><a className="button primary" href="/auth/microsoft/connect">Connect OneDrive</a></>}
        {setupMessage && <p className="setup-message" role="status">{setupMessage}</p>}
        {setupError && <div className="notice danger" role="alert"><CircleAlert size={16} />{setupError}</div>}
        {error && <div className={error.includes('This hosted API route has not been migrated yet.') ? 'notice warning' : 'notice danger'} role={error.includes('This hosted API route has not been migrated yet.') ? 'status' : 'alert'}><CircleAlert size={16} />{error.includes('This hosted API route has not been migrated yet.') ? 'The hosted collection API is not available yet.' : error}</div>}
      </section>
      {collectionError && <div className="notice danger" role="alert"><CircleAlert size={16} />{collectionError}</div>}
      {collection.length > 0 && <section className="hosted-collection" aria-labelledby="hosted-collection-title">
        <div className="hosted-collection-heading"><div><p className="eyebrow">READ-ONLY WORKBOOK SNAPSHOT</p><h2 id="hosted-collection-title">Collection</h2></div><span>{collection.length.toLocaleString()} printings · {setupCopies.toLocaleString()} copies</span></div>
        <div className="table-panel"><div className="table-scroll"><table><thead><tr><th>Card</th><th>Printing</th><th className="numeric">Owned</th><th className="numeric">Foil</th><th>Assigned to</th></tr></thead><tbody>{visibleSetupCollection.map(item => <tr key={item.key}><td><strong>{item.name}</strong><small>{item.card_type}</small></td><td><span className="set-tag">{item.set_code.toUpperCase()}</span><span className="collector">#{item.collector_number}</span></td><td className="numeric count">{item.quantity}</td><td className="numeric">{item.foil || <span className="muted">—</span>}</td><td><span className="deck-assignment" title={item.decks.join(', ')}>{item.decks.length ? item.decks.join(', ') : <span className="muted">Unassigned</span>}</span></td></tr>)}</tbody></table></div>
          <div className="table-footer"><span>Source: pinned OneDrive workbook</span><div><span>{setupCollectionPage + 1} of {setupPages}</span><button className="icon-button" disabled={setupCollectionPage === 0} aria-label="Previous collection page" onClick={() => setSetupCollectionPage(setupCollectionPage - 1)}><ChevronLeft size={18} /></button><button className="icon-button" disabled={setupCollectionPage + 1 >= setupPages} aria-label="Next collection page" onClick={() => setSetupCollectionPage(setupCollectionPage + 1)}><ChevronRight size={18} /></button></div></div>
        </div>
      </section>}
    </div>;
  }

  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><div className="brand-symbol"><Layers3 size={23} /></div><div><strong>MTG Vault</strong><span>COLLECTION WORKSPACE</span></div></div>
      <div className="nav-label">YOUR CARDS</div><nav aria-label="Main navigation">{nav.map(n => <button key={n.page} className={page === n.page ? 'nav-item active' : 'nav-item'} onClick={() => setPage(n.page)} aria-current={page === n.page ? 'page' : undefined}><n.icon size={19} /><span>{n.label}</span>{Boolean(n.count) && <span className="nav-count">{n.count}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><ShieldCheck size={20} /><div><strong>{state.hosted ? 'Hosted collection' : 'Local collection'}</strong><span>{state.hosted ? 'OneDrive snapshot + D1' : 'Excel + saved decklists'}</span></div></div>
    </aside>
    <div className="main-shell"><header className="topbar"><div><span className="breadcrumb">Workspace</span><span className="breadcrumb-divider">/</span><strong>{nav.find(n => n.page === page)?.label}</strong></div><div className="topbar-status"><Database size={14} /><span>{state.hosted ? 'D1 storage' : 'SQLite storage'}</span></div></header>
      <main>
        {error && <div role="alert" className="notice danger"><CircleAlert size={18} /><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="Dismiss error"><X size={16} /></button></div>}
        {state.settings.last_import_error && <div className="notice warning"><CircleAlert size={18} /><span>Workbook refresh: {state.settings.last_import_error}. Your last successful import is preserved.</span></div>}
        {state.pending_import && <div className="notice warning"><CircleAlert size={18} /><span>A saved workbook reduces existing quantities. Review {state.pending_import.reductions.length} changes before applying.</span><button className="text-button" onClick={() => setPage('review')}>Review changes</button></div>}

        {page === 'overview' && <>
          <div className="page-heading"><h1>Overview</h1><button className="button primary" aria-label="Browse collection" onClick={() => setPage('collection')}><Archive size={16} /><span>Browse collection</span></button></div>
          <div className="metrics"><div className="metric"><span>Owned copies <Archive size={16} /></span><strong>{state.summary.copies.toLocaleString()}</strong><small>{state.summary.foil_copies} foil copies</small></div><div className="metric"><span>Unique cards <Layers3 size={16} /></span><strong>{state.summary.unique_cards.toLocaleString()}</strong><small>{state.summary.printings} distinct printings</small></div><div className="metric"><span>Known collection value <Sparkles size={16} /></span><strong>{state.summary.priced_copies ? money(state.summary.value, currency) : '—'}</strong><small>{state.summary.priced_copies} of {state.summary.copies} copies priced · {currency}</small></div><button className="metric review-metric" onClick={() => setPage('review')}><span>Import issues <CircleAlert size={16} /></span><strong>{state.summary.issues}</strong><small>{state.summary.unresolved} printings awaiting a match</small></button></div>
          <div className="overview-meta"><span>Last imported {date(state.last_import?.created_at)}</span><span>{state.decks.filter(item => item.active).length} active decks · {state.decks.length} total</span></div>
        </>}

        {page === 'collection' && <>
          <h1 className="sr-only">Collection</h1>
          <div className="table-panel collection-panel"><div className="table-toolbar collection-toolbar"><label className="search-field"><Search size={18} /><input aria-label="Search collection" placeholder="Search cards, sets, or types…" value={query} onChange={e => setQuery(e.target.value)} />{query && <button aria-label="Clear search" className="icon-button" onClick={() => setQuery('')}><X size={15} /></button>}</label><div className="collection-inline-filters"><CollectionFilterFields color={color} type={type} setCode={setCode} foilOnly={foilOnly} setColor={setColor} setType={setType} setSetCode={setSetCode} setFoilOnly={setFoilOnly} setCodes={collectionSetCodes} /></div><details className="filter-menu"><summary className="filter-trigger"><SlidersHorizontal size={16} /><span>Filters</span>{activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}</summary><div className="filter-popover"><CollectionFilterFields color={color} type={type} setCode={setCode} foilOnly={foilOnly} setColor={setColor} setType={setType} setSetCode={setSetCode} setFoilOnly={setFoilOnly} setCodes={collectionSetCodes} />{activeFilterCount > 0 && <button type="button" className="text-button clear-filters" onClick={() => { setColor(''); setType(''); setSetCode(''); setFoilOnly(false); }}>Clear filters</button>}</div></details><div className="actions collection-header-actions"><button className="button secondary" aria-label="Export collection" onClick={() => setExportParams({ kind: 'collection' })}><ArrowDownToLine size={16} /><span>Export</span></button><button className="button primary" aria-label="Refresh workbook" disabled={busy} onClick={importWorkbook}><RefreshCw size={16} className={busy ? 'spin' : ''} /><span>Refresh workbook</span></button></div></div>
            {activeFilterCount > 0 && <div className="active-filters" aria-label="Active filters">{color && <button className="active-filter-chip" onClick={() => setColor('')}>{color}<X size={13} /><span className="sr-only">Remove color filter</span></button>}{type && <button className="active-filter-chip" onClick={() => setType('')}>{type}<X size={13} /><span className="sr-only">Remove type filter</span></button>}{setCode && <button className="active-filter-chip" onClick={() => setSetCode('')}>{setCode.toUpperCase()}<X size={13} /><span className="sr-only">Remove set filter</span></button>}{foilOnly && <button className="active-filter-chip" onClick={() => setFoilOnly(false)}>Foil only<X size={13} /><span className="sr-only">Remove foil filter</span></button>}<button className="clear-active-filters" onClick={() => { setColor(''); setType(''); setSetCode(''); setFoilOnly(false); }}>Clear all</button></div>}
            <div className="table-caption"><span>{filtered.length} printings <span className="muted">· {filtered.reduce((n, c) => n + c.quantity, 0)} copies</span></span><label><ArrowUpDown size={14} /><select aria-label="Sort collection" value={sort} onChange={e => setSort(e.target.value)}><option value="name">Name</option><option value="quantity">Quantity</option><option value="value">Known value</option></select></label></div>
            <div className="table-scroll collection-desktop-table"><table><thead><tr><th>Card</th><th>Printing</th><th className="numeric">Owned</th><th className="numeric">Foil</th><th>Assigned to</th><th className="numeric">Known value</th></tr></thead><tbody>{visible.map(c => <tr key={c.key}><td><button className="card-cell" onClick={() => setCard(c)}><div className={'card-thumb ' + c.color.split(',')[0].toLowerCase()}>{c.image_url ? <img src={c.image_url} alt="" loading="lazy" /> : <Layers3 size={17} />}</div><span><strong>{c.name}</strong><small>{c.card_type}</small></span></button></td><td><span className="set-tag">{c.set_code.toUpperCase()}</span><span className="collector">#{c.collector_number}</span></td><td className="numeric count">{c.quantity}</td><td className="numeric">{c.foil ? <span className="foil-number"><Sparkles size={12} /> {c.foil}</span> : <span className="muted">—</span>}</td><td><span className="deck-assignment" title={c.decks.join(', ')}>{c.decks.length ? c.decks.length === 1 ? c.decks[0] : `${c.decks.length} decks` : <span className="muted">Unassigned</span>}</span></td><td className="numeric"><span>{money(c.value, currency)}</span>{c.value !== null && c.priced_copies < c.quantity && <small className="partial">Partial</small>}</td></tr>)}</tbody></table></div>
            <div className="collection-mobile-list">{visible.map(c => <button key={c.key} className="collection-mobile-row" aria-label={`${c.name}, ${c.quantity} owned, ${c.set_code.toUpperCase()} ${c.collector_number}`} onClick={() => setCard(c)}><div className={'card-thumb ' + c.color.split(',')[0].toLowerCase()}>{c.image_url ? <img src={c.image_url} alt="" loading="lazy" /> : <Layers3 size={17} />}</div><span className="collection-mobile-info"><span className="collection-mobile-title"><strong>{c.name}</strong><span className="collection-mobile-count"><b>{c.quantity}</b><small>owned{c.foil ? ` · ${c.foil} foil` : ''}</small></span></span><span className="collection-mobile-meta"><span className="mobile-printing"><span className="set-tag">{c.set_code.toUpperCase()}</span><span className="collector">#{c.collector_number}</span></span><span className="mobile-assignment">{c.decks.length ? c.decks.join(', ') : 'Unassigned'}</span></span></span><ChevronRight size={16} className="collection-mobile-chevron" /></button>)}</div>
            {!visible.length && <div className="empty"><Search size={28} /><h3>No matching cards</h3><p>Change your filters or import your workbook.</p></div>}
            <div className="table-footer"><span>Last imported {date(state.last_import?.created_at)}</span><div><span>{visiblePage + 1} of {totalPages}</span><button className="icon-button" disabled={visiblePage === 0} aria-label="Previous page" onClick={() => setPagination(visiblePage - 1)}><ChevronLeft size={18} /></button><button className="icon-button" disabled={visiblePage + 1 >= totalPages} aria-label="Next page" onClick={() => setPagination(visiblePage + 1)}><ChevronRight size={18} /></button></div></div>
          </div><div className="source-footer"><FileSpreadsheet size={15} /><span>Source: Input worksheet</span><span className="separator-dot">·</span><span>Ownership is edited in Excel</span><button className="text-button" onClick={() => setPage('settings')}>Change workbook</button></div>
        </>}

        {page === 'decks' && <>
          <div className="page-heading"><h1>Decks</h1><button className="button primary" aria-label="New deck" onClick={() => setEditor(null)}><Plus size={16} /><span>New deck</span></button></div>
          {!state.decks.length ? <div className="empty table-panel"><Layers3 size={34} /><h3>Your first deck starts here</h3><p>Paste a decklist to see which cards you already own.</p><button className="button primary" onClick={() => setEditor(null)}>Create a deck</button></div> : <div className="deck-layout"><div className="deck-selector">{state.decks.map(d => { const specified = specifiedDeckCards(d.entries); const target = deckTargetSize(d.format); const complete = specified >= target; return <button className={d.id === deck?.id ? 'deck-tile selected' : 'deck-tile'} key={d.id} onClick={() => { setDeckId(d.id); setDeckZone('all'); }}><div><span className="format-tag">{formats[d.format]}</span><span className={d.active ? 'active-label' : 'muted'}>{d.active ? 'Reserved' : 'Draft'}</span></div><strong>{d.name}</strong><div className="progress" role="progressbar" aria-label={`${d.name} target list completeness`} aria-valuenow={Math.min(specified, target)} aria-valuemin={0} aria-valuemax={target}><span style={{ width: `${Math.min(100, specified / target * 100)}%` }} /></div><small>{d.covered} / {d.total} listed copies owned <span className={complete ? 'complete-label' : 'incomplete-label'}>{complete ? 'Target list complete' : `Target list incomplete · ${specified} / ${target}`}</span></small></button>; })}</div>
            {deck && <section className="deck-detail table-panel"><div className="deck-heading"><div><span className="format-tag">{formats[deck.format]}</span>{Boolean(deck.seeded) && <span className="status-tag">Workbook seed</span>}<h2>{deck.name}</h2></div><div className="actions"><button className="button secondary small" onClick={() => setExportParams({ kind: 'deck', deck_id: String(deck.id) })}><ArrowDownToLine size={14} /> Export</button><button className="button secondary small" onClick={() => duplicateDeck(deck)} disabled={busy}><Copy size={14} /> Duplicate</button><button className="button secondary small" onClick={() => setEditor(deck)}>Edit deck</button></div></div>
              <div className={deckListComplete ? 'list-completeness complete' : 'list-completeness incomplete'} role="status"><div>{deckListComplete ? <CheckCircle2 size={18} /> : <CircleAlert size={18} />}<strong>{deckListComplete ? 'Target list complete' : 'Target list incomplete'}</strong></div><p>{deckSpecifiedCount} / {deckTarget} cards specified. {deckListComplete ? 'Unowned listed cards are shown separately below.' : `${deckTarget - deckSpecifiedCount} slots are unspecified; they are not necessarily cards to acquire.`}</p></div>
              <div className="deck-stats"><div><strong>{deckSpecifiedCount} / {deckTarget}</strong><span>Cards specified</span></div><div><strong className="positive">{deck.covered} / {deck.total}</strong><span>Listed copies owned</span></div><div><strong className={deck.missing_now ? 'amber-text' : ''}>{deckAvailableNow} / {deck.total}</strong><span>Available now</span></div></div>
              <div className="deck-options"><label className="checkbox-row"><input type="checkbox" checked={Boolean(deck.active)} onChange={e => run(() => api(`/decks/${deck.id}/active`, 'POST', { active: e.target.checked }))} /> Reserve copies for this deck</label><select aria-label="Deck zone" value={deckZone} onChange={e => setDeckZone(e.target.value)}>{Object.entries(zones).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></div>
              <div className="table-scroll"><table className="deck-table"><thead><tr><th>Card</th><th className="numeric">Need</th><th className="numeric">Own</th><th className="numeric">Available</th><th className="numeric">Other decks</th><th className="numeric">To acquire</th></tr></thead><tbody>{deck.entries.filter(e => deckZone === 'all' || e.zone === deckZone).map(e => <tr key={e.id}><td><button className="deck-card-cell" aria-label={`View ${e.name} target details`} onClick={() => setDeckEntry({ entry: e, deckName: deck.name })}><Layers3 size={16} /><span><strong>{e.name}</strong><small>{zones[e.zone]}{e.printing_key && ` · ${e.printing_key}`}</small></span></button></td><td className="numeric">{e.quantity}</td><td className="numeric">{e.owned}</td><td className="numeric">{e.available}</td><td className="numeric">{e.in_other_decks || '—'}</td><td className="numeric">{e.missing ? <span className="missing-badge" title="Copies not in your collection">{e.missing}</span> : e.missing_now ? <span title="Owned but reserved elsewhere" className="amber-text">Move {e.missing_now}</span> : <Check size={16} className="positive inline-icon" />}</td></tr>)}</tbody></table></div>
              <details className="deck-warnings"><summary><CircleAlert size={15} /> {deck.warnings.length} format checks to review <ChevronDown size={14} /></summary><ul>{deck.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul><p className="hint">Checks are advisory. Pairing, companion, and card-specific exceptions may require manual review.</p></details>
              <div className="deck-bottom"><button className="text-button danger-text" onClick={() => { if (confirm(`Delete ${deck.name}? A database backup will be saved.`)) run(() => api(`/decks/${deck.id}`, 'DELETE'), 'Deck deleted'); }}><Trash2 size={14} /> Delete deck</button></div>
            </section>}
          </div>}
        </>}

        {page === 'review' && (state.hosted ? <>
          <div className="page-heading"><h1>Import review</h1><button className="button primary" aria-label="Preview workbook" disabled={busy || setupBusy} onClick={importWorkbook}>{busy || setupBusy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />}<span>Preview workbook</span></button></div>
          {state.pending_import && !importPreview && <section className="review-panel table-panel"><h2>Workbook preview awaiting review</h2><p className="muted">The staged workbook contains {state.pending_import.rows} rows and {state.pending_import.copies} copies. Reload it to inspect the complete preview.</p><button className="button primary" disabled={setupBusy} onClick={previewWorkbookImport}>{setupBusy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />} Load current preview</button></section>}
          {importPreview && <section className="review-panel table-panel"><h2>{importPreview.unchanged ? 'Workbook is unchanged' : importPreview.applied ? 'Workbook snapshot applied' : importPreview.needs_reduction_review ? 'Quantity reductions awaiting approval' : 'Workbook snapshot preview'}</h2><p className="muted">{importPreview.rows} populated rows · {importPreview.copies} owned copies · {importPreview.issue_count} rows need attention.</p>
            {importPreview.issue_samples.map(issue => <div className="source-issue" key={issue.source_row}><div className="row-number">{issue.source_row}</div><div><strong>{issue.name}</strong><p>{issue.message}</p></div></div>)}
            {importPreview.reductions.length > 0 && <div className="table-scroll"><table><thead><tr><th>Card</th><th>Finish</th><th className="numeric">Before</th><th className="numeric">After</th></tr></thead><tbody>{importPreview.reductions.map((reduction, index) => <tr key={`${reduction.printing_key}-${reduction.finish}-${index}`}><td>{reduction.name}</td><td>{reduction.finish}</td><td className="numeric">{reduction.before}</td><td className="numeric amber-text">{reduction.after}</td></tr>)}</tbody></table></div>}
            {setupError && <div className="notice danger" role="alert">{setupError}</div>}
            {importPreview.pending_review && <div className="actions"><button className="button secondary" disabled={setupBusy} onClick={dismissWorkbookImport}>{importPreview.needs_reduction_review ? 'Keep current inventory' : 'Cancel import'}</button><button className="button primary" disabled={setupBusy} onClick={applyWorkbookImport}>{setupBusy && <Loader2 className="spin" size={16} />} {importPreview.needs_reduction_review ? 'Apply reductions' : 'Apply snapshot'}</button></div>}
          </section>}
          <section className="review-panel table-panel"><h2>Workbook rows <span className="count-label">{review?.rows.length || 0}</span></h2><p className="muted">Rows that need correction remain visible here and are excluded from owned totals when their quantities are invalid.</p>{review?.rows.map(row => <div className="source-issue" key={row.id}><div className="row-number">{row.source_row}</div><div><strong>{row.name}</strong><p>{row.message}</p><small>Input worksheet · Count: {String(row.raw.Count ?? '(blank)')} · Set: {String(row.raw.Set ?? '(blank)')} · Collector: {String(row.raw['Set#'] ?? '(blank)')}</small></div></div>)}{review && !review.rows.length && <p className="positive"><CheckCircle2 size={16} className="inline-icon" /> No invalid source rows</p>}</section>
          <section className="review-panel table-panel"><div className="section-heading"><h2>Printing matches <span className="count-label">{review?.matches.length || 0}</span></h2></div><p className="muted">Confirm the exact Scryfall edition for a collection printing. Corrections are saved in D1 and do not edit the workbook.</p><div className="match-list">{review?.matches.map(item => <div className="match-row" key={item.printing_key}><div><strong>{item.name}</strong><small>{item.printing_key} · rows {item.source_rows}</small>{item.message && <p>{item.message}</p>}</div><span className="status-tag">{item.status.replace('_', ' ')}</span><button className="button secondary small" onClick={() => setMatch(item)}>Find printing</button></div>)}</div>{review && !review.matches.length && <p className="positive"><CheckCircle2 size={16} className="inline-icon" /> All collection printings have confirmed Scryfall matches</p>}</section>
        </> : <>
          <div className="page-heading"><h1>Import review</h1><button className="button primary" aria-label="Refresh workbook" disabled={busy} onClick={importWorkbook}><RefreshCw size={16} /><span>Refresh workbook</span></button></div>
          {state.pending_import && <section className="review-panel table-panel"><h2>Quantity changes awaiting approval</h2><p className="muted">The new snapshot has {state.pending_import.copies} known copies across {state.pending_import.rows} rows. Deck targets will be preserved.</p><div className="table-scroll"><table><thead><tr><th>Card</th><th>Finish</th><th className="numeric">Before</th><th className="numeric">After</th></tr></thead><tbody>{state.pending_import.reductions.map((r, i) => <tr key={i}><td>{r.name}</td><td>{r.finish}</td><td className="numeric">{r.before}</td><td className="numeric amber-text">{r.after}</td></tr>)}</tbody></table></div><div className="actions"><button className="button secondary" onClick={() => run(() => api(`/import/${state.pending_import!.id}/dismiss`, 'POST'), 'Import dismissed')}>Keep current inventory</button><button className="button primary" onClick={() => run(() => api(`/import/${state.pending_import!.id}/apply`, 'POST'), 'New snapshot applied')}><Check size={16} /> Apply snapshot</button></div></section>}
          <section className="review-panel table-panel"><h2>Workbook rows <span className="count-label">{review?.rows.length || 0}</span></h2><p className="muted">Fix these cells in Excel and save. Unknown quantities are excluded from owned totals.</p>{review?.rows.map(r => <div className="source-issue" key={r.id}><div className="row-number">{r.source_row}</div><div><strong>{r.name}</strong><p>{r.message}</p><small>Input worksheet · Count: {String(r.raw.Count ?? '(blank)')} · Set: {String(r.raw.Set ?? '(blank)')} · Collector: {String(r.raw['Set#'] ?? '(blank)')}</small></div></div>)}{review && !review.rows.length && <p className="positive"><CheckCircle2 size={16} className="inline-icon" /> No invalid source rows</p>}</section>
          <section className="review-panel table-panel"><div className="section-heading"><h2>Printing matches <span className="count-label">{review?.matches.length || 0}</span></h2><button className="button secondary small" disabled={state.price_job.running} onClick={() => run(() => api('/prices/refresh', 'POST'), 'Scryfall refresh started')}><RefreshCw size={14} className={state.price_job.running ? 'spin' : ''} /> Match with Scryfall</button></div><p className="muted">Prices are shown only after a printing is matched. Name mismatches require confirmation.</p><div className="match-list">{review?.matches.slice(0, 50).map(m => <div className="match-row" key={m.printing_key}><div><strong>{m.name}</strong><small>{m.printing_key} · rows {m.source_rows}</small>{m.message && <p>{m.message}</p>}</div><span className="status-tag">{m.status.replace('_', ' ')}</span><button className="button secondary small" onClick={() => setMatch(m)}>Find printing</button></div>)}</div>{review && review.matches.length > 50 && <p className="hint">Showing the first 50 unresolved printings. Matching with Scryfall processes the full collection.</p>}</section>
        </>) }

        {page === 'settings' && (state.hosted ? <>
          <div className="page-heading"><h1>Settings</h1></div>
          <section className="settings-panel table-panel hosted-onedrive-settings"><div className="section-heading"><h2><FileSpreadsheet size={20} /> OneDrive workbook</h2><span className={oneDrive?.connected ? 'status-tag positive' : 'status-tag'}>{oneDrive?.connected ? 'Connected' : 'Not connected'}</span></div>
            <p className="muted">The Worker requests access to the MTG Vault AppFolder. It reads the selected workbook by pinned item ID; app-to-Excel writes are not enabled yet.</p>
            {oneDrive?.connected ? <><div className="setup-pinned"><FileSpreadsheet size={18} /><div><strong>{oneDrive.workbook?.name || 'No workbook pinned'}</strong><small>{oneDrive.workbook?.path || 'Choose a workbook in the app folder'}</small></div><button className="button secondary small" disabled={setupBusy} onClick={scanAppFolder}>Change</button></div>
              {workbooks.length > 0 && <div className="setup-picker"><label className="field">Excel workbook<select aria-label="Excel workbook" value={selectedWorkbookKey} onChange={event => setSelectedWorkbookKey(event.target.value)}>{workbooks.map(file => <option key={`${file.drive_id}:${file.item_id}`} value={`${file.drive_id}:${file.item_id}`}>{file.path}</option>)}</select></label><button className="button secondary" disabled={setupBusy || !selectedWorkbookKey} onClick={pinWorkbook}>Pin workbook</button></div>}
              <div className="actions"><button className="button primary" disabled={busy || setupBusy || !oneDrive.workbook} onClick={importWorkbook}>{busy || setupBusy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />} Preview workbook update</button>{!oneDrive.workbook && <button className="button secondary" disabled={setupBusy} onClick={scanAppFolder}><FolderOpen size={16} /> Scan app folder</button>}</div>
            </> : <a className="button primary" href="/auth/microsoft/connect">Connect OneDrive</a>}
            <div className="actions"><a className="button secondary" href="/api/export?kind=collection&amp;format=csv"><ArrowDownToLine size={16} /> Export inventory CSV</a></div>
            {setupError && <div className="notice danger" role="alert"><CircleAlert size={16} />{setupError}</div>}
          </section>
          <section className="settings-panel table-panel"><div className="section-heading"><h2><Sparkles size={20} /> Scryfall card data and prices</h2><span className="status-tag positive">Search available</span></div>
            <p className="muted">Scryfall search needs no account connection. Sync fetches the exact set/collector printing data and price fields. Exact name matches are confirmed automatically; name mismatches and missing printings remain in Import Review.</p>
            <dl className="detail-list"><div><dt>Last sync</dt><dd>{date(state.settings.last_price_success)}</dd></div><div><dt>Matched printings</dt><dd>{state.summary.printings - state.summary.unresolved} / {state.summary.printings}</dd></div><div><dt>Copies with prices</dt><dd>{state.summary.priced_copies} / {state.summary.copies}</dd></div></dl>
            <div className="actions"><button className="button primary" disabled={busy} onClick={syncScryfall}>{busy ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />} Sync card data and prices</button>{scryfallSyncResult && scryfallSyncResult.needs_review + scryfallSyncResult.not_found > 0 && <button className="button secondary" onClick={() => setPage('review')}>Review {scryfallSyncResult.needs_review + scryfallSyncResult.not_found} printings</button>}</div>
            {scryfallSyncResult && <p className="sync-result" role="status">{scryfallSyncResult.updated} updated · {scryfallSyncResult.matched} matched · {scryfallSyncResult.needs_review} need review · {scryfallSyncResult.not_found} not found</p>}
          </section>
        </> : <>
          <div className="page-heading"><h1>Settings</h1></div>
          <div className="settings-layout"><section className="settings-panel table-panel"><div className="section-heading"><h2><FileSpreadsheet size={20} /> Excel workbook</h2><span className="status-tag">Input only</span></div><p className="muted">Use the full path to your original workbook to follow saved changes. The included workbook is a starting snapshot.</p><form onSubmit={e => { e.preventDefault(); run(async () => { await api('/settings', 'PATCH', { workbook_path: workbookPath }); await api('/import', 'POST', { path: workbookPath }); }, 'Workbook connected'); }}><label className="field">Workbook path<input value={workbookPath} onChange={e => setWorkbookPath(e.target.value)} placeholder="/Users/you/Documents/MagicTheGatheringInventory.xlsx" spellCheck={false} /></label><div className="actions"><button className="button primary" disabled={busy}><FolderOpen size={16} /> Connect workbook</button><button type="button" className="button secondary" onClick={() => fileRef.current?.click()}>Upload snapshot</button></div></form><input ref={fileRef} type="file" accept=".xlsx" hidden onChange={async e => { const file = e.target.files?.[0]; if (!file) return; await run(async () => { const response = await fetch('/api/upload', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }); const data = await response.json(); if (!response.ok) throw new Error(data.detail); setWorkbookPath(data.applied ? data.applied.source || '' : ''); const s = await api<Snapshot>('/state'); setWorkbookPath(s.settings.workbook_path); }, 'Workbook snapshot imported'); e.target.value = ''; }} /><label className="checkbox-row"><input type="checkbox" checked={state.settings.auto_watch} onChange={e => run(() => api('/settings', 'PATCH', { auto_watch: e.target.checked }))} /> Refresh automatically after Excel saves</label><div className="convention"><strong>Your import convention</strong><p>Count = all copies. Foil = foil copies within that total. Blank Foil = 0. Excel stays the ownership source.</p></div><p className="hint">Unsaved edits are not visible. Uploads are copies and do not follow the original file. Reductions require review.</p></section>
            <section className="settings-panel table-panel"><h2><Sparkles size={20} /> Card data and prices</h2><label className="field">Display currency<select aria-label="Display currency" value={currency} onChange={e => run(() => api('/settings', 'PATCH', { currency: e.target.value }))}><option value="EUR">EUR · Euro</option><option value="USD">USD · US dollar</option></select></label><p className="muted">Scryfall data is cached locally. Stale prices refresh daily while the app runs.</p><dl className="detail-list"><div><dt>Matched printings</dt><dd>{state.summary.printings - state.summary.unresolved} / {state.summary.printings}</dd></div><div><dt>Priced copies</dt><dd>{state.summary.priced_copies} / {state.summary.copies}</dd></div><div><dt>Last successful refresh</dt><dd>{date(state.settings.last_price_success)}</dd></div></dl><button className="button primary" disabled={state.price_job.running} onClick={() => run(() => api('/prices/refresh?force=true', 'POST'), 'Price refresh started')}><RefreshCw size={16} className={state.price_job.running ? 'spin' : ''} /> {state.price_job.running ? `Refreshing ${state.price_job.completed}/${state.price_job.total}` : 'Refresh card data and prices'}</button>{state.price_job.error && <div className="notice warning">{state.price_job.error}</div>}<p className="hint">Indicative marketplace prices, matched to printing and finish. Unknown prices are never counted as zero-value cards.</p></section>
            <section className="settings-panel table-panel"><h2><Database size={20} /> Backups and exports</h2><p className="muted">Decks, matching corrections, cached prices, and import history live in a local SQLite database. Backups are saved before replacing inventory or deleting decks.</p><div className="actions"><a className="button secondary" href="/api/backup"><ArrowDownToLine size={16} /> Download database backup</a><a className="button secondary" href="/api/export?kind=collection&format=csv"><ArrowDownToLine size={16} /> Inventory CSV</a></div><p className="hint">To restore a database backup, stop the app and follow the instructions in README.md. Keep your Excel workbook backed up separately.</p></section>
          </div>
        </>) }
      </main>
      <footer className="app-footer"><span><span className="connection-indicator" /> Workbook {state.last_import ? 'imported' : 'not imported'} · {date(state.last_import?.created_at)}</span><button className="text-button" onClick={() => setPage('settings')}>{state.hosted ? <><Search size={13} /> Scryfall lookup · {state.settings.last_price_success ? `synced ${date(state.settings.last_price_success)}` : 'not synced'}</> : state.price_job.running ? <><Loader2 size={13} className="spin" /> Scryfall {state.price_job.completed}/{state.price_job.total}</> : <><RefreshCw size={13} /> {state.price_job.error ? 'Price refresh unavailable · cached data retained' : 'Prices: ' + date(state.settings.last_price_success)}</>}</button></footer>
    </div>
    {toast && <div className="toast" role="status"><CheckCircle2 size={18} />{toast}</div>}
    {card && <CardDialog card={card} currency={currency} close={() => setCard(null)} findPrinting={() => { setMatch({ printing_key: card.printing_key, name: card.name, source_rows: card.source_rows.join(', '), status: card.match_status, message: card.match_message }); setCard(null); }} />}
    {deckEntry && <DeckTargetDialog entry={deckEntry.entry} deckName={deckEntry.deckName} ownedCards={deckEntryOwnedCards} close={() => setDeckEntry(null)} openOwned={ownedCard => { setDeckEntry(null); setCard(ownedCard); }} />}
    {editor !== undefined && <DeckEditor deck={editor} close={() => setEditor(undefined)} saved={load} />}
    {exportParams && <ExportDialog params={exportParams} close={() => setExportParams(null)} notify={notify} />}
    {match && <MatchDialog item={match} close={() => setMatch(null)} saved={load} />}
  </div>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
