# MTG Vault

A local Magic: The Gathering collection and deck workspace, built from PLAN.md. Excel remains your ownership source; decks, card matches, and cached prices are saved in SQLite.

## Run on macOS

1. On [GitHub](https://github.com/pmerrild/mtg_collection), choose **Code → Download ZIP**, then extract it to a permanent folder such as `Documents/MTG-Vault`. You can also clone the repository.
2. Install **Python 3.10 or newer** if needed: https://www.python.org/downloads/macos/. Python is a prerequisite; this is not a self-contained `.app` installer.
3. Double-click **Start.command**. The first launch creates a virtual environment and installs Python dependencies; it requires internet access. The browser then opens at http://127.0.0.1:8765.
4. Keep the Terminal window open while using the app. Press **Control-C** to stop it.

If Finder cannot execute the launcher, open Terminal, type `cd `, drag the extracted folder into Terminal, press Return, then run:

```sh
chmod +x Start.command
./Start.command
```

The packaged interface is already built. **Node.js is not needed to use this download.** The launcher was syntax-checked in Linux; Finder launch itself still needs checking on macOS.

## Connect the file you keep updating

The included `sample-inventory.xlsx` contains one synthetic demo entry: four Lightning Bolts, including one foil. The existing MagicTheGatheringInventory.xlsx file is preserved. Connect the copy you keep updating in Settings; the app database and backups are local and ignored by Git. It is imported automatically at first launch using the confirmed rule: **Count includes all copies; Foil is the number of foil copies within Count; blank Foil means zero.** Only Input is read. The application never edits Excel.

Open **Settings**, enter the full path to your original workbook, and choose **Connect workbook**. On macOS, you can drag the workbook into a Terminal window to obtain its path; remove surrounding shell quotes or backslash escapes before pasting it into the app. You can also use Finder's Copy as Pathname command. Automatic watching follows saved changes while the app is running. Unsaved Excel changes cannot be imported.

**Upload snapshot** copies a workbook into the app's data folder. It does not watch the original file.

Repeated imports replace the collection snapshot, rather than adding purchases. Quantity reductions are held for review. Backups are created before applying an import. A locked or unreadable file leaves the last good inventory available. Invalid quantities remain visible in Import review and are excluded from totals. Review any invalid source rows and confirm reductions when replacing the demo snapshot with your own inventory.

## Decks and missing cards

Deck labels in your workbook seed starting lists on import. These are initial targets copied from owned assignments, not proof that the intended decks are complete. The demo workbook has no assigned decks. Edit each target list to include unowned cards.

Decklists accept quantity/name lines and these optional section headings:

```text
Commander
1 Ramos, Dragon Engine

Deck
1 Sol Ring

Sideboard
1 Arcane Signet
```

Optional exact-edition target: `1 Sol Ring (CMM) 410`. Set and collector number must identify the desired printing; this example illustrates the syntax and is not an edition recommendation.

Active decks reserve copies in a deterministic order, with exact-edition requirements allocated first. Draft decks do not reserve copies. Each deck displays gaps against the entire collection and gaps when competing with active decks. The Missing cards view compares only the selected decks against the entire collection:

- **Assembled together:** each owned copy is used once across selected decks.
- **Share copies:** the same copies can move between decks, while respecting exact-edition requirements.

Format checks are advisory. Commander color identity, typical size, usual copy limits, cached legality and restriction flags are checked where metadata exists. Commander pairing, companion rules, and some card-specific copy-limit exceptions require manual review. Unknown metadata is explicitly flagged. Exact ownership matching before Scryfall enrichment uses normalized names; confirmed cards can use Oracle IDs.

## Scryfall data and exports

Use Settings → Refresh card data and prices, or Import review → Match with Scryfall. Stale data also refreshes automatically while the app runs. Requests use a descriptive User-Agent, request pacing, bounded backoff, and batches of at most 75 printing identifiers. Name mismatches require confirmation; cached results survive request failures.

Prices use the printing and foil/nonfoil finish, with EUR or USD available. Missing values remain unknown. Known totals show how many copies have prices. Missing-card cost estimates use available cached prices, not guaranteed purchase quotes. Condition, shipping, exchange rates, and price history are not included.

**Export for Scryfall** produces plain quantity/name text for copying or downloading. Full deck exports include unowned target cards; missing-card exports include shortages only. Exact editions and foil details are omitted from this basic text export. Select zones separately and designate commanders/sideboards in Scryfall after import. Detailed collection CSV is available in Settings.

Live Scryfall API requests were blocked by this build environment's network policy. API batching, matching, finish prices, and failure behavior were tested with controlled responses; live connectivity and the current Scryfall importer must still be checked on your Mac. No Scryfall account credentials are needed for card-data lookup. Deck transfer is manual export/import.

## Saved data and backups

Runtime data lives in `data/` beside the app:

- `vault.sqlite3`: settings, decklists, imported ownership, card matches and caches.
- `backups/`: database backups made before inventory replacement or deck deletion, and on manual backup.
- `uploads/`: uploaded workbook snapshots.

Keep the app in a stable, writable directory. Moving the folder preserves its data, but update the configured workbook path if the workbook moved too. Keep your Excel workbook backed up separately.

To restore a database backup: stop the app, copy the current `data/` somewhere safe, replace `data/vault.sqlite3` with your backup, remove `data/vault.sqlite3-wal` and `data/vault.sqlite3-shm` if present, then restart. These steps require the app to be fully stopped.

The service listens only on `127.0.0.1`. Same-origin checks protect browser writes. Only public card identifiers and search terms are sent to Scryfall; the workbook and decklists are not uploaded as files. Card images, when available, load from Scryfall's image URLs in the browser. No analytics, AI service, or hosted account is required.

## Development

Python 3.10+ and Node.js 20.19+ (or a current Node.js LTS) are required for development. From this folder:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
cd frontend
npm ci
npm run build
cd ..
.venv/bin/python run.py
```

For UI development, run the backend with `--port 8000 --no-browser`, then `npm run dev` in frontend. Vite proxies `/api` to port 8000. Tests use Python's standard unittest runner:

```sh
python3 -m unittest discover -s tests -v
```

The original workbook acceptance check is optional. Set `MTG_ORIGINAL_WORKBOOK` to its local path to include that fixture-specific test; otherwise it is skipped. Runtime databases and backups stay outside Git.

Optional `MTG_DATA_DIR` chooses a different database directory. Run `python3 run.py --port 8766` if the default port is occupied. See VALIDATION.md for checks performed and remaining limits.

## Cloudflare foundation (incomplete)

`wrangler.jsonc` and `cloudflare/` contain an initial Workers + D1 scaffold. The Worker serves the built frontend and answers `GET /api/health`; other API routes return `501` until they are migrated. Data API paths require a valid Cloudflare Access JWT matching the configured audience and `ALLOWED_EMAIL`. Configure a Cloudflare Access application to protect the site, use Microsoft as its identity provider, and restrict the policy to your account. The Worker verifies the signed assertion itself; do not rely only on an Origin check. The existing FastAPI API and OneDrive workbook synchronization are not implemented in Workers yet. Do not treat this scaffold as a usable hosted collection.

Wrangler 4 requires Node.js 22 or newer. Set `ACCESS_TEAM_DOMAIN` to the Cloudflare Access team slug (without `.cloudflareaccess.com`), `ACCESS_AUD` to the protected application's audience tag, and `ALLOWED_EMAIL` to the one permitted email using `wrangler secret put`. From `frontend/`, `npm run cloudflare:dev` starts the local Worker preview, `npm run test:cloudflare` checks JWT validation, and `npm run cloudflare:deploy` builds and deploys the interface. Before deployment, create a D1 database and replace the local placeholder `database_id` in `wrangler.jsonc`; configure the Access application and identity policy in Cloudflare.
