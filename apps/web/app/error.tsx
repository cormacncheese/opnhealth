"use client";

import { Button, PageTitle } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <>
      <PageTitle title="This page could not be loaded">
        Something went wrong while loading it. Nothing has been lost. Try again in a moment.
      </PageTitle>
      <Button type="button" onClick={reset}>
        Try again
      </Button>
    </>
  );
}
