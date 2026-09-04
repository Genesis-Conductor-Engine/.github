/**
 * THE CUSTODY INVARIANTS.
 *
 * signer.ts, credentials.ts and index.ts each claim, in prose, that the gateway
 * signing key can never reach the Cloudflare Worker. Prose does not survive a
 * well-meaning refactor. This file is the executable form of those claims, and
 * it is the regression guard the other three files name by filename.
 *
 * A failure here is a SECURITY failure, not a test failure: it means the Worker
 * bundle can now carry a signing key, or the vendor SDKs, or both.
 *
 * No network, no key, no wallet — this reads source text and walks the static
 * import graph.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { GATEWAY_KEY_SECRET, MAIN_WALLET, VAULT_ADDRESS } from "./signer";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../..");
const PKG = resolve(SRC, "..");

const WORKER_ENTRY = join(SRC, "index.ts");
const NODE_SHIM = join(SRC, "server.ts");
const WRANGLER = join(PKG, "wrangler.toml");

/** Vendor SDKs that must never enter the Worker bundle. */
const VENDOR_SDKS = ["@alchemy/x402", "mppx"];

const read = (p: string) => readFileSync(p, "utf8");
const rel = (p: string) => relative(PKG, p);

/** Every .ts file under src/, tests excluded — tests do not ship. */
function sourceFiles(dir = SRC, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/**
 * Static `import ... from "x"` / `export ... from "x"` specifiers only.
 *
 * Dynamic import() is deliberately NOT followed: credentials.ts reaches the
 * vendor SDKs through a computed specifier precisely so a bundler cannot see
 * them. Following it here would assert the opposite of the design.
 */
function staticSpecifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)(?:[\s\S]*?)\sfrom\s*["']([^"']+)["']/g;
  for (const m of source.matchAll(re)) out.push(m[1]);
  const bare = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
  for (const m of source.matchAll(bare)) out.push(m[1]);
  return out;
}

function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), spec);
  for (const cand of [base, `${base}.ts`, join(base, "index.ts")]) {
    try {
      readFileSync(cand, "utf8");
      if (cand.endsWith(".ts")) return cand;
    } catch {
      /* try next shape */
    }
  }
  return null;
}

/** Files transitively reachable from `entry` through static imports. */
function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of staticSpecifiers(read(file))) {
      const next = resolveRelative(file, spec);
      if (next) stack.push(next);
    }
  }
  return seen;
}

describe("custody invariants", () => {
  it("the Worker entry cannot statically reach lib/gateway", () => {
    const reachable = [...importGraph(WORKER_ENTRY)].filter((f) => f.includes(`${join("lib", "gateway")}`));
    expect(reachable.map(rel)).toEqual([]);
  });

  it("no shipping source statically imports a vendor payment SDK", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
      const specs = staticSpecifiers(read(file));
      for (const sdk of VENDOR_SDKS) {
        if (specs.includes(sdk)) offenders.push(`${rel(file)} -> ${sdk}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the gateway key is absent from the Worker Env, the Node allowlist and wrangler.toml", () => {
    // buildEnv() populates from an explicit allowlist, so the Node env object
    // cannot carry the key unless someone adds it here. That edit fails this.
    for (const file of [WORKER_ENTRY, NODE_SHIM, WRANGLER]) {
      expect(read(file), `${rel(file)} must not mention ${GATEWAY_KEY_SECRET}`).not.toContain(GATEWAY_KEY_SECRET);
    }
  });

  it("the forbidden-signer addresses still match the deployed payment config", () => {
    // The forbidden-address guard is only meaningful while it names the address
    // revenue actually settles to. wrangler.toml is the executable source.
    const wrangler = read(WRANGLER);
    expect(wrangler).toContain(`VAULT_ADDRESS = "${VAULT_ADDRESS}"`);
    expect(wrangler).toContain(`MAIN_WALLET = "${MAIN_WALLET}"`);
  });
});
