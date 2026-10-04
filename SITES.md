# MTG Vault on Sites

This hosted version is maintained on **`sites/mtg-vault`** in [pmerrild/mtg_collection](https://github.com/pmerrild/mtg_collection/tree/sites/mtg-vault). The original local application remains on `main`. Make hosted changes on this branch when using other tools.

Sites keeps a separate publication repository. Publishing synchronizes this branch's reviewed source to the site's publication repository; GitHub branch pushes alone do not automatically deploy. Site identity is in `.openai/hosting.json`; reuse it for updates and never register a replacement site.

## Architecture and data

The original React/Vite interface is reused. `worker/` ports the Python import and allocation rules to Cloudflare Workers. D1 stores durable inventory, deck targets, matching corrections, imports, and cached card data. R2 keeps workbook uploads and JSON backups. Schema-only migrations are generated from `db/schema.ts` by Drizzle. Inventory mutations use revision checks to prevent a stale tab from overwriting another update.

The private initial inventory and original workbook acceptance fixture are `MagicTheGatheringInventory.xlsx`, and differs from the synthetic sample workbook: 679 populated Input rows, 892 known copies, 48 foil copies, 607 names, 655 printing/name groups. Row 253 is quarantined for blank Count and unconfirmed numeric Set. Repeated rows remain separate holdings. Count includes foil; blank Foil means zero. EUR is the default; USD is selectable.

Inventory is imported into private runtime storage, never committed to this public GitHub branch. The optional initial snapshot is supplied as a compressed Sites secret and applied once on the first app request; it also saves a source snapshot in R2. Later uploads use the normal workbook workflow. A hosted site cannot watch files on a Mac. Save Excel, then use **Import workbook** or Settings → **Upload workbook**. Only Input is read. Imports are complete snapshots, so an unchanged file adds no copies. Every changed snapshot requires full review of additions, removals, quantities, finishes, invalid rows, and affected decks before applying. Target decklists and printing corrections survive imports. Limits: 4 MB compressed workbook, 24 MB expanded ZIP contents, 20,000 Input rows, and 1.2 MB parsed snapshot. Oversize and failed imports keep the previous inventory.

The five workbook deck labels seed proposed targets. Their owned assignments cannot establish missing unowned targets; enter your intended decklists. Commander and ruleset warnings are advisory; special commander pairings and card exceptions may need manual review.

Scryfall is called directly with batch size 75, queued requests, bounded retries and backoff. Prices are cached per printing and finish. Refresh occurs daily while the app is used, with a manual refresh control. Missing prices remain unknown. TXT exports guarantee quantity/name syntax only; designate commander and sideboard manually in Scryfall or export each zone separately. Scryfall account synchronization is not implemented.

Settings provides full JSON backup download, saved backup browsing, validated restore previews, and recovery of individual deck revisions or deleted decks. R2 stores backups before inventory replacement, deletion, reservation changes, and restores; deck revisions are saved before edits, deletion, and revision restoration. JSON backups include inventory, targets, corrections, cached cards, history, saved views, locations, keep preferences, and acquisition records. Restore validates the backup and its references, previews replacement impact, and writes state/cache atomically with a revision guard. Old version-1 JSON backups are upgraded without resetting existing data. Editing a deck uses its opening revision to reject stale saves.

## UX roadmap implementation

- Deck library/details distinguish target completeness, entered-target ownership, reservation-aware availability, and advisory format checks. The seeded Ramos list displays 19 entered cards and 81 unspecified slots; unspecified slots are never acquisitions.
- Lower numeric priority reserves first. Explicit compatible copy transfers show source/destination shortages before saving and preserve quantity, printing, and finish. Priority changes clear manual transfers and recompute assignments. Imports also recompute reservations against the accepted ownership snapshot.
- Excel Deck annotations remain source labels. Planned reservations and manually entered binder/box/deck locations are independent app fields. A location describes a printing/name group and can mention several places; per-copy serial tracking is not implied.
- Matching is searchable/filterable and paginated across the entire queue. Failed requests, unchecked identities, missing printings, and conflicts are distinct. Import history shows source, status, fingerprint, and totals for the latest 100 records; earlier workspace history can be recovered from backups.
- Deck editing supports quantity/name rows, zones, optional printing/finish constraints, card lookup/previews, reviewed bulk replacement, duplication as a draft, immediate validation, and unsaved-change protection. All zones/constraints survive revisions.
- Collection filters combine groups with AND; colors/types can match any or all selections, and sets/rarities match any selection. Finish, reservation coverage, exact matching status, price coverage, deck requirements, storage, owned-copy ranges, lowest known owned-finish unit price, and known printing value are independent. Unknown prices are excluded by ranges and can be viewed separately. Prices follow the display currency; a printing value can be partial. Active chips remove filters. URLs preserve filters/sort; saved views preserve sort and migrate the earlier string-valued filters. Artwork grids and double-faced-card previews remain available from cached Scryfall data.
- Selection persists across pages and clears when filters/sort change. Select a page or all results, then export TXT/CSV or review bulk changes to location, minimum copies to keep, or wanted records. A bulk operation supports 1–1,000 distinct printing/name keys; all keys and the opening revision must validate before one save. No bulk operation edits Excel ownership. Acquisition capacity remains 500 records, with one new record per selected printing even if it is already tracked.
- Duplicates count a card identity across printings. Trade candidates protect the union of current reservations and allocation across all saved deck targets, including inactive decks. Unfilled targets protect every owned copy of that identity to leave room for rearranging flexible requirements. Keep preferences set a minimum total per printing/name group, defaulting to one. Candidate quantity is `max(0, owned − max(deck-protected, keep))`; protected copies overlap the minimum rather than being counted twice. This deliberately conservative policy does not account for unspecified target slots or future plans. Review exact retained finishes and physical locations before trading.
- Collection UI and exports share one filter/sort implementation. TXT combines names. Trade exports use candidate quantities; CSV explicitly labels owned finish counts, owned priced-copy counts, and owned value so these are not mistaken for trade valuations. Selected exports use a POST body rather than an oversized URL. Optional JSON fields upgrade lazily; no SQL migration or runtime secret change is required.
- Analysis reports nonland mana curve, known land count, card-type counts, and printed mana-symbol requirements. It excludes sideboard and explicitly counts cards with unavailable metadata.
- Acquisition records move between wanted, ordered, and received. These records never modify ownership or reduce the ownership wishlist. Record actual receipts in Excel and import the complete saved workbook.
- Mobile collection uses compact rows and a shared Manage menu. Only Collection, Decks, Review, and Settings are primary navigation destinations. Dialogs have accessible names, native focus containment, Escape dismissal, and return focus; text contrast, control sizes, and keyboard focus were improved.

## Four-section interface

**Collection, Decks, Review, and Settings** are the only primary destinations. Collection is the landing page. A slim top bar replaces the global sidebar, breadcrumbs, and status footer; there is no Overview/dashboard. The shell occupies the viewport with one scrolling main region. The shared visual language uses one neutral light/dark working background, horizontal rules, consistent typography, and compact controls. Enclosed surfaces are reserved for editable controls, menus, and dialogs. Decorative icons and nested card borders/shadows are removed; emerald marks actions, focus, and selection.

Collection shows cards immediately, with Search, Filters, Sort, and Display in a compact sticky toolbar. All cards/Duplicates/Trade are in Filters, and Set progress stays inside Collection. The shared selection bar remains reachable when choosing lower rows; page selection has a native mixed state. Pagination focuses and scrolls to the next page's first result. Tables have explicit column budgets and switch to compact rows based on available panel width. Optional columns and long filter/name content do not create horizontal overflow. Manage holds export, reload, and workbook import and provides a visible focus-return target.

Decks opens a compact library, then a card-first detail page. Incomplete targets remain explicit: unspecified slots are not cards to buy. Edit list opens an inline working page with Save/Cancel, name/format, Add/Find/Paste, and direct card name/quantity/zone rows. Optional printing/finish constraints and detailed deck options expand on demand. Newly added rows receive focus. Missing lists, multi-deck comparisons, and purchases remain subordinate Decks views. Detailed options retain exports, revisions, reservation previews/transfers, analysis, advisory format checks, and guarded deletion.

Editing uses the opening revision and retains unsaved-change protection. Pending saves disable editing and prevent navigation, including an unchanged save. Rejected saves keep the draft and show an error beside Save; a later successful validation cannot erase that failure. DOM and keyboard order match the visible editor order.

Settings separates Preferences, Data & prices, and Recovery. Light, Dark, and System are buttons only in Preferences. Appearance/display choices are browser-local; currency applies across the vault. Data & prices links to the relevant Review view. Recovery loads on demand and separates collection backups from deck revisions. Deep links update the panel even while Settings is already open.

Review has Workbook and Matching views. Workbook shows pending changes/affected decks, accepted-source issues, and collapsed history; raw source cells are expandable. Matching shows search/status, individual correction actions, and refresh progress. Loading does not imply zero issues; failed review reads offer Retry. Matching queries persist in URLs and pagination focuses the current results. Uploads open Workbook directly. The matching dialog retains its opening revision, and failed workspace actions reveal/focus the error after long scrolling.

Legacy `#overview` falls back to Collection, `#settings?section=data&review=1` opens Review → Workbook, and `#missing` opens Decks comparison or the specified deck's Missing tab. Existing Collection bookmarks and Set progress links remain supported.

## Set completion

Collection has Cards and Set progress subpages. Set progress groups accepted ownership by edition code. Explicit loading uses Scryfall's complete paginated English paper printing catalog including variants. Duplicate copies and foil/nonfoil count once; token/supplemental editions with separate codes remain separate. Completion and missing count require a complete catalog and exact verified owned identities. Otherwise they remain unknown while verified ownership and unresolved counts are visible; Missing browsing is disabled. Invalid workbook rows are excluded from accepted ownership and flagged.

Validated catalogs are cached under `set-catalogs/<code>.json` in R2. Fetching is bounded to 40 pages/10,000 entries, validates scope/IDs/numbers/counts and next-page URLs, and writes only after full validation. Failed/partial refreshes retain previous complete data. These public catalog caches are auxiliary, separate from vault backups; restored ownership recomputes progress. No SQL, bindings, secrets, or inventory migration is required.

## Appearance and collection refinements

System / Light / Dark applies before first paint, follows OS changes in System mode, and remembers a manual choice in this browser. Appearance and collection display preferences are device-local; inventory remains server-backed. Density, layout, and optional columns persist independently of saved filter views.

Filters are draft changes in a native desktop side panel/mobile sheet. Apply commits them; Cancel/Escape preserves active filters. Saved views load into the draft. Search Sets by code; selected sets remain visible even when the search hides their options. The selected Actions sheet offers all-result selection after partial selection and supports the same 1,000-printing bound. Details Previous/Next result uses the ordered result context and opening revision, protects dirty locations during details and browser/route navigation, and resets artwork faces. Cancelled route navigation preserves the current filter URL. Missing results are keyed to selected decks, usage mode, revision, and currency; outdated results cannot be exported or tracked. Request failures offer Retry.

Bulk location/keep updates offer a persistent Undo until another workspace change or 15 minutes. The server keeps an opaque expiring token in R2 and requires its exact revision before restoring earlier fields, including absence/default values. Undo tokens are transient and are not included in vault backups. A new bulk update replaces the displayed undo affordance; wanted records retain their existing reviewed flow. No change writes ownership, changes SQL, or changes production bootstrap secrets.

## Capacity and future growth

The current bounded JSON workspace remains compatible with existing production state. Capacity failures preserve the last accepted inventory, and the importer no longer suggests splitting ownership across uploads. Workbook formatting/unused sheets can be removed without omitting Input holdings. Full restore previews accept bounded backup payloads (16 MB); state must still fit the 1.8 MB workspace limit.

If real inventory growth reaches these limits, introduce immutable snapshot IDs with holding/issue rows in D1, move deck requirements and auxiliary app data to separate tables, stage the entire Input inventory in bounded batches, and switch the active snapshot only in a guarded transaction after count/finish/identity validation. Keep prior snapshots recoverable and page the UI/API reads. Migrate the existing vault and R2 backups with a verified round trip before increasing upload limits. Never concatenate partial replacement uploads or silently drop rows.

Source and release steps: work on `sites/mtg-vault`, build and run the checks below, preview with disposable local D1/R2, commit the reviewed source, synchronize the same commit to the existing Site publication repository, package the matching Worker/client/migrations, and publish that saved version privately. Schema changes must append migrations; this release upgrades optional JSON fields and needs no new SQL migration. Do not alter runtime bootstrap secrets or reset production storage.

## Development

Requires Node 22+.

```sh
npm ci
npm --prefix frontend ci
npm test
npm run build
npm run test:api
python tests/roadmap_browser.py --url http://127.0.0.1:4180 # disposable seeded preview only
npm run db:generate # only after schema changes
npm run build
npx wrangler d1 execute DB --local --config dist/server/wrangler.json --file drizzle/0000_tense_human_fly.sql
npx wrangler dev --local --config dist/server/wrangler.json
```

Production is private through Sites access controls. Keep that audience when publishing. Runtime data is excluded from Git. Append migrations after publishing; never rewrite applied migrations.
