"use client";

// The customer's manage page body (/b/{token}): view, cancel, change day (BUSINESS_RULES §9).
// The server page loads the first view; changes go through /api/booking/manage/{token}/*.
import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, Car, CheckCircle2, ClipboardList, Loader2, Phone, XCircle } from "lucide-react";
import { DayTile } from "@/components/booking/book-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { addDaysIso, sydneyToday } from "@/lib/booking/dates";
import { formatDayLong, formatWindow, telHref } from "@/lib/booking/format";
import { formatChangeUntil } from "@/lib/booking/manage";
import type { ManageView, PublicDay, PublicInfo } from "@/lib/booking/schemas";

type ApiError = { code: string; message: string };
const FALLBACK_ERROR = "Something went wrong. Please try again, or give us a call.";

async function post(url: string, body?: unknown): Promise<{ view?: ManageView; error?: ApiError }> {
  const r = await fetch(url, {
    method: "POST",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null);
  if (!r) return { error: { code: "NETWORK", message: "No connection. Please check your internet and try again." } };
  const json = await r.json().catch(() => null);
  if (r.ok) return { view: json as ManageView };
  return { error: (json?.error as ApiError) ?? { code: "SERVER_ERROR", message: FALLBACK_ERROR } };
}

export function ManageBooking({ token, initial }: { token: string; initial: ManageView }) {
  const [view, setView] = useState(initial);
  const [mode, setMode] = useState<"view" | "change">("view");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const base = `/api/booking/manage/${token}`;
  const phone = view.business.phone;

  async function cancel() {
    setBusy(true);
    setError(null);
    const r = await post(`${base}/cancel`);
    setBusy(false);
    setConfirmCancel(false);
    if (r.view) {
      setView(r.view);
      setNotice(null);
    } else setError(r.error!.message);
  }

  if (view.status === "cancelled") {
    return (
      <Card className="p-6 text-center sm:p-8">
        <XCircle className="mx-auto mb-3 h-12 w-12 text-muted" aria-hidden="true" />
        <h1 className="text-[24px] font-bold text-ink">Booking cancelled</h1>
        <p className="mt-2 text-[17px]">
          Your booking for <strong>{formatDayLong(view.date)}</strong> ({view.rego}) is cancelled.
        </p>
        <p className="mt-1 text-sm text-muted">Reference {view.referenceNo}</p>
        <Link href="/book" className="mt-5 inline-flex min-h-12 items-center rounded-[12px] bg-primary px-5 font-semibold text-white">
          Book again
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-6 sm:p-8">
        <h1 className="text-[24px] font-bold text-ink">Hi {view.firstName}</h1>
        <p className="mt-1 text-muted">
          {STATUS_TEXT[view.status]} · <span className="font-mono">{view.referenceNo}</span>
        </p>

        {notice && (
          <p role="status" className="mt-4 flex items-start gap-2 rounded-[12px] bg-emerald-50 px-4 py-3 text-[15px] text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" /> {notice}
          </p>
        )}

        <dl className="mt-5 space-y-4">
          <Row icon={CalendarDays} label="Drop-off">
            <strong>{formatDayLong(view.date)}</strong>, drop off {formatWindow(view.window.start, view.window.end)}
          </Row>
          <Row icon={Car} label="Vehicle">
            <span className="font-mono font-semibold">{view.rego}</span> · {view.make} {view.model}
          </Row>
          {view.services.length > 0 && (
            <Row icon={ClipboardList} label="Services">{view.services.join(", ")}</Row>
          )}
        </dl>
      </Card>

      {error && mode === "view" && <ErrorBanner msg={error} />}

      {view.status === "booked" && view.canChange && mode === "view" && (
        <Card className="p-6">
          <p className="text-[15px] text-muted">You can change or cancel online until {formatChangeUntil(view.changeUntil)}.</p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Button size="lg" className="sm:flex-1" onClick={() => { setError(null); setNotice(null); setMode("change"); }}>
              <CalendarDays /> Change day
            </Button>
            <Button size="lg" variant="outline" className="sm:flex-1" onClick={() => { setError(null); setConfirmCancel(true); }}>
              Cancel booking
            </Button>
          </div>
        </Card>
      )}

      {view.status === "booked" && !view.canChange && (
        <Card className="p-6 text-center">
          <p className="text-[15px]">
            It&apos;s too late to change this booking online.{" "}
            {phone ? <>Please call us on {phone}.</> : "Please give the workshop a call."}
          </p>
          {phone && <CallButton phone={phone} />}
        </Card>
      )}

      {mode === "change" && (
        <ChangeDay
          base={base}
          current={view}
          onDone={(v) => {
            setView(v);
            setMode("view");
            setNotice("Booking moved. We'll text you the new details.");
          }}
          onBack={() => setMode("view")}
        />
      )}

      <Modal
        open={confirmCancel}
        onOpenChange={(o) => !busy && setConfirmCancel(o)}
        title="Cancel this booking?"
        description={`${formatDayLong(view.date)} for ${view.rego}. We'll text you to confirm.`}
        icon={<XCircle className="text-danger" />}
      >
        <div className="mt-6 flex flex-col gap-2 sm:flex-row-reverse">
          <Button variant="destructive" className="sm:flex-1" disabled={busy} onClick={cancel}>
            {busy && <Loader2 className="animate-spin" />} Yes, cancel
          </Button>
          <Button variant="outline" className="sm:flex-1" disabled={busy} onClick={() => setConfirmCancel(false)}>
            Keep it
          </Button>
        </div>
      </Modal>
    </div>
  );
}

const STATUS_TEXT: Record<ManageView["status"], string> = {
  booked: "You're booked in",
  arrived: "Your car is with us",
  completed: "All done",
  cancelled: "Cancelled",
  no_show: "Missed booking",
};

function ChangeDay({ base, current, onDone, onBack }: {
  base: string; current: ManageView; onDone: (v: ManageView) => void; onBack: () => void;
}) {
  const [days, setDays] = useState<PublicDay[] | null>(null);
  const [info, setInfo] = useState<PublicInfo | null>(null);
  const [date, setDate] = useState("");
  const [windowId, setWindowId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    fetchChoices().then((r) => {
      if (!live) return;
      if ("error" in r) {
        setDays([]);
        setError(r.error);
        return;
      }
      setInfo(r.info);
      setWindowId((w) => w || r.info.windows[0]?.id || "");
      setDays(r.days);
    });
    return () => {
      live = false;
    };
  }, [reload]);

  async function move() {
    if (!date) {
      setError("Choose a new day");
      return;
    }
    setBusy(true);
    setError(null);
    const r = await post(`${base}/reschedule`, { date, windowId });
    setBusy(false);
    if (r.view) return onDone(r.view);
    setError(r.error!.message);
    if (["FULL", "CLOSED", "CUTOFF_PASSED", "OUTSIDE_HORIZON"].includes(r.error!.code)) {
      setDate("");
      setDays(null);
      setReload((n) => n + 1);
    }
  }

  const windows = info?.windows ?? [];
  return (
    <Card className="p-6">
      <h2 className="text-[19px] font-bold">Pick a new drop-off day</h2>
      <p className="mt-1 text-sm text-muted">Currently {formatDayLong(current.date)}.</p>
      {error && <div className="mt-4"><ErrorBanner msg={error} /></div>}
      <div className="mt-4">
        {days === null ? (
          <div className="flex justify-center py-10 text-muted" role="status">
            <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /><span className="sr-only">Loading days</span>
          </div>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Drop-off days">
            {days.map((d) => (
              <li key={d.date}>
                <DayTile day={d} selected={date === d.date} phone={info?.business.phone ?? null}
                  onPick={() => { setDate(d.date); setError(null); }} />
              </li>
            ))}
          </ul>
        )}
      </div>
      {windows.length > 1 && (
        <fieldset className="mt-5">
          <legend className="mb-2 text-[15px] font-semibold">Drop-off time</legend>
          {windows.map((w) => (
            <label key={w.id} className="mb-2 flex min-h-12 items-center gap-3 rounded-[12px] border border-line px-4">
              <input type="radio" name="window" checked={windowId === w.id} onChange={() => setWindowId(w.id)} />
              {formatWindow(w.start, w.end)}
            </label>
          ))}
        </fieldset>
      )}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
        <Button size="lg" className="sm:flex-1" disabled={busy || !days?.length} onClick={move}>
          {busy && <Loader2 className="animate-spin" />} Move my booking
        </Button>
        <Button size="lg" variant="outline" className="sm:flex-1" disabled={busy} onClick={onBack}>Back</Button>
      </div>
    </Card>
  );
}

/** The windows + phone (/info) and the next 31 days (/availability). */
async function fetchChoices(): Promise<{ info: PublicInfo; days: PublicDay[] } | { error: string }> {
  const from = addDaysIso(sydneyToday(), 1);
  const [a, i] = await Promise.all([
    fetch(`/api/booking/availability?from=${from}&to=${addDaysIso(from, 30)}`).catch(() => null),
    fetch("/api/booking/info").catch(() => null),
  ]);
  if (!i?.ok) return { error: i?.status === 503 ? "Online changes are paused right now. Please give us a call." : FALLBACK_ERROR };
  if (!a?.ok) return { error: "We couldn't load the available days. Please try again." };
  return { info: (await i.json()) as PublicInfo, days: ((await a.json()) as { days: PublicDay[] }).days };
}

function Row({ icon: Icon, label, children }: { icon: typeof Car; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <div>
        <dt className="text-sm font-semibold text-muted">{label}</dt>
        <dd className="text-[16px] text-ink">{children}</dd>
      </div>
    </div>
  );
}

function ErrorBanner({ msg }: { msg: string }) {
  return <p role="alert" className="rounded-[12px] bg-red-50 px-4 py-3 text-[15px] font-medium text-danger">{msg}</p>;
}

function CallButton({ phone }: { phone: string }) {
  return (
    <a href={telHref(phone)} className="mt-4 inline-flex min-h-12 items-center gap-2 rounded-[12px] bg-primary px-5 font-semibold text-white">
      <Phone className="h-5 w-5" aria-hidden="true" /> Call {phone}
    </a>
  );
}

/** The page couldn't load the booking (not a bad link). */
export function ManageProblem() {
  return (
    <Card className="p-6 text-center">
      <h1 className="text-[22px] font-bold">We couldn&apos;t load your booking</h1>
      <p className="mt-2 text-muted">Please try again in a minute, or give the workshop a call.</p>
    </Card>
  );
}
