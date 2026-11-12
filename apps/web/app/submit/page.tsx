import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, PageTitle } from "@/components/ui";
import { SubmitForm } from "./submit-form";

export const metadata: Metadata = { title: "Submit a lab report" };

export default function SubmitPage() {
  return (
    <>
      <PageTitle title="Submit a lab report">
        Upload a certificate of analysis for a product. Agents read it, check it against the document and
        decide whether to publish it. Every step is recorded in the public ledger.
      </PageTitle>
      <Suspense fallback={<Loading lines={2} />}>
        <SubmitForm />
      </Suspense>
    </>
  );
}
