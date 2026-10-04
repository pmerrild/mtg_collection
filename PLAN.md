# MTG collection and deck tracker: implementation plan

The original local implementation described below is complete. This document records that delivered scope and the next hosted phase. The hosted Worker is live, with Scryfall search, manual bounded card/price sync, and D1-backed read/deck/wishlist/export routes. Launch through the local Mac shortcut was not re-tested during hosted work; see README.md and VALIDATION.md for current instructions and limits.

Confirmed implementation preferences: macOS; Input is the full inventory; Count includes all copies; Foil is the number of foil copies within Count. EUR is the initial display currency and can be changed to USD in Settings.

## Current Status And Next Steps

### Delivered

The existing local app provides a React/TypeScript interface, a FastAPI service, and a SQLite database. It imports and watches the Excel `Input` sheet, supports collection browsing and deck editing, calculates missing cards, caches Scryfall data, exports TXT/CSV, and backs up the database. Inventory ownership remains read-only in the app.

On branch `copilot/mtg-vault-collection`, the Cloudflare Worker serves static assets and validates Cloudflare Access independently from Microsoft identity. Three D1 migrations are applied remotely. Cloudflare Access protects Worker traffic; the account remained on Free during setup. The personal Microsoft account has consented to AppFolder scope, and one workbook is pinned by drive/item ID. A read-only import of that workbook is in D1 (892 known copies, 1 review issue). D1-backed state, collection, issues, deck CRUD, wishlist, Scryfall search/match confirmation, manual 75-item-batched Scryfall sync, and TXT/CSV export routes are implemented and live. Excel writes, automatic/background price refresh, and automatic external-change synchronization remain unimplemented. The Access policy currently includes Cloudflare account members and an Email domain condition containing a full email address; verify only the owner is allowed and use an exact-email selector if needed.

### Agreed product direction

- Edit inventory in the app and in Excel, with app edits written back to the same workbook.
- Keep the workbook in OneDrive and use Microsoft Graph for hosted reads and writes.
- Add a hidden stable ID column to the `Input` table so edits target the right source row after sorting or inserting rows.
- Make the app available from anywhere in a phone, iPad, or Windows browser; only the owner needs an account, and free hosting is preferred when it meets persistence and availability needs.
- Evaluate Cloudflare Sites/Workers with D1 for the hosted app and database, and R2 for backups. Keep the existing React UI where practical, but adapt the backend: local FastAPI paths, file watching, and SQLite files cannot be deployed unchanged.

### Agreed product direction

- Edit collection ownership in both the app and Excel; app edits write back to the same workbook.
- Keep the workbook in OneDrive and use Microsoft Graph for hosted reads and writes.
- Add a hidden stable ID column to the `Input` table so edits survive sorting and inserted rows.
- Support access from anywhere in phone, iPad, and Windows browsers; only the owner needs an account; prefer free hosting when it meets persistence and availability requirements.
- Use Cloudflare Workers for the hosted application/API, D1 for structured application data, and optionally R2 for backups. Do not sync database files between devices.

### Ordered implementation steps

1. **Confirm owner-only Access policy.** The D1 resource is created and bound in `wrangler.jsonc`; Access is enabled for this Worker only and all traffic. Keep Cloudflare on Free. Ensure the policy is limited to the owner (account-member login is acceptable only if the Cloudflare account has no other members; prefer an exact-email rule). Do not enter a full email address in an Email domain selector. Verify authenticated requests pass and unauthenticated requests redirect to Access. Never select a paid add-on.
2. **Complete OneDrive token lifecycle.** Live personal-account consent and encrypted D1 persistence are verified. Add refresh-token rotation, expiry handling, revocation/reconnect, and encrypted key rotation. Cloudflare Access protects app entry; it is separate from Graph API authorization. Never place tokens in the browser, plaintext D1, source control, or chat.
3. **Establish workbook identity and sync reads.** Back up the workbook, add/preserve the approved hidden stable row ID in the `Input` table, and map imported rows to that ID. Read the workbook through Graph, capture its item ID and eTag, preserve unrelated sheets, and keep the existing last-good inventory if download or parse fails. Verify duplicate rows and workbook formatting on a copy.
4. **Port collection reads and domain state.** Replace local file paths, file watching, and local SQLite assumptions in the Worker API with Graph-backed workbook reads and D1 queries. Migrate collection state, import history, issues, matches, decks, and entries without losing current semantics. Use Graph change notifications/delta or bounded polling for external Excel edits; do not assume OneDrive can be watched as a local file from Workers.
5. **Implement conflict-safe inventory writes.** Add validated endpoints to edit Count, Foil, Notes, Deck, add rows, and remove copies. Before a write, fetch the current eTag; edit the target by stable row ID; upload conditionally only if the version is unchanged; then re-read and reconcile D1. If Excel changed first, the upload is locked, or sync is uncertain, preserve both versions and require review instead of overwriting. Keep reduction review for external workbook changes.
6. **Add the collection editor.** Expose row provenance where necessary, including duplicate source rows. Provide save, syncing, conflict, and failure states, and refresh shared state after a successful write. Keep ownership separate from app-owned deck targets and allocations.
7. **Harden, back up, and validate release.** Enforce same-origin mutation checks in addition to Access identity; apply request/body limits and security headers. Configure D1 backups and use R2 only for backup artifacts, not as the live workbook or database. Test app-to-Excel and Excel-to-app round trips, eTag conflicts, duplicate IDs, locked/syncing files, restarts, restore, and phone/tablet/Windows layouts. Run Python tests, Worker auth tests, frontend build, local D1 migration, and hosted checks after account access is configured.

### Blockers and scope

Cloudflare account access and OneDrive consent were configured for the live deployment. The D1 schema is a hosted starting mapping, not a migration of a local database. Do not put credentials in this repository. The hosted app supports read-only workbook snapshots and D1-backed deck management, but collection ownership is still edited only in Excel; safe conditional workbook writes, external-change sync, and backup/restore remain release blockers.

## Initial Local-App Plan (Historical)

Build a local application that runs on your computer and opens in your browser. Keep Excel as the authoritative collection source. Store intended deck lists, allocation decisions, card matches, and cached Scryfall data in a local SQLite database. Make the first version useful without AI running in the application.

Proposed stack: React and TypeScript for the interface; Python and FastAPI for the local service; openpyxl for Excel; SQLite for saved data. These are recommendations, not dependencies already installed on your computer. Package startup behind one script or shortcut after your operating system is known. Start and stop the backend together with the app, listening on localhost only.

The application must run on your own computer to watch its files. This chat's uploaded workbook is a snapshot and does not provide continuing access to your local file.

## What the workbook establishes

The uploaded `Input` worksheet has an Excel table named `Input`, covering A1:J680. Its columns are Name, Type, Color, Rarity, Set#, Set, Count, Foil, Notes, and Deck.

- 679 populated data rows and 607 distinct name strings.
- Known Count values sum to 892 copies. One quantity is blank, so 892 is not a verified complete inventory total.
- All rows have a name, set, and collector number.
- Foil has 633 blanks, 44 values of 1, and two values of 2. In particular, a Forest row has Count 4 and Foil 2. This suggests a foil-copy count, but your intended meaning must be confirmed.
- Five deck labels exist. Cloud, Sephiroth, Angels, and Black Vampires each sum to 60 copies. Ramos Guildgate Commander sums to 19.
- 21 name/set/collector-number/foil keys occur on multiple rows. Repeated rows may represent separate copies or assignments; they must not be discarded automatically.
- Row 253 is Plains, with a blank Count and numeric Set value 8. It needs a quantity and confirmation of the edition. Do not silently replace 8 with a guessed Scryfall code.
- `Collection` is backed by a Power Query connection and contains 652 rows with quantities totaling 1,758. It is a different saved view from `Input`; its totals cannot be substituted for the authoritative input total.

Import `Input` only. Keep all other worksheets untouched. Confirm that `Input` covers everything you want tracked before declaring the import complete.

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

Every import is a complete snapshot, not a batch of extra purchases. Reimporting the same file must leave quantities unchanged. Keep original row values and row numbers for diagnostics; row numbers are not permanent inventory identifiers. Store a content fingerprint and import history. Preview quantity reductions or removed entries before accepting them, especially when they affect allocated cards.

Validate quantities, foil counts, and required columns. Quarantine incomplete rows with a clear explanation rather than assuming a missing Count means 1 or 0. Preserve the last good import if Excel is locked or a read fails. Persist corrections to identity matching separately so they survive future imports of the same source key.

If Foil means the number of foil copies, split each source row into nonfoil = Count − Foil and foil = Foil. Treat a blank as zero only after confirming that convention. Preserve finishes as separate holdings. Additional languages, conditions, etched finishes, and locations can be supported later if you need them.

## Card matching and valuation

Use the set code and collector number to resolve a printing. Preserve the raw collector number; normalize numeric padding when appropriate for Scryfall, and retain meaningful suffixes. Check the returned name as a safeguard. Show ambiguous or inconsistent results in a review queue; fuzzy search should suggest candidates for approval.

Store both the Scryfall printing ID and the Oracle ID. A printing ID identifies the edition being valued; an Oracle ID normally identifies the underlying card for deck requirements. Let a deck accept any printing by default, with an optional exact-printing requirement. Handle double-faced and split cards explicitly.

Use Scryfall's public HTTP API directly. A Scryfall MCP is not required for the application. Planned integration points:

- Card collection lookups for batches of printing matches.
- Search for adding deck targets and choosing printings.
- Card objects for card details, images, legalities, and price fields.

Use a descriptive User-Agent, an Accept header, a queued request limit, caching, bounded retries, and backoff on rate limiting. A conservative starting point is roughly five requests per second. Confirm current limits and batch sizes against the documentation before implementation; the collection endpoint has historically supported up to 75 identifiers per request.

Proposed pricing policy: refresh stale prices once daily while the app runs, with manual refresh available. The application need not download Scryfall's entire bulk dataset for this inventory. Cache results and continue operating when offline, with a visible last-successful-refresh timestamp.

Match the price to the actual printing and finish. EUR and USD are useful display options; choose your preferred currency before implementation. Missing price values are unknown, never zero. Show valuation coverage alongside totals, and identify the source and currency. Scryfall prices are indicative marketplace estimates, not guaranteed sale proceeds or the final price at checkout. Do not claim condition-adjusted valuations from these fields. Add DKK only with an explicit exchange-rate source and timestamp if requested.

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

## Proposed interface

Use a compact desktop workspace: a narrow left navigation, search at the top of each relevant page, and the working content immediately visible. Start in Collection. Use a restrained charcoal or neutral theme, clear table typography, and small card thumbnails with larger previews. Use color plus text for completion states. Avoid a marketing landing page.

| View | Primary task and content |
| --- | --- |
| Collection | Search and filter; show name, edition/number, nonfoil/foil quantities, assignments, unit price, total, and freshness. Open a row for card artwork and details. |
| Decks | Select a deck; show target size, owned coverage, cards available now, and a per-card To acquire highlight for copies absent from the collection. Add or paste a decklist. |
| Deck detail | Card rows with Needed, Owned, Available, In other decks, Missing, and indicative acquisition cost; tabs or filters for zones; Export for Scryfall. |
| Import review | Show changed counts, unresolved printings, and invalid source rows with Excel row references. |
| Settings | Workbook path, Refresh, currency, copy-sharing preference, and data export/backup. |

The Collection toolbar should include Search, Filters, Refresh, and Last imported. Summary values should be subordinate to the card table: known owned copies, priced value, and unresolved entries. Missing-card counts should show quantity, not merely distinct names.

Design explicit states for an initial import, no decks yet, an incomplete row, unavailable prices, a locked workbook, stale prices, and failed imports. Keep cached data usable and visible during network failures.

## Hosting and integration options

| Option | Fit for your current needs | Tradeoff |
| --- | --- | --- |
| Local browser app + SQLite | Recommended | Reads your local workbook; no hosting subscription. Requires your computer to be running and a managed local startup. |
| Private Sites app + D1/R2 | Good later if you want another device | Built-in private access and hosted persistence. A hosted service cannot automatically read your computer's file; use uploads, a cloud source, or a local uploader. Verify current plan limits and charges. |
| Databricks Apps | Technically possible, unnecessary for this scope | More useful if the inventory already participates in an existing Databricks analytics environment. Adds workspace and operational overhead. Genie is an analysis connector, not the tracker itself. |

On Sites, D1 would hold structured data and R2 could hold workbook uploads and backups. The recommended Python backend cannot be deployed unchanged to the Sites Cloudflare Workers runtime. Reuse the UI and data model; port the backend and importer to a Worker-compatible implementation if moving later.

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

First agree on the data model and ownership/allocation rules. Then the designer and developer can work in parallel against a shared API contract. Use separate branches/worktrees and file ownership; the lead integrates changes. Keep a single owner for schema changes and dependency changes. Separate Codex agents can perform these roles when implementation is requested; no agents or new chats have been launched for this plan.

Suggested milestones:

1. Validate the file convention and build a reliable, repeatable import into SQLite with a basic collection table.
2. Resolve printings and add cached card details and finish-correct prices.
3. Seed the five deck labels, add intended decklist import/editing, implement coverage and allocation-aware missing lists, and add Scryfall-compatible text export.
4. Finish desktop interactions, recovery states, export/backup, and convenient startup.

Acceptance checks should prove that reimporting does not duplicate holdings; foil splitting preserves total quantities; unresolved quantities remain flagged; printing mismatches are surfaced; identical cards are not allocated twice; double-faced names resolve correctly; offline price failures retain cached values; and app restart preserves decks. Verify totals against the workbook rather than snapshotting the UI implementation.

Before implementation, confirm your operating system, the meaning of Count/Foil and blank Foil values, whether Input is the complete inventory, what the existing Deck labels mean, and which target decklists and currency to use. These are data and packaging decisions, not a reason to install enterprise infrastructure.
