"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";
import { Button, ErrorNote, Field, fieldClass, QuietButton } from "@/components/ui";
import { safeNextPath } from "@/lib/next-path";
import { browserClient } from "@/lib/supabase/browser";

export function LoginForm() {
  const router = useRouter();
  const next = safeNextPath(useSearchParams().get("next"));
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const address = email.trim().toLowerCase();
    const { error } = await browserClient().auth.signInWithOtp({
      email: address,
      options: { emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    if (error) {
      setError(
        error.status === 429
          ? "Too many sign-in emails were requested. Wait a minute, then try again."
          : "The sign-in email could not be sent. Check the address and try again.",
      );
      return;
    }
    setSentTo(address);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    const { error } = await browserClient().auth.verifyOtp({ email: sentTo, token: code.trim(), type: "email" });
    setBusy(false);
    if (error) {
      setError("That code is wrong or has expired. Check the email, or send a new code.");
      return;
    }
    router.replace(next);
  }

  if (sentTo) {
    return (
      <form onSubmit={verify} className="space-y-4">
        <Field label={`Code sent to ${sentTo}`} hint="You can also follow the link in the email instead.">
          <input
            className={`${fieldClass} font-mono tracking-widest`}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter the code"
          />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex gap-3">
          <Button type="submit" disabled={busy || code.trim().length < 6}>
            Sign in
          </Button>
          <QuietButton
            type="button"
            onClick={() => {
              setSentTo(null);
              setCode("");
              setError(null);
            }}
          >
            Use another email
          </QuietButton>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={sendCode} className="space-y-4">
      <Field label="Email">
        <input
          className={fieldClass}
          type="email"
          autoComplete="email"
          autoFocus
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" disabled={busy}>
        Send sign-in code
      </Button>
    </form>
  );
}
