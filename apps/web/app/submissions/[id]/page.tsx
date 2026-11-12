import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "@/components/ui";
import { SubmissionView } from "./submission-view";

export const metadata: Metadata = { title: "Lab report" };

export default function SubmissionPage({ params }: PageProps<"/submissions/[id]">) {
  return (
    <Suspense fallback={<Loading lines={4} />}>
      <SubmissionView params={params} />
    </Suspense>
  );
}
