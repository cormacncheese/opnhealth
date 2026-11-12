"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { safeNextPath } from "@/lib/next-path";
import { browserClient } from "@/lib/supabase/browser";

/**
 * Landing page for the link in the sign-in email. The Supabase client
 * exchanges the code in the URL for a session by itself; this waits for it.
 */
export function Confirm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const linkError = params.get("error_description");
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (linkError) return;
    const { data } = browserClient().auth.onAuthStateChange((_event, session) => {
      if (session) router.replace(next);
    });
    const timer = setTimeout(() => setTimedOut(true), 8000);
    return () => {
      data.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [router, next, linkError]);

  if (linkError || timedOut) {
    return (
      <p className="text-neutral-700">
        This sign-in link has expired or was already used.{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="underline">
          Send a new one
        </Link>
        .
      </p>
    );
  }
  return <p className="status-line text-neutral-600">Signing you in</p>;
}
