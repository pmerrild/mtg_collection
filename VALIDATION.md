# Validation of the first implementation

## Passed

- React/TypeScript type checking and production Vite build.
- 30 automated backend acceptance tests (29 public checks and one optional original workbook fixture check) using Python's unittest runner.
- Original workbook acceptance fixture: 679 populated rows, 892 known copies, 48 foil copies, 607 distinct names, 655 aggregated printings, and one source issue at row 253.
- Five seeded lists with target totals 19, 60, 60, 60, and 60. Intended unowned targets must still be entered by the owner.
- Snapshot import idempotency, foil splitting, invalid quantities, quantity-reduction review, stale-preview rejection, preserved target edits, and deleted-deck persistence.
- Matching canonical double-faced/split names, corrected printing aliases, and constrained exact-printing allocation.
- Physical-copy allocation across simultaneous decks; shared-copy and exact-edition wishlist calculations.
- Printing/finish prices, unknown currency values, fresh-cache reuse, 75-identifier batches, name mismatch handling, and preserved prices during outages. Scryfall responses were mocked for these checks.
- Complete target TXT exports include unowned cards; missing-list exports contain positive shortages; CSV formula text is escaped.
- Same-origin browser mutation checks and database persistence across service restarts.
- Headless Chromium checks: collection search and card details; deck creation and editing; TXT download; missing-list mode selection; source issue display; currency changes; and small-viewport layout. No JavaScript errors were reported.
- macOS launcher Bash syntax and Python compilation.
- Clean ZIP extraction and service startup from the extracted folder; bundled assets were served successfully. The ZIP retains the launcher's executable permissions and excludes runtime databases and node_modules.
- Real file-watcher check on the extracted test copy: an Excel save increased known copies from 892 to 893, a reduction waited for approval, and approval restored the total to 892. The original uploaded workbook and included source snapshot remained unchanged.
- Downloaded backup was a valid SQLite database; the full collection TXT export summed to 892 copies.

## Remaining practical checks

- Launch `Start.command` on an actual Mac with Python 3.10+ and a fresh virtual environment. This build ran on Linux; it does not validate Finder or macOS quarantine behavior.
- Confirm live Scryfall connectivity and current API/importer behavior on the Mac. Outbound Scryfall requests were blocked by the build environment's network policy. Prices remain unpopulated here.
- Name-only text is the initial Scryfall export. Commander/sideboard designation and exact editions should be reviewed in Scryfall after importing.
- Commander pairings, companion rules, and some card-specific deck exceptions require manual review; format checks are advisory.
- The committed workbook is synthetic demo data. Connect your original macOS path in Settings to track future saves.

The first version includes the local app, Excel watching/import review, durable decks, allocation-aware missing lists, Scryfall integration with caching, TXT/CSV exports, and database backup. Hosted deployment, a native signed `.app`, a custom MCP, historical prices, and condition/FX adjustments were deferred.
