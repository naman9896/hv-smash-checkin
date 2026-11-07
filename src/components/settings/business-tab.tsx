"use client";

import { useEffect, useRef, useState } from "react";
import { ImageUp, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FormField, SaveFooter, SettingsCard, textareaClass, useSettingsDraft } from "@/components/settings/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LOGO_MAX_BYTES, LOGO_TYPES, logoPublicUrl, uploadLogo } from "@/lib/data";

const KEYS = ["business_name", "owner_name", "abn", "phone", "email", "address", "opening_hours", "logo_path"] as const;

export function BusinessTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const { draft, set, dirty, saving, save, discard } = useSettingsDraft(KEYS);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  const text = (k: Exclude<(typeof KEYS)[number], "logo_path">) => ({
    id: `biz-${k}`,
    value: draft[k] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k, e.target.value || null),
  });

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!LOGO_TYPES.includes(file.type)) return toast.error("Logo must be a PNG, JPG or SVG file.");
    if (file.size > LOGO_MAX_BYTES) return toast.error("Logo must be 2 MB or smaller.");
    setUploading(true);
    try {
      set("logo_path", await uploadLogo(file));
      toast.success("Logo uploaded – click Save to use it");
    } catch (e) {
      toast.error("Upload failed", { description: e instanceof Error ? e.message : undefined });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onSave() {
    setError(null);
    if (!draft.business_name?.trim()) return setError("Business name is required.");
    if (draft.abn && draft.abn.replace(/\s/g, "").length !== 11) return setError("ABN must be 11 digits.");
    await save();
  }

  const preview = logoPublicUrl(draft.logo_path);

  return (
    <div className="space-y-6">
      <SettingsCard
        title="Business details"
        description="Shown on the kiosk, thank-you screen, dashboard and printed job sheets."
        footer={<SaveFooter dirty={dirty} saving={saving} onSave={onSave} onDiscard={discard} />}
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <FormField id="biz-business_name" label="Business name" required error={error}>
            <Input {...text("business_name")} autoComplete="organization" />
          </FormField>
          <FormField id="biz-owner_name" label="Owner name">
            <Input {...text("owner_name")} autoComplete="name" />
          </FormField>
          <FormField id="biz-abn" label="ABN" hint="11 digits">
            <Input {...text("abn")} inputMode="numeric" />
          </FormField>
          <FormField id="biz-phone" label="Phone">
            <Input {...text("phone")} type="tel" inputMode="tel" autoComplete="tel" />
          </FormField>
          <FormField id="biz-email" label="Email" hint="Also receives new check-in email alerts (Notifications tab).">
            <Input {...text("email")} type="email" inputMode="email" autoComplete="email" autoCapitalize="none" />
          </FormField>
          <FormField id="biz-address" label="Address">
            <Input {...text("address")} autoComplete="street-address" />
          </FormField>
          <FormField id="biz-opening_hours" label="Opening hours" className="sm:col-span-2">
            <textarea {...text("opening_hours")} className={textareaClass} placeholder={"Mon–Fri 7:30am–5:00pm\nSat 8:00am–12:00pm"} />
          </FormField>
        </div>

        <div className="mt-6 border-t border-line pt-6">
          <p className="text-[15px] font-semibold">Logo</p>
          <p className="text-sm text-muted">PNG, SVG or JPG, up to 2 MB. A transparent background with light lettering works best on the dark headers.</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <div className="flex h-24 w-56 items-center justify-center rounded-[12px] bg-navy p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={preview ?? "/logo.png"} alt="Logo preview" className="max-h-full max-w-full object-contain" />
            </div>
            <div className="flex flex-col gap-2">
              <input ref={fileRef} type="file" accept={LOGO_TYPES.join(",")} className="sr-only" id="logo-file" onChange={(e) => onFile(e.target.files?.[0])} />
              <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading}>
                {uploading ? <Loader2 className="animate-spin" /> : <ImageUp />} Upload logo
              </Button>
              {draft.logo_path && (
                <Button variant="ghost" onClick={() => set("logo_path", null)}>
                  <Trash2 /> Use default logo
                </Button>
              )}
            </div>
          </div>
        </div>
      </SettingsCard>
    </div>
  );
}
