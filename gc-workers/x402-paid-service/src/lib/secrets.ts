/**
 * Runtime-agnostic secret resolver.
 *
 * Resolution order (first non-empty wins):
 *   1. An explicit env/binding object (Cloudflare Worker `env`, or any object
 *      passed in). This is the ONLY source that works in a Cloudflare Worker,
 *      since Workers have no filesystem and no populated `process.env`.
 *   2. A Podman/Docker secret file at `/run/secrets/<name>` (Node runtimes only).
 *   3. `process.env[<name>]` (Node runtimes only).
 *
 * The container applications stay agnostic to the host `.vault` layout: the host
 * decrypts `.vault/secrets.enc.yaml` and injects values as native Podman secrets
 * mounted at `/run/secrets/<name>`. This module never reads `.vault` directly.
 *
 * NOTE ON RUNTIME: gc-payment-engine currently ships as a Cloudflare Worker
 * (see wrangler.toml). In that deployment only source (1) applies — inject
 * secrets via `wrangler secret put` so they appear on the `env` binding. The
 * `/run/secrets` + `process.env` paths only take effect if this code is instead
 * run as a Node service inside the Podman container. The resolver supports both
 * so the same code is portable; it does not, by itself, make a Worker able to
 * read a container filesystem.
 */

export type SecretBindings = Record<string, unknown> | undefined;

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

async function readSecretFile(name: string): Promise<string | undefined> {
  // Only attempt on a runtime that actually has Node's filesystem. In a
  // Worker this short-circuits, so we never bundle-fault on node:fs.
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  if (!proc?.versions?.node) return undefined;
  try {
    const fs = await import("node:fs/promises");
    const raw = await fs.readFile(`/run/secrets/${name}`, "utf8");
    return nonEmptyString(raw.trim());
  } catch {
    // Missing file / no fs access / permission error: fall through to next source.
    return undefined;
  }
}

/**
 * Resolve a single named secret. Returns undefined if no source provides it.
 * Callers decide whether a missing secret is fatal (it usually is for signing
 * keys / webhook secrets — fail closed rather than proceed unauthenticated).
 */
export async function resolveSecret(name: string, env?: SecretBindings): Promise<string | undefined> {
  const fromBinding = nonEmptyString(env?.[name]);
  if (fromBinding) return fromBinding;

  const fromFile = await readSecretFile(name);
  if (fromFile) return fromFile;

  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  return nonEmptyString(proc?.env?.[name]);
}

/** Resolve a secret or throw — use for secrets whose absence must fail closed. */
export async function requireSecret(name: string, env?: SecretBindings): Promise<string> {
  const value = await resolveSecret(name, env);
  if (!value) {
    throw new Error(`Required secret "${name}" is not available from env binding, /run/secrets, or process.env`);
  }
  return value;
}
