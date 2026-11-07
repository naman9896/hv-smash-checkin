"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Lock, MailCheck, Send } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendPasswordReset, signIn } from "@/lib/data";
import { isValidEmail } from "@/lib/utils";

export default function LoginPage() {
  const [mode, setMode] = useState<"login" | "forgot" | "sent">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidEmail(email)) return setError("Enter the owner email address.");
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      sessionStorage.removeItem("checkin.locked");
      const next = new URLSearchParams(window.location.search).get("next");
      // Full page load: the client router may hold a pre-login prefetch of /dashboard (a redirect)
      // Semgrep false positive (reviewed 2026-11-05): `next` must start with "/dashboard", so it is
      // always a same-origin path (no other host, no javascript: URL).
      // nosemgrep: javascript.browser.security.open-redirect.js-open-redirect
      window.location.replace(next && next.startsWith("/dashboard") ? next : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
      setBusy(false);
    }
  }

  async function onForgot(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isValidEmail(email)) return setError("Enter the owner email address.");
    setBusy(true);
    try {
      await sendPasswordReset(email.trim());
      setMode("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't send the reset email.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-5 py-10">
      <div className="w-full max-w-md">
        <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-400 hover:text-white">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Back to portals
        </Link>
        <div className="mb-6 flex justify-center">
          <Logo className="h-20" />
        </div>
        <div className="rounded-[20px] bg-white p-7 shadow-2xl sm:p-9">
          <h1 className="text-xl font-bold">{mode === "login" ? "Staff Login" : "Reset password"}</h1>
          <p className="text-sm text-muted">
            {mode === "login" ? "Owner Dashboard" : "We'll email you a link to choose a new password."}
          </p>

          {mode === "sent" ? (
            <div className="mt-7 space-y-5">
              <p className="flex gap-3 rounded-[12px] bg-emerald-50 p-4 text-[15px] text-emerald-800" role="status">
                <MailCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                If {email.trim()} is the owner account, a reset link is on its way. Open it on this device.
              </p>
              <Button variant="outline" size="lg" className="w-full" onClick={() => setMode("login")}>
                Back to sign in
              </Button>
            </div>
          ) : (
            <form onSubmit={mode === "login" ? onLogin : onForgot} className="mt-7 space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoCapitalize="none"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              {mode === "login" && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setMode("forgot");
                      }}
                      className="text-sm font-semibold text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              )}
              {error && (
                <p role="alert" className="rounded-[12px] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  {error}
                </p>
              )}
              {mode === "login" ? (
                <Button type="submit" size="lg" className="w-full" disabled={busy || !password}>
                  {busy ? <Loader2 className="animate-spin" /> : <Lock />}
                  {busy ? "Signing in…" : "Sign in"}
                </Button>
              ) : (
                <div className="space-y-3">
                  <Button type="submit" size="lg" className="w-full" disabled={busy}>
                    {busy ? <Loader2 className="animate-spin" /> : <Send />}
                    Send reset link
                  </Button>
                  <Button type="button" variant="ghost" className="w-full" onClick={() => setMode("login")}>
                    Back to sign in
                  </Button>
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
