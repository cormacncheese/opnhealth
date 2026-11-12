import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading, PageTitle } from "@/components/ui";
import { Account } from "./account";

export const metadata: Metadata = { title: "Your account" };

export default function AccountPage() {
  return (
    <>
      <PageTitle title="Your account" />
      <Suspense fallback={<Loading lines={3} />}>
        <Account />
      </Suspense>
    </>
  );
}
