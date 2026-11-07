import { afterEach, describe, expect, it, vi } from "vitest";
import { isAuthorizedCron } from "../cron-auth";
import { clicksendProvider } from "./clicksend";
import { runDispatch, renderBody, type ClaimedSms } from "./dispatch";
import { logProvider } from "./log";
import { resolveSmsMode } from "./provider";

afterEach(() => vi.restoreAllMocks());

describe("SMS mode: real SMS only in production with SMS_MODE=live", () => {
  it.each([
    [{ SMS_MODE: "live", NODE_ENV: "production", VERCEL_ENV: "production" }, "live"],
    [{ SMS_MODE: "live", NODE_ENV: "production" }, "live"], // not on Vercel (self-hosted prod)
    [{ SMS_MODE: "live", NODE_ENV: "production", VERCEL_ENV: "preview" }, "log"], // preview deployments are production builds
    [{ SMS_MODE: "live", NODE_ENV: "development" }, "log"],
    [{ SMS_MODE: "live", NODE_ENV: "test" }, "log"],
    [{ SMS_MODE: "log", NODE_ENV: "production", VERCEL_ENV: "production" }, "log"],
    [{ NODE_ENV: "production", VERCEL_ENV: "production" }, "log"], // unset = log
    [{ SMS_MODE: "LIVE", NODE_ENV: "production" }, "log"], // exact value only
  ])("%j → %s", (env, mode) => expect(resolveSmsMode(env)).toBe(mode));
});

describe("log provider", () => {
  it("sends nothing and logs no mobile or message text", async () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const r = await logProvider.send("+61412345678", "Hi Sam, secret body", "SaiMotor");
    expect(r).toMatchObject({ ok: true });
    const logged = spy.mock.calls.flat().join(" ");
    expect(logged).not.toMatch(/412345678|Sam|secret/);
  });
});

describe("ClickSend provider", () => {
  const ok = { http_code: 200, response_code: "SUCCESS", data: { messages: [{ status: "SUCCESS", message_id: "MSG-1" }] } };
  const mockFetch = (status: number, body: unknown) =>
    vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

  it("posts to /v3/sms/send with basic auth and returns the message id", async () => {
    const fetch = mockFetch(200, ok);
    const p = clicksendProvider({ username: "user", apiKey: "key", fetch });
    expect(await p.send("+61412345678", "Hello", "SaiMotor")).toEqual({ ok: true, id: "MSG-1" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://rest.clicksend.com/v3/sms/send");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("user:key").toString("base64")}`);
    expect(JSON.parse(init.body as string)).toEqual({ messages: [{ source: "sai-motor-checkin", from: "SaiMotor", to: "+61412345678", body: "Hello" }] });
  });

  it("a per-message failure (e.g. bad number) is not retried", async () => {
    const p = clicksendProvider({ username: "u", apiKey: "k", fetch: mockFetch(200, { ...ok, data: { messages: [{ status: "INVALID_RECIPIENT" }] } }) });
    expect(await p.send("+61412345678", "x", "S")).toEqual({ ok: false, error: "ClickSend: INVALID_RECIPIENT", retryable: false });
  });

  it.each([[500, true], [503, true], [429, true], [401, false], [400, false]])("HTTP %i → retryable %s", async (status, retryable) => {
    const p = clicksendProvider({ username: "u", apiKey: "k", fetch: mockFetch(status, "nope") });
    expect(await p.send("+61412345678", "x", "S")).toEqual({ ok: false, error: `ClickSend HTTP ${status}`, retryable });
  });

  it("network errors and timeouts are retryable, and never echo the mobile", async () => {
    const p = clicksendProvider({ username: "u", apiKey: "k", fetch: vi.fn(async () => { throw new Error("connect to +61412345678 failed"); }) });
    const r = await p.send("+61412345678", "x", "S");
    expect(r).toEqual({ ok: false, error: "ClickSend network error", retryable: true });
  });
});

describe("renderBody", () => {
  it("fills the manage link at send time", () => {
    expect(renderBody("Manage: {manage_link}", "tok_123", "https://book.example")).toBe("Manage: https://book.example/b/tok_123");
  });
  it("leaves bodies without a link alone", () => {
    expect(renderBody("Your car is ready", null, "https://x")).toBe("Your car is ready");
  });
  it("fills the booking page (no token needed)", () => {
    expect(renderBody("To rebook: {booking_page}", null, "https://book.example")).toBe("To rebook: https://book.example/book");
  });
  it("refuses a link body without a token", () => {
    expect(renderBody("Manage: {manage_link}", null, "https://x")).toBeNull();
  });
});

describe("runDispatch", () => {
  const row = (over: Partial<ClaimedSms> = {}): ClaimedSms => ({
    id: crypto.randomUUID(), template: "confirmation", to_mobile: "+61412345678", body: "Hi. Manage: {manage_link}",
    token: "tok", sender_id: "SaiMotor", attempts: 1, ...over,
  });

  it("sends each claimed row with the link filled in and records the result", async () => {
    const rows = [row(), row({ body: "Ready", token: null, template: "ready" })];
    const sent: [string, string, string][] = [];
    const results: unknown[] = [];
    const summary = await runDispatch({
      claim: async () => rows,
      result: async (...args) => void results.push(args),
      provider: { send: async (to, body, sender) => (sent.push([to, body, sender]), { ok: true, id: "P1" }) },
      baseUrl: "https://book.example",
    });
    expect(sent).toEqual([
      ["+61412345678", "Hi. Manage: https://book.example/b/tok", "SaiMotor"],
      ["+61412345678", "Ready", "SaiMotor"],
    ]);
    expect(results).toEqual([[rows[0].id, true, "P1", null, true], [rows[1].id, true, "P1", null, true]]);
    expect(summary).toEqual({ claimed: 2, sent: 2, failed: 0 });
  });

  it("a crash in the provider is a retryable failure, and other rows still go", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rows = [row(), row()];
    const results: unknown[][] = [];
    let n = 0;
    await runDispatch({
      claim: async () => rows,
      result: async (...args) => void results.push(args),
      provider: { send: async () => { if (n++ === 0) throw new Error("boom +61412345678"); return { ok: true, id: "P2" }; } },
      baseUrl: "https://x",
    });
    expect(results[0]).toEqual([rows[0].id, false, null, "Provider error", true]);
    expect(results[1]).toEqual([rows[1].id, true, "P2", null, true]);
  });

  it("a link SMS with no token is failed without sending", async () => {
    const send = vi.fn();
    const results: unknown[][] = [];
    await runDispatch({ claim: async () => [row({ token: null })], result: async (...a) => void results.push(a), provider: { send }, baseUrl: "https://x" });
    expect(send).not.toHaveBeenCalled();
    expect(results[0].slice(1)).toEqual([false, null, "Manage link missing", false]);
  });
});

describe("cron auth", () => {
  const secret = "s3cret-value-long-enough-0123456789";
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorizedCron(`Bearer ${secret}`, secret)).toBe(true);
    expect(isAuthorizedCron(`Bearer ${secret}x`, secret)).toBe(false);
    expect(isAuthorizedCron(secret, secret)).toBe(false);
    expect(isAuthorizedCron(null, secret)).toBe(false);
  });
  it("denies everything when the secret is missing or too short", () => {
    expect(isAuthorizedCron("Bearer ", "")).toBe(false);
    expect(isAuthorizedCron("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorizedCron("Bearer short", "short")).toBe(false);
  });
});
