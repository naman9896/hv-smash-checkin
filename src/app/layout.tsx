import type { Metadata, Viewport } from "next";
import { Toaster } from "sonner";
import { BrandProvider } from "@/components/brand-provider";
import { SetupRequired } from "@/components/setup-required";
import { SUPABASE_CONFIGURED } from "@/lib/supabase";
// Self-hosted fonts (no Google Fonts request at build or run time)
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/600.css";
import "@fontsource/jetbrains-mono/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sai Motor Works – Digital Check-in",
  description: "Digital customer check-in for Sai Motor Works, Rutherford NSW",
  appleWebApp: { capable: true, title: "SMW Check-in", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0F172A",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-AU" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {SUPABASE_CONFIGURED ? <BrandProvider>{children}</BrandProvider> : <SetupRequired />}
        <Toaster position="top-right" richColors closeButton />
      </body>
    </html>
  );
}
