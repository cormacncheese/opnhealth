"use client";

import type { User } from "@supabase/supabase-js";
import { usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { useUser } from "@/lib/supabase/browser";
import { ButtonLink, Loading, Panel } from "./ui";

/** Renders its children for a signed-in visitor, and a sign-in prompt otherwise. */
export function RequireUser({ reason, children }: { reason: string; children: (user: User) => ReactNode }) {
  const user = useUser();
  const pathname = usePathname();
  const query = useSearchParams().toString();

  if (user === undefined) return <Loading lines={2} />;
  if (user === null) {
    const next = encodeURIComponent(query ? `${pathname}?${query}` : pathname);
    return (
      <Panel>
        <p className="text-neutral-700">{reason}</p>
        <ButtonLink href={`/login?next=${next}`} className="mt-4">
          Sign in
        </ButtonLink>
      </Panel>
    );
  }
  return <>{children(user)}</>;
}
