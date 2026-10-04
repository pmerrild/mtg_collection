# Hosted acceptance validation — UX roadmap release

The implementation is verified against disposable local storage; production inventory and bootstrap secrets were not changed.

- React/TypeScript/Vite and Worker production builds pass.
- 24 deterministic checks pass: eight original domain/import checks, seven new roadmap domain checks, four original hosted API checks, and five new hosted workflow/data-safety checks.
- The original private acceptance fixture still yields 679 populated Input rows, 892 known copies, 48 foil copies, 607 names, 655 printing/name groups, and one invalid row at 253. Repeat imports preserve totals and target edits; foil splitting and repeated source rows retain ownership.
- Covered but incomplete targets remain incomplete. Reservation priority and explicit printing/finish transfers preview source/destination shortages, preserve ownership, and allocate each compatible copy at most once. Shared/assembled shortages and finish-specific prices are checked.
- Every changed workbook waits for complete snapshot review. Additions, removals, quantities, finish changes, invalid rows, and affected decks are included. Invalid/unchanged files preserve the accepted inventory; failed parsing is recorded in history.
- Deck revisions recover edits and deleted decks without reusing identifiers. Full backups are validated, old version-1 state gains optional fields, and corrupt ownership/orphaned entries are rejected. Restore writes vault/cache atomically; stale previews and a simulated concurrent write leave current inventory and cached cards intact.
- Wanted/ordered/received records never change owned quantities. Locations and saved views persist, and collection exports honor filters. Cached prices survive offline failures and identity mismatches remain quarantined before valuation.
- Chromium desktop/mobile acceptance passes: collection search/details, location save, accessible dialog names and Escape, direct deck quantities/zones, save/discard/continue protection, deck revision restoration, TXT download, acquisition tracking, full matching pagination beyond 50 items, and currency settings. No page errors were observed.
- At 390 × 844, all five navigation destinations remain visible, search begins near 331 px and the first compact card row near 449 px (earlier review: table began around 720 px). Collection, Decks, Missing, Review, and Settings have no document-level horizontal overflow. A 700 px viewport with 200% root text also passes the overflow check.
- Table header text is now #40594a on #f8faf9; secondary working text uses darker colors. Dialog naming, native focus containment, keyboard dismissal, focus return, and visible keyboard focus are verified through browser interaction/accessibility roles. This is not a comprehensive assistive-technology or WCAG conformance certification.
- Collection calculations were indexed to avoid repeated full-table scans. The original-fixture local Worker state request measured approximately 42 ms after this optimization; this is a local observation, not a production performance guarantee.
- This release preserves the existing D1 SQL schema, bindings, private access, bootstrap behavior, and production inventory. Optional JSON fields are upgraded lazily. No SQL migration or destructive reset is needed.

Run deterministic checks after building:

```sh
npm test
npm run build
npm run test:api
```

For the browser acceptance, start a disposable local Wrangler instance on port 4180 and seed it with the original acceptance workbook; then run `python tests/roadmap_browser.py`. That script deliberately edits only disposable local inventory/decks. `tests/hosted_smoke.py` also uses disposable storage and has been updated for complete-snapshot review and revision headers.

Live Scryfall retrieval remains unverified from the restricted authoring environment. API behavior was checked with controlled cached-card responses and offline failures; no real marketplace prices or artwork were invented. Optional browser WebMCP registration remains feature-detected and was not available for registry validation in Chromium. Private publication is verified through native Sites deployment status.
