import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { business } from "@config/business";
import { BrandProvider } from "@/components/brand-provider";
import { SetupRequired } from "@/components/setup-required";
import { SUPABASE_CONFIGURED } from "@/lib/supabase";
// Self-hosted fonts (no Google Fonts request at build or run time)
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: `${business.name} – Check-in`,
  description: `Customer check-in for ${business.name}, ${business.location}`,
  appleWebApp: { capable: true, title: `${business.shortName} Check-in`, statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: business.colors.dark,
};

/** Theme colours from config/business.ts as CSS variables (read by globals.css). */
const c = business.colors;
const themeVars = {
  "--brand-primary": c.primary,
  "--brand-primary-hover": c.primaryHover,
  "--brand-dark": c.dark,
  "--brand-dark-raised": c.darkRaised,
  "--brand-page": c.page,
  "--brand-line": c.line,
  "--brand-ink": c.ink,
  "--brand-muted": c.muted,
  "--brand-accent": c.accent,
} as React.CSSProperties;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className="h-full antialiased" style={themeVars}>
      <body className="min-h-full flex flex-col">
        {SUPABASE_CONFIGURED ? <BrandProvider>{children}</BrandProvider> : <SetupRequired />}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
