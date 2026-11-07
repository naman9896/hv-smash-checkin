import Link from "next/link";
import { LinkIcon } from "lucide-react";
import { Card } from "@/components/ui/card";

export default function NotFound() {
  return (
    <Card className="p-6 text-center sm:p-8">
      <LinkIcon className="mx-auto mb-3 h-10 w-10 text-muted" aria-hidden="true" />
      <h1 className="text-[22px] font-bold text-ink">This link isn&apos;t valid</h1>
      <p className="mt-2 text-muted">
        It may have expired or been typed wrong. Check the link in your text message, or give the workshop a call.
      </p>
      <Link href="/book" className="mt-5 inline-flex min-h-12 items-center rounded-[12px] bg-primary px-5 font-semibold text-white">
        Book a service
      </Link>
    </Card>
  );
}
