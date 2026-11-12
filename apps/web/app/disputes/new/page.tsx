import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, PageTitle } from "@/components/ui";
import { DisputeForm } from "./dispute-form";

export const metadata: Metadata = { title: "Dispute a report" };

export default function NewDisputePage() {
  return (
    <>
      <PageTitle title="Dispute a report">
        Tell us what is wrong with a published report. An agent re-checks the record against the original
        document. That a dispute was opened and how it ended are public. What you write here is not.
      </PageTitle>
      <Suspense fallback={<Loading lines={2} />}>
        <DisputeForm />
      </Suspense>
    </>
  );
}
