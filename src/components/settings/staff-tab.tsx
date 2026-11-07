"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ExternalLink, KeyRound, Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { useBrand } from "@/components/brand-provider";
import { FormField, SaveFooter, SettingsCard, useSettingsDraft } from "@/components/settings/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setStaffPin } from "@/lib/data";
import { pinSchema } from "@/lib/validation";

const KEYS = ["staff_names"] as const;

export function StaffTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const { kiosk, refresh: refreshBrand } = useBrand();
  const { draft, set, dirty, saving, save, discard } = useSettingsDraft(KEYS);
  const [newName, setNewName] = useState("");
  const [pin, setPinFields] = useState({ next: "", confirm: "" });
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinBusy, setPinBusy] = useState(false);

  const pinDirty = !!(pin.next || pin.confirm);
  useEffect(() => onDirty(dirty || pinDirty), [dirty, pinDirty, onDirty]);

  const names = draft.staff_names;

  function addName() {
    const n = newName.trim().replace(/\s+/g, " ");
    if (!n) return;
    if (names.some((x) => x.toLowerCase() === n.toLowerCase())) {
      toast.info(`${n} is already on the list`);
      return setNewName("");
    }
    set("staff_names", [...names, n]);
    setNewName("");
  }

  function move(from: number, to: number) {
    if (to < 0 || to >= names.length) return;
    const next = [...names];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    set("staff_names", next);
  }

  async function onSetPin() {
    setPinError(null);
    const parsed = pinSchema.safeParse(pin.next);
    if (!parsed.success) return setPinError(parsed.error.issues[0].message);
    if (pin.next !== pin.confirm) return setPinError("PINs don't match.");
    setPinBusy(true);
    try {
      await setStaffPin(pin.next);
      await refreshBrand();
      setPinFields({ next: "", confirm: "" });
      toast.success(kiosk.staff_pin_set ? "Staff PIN changed" : "Staff PIN set");
    } catch (e) {
      setPinError(e instanceof Error ? e.message : "Couldn't save the PIN.");
    } finally {
      setPinBusy(false);
    }
  }

  const pinInput = (k: keyof typeof pin, label: string) => (
    <FormField id={`staff-pin-${k}`} label={label}>
      <Input
        id={`staff-pin-${k}`}
        type="password"
        inputMode="numeric"
        autoComplete="off"
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
        title="Employees"
        description={
          <>
            Names in the dropdown on the Staff Job Sheet.{" "}
            <Link href="/jobs" target="_blank" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
              Open job sheet <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </>
        }
        footer={<SaveFooter dirty={dirty} saving={saving} onSave={() => save()} onDiscard={discard} />}
      >
        {names.length === 0 ? (
          <p className="rounded-[12px] bg-amber-50 p-4 text-[15px] text-amber-900">No employees yet – add the workshop team below so they can pick their name.</p>
        ) : (
          <ul className="divide-y divide-line rounded-[12px] border border-line">
            {names.map((n, i) => (
              <li key={n} className="flex items-center gap-2 px-4 py-2">
                <span className="flex-1 text-[15px] font-semibold">{n}</span>
                <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="rounded-full p-2 text-muted hover:bg-slate-100 disabled:opacity-30" aria-label={`Move ${n} up`}>
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, i + 1)}
                  disabled={i === names.length - 1}
                  className="rounded-full p-2 text-muted hover:bg-slate-100 disabled:opacity-30"
                  aria-label={`Move ${n} down`}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => set("staff_names", names.filter((x) => x !== n))}
                  className="rounded-full p-2 text-muted hover:bg-red-50 hover:text-danger"
                  aria-label={`Remove ${n}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex max-w-md gap-2">
          <label htmlFor="new-staff" className="sr-only">
            Employee name
          </label>
          <Input
            id="new-staff"
            placeholder="Employee name, e.g. Raghu"
            autoCapitalize="words"
            maxLength={40}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addName();
              }
            }}
          />
          <Button variant="outline" onClick={addName} className="h-12">
            <Plus /> Add
          </Button>
        </div>
        <p className="mt-3 text-sm text-muted">Removing someone doesn&apos;t change the jobs they&apos;ve already saved.</p>
      </SettingsCard>

      <SettingsCard
        title={kiosk.staff_pin_set ? "Change staff PIN" : "Set up the staff PIN"}
        description="One shared 4–6 digit PIN for the workshop team to open the Staff Job Sheet. Keep it different from your owner PIN. Stored only as a bcrypt hash; 5 wrong attempts lock the sheet for 5 minutes."
        footer={
          <Button onClick={onSetPin} disabled={pinBusy || !pin.next}>
            {pinBusy ? <Loader2 className="animate-spin" /> : <KeyRound />} {kiosk.staff_pin_set ? "Change staff PIN" : "Set staff PIN"}
          </Button>
        }
      >
        <form className="grid max-w-xl gap-5 sm:grid-cols-2" onSubmit={(e) => e.preventDefault()}>
          {pinInput("next", "New staff PIN")}
          {pinInput("confirm", "Confirm staff PIN")}
        </form>
        {pinError && (
          <p role="alert" className="mt-4 rounded-[12px] bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {pinError}
          </p>
        )}
      </SettingsCard>
    </div>
  );
}
