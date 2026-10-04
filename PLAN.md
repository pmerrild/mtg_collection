# MTG collection and deck tracker: implementation plan and UX roadmap

This plan guided the first local implementation and now includes the roadmap for the private MTG Vault site. The local app includes workbook import and watching, collection browsing, durable decklists, missing-card comparisons, Scryfall integration with caching, text/CSV exports, and backups. The hosted version reuses the interface and runs a Worker backend with D1/R2 persistence and manual workbook uploads. See README.md and VALIDATION.md for the local app, and SITES.md and SITES_VALIDATION.md for the hosted implementation and verified scope. Live Scryfall access and launch of the local app on an actual Mac remain to be checked.

The site version lives on its own GitHub branch, `sites/mtg-vault`, so other tools can work independently of `main`. The private site is https://mtg-vault-collection.peter-nielsen22.chatgpt.site. A GitHub branch update does not automatically publish a new Site version.

Confirmed implementation preferences: macOS; Input is the full inventory; Count includes all copies; Foil is the number of foil copies within Count. EUR is the initial display currency and can be changed to USD in Settings.

## Simple Review and shared visual language — 2026-10-05

The latest user request restores **Review** alongside **Collection, Decks, and Settings**, while simplifying the whole platform further. This supersedes the three-destination navigation decision in the previous reset. Collection remains the landing page; Overview remains removed.

- Review is one primary destination with two focused views. Workbook shows pending replacement changes and affected decks, source issues, and closed import history. Matching shows one search/status toolbar and a plain list of printings to check. Raw source fields and history details stay subordinate.
- Uploads open Workbook directly. Settings and set-progress links open the relevant Review view. Older embedded Settings review links redirect to Workbook. Matching search/status survive reload and Back/Forward; pagination returns focus to the results.
- Use one neutral working background in light/dark, quiet horizontal rules, consistent titles and compact controls. Remove nested card surfaces, inherited shadows/rounded list rows, decorative action/section icons, repeated framing, and large appearance tiles. Light/Dark/System remain a compact text-button group in Settings.
- Keep loading distinct from confirmed zero source issues and unchecked printings distinct from failed/conflicting matches. A failed review fetch has Retry. Applying always replaces the complete Input snapshot, including changes outside the current search/page; retain explicit consequences, backups, targets, corrections, and guarded writes.
- Matching dialogs capture their opening revision so a later background refresh cannot allow an old dialog to overwrite a newer correction. Failed workspace actions reveal and focus their error even after scrolling through a long review; pending imports remain intact.

Independent UI and UX critics agreed with the direction. The UI critic approved the flat visual system and four-label mobile navigation. The UX critic independently found the offscreen rejected-Apply message; it was fixed and tested with a long unfiltered snapshot. Validation covers seven browser suites and 38 domain/API checks, including both themes, laptop/mobile widths, 200% text, loading/failure/retry, controlled upload/full-snapshot apply, query navigation, and stale matching confirmation. All test changes use disposable local storage or browser-only fixtures.

Continue within these four sections. No new dashboard, charts, or speculative feature expansion is part of this release.

## Earlier simplification reset — 2026-10-04 (Review placement superseded)


The user's request to cut the platform down to **Collection, Decks, and Settings** supersedes the earlier dashboard and navigation roadmap below. This release revamps the working interface on `sites/mtg-vault`; it does not expand the feature backlog.

- Only three primary destinations in a slim shared top bar. Collection is the landing page. Remove Overview, the global side navigation, breadcrumbs, and status footer. Keep one bounded content scroll within the laptop viewport.
- Collection puts card names and owned quantities first. Search, Filters, Sort, and Display share a compact sticky toolbar. All cards/Duplicates/Trade live in Filters; Set progress remains a Collection subpage. Remove repetitive metadata and empty artwork placeholders. Optional columns, saved views, selection, exports, and reviewed bulk actions remain available.
- Decks starts with a compact library. Selecting a deck shows its card list immediately, with an honest entered-target/unspecified summary. Edit list opens a working page with direct name/quantity/zone rows, Add/Find/Paste, and visible Save/Cancel. Printing constraints and detailed deck options are expandable. Missing cards, comparisons, and purchases stay inside Decks.
- Settings groups Preferences, Data & prices, and Recovery. Light, Dark, and System remain buttons in Preferences. Workbook review, matching corrections, source issues, and import history live under Data & prices. Old Review/Missing/Overview bookmarks redirect to their current homes.
- Quiet neutral light/dark surfaces, shared controls, readable spacing, and responsive card rows replace the crowded interface. Narrow laptop widths receive the same attention as desktop and phone sizes.
- Preserve ownership, revision checks, confirmations, import review, recovery, reservation previews, and dirty navigation protection. During a save, fields are disabled and navigation is blocked. A rejected save retains its draft and a visible message beside Save; late validation cannot erase the failure.

Separate independent UI and UX critics reviewed the redesign and re-reviewed corrections. Their findings prompted narrower table budgets, responsive rows at intermediate widths, compact density fixes, native partial-selection state, sticky selection actions, pagination focus/scroll recovery, correct editor reading order, focus on newly added rows, and persistent save failures. Both approved the final workflows without a remaining blocker.

Acceptance: all 38 deterministic domain/API checks and six Chromium browser suites pass on disposable local data. The new working-interface suite covers eight sizes from 1366 × 768 to 360 × 640 in both actual themes, long filters/names, optional columns, a 100-card editor, dirty/busy/rejected-save flows, legacy links, and unchanged ownership. Existing suites cover 200% text, keyboard/focus, imports, filters/exports, Undo, revision recovery, acquisitions, stale writes, and set catalogs. See SITES_VALIDATION.md for limits.

Continue from actual use of these three sections. Do not reintroduce a dashboard or add speculative tools after acceptance. Source-data completeness and live Scryfall verification remain separate outstanding work.

## Earlier platform structure, Overview, and set completion — 2026-10-04 (superseded navigation)


Historical release notes: the stricter second review found structural problems that the earlier control improvements missed: crowded Settings, a green-tinted dark theme, an unbounded document, and no useful landing page. Independent UI and UX critics agreed on this revision, implemented on `sites/mtg-vault`:

- Bounded viewport workspace with scrolling inside `main` and shared headings, surfaces, navigation, and controls. Collection has one vertical content scroll and sticky search. Mobile has six visible destinations, readable 14 px navigation, and a shared Manage menu; its first card appears before 480 px at 390 × 844.
- Neutral graphite dark surfaces and quiet light surfaces; emerald identifies actions and selection. Light, Dark, and System are buttons only in Settings → Preferences. Browser-local persistence, first-paint behavior, OS switching, and cross-tab synchronization remain intact.
- Settings separates Preferences, Data & prices, and Recovery. Recovery loads on demand and separates collection backups from deck revisions. Same-page deep links update the displayed section; invalid sections fall back to Preferences. Everyday choices lead, with implementation explanations in secondary disclosures.
- Overview is the default landing page and dashboard: known ownership, unique names/printings, known value with priced-copy coverage, complete confirmed decks ready to assemble, actionable failures, quiet data coverage, deck actions, workbook freshness, and acquisition record counts. No invented trends, unknown values shown as zero, summed overlapping shortages, or incomplete decks labeled ready.
- Collection → Set progress uses a complete validated Scryfall catalog of English paper printings including variants. Duplicate copies and foil/nonfoil count once; separate token/supplemental edition codes have separate checklists. Load/refresh is explicit. Percentage and missing count stay unknown until every included owned printing is verified. Invalid workbook rows are excluded and visibly flagged. Verified checklists offer All/Missing printings and paging.
- Auxiliary R2 set catalogs replace prior data only after full validation; partial/invalid/unsafe/failed fetches preserve the previous complete checklist. No SQL migration, ownership edit, secret change, or production reset.

Independent review caught wrong-panel Settings links, misleading set-load/failure copy, inconsistent collection actions, excess mobile spacing, and dialog focus returning to a hidden menu item. These were corrected and re-reviewed. Regression checks also corrected the sticky toolbar position in the new scrolling container. Both critics approved that earlier structure. Mobile set explanation length is minor remaining polish.

Acceptance includes domain/API checks, five sizes in both themes, every destination/Settings section, internal scroll bounds, 200% text, keyboard navigation/focus return, System persistence, existing editing/recovery/export/filter/Undo workflows, and provisional/offline/verified set states. See SITES_VALIDATION.md for results and limits.

Next work needs trustworthy source facts: resolve the invalid workbook row, confirm exact printing matches/live price coverage, and enter complete intended decklists. Then evaluate physical assembly, receipt reconciliation, and condition/language/etched-finish conventions with actual examples. Do not fill the dashboard with speculative charts or extend scope after acceptance.

## Earlier UI review and collection refinement — 2026-10-04

Implemented and reviewed on `sites/mtg-vault`:

- System / Light / Dark appearance applies before the interface renders. System follows OS changes; a manual preference persists in this browser. Shared emerald accents now use distinct accessible surfaces, text, controls, and severity colors across all five pages and dialogs.
- Collection search stays in a short sticky toolbar. Filters use a desktop side panel or mobile sheet with draft changes, preview counts, Apply, Reset, and Cancel. Saved views load into the draft and wait for Apply. Set-code search shows a selected count, keeps selected sets visible as removable chips, and explains empty option results.
- Selecting printings retains one compact bar with count, Clear, and Actions. The Actions sheet includes Select all results even after a partial selection. Card name and owned count lead each row; browser-local display preferences control list/grid, comfortable/compact density, and optional location, reservations, Excel labels, and value details.
- Unchecked matching and unknown prices are neutral; failed/missing printings use amber, and identity conflicts use red. Actual metadata adds labeled mana, rarity, and foil information. Artwork only comes from the existing cache. Empty results expose reset; initial loading has a named state and cached results remain visible during refresh.
- Printing details provide Previous/Next result, position, exact printing identity, and disabled boundaries. Navigation follows the ordered results and revision captured when details opens, resets artwork face, and guards unsaved location changes, including browser Back and route changes. Cancelling navigation retains the complete filter URL. A later workspace change causes a stale save to fail safely.
- Reviewed bulk location and keep changes expose persistent Undo across page navigation. Undo restores previous values, including absent defaults, and is guarded by the exact saved revision and a 15-minute expiry. Another workspace change invalidates it. Ownership remains exclusively from Excel Input. The affordance explains the time/change limit.

- Missing results belong to the selected decks, usage mode, and current workspace revision. Changed queries hide obsolete rows immediately; pending/failed requests block export and row-derived wanted tracking, expose status and Retry, and ignore late obsolete responses. Valid results stay visible during a refresh of the same query.

The independent UI critic agreed with the core direction, identified stretched desktop thumbnails, disappearing Select all after partial selection, and saved views bypassing drafts. Those defects were corrected. The critic also independently agreed with set search and captured-context printing navigation, which were implemented in a second pass. A second, independent UX critic confirmed a route-change loss of unsaved locations and stale Missing results during changed/failed requests. A final pass corrected both, clarified result-navigation wording, and explained Undo limits. Stop adding speculative features after acceptance; prioritize actual data quality and confirmed daily workflows.

Both independent critics agreed with the final fixes and found no remaining concrete UI/UX blocker. Future UI work: consider collapsible filter groups to reduce mobile scrolling and edition names only where verified names already exist in the card cache. These are backlog items, not implemented in this release.

Next priorities require source facts: fix the invalid Plains row after confirming quantity/edition; enter complete intended targets; confirm live Scryfall matching/prices. Then investigate a workbook-label versus reservation comparison and explicit physical deck assembly status with real examples. Grouping every printing beneath one card is deferred because selection, finish constraints, location, protection, and trade exports must retain exact printing identity. Multi-copy physical tracking, condition/language/etched finish, and receipt reconciliation need explicit data conventions before implementation.

## Collection workflow release — 2026-10-04

Implemented on the dedicated `sites/mtg-vault` branch:

- Advanced filters combine groups with AND. Colors and card types support any/all selection; sets and rarities support multiple selections. Quantity, lowest known owned-finish unit price, and known printing-value ranges are available. Finish, reservation coverage, exact matching status, price coverage, deck requirement, and location remain independent filters.
- Removable active-filter chips, printing/copy counts, bookmarkable collection URLs, and saved views including sort. Legacy foil/unresolved/unreserved saved views still work. Price limits exclude unknown values; known zero prices remain valid. Numeric range errors are visible. Mobile filters scroll in a bounded panel with a result button.
- Select a page or all matching results (up to 1,000 printings), keep selections across pagination, review selected printings, then export TXT/CSV, replace storage locations, set a keep minimum, or add wanted acquisition records. Changing filters or sort clears selection. Bulk writes validate the entire selection and opening revision before one atomic save. They never change owned quantities.
- Duplicates include identical cards across printings, using matched identity when available. Trade candidates protect current reservations and an allocation across every saved deck target, including inactive decks. If any target for a card remains short, every copy of that identity stays protected to allow rearrangement. A per-printing minimum defaults to one; candidates equal owned minus the larger of deck protection or that minimum. A minimum can exceed current ownership without inventing copies.
- Trade TXT/CSV exports use candidate quantities. CSV labels owned finish counts and owned valuation explicitly. Trade candidates are suggestions: unspecified deck slots, future plans, condition, exact finishes to retain, and physical card movements still need review.
- Keep preferences persist in full backups and gain an empty default when restoring older backups. The SQL schema, private sharing, and Excel ownership convention remain unchanged.

Next work should improve real-data completeness: correct and reimport the invalid Plains source row after confirming its quantity/edition; enter and confirm complete deck targets; validate live Scryfall matching/prices in the running site. After that, add reconciliation between workbook Deck annotations and app reservations, and explicit per-deck physical assembly status if useful. These items require actual inventory/target information and are not inferred from the imported labels.

## Original local-app recommendation

Build a local application that runs on your computer and opens in your browser. Keep Excel as the authoritative collection source. Store intended deck lists, allocation decisions, card matches, and cached Scryfall data in a local SQLite database. Make the first version useful without AI running in the application.

Proposed stack: React and TypeScript for the interface; Python and FastAPI for the local service; openpyxl for Excel; SQLite for saved data. These are recommendations, not dependencies already installed on your computer. Package startup behind one script or shortcut after your operating system is known. Start and stop the backend together with the app, listening on localhost only.

The application must run on your own computer to watch its files. This chat's uploaded workbook is a snapshot and does not provide continuing access to your local file.

## What the workbook establishes

The uploaded `Input` worksheet has an Excel table named `Input`, covering A1:J680. Its columns are Name, Type, Color, Rarity, Set#, Set, Count, Foil, Notes, and Deck.

- 679 populated data rows and 607 distinct name strings.
- Known Count values sum to 892 copies. One quantity is blank, so 892 is not a verified complete inventory total.
- All rows have a name, set, and collector number.
- Foil has 633 blanks, 44 values of 1, and two values of 2. In particular, a Forest row has Count 4 and Foil 2. The confirmed convention is a foil-copy count within Count, with blank Foil treated as zero.
- Five deck labels exist. Cloud, Sephiroth, Angels, and Black Vampires each sum to 60 copies. Ramos Guildgate Commander sums to 19.
- 21 name/set/collector-number/foil keys occur on multiple rows. Repeated rows may represent separate copies or assignments; they must not be discarded automatically.
- Row 253 is Plains, with a blank Count and numeric Set value 8. It needs a quantity and confirmation of the edition. Do not silently replace 8 with a guessed Scryfall code.
- `Collection` is backed by a Power Query connection and contains 652 rows with quantities totaling 1,758. It is a different saved view from `Input`; its totals cannot be substituted for the authoritative input total.

Import `Input` only. Keep all other worksheets untouched. Input is confirmed as the full inventory; the invalid row still prevents treating the known quantity total as complete.

## Ownership and update rules

| Information | Authority |
| --- | --- |
| Owned quantities, physical printing, finish, notes | Excel Input |
| Intended deck lists, format, commander, sideboard | Application database |
| Existing Deck labels | Imported source annotations; proposed initial assignments |
| Card identity, images, rules text, legality, indicative prices | Scryfall, cached locally |
| Copy allocations between decks | Application database, reconciled after each import |

Begin with one-way synchronization. Editing ownership happens in Excel; editing deck targets happens in the app. Do not write back to the workbook in the first version.

On setup, select or configure the workbook path. Import its saved contents, then watch saves with debouncing and retry handling for Excel's temporary files and locked files. Unsaved edits cannot be observed. Also provide an explicit Refresh button.

The path and watcher workflow above applies to the local app. The hosted site imports uploaded saved workbooks and cannot watch a file on your Mac. Reloading the hosted collection only reloads saved app data; importing a newer workbook requires an upload.

Every import is a complete snapshot, not a batch of extra purchases. Reimporting the same file must leave quantities unchanged. Keep original row values and row numbers for diagnostics; row numbers are not permanent inventory identifiers. Store a content fingerprint and import history. Preview quantity reductions or removed entries before accepting them, especially when they affect allocated cards.

Validate quantities, foil counts, and required columns. Quarantine incomplete rows with a clear explanation rather than assuming a missing Count means 1 or 0. Preserve the last good import if Excel is locked or a read fails. Persist corrections to identity matching separately so they survive future imports of the same source key.

Under the confirmed foil-copy convention, split each source row into nonfoil = Count − Foil and foil = Foil, treating blank Foil as zero. Preserve finishes as separate holdings. Additional languages, conditions, etched finishes, and locations can be supported later if you need them.

## Card matching and valuation

Use the set code and collector number to resolve a printing. Preserve the raw collector number; normalize numeric padding when appropriate for Scryfall, and retain meaningful suffixes. Check the returned name as a safeguard. Show ambiguous or inconsistent results in a review queue; fuzzy search should suggest candidates for approval.

Store both the Scryfall printing ID and the Oracle ID. A printing ID identifies the edition being valued; an Oracle ID normally identifies the underlying card for deck requirements. Let a deck accept any printing by default, with an optional exact-printing requirement. Handle double-faced and split cards explicitly.

Use Scryfall's public HTTP API directly. A Scryfall MCP is not required for the application. Planned integration points:

- Card collection lookups for batches of printing matches.
- Search for adding deck targets and choosing printings.
- Card objects for card details, images, legalities, and price fields.

Use a descriptive User-Agent, an Accept header, a queued request limit, caching, bounded retries, and backoff on rate limiting. A conservative starting point is roughly five requests per second. Confirm current limits and batch sizes against the documentation before implementation; the collection endpoint has historically supported up to 75 identifiers per request.

Proposed pricing policy: refresh stale prices once daily while the app runs, with manual refresh available. The application need not download Scryfall's entire bulk dataset for this inventory. Cache results and continue operating when offline, with a visible last-successful-refresh timestamp.

Match the price to the actual printing and finish. EUR is the confirmed initial currency, with USD available in Settings. Missing price values are unknown, never zero. Show valuation coverage alongside totals, and identify the source and currency. Scryfall prices are indicative marketplace estimates, not guaranteed sale proceeds or the final price at checkout. Do not claim condition-adjusted valuations from these fields. Add DKK only with an explicit exchange-rate source and timestamp if requested.

If price history is added later, collect dated snapshots yourself. The ordinary current card response is not a historical price series.

Live Scryfall documentation retrieval was unavailable in this research environment. The endpoint details above are implementation assumptions to verify, not a successful live API test. References: https://scryfall.com/docs/api, https://scryfall.com/docs/api/cards/collection, https://scryfall.com/docs/api/cards, and https://scryfall.com/docs/api/bulk-data.

## Decks and missing cards

Import current Deck labels as proposed starting decks, then let you paste or import a target list using ordinary quantity/name lines. Your owned assignments alone cannot tell the application which unowned cards you intend to include. The Ramos entry therefore cannot establish an exact missing list without a target decklist.

Store a deck's required cards separately from ownership, with zones for main deck, command zone, and sideboard as applicable. Support Commander and casual 60-card decks initially. A 60-card deck is a size category, not a legality format; add Standard, Modern, Pioneer, or another selected ruleset where requested.

Show two useful quantities:

- Missing from collection: max(0, required − compatible copies owned).
- Missing to assemble now: max(0, required − compatible copies available after reservations in other active decks).

Your deck's own allocations remain available to that deck. Distinguish cards available in storage, cards that could be moved from another deck, and cards that need acquiring. Do not treat moving a card between decks as buying or deleting ownership.

For the combined wishlist, choose either simultaneously assembled decks or decks that share copies. For simultaneous decks, allocate each physical copy once and compute shortages against total selected demand. Example: two selected decks each need one copy and you own one compatible copy, so the combined shortage is one. Per-deck calculations alone would incorrectly report that both decks can be built together.

Use format checks appropriate to the selected ruleset. Commander validation needs command-zone configurations, color identity, singleton exceptions, deck size, and banned cards; 60-card validation needs its chosen ruleset, zones, and copy-limit exceptions. Casual lists should remain editable with warnings. Refresh legality metadata independently of imports.

## Exporting lists to Scryfall

Add an Export for Scryfall action for a full target deck, its missing-card list, and a selected collection list. Offer Copy decklist and Download .txt. Start with the broadly supported quantity-and-card-name format:

```text
4 Lightning Bolt
20 Mountain
```

This is a format illustration, not a deck or inventory extracted from the workbook. Aggregate equivalent card names for a name-only export, using the quantity appropriate to the chosen list: target quantities for a complete deck, computed shortages for a missing list, and owned quantities for a collection selection.

The intended workflow is to export, open Scryfall's deck builder, and paste or upload the list through its import interface. Treat this as manual export/import, not automatic account synchronization through the card-data API. Do not add Scryfall account credentials or depend on an undocumented account interface.

Before implementation, verify the current Scryfall importer against one Commander list and one 60-card list with a sideboard. Establish its accepted section syntax and whether it preserves set/collector-number metadata. Until verified, guarantee only the basic quantity/name export; offer additional printing and zone metadata only in a supported syntax, and identify any manual selection needed after importing. Preserve canonical full names for split and double-faced cards.

A collection or wishlist exported this way is a card list. Excel and the local app remain the collection ledger; do not assume Scryfall's deck builder preserves foil counts, condition, locations, allocation decisions, or inventory notes. Keep a separate detailed CSV export for those fields.

Acceptance checks: exported quantities equal the selected source quantities; a complete target deck includes unowned targets; a missing-list export contains only positive shortages; supported deck zones remain distinct; and a name-only export aggregates printings without changing total quantities. Live importer verification is outstanding because Scryfall was unreachable from this environment during planning.

## Original proposed interface (superseded by the simplification reset)

Use a compact desktop workspace: a narrow left navigation, search at the top of each relevant page, and the working content immediately visible. Start in Collection. Use a restrained charcoal or neutral theme, clear table typography, and small card thumbnails with larger previews. Use color plus text for completion states. Avoid a marketing landing page.

| View | Primary task and content |
| --- | --- |
| Collection | Search and filter; show name, edition/number, nonfoil/foil quantities, assignments, unit price, total, and freshness. Open a row for card artwork and details. |
| Decks | Select a deck; show target size, owned coverage, cards available now, and missing quantities. Add or paste a decklist. |
| Deck detail | Card rows with Needed, Owned, Available, In other decks, Missing, and indicative acquisition cost; tabs or filters for zones; Export for Scryfall. |
| Missing cards | Choose decks; view a combined wishlist with quantities, indicative costs, unpriced entries, and Scryfall text/CSV export. |
| Import review | Show changed counts, unresolved printings, and invalid source rows with Excel row references. |
| Settings | Workbook path, Refresh, currency, copy-sharing preference, and data export/backup. |

The Collection toolbar should include Search, Filters, Refresh, and Last imported. Summary values should be subordinate to the card table: known owned copies, priced value, and unresolved entries. Missing-card counts should show quantity, not merely distinct names.

Design explicit states for an initial import, no decks yet, an incomplete row, unavailable prices, a locked workbook, stale prices, and failed imports. Keep cached data usable and visible during network failures.

## UI/UX review and next-release roadmap — 2026-10-04

The review covered the earlier implementation and local desktop/mobile renders. Its findings below describe that version. The roadmap is now implemented on `sites/mtg-vault`: separate deck-readiness states; explicit reservation priorities/transfers with impact previews; full snapshot and matching review; validated collection restores and deck revisions; direct card-row editing; mobile/accessibility improvements; distinct refresh actions; and the later analysis, storage, saved-view, acquisition, and artwork tools. See SITES_VALIDATION.md for verified scope. Live Scryfall behavior remains unverified from the authoring environment, and format checks remain advisory.

### 1. Make deck readiness honest and prominent

At review time, Ramos showed `19 / 19 owned`, `Covered`, and a full green progress bar even though the seeded Commander target contains only 19 cards. Format warnings are below the card table. Ownership coverage of entered targets is useful, but it does not establish a complete, ready-to-play deck.

Show four separate states: target-list completeness, collection ownership coverage, availability after reservations, and format checks. Put an incomplete-list warning and important format issues near the deck title. Use text alongside color and keep detailed checks expandable.

Acceptance criteria:

- Ramos cannot appear ready to play while its target list is incomplete or its Commander checks are unresolved.
- The UI can explain `19 entered targets owned; 81 slots unspecified` without treating the unspecified slots as 81 cards to buy. Exact acquisitions require a confirmed target list.
- A complete list that is fully owned but blocked by another deck's reservations has a distinct availability state.
- Summary tiles and deck detail use the same definitions and expose the reason for each status.

### 2. Explain and control copy reservations

At review time, the app calculated copies in other decks without a clear priority or transfer workflow. All five seeded decks start reserved at the same priority. A planned reservation also does not prove a card is physically in that deck.

Show which deck reserves each compatible copy, including printing and finish. Add explicit deck priority and a `Move from…` action with a preview of the source deck's resulting shortage. Label planned reservations separately from physical storage or assembly status.

Acceptance criteria:

- A blocked requirement explains the reserving deck, quantity, and relevant printing/finish.
- Changing priority or moving a reservation shows the impact on all affected decks before saving.
- Each compatible copy is reserved at most once, and transfers never change owned quantities.
- Imported Excel Deck annotations and app reservations have distinct labels; neither silently overwrites the other.

### 3. Complete import and card-matching review

At review time, review emphasized reductions and the matching UI showed only the first 50 unresolved items without a way to reach the rest. Import history was stored but not shown. Expand review to additions, removals, quantity and finish changes, invalid rows, and affected decks.

Acceptance criteria:

- Every unresolved item is reachable through a searchable queue with pagination or an equivalent accessible list.
- Matching states distinguish not yet checked, no match, conflicting identity, and a request that failed and can be retried.
- Import preview shows before/after counts, nonfoil/foil changes, original Excel row references, quarantined rows, and reservation impacts.
- An import-history view shows when a snapshot was accepted, its source/fingerprint, and its results. Failed or cancelled imports preserve the last accepted inventory.
- Reimporting the same complete snapshot does not duplicate holdings; pagination never omits unresolved records.

### 4. Make recovery usable

At review time, the hosted app saved backups before inventory replacement and deck deletion, but had no restore interface. Deck edits had no revision history, and closing an editor could lose unsaved work.

Acceptance criteria:

- Users can inspect available backups, validate a selected backup, and preview a restoration's inventory/deck impact before applying it.
- Restore is atomic, reconciles reservations, and creates a backup of the current state before replacement. Corrupt or incompatible backups leave current data intact.
- Deck revisions support recovering an earlier list and undoing a deletion or mistaken edit.
- Closing an editor or navigating away with unsaved changes offers explicit save, discard, or continue-editing choices.

### 5. Improve mobile use and accessibility

At review time, at a 390 × 844 viewport, the collection table began about 720 px down the page and is roughly 998 px wide. No card rows are visible in the first viewport. Navigation also requires horizontal scrolling. Small table-header text has approximately 3.2:1 contrast, and dialogs lack accessible names.

Acceptance criteria:

- Collapse or compact summary statistics on small screens so search and collection content appear early.
- Provide compact card rows or a mobile detail layout that keeps primary tasks usable without a desktop-width table. Keep all navigation destinations discoverable.
- Meet WCAG AA contrast for normal text, provide visible keyboard focus and usable touch targets, and give dialogs accessible names, focus management, and keyboard dismissal.
- Verify collection search, deck inspection/editing, review queues, and recovery at desktop and narrow mobile sizes, including keyboard and screen-reader checks.

### 6. Make deck editing faster

At review time, the editor was primarily a textarea, with card lookup hidden in an expandable area. Keep bulk paste, and add direct editing for ordinary adjustments.

Acceptance criteria:

- Edit quantities in card rows; search/add cards with previews; move cards between main deck, command zone, and sideboard where applicable.
- Duplicate a deck without changing its source, and show validation feedback immediately as targets or zones change.
- Preserve printing/finish requirements and reservations through edits; prevent unsaved edits from being lost.
- Pasting a list presents parsing errors and a reviewable result before replacement.

### 7. Clarify refresh actions and price confidence

At review time, hosted Refresh reported that saved inventory was current without reading Excel, and missing prices mainly appeared as dashes with explanations elsewhere in the app.

Acceptance criteria:

- Use distinct actions for `Reload collection`, `Import saved workbook`, and `Refresh prices`, with clear results and timestamps.
- Explain unknown, stale, and failed price states where users see them. Show priced-copy coverage and unpriced quantities beside collection or acquisition totals.
- Retain cached prices during failures, and never present an unknown price as zero or imply a partial estimate covers every card.

### Additional tools — implemented in this release

| Addition | Useful behavior | Dependency |
| --- | --- | --- |
| Deck analysis | Mana curve, land counts, color requirements, and card-type distributions | Confirmed target lists and resolved card identities |
| Physical storage locations | Binder/box/deck labels and a `Where is this card?` view | Separate physical locations from planned reservations |
| Saved filters | Quickly return to unassigned cards, foils, unresolved cards, or cards needed by a selected deck | Clear assignment and matching-state definitions |
| Acquisition tracking | Track wanted, ordered, and received cards | Ownership increases only when Excel records receipt; avoid double-counting orders |
| Artwork browsing | Optional card grid, larger previews, and double-faced-card flipping | Reliable matching, responsive image loading, and accessible alternatives |

### Decisions and constraints

- **Assignment reconciliation:** Excel labels seed targets once and remain visibly labeled source annotations. Planned reservations and manually recorded locations are separate app data. The UI displays both labels and reservations; accepting a new snapshot preserves target lists and recomputes reservations, including resetting manual transfers.
- **Acquisition-price policy:** use the lowest compatible cached price, respecting explicit printing and finish requirements. This is not a live market-wide cheapest-price search. State the policy beside estimates; owned-card valuation continues to use the actual printing and finish.
- **Capacity and growth:** the current hosted importer caps uploads at 4 MiB, expanded workbook content at 24 MiB, and worksheet rows at 20,000. Parsed snapshots are limited to 1.2 MB and saved vault JSON to 1.8 MB. Because each accepted import replaces the full inventory, splitting a workbook into several uploads is not a safe workaround. Limit errors preserve current data and explain complete-snapshot semantics. The growth design is to move holdings and requirements to versioned D1 rows and atomically switch an accepted snapshot pointer after validation; see SITES.md. That larger-storage migration is reserved for an actual capacity need.
- **Other-tool and release workflow:** keep this version on `sites/mtg-vault`; document preview, validation, and explicit Site publication. GitHub commits alone do not deploy. Schema changes must preserve existing hosted inventory, decks, matching decisions, and backups, with a migration and recovery plan.

### Delivery sequence — completed

1. Deliver honest deck-readiness states, reservation explanations, complete import/matching review, and restore/undo support. Include mobile and accessibility fixes as release acceptance requirements.
2. Add explicit reservation transfer/priority controls, faster deck editing, and clearer refresh/price interactions.
3. Add deck analysis, storage locations, saved filters, acquisition tracking, and optional artwork browsing according to actual use.

Keep AI features behind reliable inventory, confirmed target lists, and dependable recovery. Completion means the acceptance criteria above are verified, not simply that another summary widget has been added.

## Hosting and integration options

| Option | Fit for your current needs | Tradeoff |
| --- | --- | --- |
| Local browser app + SQLite | Original local implementation | Reads your local workbook; no hosting subscription. Requires your computer to be running and a managed local startup. |
| Private Sites app + D1/R2 | Current hosted version on `sites/mtg-vault` | Built-in private access and hosted persistence. Uses manual workbook uploads because it cannot automatically read your computer's file. Verify current plan limits and charges. |
| Databricks Apps | Technically possible, unnecessary for this scope | More useful if the inventory already participates in an existing Databricks analytics environment. Adds workspace and operational overhead. Genie is an analysis connector, not the tracker itself. |

The hosted version stores structured data in D1 and uploaded workbooks/backups in R2. Its backend and importer have been ported to the Sites Cloudflare Workers runtime; the original Python backend remains the local-app implementation.

Integration findings: plugin discovery returned no Scryfall plugin. Direct API integration remains sufficient. GitHub is already available for source control and review. Figma was found as an optional design plugin; it is unnecessary for one person's first version. SharePoint is a possible future cloud-file source, and Databricks Genie was found for analytics. No additional plugins have been installed or suggested for connection.

An MCP is an interface for AI tools, not a prerequisite for a normal app calling Scryfall. If you later want AI to query this collection, build a small local MCP over the application's existing service with tools such as search_collection, get_deck_gaps, and get_prices. Start read-only; add mutation tools only when there is a useful workflow and clear ownership rules. Keep deck coverage and valuation calculations deterministic.

## AI team and execution sequence

Use one lead/integrator and a few bounded roles rather than several agents editing the same files without coordination.

| Role | Responsibility | Deliverable |
| --- | --- | --- |
| AI Product/Project Manager | Own scope, rules, backlog, contracts, and integration; resolve tradeoffs | Prioritized acceptance criteria and a coherent reviewed release |
| AI UI/UX designer | Define screens, states, table layout, card previews, and keyboard flows | Wireframes, design tokens, and UI components using agreed sample data |
| AI Developer | Implement import, storage, matching, deck logic, API integration, and UI wiring | Working app plus setup instructions |
| Independent reviewer, optionally a separate agent | Check calculations, failure handling, usability, and data preservation | Review findings and acceptance-check results |

First agree on the data model and ownership/allocation rules. Then the designer and developer can work in parallel against a shared API contract. Use separate branches/worktrees and file ownership; the lead integrates changes. Keep a single owner for schema changes and dependency changes. Separate Codex agents can perform these roles when implementation is requested; the hosted implementation has since used separate independent UI and UX critics. No new user-owned chats are required.

Original local implementation milestones (retain as baseline; use the UX roadmap above for the next hosted release):

1. Validate the file convention and build a reliable, repeatable import into SQLite with a basic collection table.
2. Resolve printings and add cached card details and finish-correct prices.
3. Seed the five deck labels, add intended decklist import/editing, implement coverage and allocation-aware missing lists, and add Scryfall-compatible text export.
4. Finish desktop interactions, recovery states, export/backup, and convenient startup.

Acceptance checks should prove that reimporting does not duplicate holdings; foil splitting preserves total quantities; unresolved quantities remain flagged; printing mismatches are surfaced; identical cards are not allocated twice; double-faced names resolve correctly; offline price failures retain cached values; and app restart preserves decks. Verify totals against the workbook rather than snapshotting the UI implementation.

Operating system, Input authority, Count/Foil semantics, blank Foil handling, and initial currency are confirmed. The app now exposes intended-list confirmation, reservation priority/transfer controls, physical-location fields, and the stated cached acquisition-price policy. Actual complete target decklists, invalid Excel rows, and the physical movement/receipt of cards remain user-maintained source facts.
