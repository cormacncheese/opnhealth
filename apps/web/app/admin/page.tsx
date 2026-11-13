import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, PageTitle } from "@/components/ui";
import { Dashboard } from "./dashboard";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };

export default function AdminPage() {
  return (
    <>
      <PageTitle title="Admin">What the agents are doing right now. Refreshes every few seconds.</PageTitle>
      <Suspense fallback={<Loading lines={4} />}>
        <Dashboard />
      </Suspense>
    </>
  );
}
