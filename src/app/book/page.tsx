import type { Metadata } from "next";
import { BookForm } from "@/components/booking/book-form";

export const metadata: Metadata = {
  title: "Book a service – Sai Motor Works",
  description: "Book your car in at Sai Motor Works, Rutherford NSW.",
};

// Everything on this page is loaded in the browser from /api/booking/*, so it is a
// static shell (nothing to render per request on the server).
export default function Page() {
  return <BookForm />;
}
