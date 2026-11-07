"use client";

import { useState } from "react";
import { KeyRound, Loader2, Lock, LogOut } from "lucide-react";
import { useBrand } from "@/components/brand-provider";
import { Logo } from "@/components/logo";
import { PinPad } from "@/components/pin-pad";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkPassword, verifyPin } from "@/lib/data";

const MAX_PIN_ATTEMPTS = 5;
const ATTEMPTS_KEY = "checkin.lock.attempts";

/** Auto-lock overlay. PIN unlocks; 5 wrong PINs force a full logout. */
export function LockScreen({ email, onUnlock, onForceLogout }: { email: string; onUnlock: () => void; onForceLogout: () => void }) {
  const { kiosk } = useBrand();
  const [mode, setMode] = useState<"pin" | "password">(kiosk.pin_set ? "pin" : "password");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function unlocked() {
    sessionStorage.removeItem(ATTEMPTS_KEY);
    onUnlock();
  }

  async function onPin(pin: string): Promise<string | null> {
    try {
      if (await verifyPin(pin)) {
        unlocked();
        return null;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Couldn't check the PIN";
      // Database lockout after repeated failures: require the password
      if (/too many/i.test(msg)) onForceLogout();
      return msg;
    }
    const attempts = Number(sessionStorage.getItem(ATTEMPTS_KEY) || 0) + 1;
    sessionStorage.setItem(ATTEMPTS_KEY, String(attempts));
    if (attempts >= MAX_PIN_ATTEMPTS) {
      sessionStorage.removeItem(ATTEMPTS_KEY);
      onForceLogout();
      return "Too many attempts – signing out…";
    }
    const left = MAX_PIN_ATTEMPTS - attempts;
    return `Incorrect PIN. ${left} attempt${left === 1 ? "" : "s"} left.`;
  }

  async function onPassword(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    if (await checkPassword(password)) unlocked();
    else {
      setError("Incorrect password.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center overflow-y-auto bg-navy px-6 py-10 text-white" role="dialog" aria-modal="true" aria-labelledby="lock-title">
      <Logo className="h-16 sm:h-20" />
      <div className="mt-8 flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
        <Lock className="h-7 w-7" aria-hidden="true" />
      </div>
      <h1 id="lock-title" className="mt-4 text-2xl font-bold">
        Dashboard locked
      </h1>
      <p className="mt-1 text-sm text-slate-400">{email}</p>

      <div className="mt-8 w-full max-w-sm">
        {mode === "pin" ? (
          <PinPad tone="dark" onSubmit={onPin} />
        ) : (
          <form onSubmit={onPassword} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="unlock-password" className="text-white">
                Password
              </Label>
              <Input
                id="unlock-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm font-medium text-red-300">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={busy || !password}>
              {busy ? <Loader2 className="animate-spin" /> : <KeyRound />} Unlock
            </Button>
          </form>
        )}
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        {kiosk.pin_set && (
          <Button variant="dark" onClick={() => setMode(mode === "pin" ? "password" : "pin")}>
            <KeyRound /> {mode === "pin" ? "Use password instead" : "Use PIN instead"}
          </Button>
        )}
        <Button variant="dark" onClick={onForceLogout}>
          <LogOut /> Sign out
        </Button>
      </div>
    </div>
  );
}
