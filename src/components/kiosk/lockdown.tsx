"use client";

import { useEffect } from "react";

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };

/** Running from the Home Screen (no browser bars already). */
function isInstalled() {
  return (
    window.matchMedia("(display-mode: fullscreen), (display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isFullscreen() {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement);
}

function requestFullscreen() {
  const d = document as FsDoc;
  const el = document.documentElement as FsEl;
  if (isFullscreen() || !(d.fullscreenEnabled || d.webkitFullscreenEnabled)) return;
  try {
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: "hide" }).catch(() => {});
    else el.webkitRequestFullscreen?.();
  } catch {
    /* not allowed here – Guided Access / Home Screen mode still apply */
  }
}

/**
 * Makes the kiosk hard to leave or mess with: full screen on the first tap
 * (and again if someone exits), no pinch-zoom, long-press menus, pull-to-refresh
 * or back-swipe, and the screen stays awake. The real lock on an iPad is
 * Guided Access (see README) – a web page can't block the Home gesture.
 */
export function KioskLockdown() {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add("kiosk-mode");

    // Full screen needs a user gesture, so try on every tap until it sticks
    const onTap = () => {
      if (!isInstalled()) requestFullscreen();
    };
    window.addEventListener("pointerdown", onTap, { capture: true });

    // Block browser gestures that leave or zoom the page
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", block);
    document.addEventListener("gesturestart", block);

    // Swallow "back" (swipe or button) so customers can't navigate away.
    // Re-push the router's own state so Next.js treats it as the same page.
    history.pushState(history.state, "");
    const onPop = () => history.pushState(history.state, "");
    window.addEventListener("popstate", onPop);

    // Keep the screen on while the kiosk is open
    let lock: WakeLockSentinel | null = null;
    const wake = async () => {
      try {
        if (document.visibilityState === "visible" && "wakeLock" in navigator) lock = await navigator.wakeLock.request("screen");
      } catch {
        /* unsupported or denied – set Auto-Lock to Never on the iPad */
      }
    };
    wake();
    document.addEventListener("visibilitychange", wake);

    return () => {
      html.classList.remove("kiosk-mode");
      window.removeEventListener("pointerdown", onTap, { capture: true });
      document.removeEventListener("contextmenu", block);
      document.removeEventListener("gesturestart", block);
      window.removeEventListener("popstate", onPop);
      document.removeEventListener("visibilitychange", wake);
      lock?.release().catch(() => {});
      // Staff left through the PIN: give them a normal window back
      const d = document as FsDoc;
      if (isFullscreen()) {
        if (d.exitFullscreen) d.exitFullscreen().catch(() => {});
        else d.webkitExitFullscreen?.();
      }
    };
  }, []);

  return null;
}
