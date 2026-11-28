#!/usr/bin/env node
/**
 * Vendor Drawbridge replay, fonts, and attack-results JSON at a pinned SHA.
 * Run by hand; commit the output. The Vercel build must not fetch Drawbridge.
 *
 * Usage: node scripts/sync-drawbridge.mjs [sha]
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SHA = "8ef15ffc4a4dcfbf31414dcb6480016f1701b3e8";
const REPO = "https://github.com/anthonys1760/drawbridge";
const sha = process.argv[2] || DEFAULT_SHA;
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const work = mkdtempSync(join(tmpdir(), "drawbridge-sync-"));

function git(args, cwd = work) {
  execFileSync("git", args, { cwd, stdio: "inherit" });
}

try {
  git(["init"]);
  git(["remote", "add", "origin", `${REPO}.git`]);
  git(["fetch", "--depth", "1", "origin", sha]);
  git(["checkout", "FETCH_HEAD"]);

  const replaySrc = join(work, "site", "replay");
  const fontsSrc = join(work, "site", "fonts");
  const attacksSrc = join(work, "docs", "attack-results.json");
  const publicRoot = join(root, "public", "drawbridge");
  const replayDest = join(publicRoot, "replay");
  const fontsDest = join(publicRoot, "fonts");
  const attacksDest = join(root, "src", "data", "drawbridge-attacks.json");

  rmSync(replayDest, { recursive: true, force: true });
  rmSync(fontsDest, { recursive: true, force: true });
  mkdirSync(replayDest, { recursive: true });
  mkdirSync(fontsDest, { recursive: true });
  mkdirSync(join(root, "src", "data"), { recursive: true });
  cpSync(replaySrc, replayDest, { recursive: true });
  cpSync(fontsSrc, fontsDest, { recursive: true });

  const upstream = JSON.parse(readFileSync(attacksSrc, "utf8"));
  const fetchedAt = new Date().toISOString();
  writeFileSync(
    attacksDest,
    `${JSON.stringify(
      {
        ...upstream,
        sourceCommit: sha,
        sourceUrl: `${REPO}/blob/${sha}/docs/attack-results.json`,
        fetchedAt,
      },
      null,
      2,
    )}\n`,
  );

  writeFileSync(
    join(publicRoot, "SOURCE.txt"),
    [
      `repo: ${REPO}`,
      `sha: ${sha}`,
      `url: ${REPO}/tree/${sha}`,
      `date: ${fetchedAt.slice(0, 10)}`,
      `copied: site/replay -> public/drawbridge/replay`,
      `copied: site/fonts -> public/drawbridge/fonts`,
      `copied: docs/attack-results.json -> src/data/drawbridge-attacks.json`,
      "",
    ].join("\n"),
  );

  console.log(`Vendored Drawbridge at ${sha}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
