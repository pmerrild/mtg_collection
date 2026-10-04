# Hosted acceptance validation

- Production React/TypeScript/Vite build and Worker ESM build passed.
- Eight deterministic domain/import checks passed against the original workbook fixture: 679 populated rows, 892 known copies, 48 foil copies, 607 names, 655 printing/name groups, one invalid row at 253.
- Workbook repeat imports, foil splitting, snapshot reductions, preserved target edits, seeded-deck deletion, exact-edition allocation, simultaneous versus shared-copy demand, canonical double-faced names, unknown prices and quantity/name export passed.
- Three hosted API checks passed: printing/finish valuation, offline cache retention, name-mismatch quarantine, filtered export and full JSON backup.
- Local Wrangler with real D1/R2 bindings passed upload idempotency, malformed-file recovery, reductions awaiting review and apply, restored inventory totals, saved deck targets, wishlist, exports, currency changes, backup download, deletion and same-origin rejection.
- Schema-only Drizzle migration was generated and inspected; local D1 applied all three statements successfully.
- Live Scryfall could not be verified in the authoring environment. Hosted refresh failures preserve cached values and show a recoverable message. No price data was fabricated.
- Portable cloud loopback is not a supported user-facing preview here. Publication is checked through Sites deployment status. Browser WebMCP registry validation is unavailable in this environment; the optional tools feature-detect browser support.

Inventory is private runtime data and is excluded from the GitHub branch. The original local Python implementation and its validation remain available in the repository.
