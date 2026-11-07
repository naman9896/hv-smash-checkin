import { Shell } from "@/components/booking/book-form";

// Around both the page and not-found.tsx.
export default function Layout({ children }: LayoutProps<"/b/[token]">) {
  return <Shell>{children}</Shell>;
}
