import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, PageTitle } from "@/components/ui";
import { Queue } from "./queue";

export const metadata: Metadata = { title: "Review queue" };

export default function MaintainPage() {
  return (
    <>
      <PageTitle title="Review queue">
        Cases the agents would not decide alone. Your decisions are written to the same public ledger as
        theirs, marked as made by a maintainer.
      </PageTitle>
      <Suspense fallback={<Loading lines={3} />}>
        <Queue />
      </Suspense>
    </>
  );
}
