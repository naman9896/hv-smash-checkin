// Guard for every test that talks to a real Supabase project (DB integration + E2E).
//
// Tests must only ever run against the separate STAGING project. This module:
//   1. loads `.env.test.local` (if present) into process.env, without overriding values already set
//   2. works out which project refs are PRODUCTION (fail closed: if none are known, refuse)
//   3. refuses to continue if the test URL or keys point at production, or don't match each other
//
// Error messages never contain URLs, refs or keys.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

export const TEST_ENV_FILE = ".env.test.local";

/** Files that may hold the production app's NEXT_PUBLIC_SUPABASE_URL. Only that one key is read. */
const PRODUCTION_ENV_FILES = [".env.local", ".env", ".env.production", ".env.production.local", ".env.development.local"];

const SUPABASE_HOST = /^([a-z0-9]{20})\.supabase\.co$/;

export class UnsafeTestTargetError extends Error {
  constructor(reason: string) {
    super(`Refusing to run tests against Supabase: ${reason}`);
    this.name = "UnsafeTestTargetError";
  }
}

export type TestTargetInput = {
  url: string | undefined;
  anonKey: string | undefined;
  serviceRoleKey: string | undefined;
  productionRefs: readonly string[];
};

export type TestTarget = { url: string; ref: string; anonKey: string; serviceRoleKey: string };

/** `https://<ref>.supabase.co` → `<ref>`; anything else → null. */
export function projectRefFromUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  const m = SUPABASE_HOST.exec(u.hostname.toLowerCase());
  return m ? m[1] : null;
}

/** Legacy Supabase keys are JWTs carrying `ref` and `role`. New `sb_*` keys carry neither. */
function jwtClaims(key: string): { ref?: unknown; role?: unknown } | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function checkKey(name: string, key: string, ref: string, role: "anon" | "service_role", productionRefs: Set<string>) {
  const claims = jwtClaims(key);
  if (!claims) return; // sb_publishable_/sb_secret_ keys: nothing to check offline
  if (typeof claims.ref === "string") {
    if (productionRefs.has(claims.ref)) throw new UnsafeTestTargetError(`${name} belongs to the production project.`);
    if (claims.ref !== ref) throw new UnsafeTestTargetError(`${name} is for a different project than TEST_SUPABASE_URL.`);
  }
  if (typeof claims.role === "string" && claims.role !== role) {
    throw new UnsafeTestTargetError(`${name} has the wrong role (expected ${role}).`);
  }
}

export function assertSafeTestTarget(input: TestTargetInput): TestTarget {
  const { url, anonKey, serviceRoleKey } = input;
  const missing = [
    !url && "TEST_SUPABASE_URL",
    !anonKey && "TEST_SUPABASE_ANON_KEY",
    !serviceRoleKey && "TEST_SUPABASE_SERVICE_ROLE_KEY",
  ].filter(Boolean);
  if (missing.length) {
    throw new UnsafeTestTargetError(`missing ${missing.join(", ")} (put them in ${TEST_ENV_FILE}).`);
  }

  const ref = projectRefFromUrl(url);
  if (!ref) throw new UnsafeTestTargetError("TEST_SUPABASE_URL must look like https://<project-ref>.supabase.co.");

  const productionRefs = new Set(input.productionRefs.map((r) => r.trim().toLowerCase()).filter(Boolean));
  if (productionRefs.size === 0) {
    throw new UnsafeTestTargetError(
      "the production project ref is unknown, so staging can't be told apart from production. " +
        "Set PROD_SUPABASE_PROJECT_REFS, or keep NEXT_PUBLIC_SUPABASE_URL in .env.local.",
    );
  }
  if (productionRefs.has(ref)) throw new UnsafeTestTargetError("TEST_SUPABASE_URL is the production project.");

  checkKey("TEST_SUPABASE_ANON_KEY", anonKey!, ref, "anon", productionRefs);
  checkKey("TEST_SUPABASE_SERVICE_ROLE_KEY", serviceRoleKey!, ref, "service_role", productionRefs);
  if (anonKey === serviceRoleKey) throw new UnsafeTestTargetError("anon and service-role keys are identical.");

  return { url: url!.trim().replace(/\/+$/, ""), ref, anonKey: anonKey!, serviceRoleKey: serviceRoleKey! };
}

/**
 * Production refs from `PROD_SUPABASE_PROJECT_REFS` (comma-separated; used in CI) plus the
 * NEXT_PUBLIC_SUPABASE_URL of the app's own env files (local dev). The values are only parsed
 * here; nothing from those files is put into process.env.
 */
export function productionRefs(cwd: string = process.cwd(), env: Record<string, string | undefined> = process.env): string[] {
  const refs = new Set<string>();
  for (const r of (env.PROD_SUPABASE_PROJECT_REFS ?? "").split(",")) {
    if (r.trim()) refs.add(r.trim().toLowerCase());
  }
  const fromEnv = projectRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  if (fromEnv) refs.add(fromEnv);
  for (const file of PRODUCTION_ENV_FILES) {
    const p = path.join(cwd, file);
    if (!existsSync(p)) continue;
    const ref = projectRefFromUrl(parseEnv(readFileSync(p, "utf8")).NEXT_PUBLIC_SUPABASE_URL);
    if (ref) refs.add(ref);
  }
  return [...refs];
}

/** Load `.env.test.local` (values already in process.env win, e.g. CI secrets). */
export function loadTestEnvFile(cwd: string = process.cwd()): void {
  const p = path.join(cwd, TEST_ENV_FILE);
  if (existsSync(p)) process.loadEnvFile(p);
}

/** Load test env and assert it is safe. Call before any test touches Supabase. */
export function requireTestTarget(cwd: string = process.cwd()): TestTarget {
  // A production NEXT_PUBLIC_SUPABASE_URL in the process env would be read as a production ref
  // above (good), but it must never be what tests connect to: they only use TEST_* variables.
  loadTestEnvFile(cwd);
  return assertSafeTestTarget({
    url: process.env.TEST_SUPABASE_URL,
    anonKey: process.env.TEST_SUPABASE_ANON_KEY,
    serviceRoleKey: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY,
    productionRefs: productionRefs(cwd),
  });
}
