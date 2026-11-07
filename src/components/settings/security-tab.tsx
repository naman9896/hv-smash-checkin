"use client";

import { useEffect, useState } from "react";
import { KeyRound, Loader2, LogOut, MonitorX } from "lucide-react";
import { toast } from "sonner";
import { useBrand } from "@/components/brand-provider";
import { useDashboard } from "@/components/dashboard/shell";
import { FormField, SaveFooter, selectClass, SettingsCard, useSettingsDraft } from "@/components/settings/common";
import { PasswordStrength } from "@/components/settings/password-strength";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Modal } from "@/components/ui/modal";
import { changePassword, checkPassword, setPin, signOut, verifyPin } from "@/lib/data";
import { AUTO_LOCK_OPTIONS } from "@/lib/settings";
import type { Settings } from "@/lib/types";
import { passwordSchema, pinSchema } from "@/lib/validation";

const KEYS = ["auto_lock_minutes"] as const;

export function SecurityTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const { email } = useDashboard();
  const { kiosk, refresh: refreshBrand } = useBrand();
  const lockDraft = useSettingsDraft(KEYS);

  // Change password
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  // Change PIN
  const [pin, setPinFields] = useState({ current: "", next: "", confirm: "" });
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  const [confirmGlobal, setConfirmGlobal] = useState(false);
  const [globalBusy, setGlobalBusy] = useState(false);

  const dirty = lockDraft.dirty || Object.values(pw).some(Boolean) || Object.values(pin).some(Boolean);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  async function onChangePassword() {
    setPwError(null);
    const parsed = passwordSchema.safeParse(pw.next);
    if (!pw.current) return setPwError("Enter your current password.");
    if (!parsed.success) return setPwError(parsed.error.issues[0].message);
    if (pw.next !== pw.confirm) return setPwError("New passwords don't match.");
    if (pw.next === pw.current) return setPwError("Choose a password different from the current one.");
    setPwBusy(true);
    try {
      await changePassword(pw.current, pw.next);
      setPw({ current: "", next: "", confirm: "" });
      toast.success("Password changed");
    } catch (e) {
      setPwError(e instanceof Error ? e.message : "Couldn't change the password.");
    } finally {
      setPwBusy(false);
    }
  }

  async function onChangePin() {
    setPinError(null);
    if (!pin.current) return setPinError(kiosk.pin_set ? "Enter your current PIN." : "Enter your password.");
    const parsed = pinSchema.safeParse(pin.next);
    if (!parsed.success) return setPinError(parsed.error.issues[0].message);
    if (pin.next !== pin.confirm) return setPinError("New PINs don't match.");
    setPinBusy(true);
    try {
      const ok = kiosk.pin_set ? await verifyPin(pin.current) : await checkPassword(pin.current);
      if (!ok) {
        setPinError(kiosk.pin_set ? "Current PIN is incorrect." : "Password is incorrect.");
        return;
      }
      await setPin(pin.next);
      await refreshBrand();
      setPinFields({ current: "", next: "", confirm: "" });
      toast.success(kiosk.pin_set ? "PIN changed" : "PIN set");
    } catch (e) {
      setPinError(e instanceof Error ? e.message : "Couldn't save the PIN.");
    } finally {
      setPinBusy(false);
    }
  }

  async function onLogoutEverywhere() {
    setGlobalBusy(true);
    sessionStorage.removeItem("checkin.locked");
    await signOut("global");
    window.location.replace("/login");
  }

  const pinInput = (k: keyof typeof pin, label: string, autoComplete = "off") => (
    <FormField id={`pin-${k}`} label={label}>
      <Input
        id={`pin-${k}`}
        type="password"
        inputMode="numeric"
        autoComplete={autoComplete}
        maxLength={6}
        value={pin[k]}
        onChange={(e) => setPinFields((p) => ({ ...p, [k]: e.target.value.replace(/\D/g, "").slice(0, 6) }))}
        className="font-mono tracking-[0.3em]"
      />
    </FormField>
  );

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Change password"
        description={`Owner login: ${email}`}
        footer={
          <Button onClick={onChangePassword} disabled={pwBusy || !pw.current || !pw.next}>
            {pwBusy ? <Loader2 className="animate-spin" /> : <KeyRound />} Change password
          </Button>
        }
      >
        <form className="grid gap-5 sm:grid-cols-3" onSubmit={(e) => e.preventDefault()}>
          <input type="text" autoComplete="username" value={email} readOnly hidden />
          <FormField id="pw-current" label="Current password">
            <Input id="pw-current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
          </FormField>
          <FormField id="pw-next" label="New password" hint="At least 8 characters">
            <Input id="pw-next" type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
            <PasswordStrength password={pw.next} />
          </FormField>
          <FormField id="pw-confirm" label="Confirm new password">
            <Input id="pw-confirm" type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} />
          </FormField>
        </form>
        {pwError && (
          <p role="alert" className="mt-4 rounded-[12px] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {pwError}
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        title={kiosk.pin_set ? "Change PIN" : "Set up a PIN"}
        description="A 4–6 digit PIN unlocks the dashboard after auto-lock and lets staff leave the iPad kiosk. It is stored only as a bcrypt hash."
        footer={
          <Button onClick={onChangePin} disabled={pinBusy || !pin.next}>
            {pinBusy ? <Loader2 className="animate-spin" /> : <KeyRound />} {kiosk.pin_set ? "Change PIN" : "Set PIN"}
          </Button>
        }
      >
        <form className="grid gap-5 sm:grid-cols-3" onSubmit={(e) => e.preventDefault()}>
          {kiosk.pin_set ? (
            pinInput("current", "Current PIN")
          ) : (
            <FormField id="pin-current" label="Your password" hint="No PIN exists yet, so confirm with your password.">
              <Input id="pin-current" type="password" autoComplete="current-password" value={pin.current} onChange={(e) => setPinFields((p) => ({ ...p, current: e.target.value }))} />
            </FormField>
          )}
          {pinInput("next", "New PIN")}
          {pinInput("confirm", "Confirm new PIN")}
        </form>
        {pinError && (
          <p role="alert" className="mt-4 rounded-[12px] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {pinError}
          </p>
        )}
      </SettingsCard>

      <SettingsCard
        title="Auto-lock"
        description="Lock the dashboard to the PIN screen after this much inactivity."
        footer={<SaveFooter dirty={lockDraft.dirty} saving={lockDraft.saving} onSave={() => lockDraft.save()} onDiscard={lockDraft.discard} />}
      >
        <FormField id="auto-lock" label="Lock after" className="max-w-xs">
          <select
            id="auto-lock"
            className={selectClass}
            value={lockDraft.draft.auto_lock_minutes}
            onChange={(e) => lockDraft.set("auto_lock_minutes", Number(e.target.value) as Settings["auto_lock_minutes"])}
          >
            {AUTO_LOCK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>
        {!kiosk.pin_set && lockDraft.draft.auto_lock_minutes > 0 && (
          <p className="mt-3 text-sm text-muted">Until a PIN is set, the lock screen asks for your password.</p>
        )}
      </SettingsCard>

      <SettingsCard title="Sessions" description="Sign out every browser and device that is logged in to the dashboard, including this one.">
        <Button variant="outline" onClick={() => setConfirmGlobal(true)}>
          <MonitorX /> Log out of all devices
        </Button>
      </SettingsCard>

      <Modal
        open={confirmGlobal}
        onOpenChange={setConfirmGlobal}
        icon={<LogOut className="text-danger" />}
        title="Log out everywhere?"
        description="Every device will need the password to sign in again."
      >
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Button variant="outline" size="lg" onClick={() => setConfirmGlobal(false)}>
            Cancel
          </Button>
          <Button variant="destructive" size="lg" onClick={onLogoutEverywhere} disabled={globalBusy}>
            {globalBusy && <Loader2 className="animate-spin" />} Log out all
          </Button>
        </div>
      </Modal>
    </div>
  );
}
