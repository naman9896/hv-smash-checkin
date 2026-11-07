"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, KeyRound, Loader2 } from "lucide-react";
import { Logo } from "@/components/logo";
import { PasswordStrength } from "@/components/settings/password-strength";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setNewPassword } from "@/lib/data";
import { getSupabase } from "@/lib/supabase";
import { passwordSchema } from "@/lib/validation";

/** Landing page for the Supabase password-reset email link. */
export default function ResetPasswordPage() {
  const [state, setState] = useState<"checking" | "ready" | "invalid" | "done">("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const sb = getSupabase();
      // The client exchanges the ?code= from the email link on start-up; fall back to doing it here.
      let { data } = await sb.auth.getSession();
      const code = new URLSearchParams(window.location.search).get("code");
      if (!data.session && code) {
        await sb.auth.exchangeCodeForSession(code).catch(() => null);
        ({ data } = await sb.auth.getSession());
      }
      setState(data.session ? "ready" : "invalid");
    })();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    if (password !== confirm) return setError("Passwords don't match.");
    setBusy(true);
    try {
      await setNewPassword(password);
      setState("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-navy px-5 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex justify-center">
          <Logo className="h-20" />
        </div>
        <div className="rounded-[20px] bg-white p-7 shadow-2xl sm:p-9">
          <h1 className="text-xl font-bold">Choose a new password</h1>
          {state === "checking" && (
            <p className="mt-6 flex items-center gap-2 text-muted">
              <Loader2 className="h-5 w-5 animate-spin" /> Checking your reset link…
            </p>
          )}
          {state === "invalid" && (
            <div className="mt-6 space-y-5">
              <p className="rounded-[12px] bg-red-50 p-4 text-[15px] text-red-700" role="alert">
                This reset link is invalid or has expired. Request a new one from the login page.
              </p>
              <Button asChild size="lg" className="w-full">
                <Link href="/login">Back to login</Link>
              </Button>
            </div>
          )}
          {state === "done" && (
            <div className="mt-6 space-y-5">
              <p className="flex gap-3 rounded-[12px] bg-emerald-50 p-4 text-[15px] text-emerald-800" role="status">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /> Password updated.
              </p>
              <Button size="lg" className="w-full" onClick={() => window.location.replace("/dashboard")}>
                Go to dashboard
              </Button>
            </div>
          )}
          {state === "ready" && (
            <form onSubmit={onSubmit} className="mt-6 space-y-5" noValidate>
              <div className="space-y-2">
                <Label htmlFor="new-password">New password</Label>
                <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
                <PasswordStrength password={password} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
              </div>
              {error && (
                <p role="alert" className="rounded-[12px] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  {error}
                </p>
              )}
              <Button type="submit" size="lg" className="w-full" disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : <KeyRound />} Save new password
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
