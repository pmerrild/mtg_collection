export type Reservation = {
  deck_id: number;
  name: string;
  printing_key?: string;
  finish: string;
  quantity: number;
};
export type Entry = {
  id: number;
  name: string;
  quantity: number;
  zone: string;
  printing_key: string | null;
  finish?: string | null;
  owned: number;
  available: number;
  in_other_decks: number;
  covered: number;
  assigned: number;
  missing: number;
  missing_now: number;
  estimate: number | null;
  reserved_by: Reservation[];
  card?: {
    image_url?: string;
    type_line: string;
    mana_value: number;
    color_identity: string[];
    mana_cost: string;
  } | null;
};
export type Deck = {
  id: number;
  name: string;
  format: string;
  active: number;
  priority: number;
  seeded: number;
  source_label?: string;
  list_confirmed: boolean;
  total: number;
  covered: number;
  missing: number;
  missing_now: number;
  decklist: string;
  entries: Entry[];
  warnings: string[];
  readiness: {
    list: {
      complete: boolean;
      confirmed: boolean;
      entered: number;
      target: number;
      unspecified: number;
      label: string;
    };
    ownership: { covered: number; required: number };
    availability: { short: number };
    format: { status: string };
  };
  analysis: {
    curve: number[];
    types: Record<string, number>;
    colors: Record<string, number>;
    lands: number;
    known: number;
    unknown: number;
  };
};
export type Card = {
  key: string;
  name: string;
  printing_key: string;
  set_code: string;
  collector_number: string;
  quantity: number;
  nonfoil: number;
  foil: number;
  card_type: string;
  color: string;
  rarity: string;
  value: number | null;
  priced_copies: number;
  prices: { nonfoil: number | null; foil: number | null };
  decks: string[];
  notes: string[];
  source_rows: number[];
  match_status: string;
  match_message: string;
  image_url: string | null;
  image_faces: { name: string; url: string }[];
  scryfall_url: string | null;
  oracle_text: string;
  mana_cost: string;
  fetched_at: string | null;
  price_state: string;
  reservations: Reservation[];
  reserved: number;
  needed_by: number[];
  location: string;
};
export type Change = {
  name: string;
  printing_key: string;
  before: number;
  after: number;
  finish: string;
  kind?: string;
  source_rows?: number[];
};
export type Impact = {
  id: number;
  name: string;
  before: number | null;
  after: number;
};
export type SourceIssue = {
  id?: number;
  source_row: number;
  name: string;
  message: string;
  raw: Record<string, unknown>;
};
export type Order = {
  id: string;
  name: string;
  quantity: number;
  printing_key: string;
  finish: string | null;
  status: string;
  notes: string;
  updated_at: string;
};
export type Snapshot = {
  revision: number;
  settings: {
    workbook_path: string;
    currency: string;
    last_import_error: string;
    last_price_success: string | null;
  };
  summary: {
    copies: number;
    unique_cards: number;
    printings: number;
    foil_copies: number;
    value: number;
    priced_copies: number;
    unresolved: number;
    issues: number;
  };
  decks: Deck[];
  last_import: { created_at: string; source: string } | null;
  pending_import: {
    id: string;
    copies: number;
    rows: number;
    source: string;
    before_copies: number;
    reductions: Change[];
    changes?: Change[];
    issues?: SourceIssue[];
    affected_decks?: Impact[];
  } | null;
  price_job: {
    running: boolean;
    completed: number;
    total: number;
    error: string;
    message: string;
  };
  saved_filters: {
    id: string;
    name: string;
    filters: Record<string, string>;
  }[];
  acquisitions: Order[];
};
export type Wish = {
  items: {
    name: string;
    printing_key: string | null;
    finish?: string | null;
    quantity: number;
    estimate: number | null;
    decks: string[];
  }[];
  copies: number;
  estimate: number;
  priced_copies: number;
};
export type Issues = {
  rows: SourceIssue[];
  matches: {
    printing_key: string;
    name: string;
    source_rows: string;
    status: string;
    message: string;
  }[];
  history: {
    id: string;
    created_at: string;
    source: string;
    status: string;
    fingerprint?: string;
    copies?: number;
    rows?: number;
  }[];
};
export type ScryCard = {
  id: string;
  name: string;
  set: string;
  set_name: string;
  collector_number: string;
  type_line: string;
  image_uris?: { small?: string };
  card_faces?: { image_uris?: { small?: string } }[];
};
export type Run = (
  fn: () => Promise<unknown>,
  message?: string,
) => Promise<boolean>;
export type ViewProps = {
  state: Snapshot;
  run: Run;
  busy: boolean;
  reload: () => Promise<void>;
};
export const formats: Record<string, string> = {
  commander: "Commander",
  casual60: "Casual 60-card",
  standard: "Standard",
  modern: "Modern",
  pioneer: "Pioneer",
  legacy: "Legacy",
  vintage: "Vintage",
  pauper: "Pauper",
};
export const zones: Record<string, string> = {
  commander: "Command zone",
  main: "Main deck",
  sideboard: "Sideboard",
};
