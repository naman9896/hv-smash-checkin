"use client";

import { useEffect, useState } from "react";
import { Volume2 } from "lucide-react";
import { toast } from "sonner";
import { FormField, SaveFooter, selectClass, SettingsCard, ToggleRow, useSettingsDraft } from "@/components/settings/common";
import { Button } from "@/components/ui/button";
import { CHIME_LABEL, playChime } from "@/lib/chime";
import { CHIMES, type Chime } from "@/lib/types";

const KEYS = ["sound_enabled", "chime", "browser_notifications", "email_alerts"] as const;

export function NotificationsTab({ onDirty }: { onDirty: (d: boolean) => void }) {
  const { draft, set, dirty, saving, save, discard } = useSettingsDraft(KEYS);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(() =>
    typeof Notification === "undefined" ? "unsupported" : Notification.permission,
  );

  useEffect(() => onDirty(dirty), [dirty, onDirty]);

  async function toggleBrowser(on: boolean) {
    if (!on) return set("browser_notifications", false);
    if (permission === "unsupported") return toast.error("This browser doesn't support notifications.");
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p === "granted") {
      set("browser_notifications", true);
      new Notification("Notifications are on", { body: "You'll see new check-ins here.", icon: "/icon-192.png" });
    } else {
      toast.error("Notifications are blocked", { description: "Allow notifications for this site in your browser settings, then try again." });
    }
  }

  return (
    <div className="space-y-6">
      <SettingsCard
        title="New check-in alerts"
        description="How the dashboard tells you a customer has checked in."
        footer={<SaveFooter dirty={dirty} saving={saving} onSave={() => save()} onDiscard={discard} />}
      >
        <div className="divide-y divide-line">
          <ToggleRow id="sound" label="Play a sound" checked={draft.sound_enabled} onCheckedChange={(v) => set("sound_enabled", v)} />
          <div className="flex flex-wrap items-end gap-3 py-4">
            <FormField id="chime" label="Chime" className="w-full max-w-xs">
              <select id="chime" className={selectClass} value={draft.chime} onChange={(e) => set("chime", e.target.value as Chime)} disabled={!draft.sound_enabled}>
                {CHIMES.map((c) => (
                  <option key={c} value={c}>
                    {CHIME_LABEL[c]}
                  </option>
                ))}
              </select>
            </FormField>
            <Button variant="outline" className="h-12" onClick={() => playChime(draft.chime)}>
              <Volume2 /> Preview
            </Button>
          </div>
          <ToggleRow
            id="browser-notifications"
            label="Browser notifications"
            description={
              permission === "denied"
                ? "Blocked in this browser – allow notifications for this site first."
                : permission === "unsupported"
                  ? "Not supported in this browser."
                  : "Pop-up alerts even when the dashboard tab is in the background. Applies to this browser."
            }
            checked={draft.browser_notifications}
            onCheckedChange={toggleBrowser}
            disabled={permission === "unsupported"}
          />
          <ToggleRow
            id="email-alerts"
            label="Email alert for each check-in"
            description="Sent to the business email in Business Details. Needs the email function set up (see README)."
            checked={draft.email_alerts}
            onCheckedChange={(v) => set("email_alerts", v)}
          />
        </div>
      </SettingsCard>
    </div>
  );
}
