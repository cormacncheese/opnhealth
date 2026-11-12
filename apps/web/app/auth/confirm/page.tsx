import { Suspense } from "react";
import { Confirm } from "./confirm";

export default function ConfirmPage() {
  return (
    <Suspense>
      <Confirm />
    </Suspense>
  );
}
