import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, PageTitle } from "@/components/ui";
import { ClaimForm } from "./claim-form";

export const metadata: Metadata = { title: "Verify your brand" };

export default function ClaimPage() {
  return (
    <>
      <PageTitle title="Verify your brand">
        A verified brand account can submit lab reports as the brand. Verification is automatic: an agent
        checks that you control the brand&apos;s website domain.
      </PageTitle>
      <Suspense fallback={<Loading lines={2} />}>
        <ClaimForm />
      </Suspense>
    </>
  );
}
