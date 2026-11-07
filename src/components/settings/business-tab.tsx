"use client";

import { useEffect, useState } from "react";
import { business } from "@config/business";
import { FormField, SaveFooter, SettingsCard, textareaClass, useSettingsDraft } from "@/components/settings/common";
import { Input } from "@/components/ui/input";

const KEYS = ["owner_name", "abn", "phone", "email", "address", "opening_hours"] as const;

/** Contact details only. Name, logo and colours are set in config/business.ts. */
export function BusinessTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const { draft, set, dirty, saving, save, discard } = useSettingsDraft(KEYS);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const text = (k: (typeof KEYS)[number]) => ({
    id: `biz-${k}`,
    value: draft[k] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value || null),
  });

  async function onSave() {
    setError(null);
    if (draft.abn && draft.abn.replace(/\s/g, "").length !== 11) return setError("ABN must be 11 digits.");
    await save();
  }

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Business details"
        description={
          <>
            Shown on the printed check-in sheet. Leave a field blank to use the default from the app&apos;s branding file. The business
            name ({business.name}), logo and colours are set in <code className="font-mono text-[13px]">config/business.ts</code>.
          </>
        }
        footer={<SaveFooter dirty={dirty} saving={saving} onSave={onSave} onDiscard={discard} />}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="biz-owner_name" label="Owner name">
            <Input {...text("owner_name")} autoComplete="name" />
          </FormField>
          <FormField id="biz-abn" label="ABN" hint="11 digits" error={error}>
            <Input {...text("abn")} inputMode="numeric" />
          </FormField>
          <FormField id="biz-phone" label="Phone">
            <Input {...text("phone")} type="tel" inputMode="tel" autoComplete="tel" placeholder={business.contact.phone} />
          </FormField>
          <FormField id="biz-email" label="Email" hint="Also receives new check-in email alerts (Notifications tab).">
            <Input {...text("email")} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder={business.contact.email} />
          </FormField>
          <FormField id="biz-address" label="Address" className="sm:col-span-2">
            <Input {...text("address")} autoComplete="street-address" placeholder={business.contact.address} />
          </FormField>
          <FormField id="biz-opening_hours" label="Opening hours" className="sm:col-span-2">
            <textarea {...text("opening_hours")} className={textareaClass} placeholder={"Mon–Fri 7:30am–5:00pm\nSat closed"} />
          </FormField>
        </div>
      </SettingsCard>
    </div>
  );
}
