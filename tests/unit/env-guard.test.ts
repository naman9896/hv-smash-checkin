import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertSafeTestTarget,
  productionRefs,
  projectRefFromUrl,
  UnsafeTestTargetError,
} from "../support/env-guard";

// Fake, made-up refs and keys. None of these are real projects.
const STAGING = "stagingstagingstagin";
const PROD = "prodprodprodprodprod";
const url = (ref: string) => `https://${ref}.supabase.co`;
const jwt = (claims: Record<string, unknown>) =>
  ["e30", Buffer.from(JSON.stringify(claims)).toString("base64url"), "sig"].join(".");

const safe = {
  url: url(STAGING),
  anonKey: jwt({ ref: STAGING, role: "anon" }),
  serviceRoleKey: jwt({ ref: STAGING, role: "service_role" }),
  productionRefs: [PROD],
};

describe("projectRefFromUrl", () => {
  it("extracts the ref from a Supabase URL", () => {
    expect(projectRefFromUrl(url(STAGING))).toBe(STAGING);
    expect(projectRefFromUrl(`${url(STAGING)}/`)).toBe(STAGING);
  });
  it.each([undefined, "", "not a url", `http://${STAGING}.supabase.co`, "https://example.com", "https://localhost:54321"])(
    "rejects %s",
    (v) => expect(projectRefFromUrl(v)).toBeNull(),
  );
});

describe("assertSafeTestTarget", () => {
  it("accepts a staging target and returns it", () => {
    expect(assertSafeTestTarget(safe)).toMatchObject({ url: url(STAGING), ref: STAGING });
  });

  it("accepts new-style sb_ keys (no claims to check)", () => {
    expect(() =>
      assertSafeTestTarget({ ...safe, anonKey: "sb_publishable_x", serviceRoleKey: "sb_secret_y" }),
    ).not.toThrow();
  });

  it("refuses the production project URL", () => {
    expect(() => assertSafeTestTarget({ ...safe, url: url(PROD) })).toThrow(/production project/);
  });

  it("refuses when the production ref is unknown (fail closed)", () => {
    expect(() => assertSafeTestTarget({ ...safe, productionRefs: [] })).toThrow(/production project ref is unknown/);
    expect(() => assertSafeTestTarget({ ...safe, productionRefs: [" ", ""] })).toThrow(UnsafeTestTargetError);
  });

  it("matches production refs case-insensitively", () => {
    expect(() => assertSafeTestTarget({ ...safe, productionRefs: [STAGING.toUpperCase()] })).toThrow(/production/);
  });

  it.each(["url", "anonKey", "serviceRoleKey"] as const)("refuses when %s is missing", (k) => {
    expect(() => assertSafeTestTarget({ ...safe, [k]: undefined })).toThrow(/missing/);
  });

  it("refuses a non-Supabase URL", () => {
    expect(() => assertSafeTestTarget({ ...safe, url: "https://example.com" })).toThrow(/must look like/);
  });

  it("refuses a production key with the staging URL", () => {
    expect(() => assertSafeTestTarget({ ...safe, serviceRoleKey: jwt({ ref: PROD, role: "service_role" }) })).toThrow(
      /belongs to the production project/,
    );
  });

  it("refuses a key from another project", () => {
    expect(() =>
      assertSafeTestTarget({ ...safe, anonKey: jwt({ ref: "otherotherotherother", role: "anon" }) }),
    ).toThrow(/different project/);
  });

  it("refuses swapped keys", () => {
    expect(() =>
      assertSafeTestTarget({ ...safe, anonKey: safe.serviceRoleKey, serviceRoleKey: safe.anonKey }),
    ).toThrow(/wrong role/);
  });

  it("refuses identical anon and service keys", () => {
    expect(() => assertSafeTestTarget({ ...safe, anonKey: "sb_x", serviceRoleKey: "sb_x" })).toThrow(/identical/);
  });

  it("never puts the URL, ref or keys in the error message", () => {
    const cases = [
      { ...safe, url: url(PROD) },
      { ...safe, serviceRoleKey: jwt({ ref: PROD, role: "service_role" }) },
      { ...safe, productionRefs: [] },
    ];
    for (const c of cases) {
      try {
        assertSafeTestTarget(c);
        expect.unreachable();
      } catch (e) {
        const msg = (e as Error).message;
        for (const secret of [PROD, STAGING, c.anonKey!, c.serviceRoleKey!]) expect(msg).not.toContain(secret);
      }
    }
  });
});

describe("productionRefs", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "env-guard-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reads PROD_SUPABASE_PROJECT_REFS (comma-separated)", () => {
    expect(productionRefs(dir, { PROD_SUPABASE_PROJECT_REFS: ` ${PROD} , AAAAAAAAAAAAAAAAAAAA ` })).toEqual([
      PROD,
      "aaaaaaaaaaaaaaaaaaaa",
    ]);
  });

  it("reads only NEXT_PUBLIC_SUPABASE_URL from the app's .env.local", () => {
    writeFileSync(path.join(dir, ".env.local"), `NEXT_PUBLIC_SUPABASE_URL=${url(PROD)}\nOTHER_SECRET=shh\n`);
    const env: Record<string, string | undefined> = {};
    expect(productionRefs(dir, env)).toEqual([PROD]);
    expect(env).toEqual({}); // nothing loaded into the env
  });

  it("returns nothing when no production source exists", () => {
    expect(productionRefs(dir, {})).toEqual([]);
  });
});
