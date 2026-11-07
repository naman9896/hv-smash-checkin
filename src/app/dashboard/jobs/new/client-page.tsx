"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { DashboardHeader } from "@/components/dashboard/header";
import { useDashboard } from "@/components/dashboard/shell";
import { JobEditor } from "@/components/jobs/job-editor";
import { createJob } from "@/lib/data";
import { blankJob } from "@/lib/jobs";

/** The owner adds a job by hand (staff normally do this on /jobs). */
export default function NewJobPage() {
  const router = useRouter();
  const { upsertJob } = useDashboard();

  return (
    <div className="min-h-screen bg-page">
      <DashboardHeader back={{ href: "/dashboard/jobs", label: "All jobs" }} />
      <main className="mx-auto max-w-5xl px-4 pt-6 sm:px-6">
        <h1 className="mb-6 text-2xl font-bold">New job</h1>
        <JobEditor
          initial={{ ...blankJob(), status: "new" }}
          alwaysDirty
          saveLabel="Create job"
          onSave={async (job) => {
            const created = await createJob({ ...job, is_read: true });
            upsertJob(created);
            toast.success(`${created.job_no} created`);
            router.replace(`/dashboard/jobs/${created.id}`);
          }}
        />
      </main>
    </div>
  );
}
