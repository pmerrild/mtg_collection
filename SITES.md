# MTG Vault on Sites

This hosted version is maintained on **`sites/mtg-vault`** in [pmerrild/mtg_collection](https://github.com/pmerrild/mtg_collection/tree/sites/mtg-vault). The original local application remains on `main`. Make hosted changes on this branch when using other tools.

Sites keeps a separate publication repository. Publishing synchronizes this branch's reviewed source to the site's publication repository; GitHub branch pushes alone do not automatically deploy. Site identity is in `.openai/hosting.json`; reuse it for updates and never register a replacement site.

## Architecture and data

The original React/Vite interface is reused. `worker/` ports the Python import and allocation rules to Cloudflare Workers. D1 stores durable inventory, deck targets, matching corrections, imports, and cached card data. R2 keeps workbook uploads and JSON backups. Schema-only migrations are generated from `db/schema.ts` by Drizzle. Inventory mutations use revision checks to prevent a stale tab from overwriting another update.

The private initial inventory and original workbook acceptance fixture are `MagicTheGatheringInventory.xlsx`, and differs from the synthetic sample workbook: 679 populated Input rows, 892 known copies, 48 foil copies, 607 names, 655 printing/name groups. Row 253 is quarantined for blank Count and unconfirmed numeric Set. Repeated rows remain separate holdings. Count includes foil; blank Foil means zero. EUR is the default; USD is selectable.

Inventory is imported into private runtime storage, never committed to this public GitHub branch. The optional initial snapshot is supplied as a compressed Sites secret and applied once on the first app request; it also saves a source snapshot in R2. Later uploads use the normal workbook workflow. A hosted site cannot watch files on a Mac. Save Excel, then use **Import workbook** or Settings → **Upload workbook**. Only Input is read. Imports are complete snapshots, so an unchanged file adds no copies. Quantity reductions require review. Target decklists and printing corrections survive imports. Limits: 4 MB compressed workbook, 24 MB expanded ZIP contents, 20,000 Input rows, and 1.2 MB parsed snapshot. Oversize and failed imports keep the previous inventory.

The five workbook deck labels seed proposed targets. Their owned assignments cannot establish missing unowned targets; enter your intended decklists. Commander and ruleset warnings are advisory; special commander pairings and card exceptions may need manual review.

Scryfall is called directly with batch size 75, queued requests, bounded retries and backoff. Prices are cached per printing and finish. Refresh occurs daily while the app is used, with a manual refresh control. Missing prices remain unknown. TXT exports guarantee quantity/name syntax only; designate commander and sideboard manually in Scryfall or export each zone separately. Scryfall account synchronization is not implemented.

Download full JSON backups and detailed inventory CSV from Settings. Before inventory replacement and deck deletion, a backup is also saved in R2. JSON backups include inventory, decklists, corrections, cached cards and import history; they are not SQLite files.

## Development

Requires Node 22+.

```sh
npm ci
npm --prefix frontend ci
npm test
npm run db:generate # only after schema changes
npm run build
npx wrangler d1 execute DB --local --config dist/server/wrangler.json --file drizzle/0000_tense_human_fly.sql
npx wrangler dev --local --config dist/server/wrangler.json
```

Production is private through Sites access controls. Keep that audience when publishing. Runtime data is excluded from Git. Append migrations after publishing; never rewrite applied migrations.
