"use client";

import Link from "next/link";
import { useUser } from "@/lib/supabase/browser";

export function AccountLink() {
  const user = useUser();
  // Hold the space while the session is read so the header does not jump.
  if (user === undefined) return <span className="w-14" aria-hidden />;
  return (
    <Link href={user ? "/account" : "/login"} className="font-medium hover:underline">
      {user ? "Account" : "Sign in"}
    </Link>
  );
}
