import { build } from "esbuild";
import { mkdir, cp, writeFile, readFile, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist/server", { recursive: true });
await cp("frontend/dist", "dist/client", { recursive: true });
await build({
  entryPoints: ["worker/index.mjs"],
  outfile: "dist/server/index.js",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  external: ["cloudflare:workers"],
});
const manifest = JSON.parse(await readFile(".openai/hosting.json", "utf8"));
await writeFile(
  "dist/server/wrangler.json",
  JSON.stringify(
    {
      name: "mtg-vault",
      main: "index.js",
      compatibility_date: "2026-05-15",
      compatibility_flags: ["nodejs_compat"],
      assets: {
        directory: "../client",
        binding: "ASSETS",
        not_found_handling: "single-page-application",
        run_worker_first: ["/api/*"],
      },
      d1_databases: [
        {
          binding: "DB",
          database_name: "mtg-vault",
          database_id: "local-preview",
          migrations_dir: "../../drizzle",
        },
      ],
      r2_buckets: [{ binding: "BUCKET", bucket_name: "mtg-vault-workbooks" }],
    },
    null,
    2,
  ),
);
console.log("Built MTG Vault Worker and client");
