import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-8">
      <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
      {children && <p className="mt-2 text-neutral-600">{children}</p>}
    </div>
  );
}

export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {aside && <div className="text-sm text-neutral-500">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** A soft panel. Rows inside it are separated by space, not rules. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[22px] bg-neutral-100 p-5 ${className}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <Panel className="text-neutral-600">{children}</Panel>;
}

const TONES = {
  neutral: "bg-neutral-200 text-neutral-800",
  good: "bg-emerald-100 text-emerald-900",
  warn: "bg-amber-100 text-amber-900",
  bad: "bg-red-100 text-red-900",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>
      {children}
    </span>
  );
}

export const statusTone = (status: string): Tone =>
  status === "published"
    ? "good"
    : status === "escalated" || status === "approved" || status === "processing" || status === "received"
      ? "warn"
      : status === "rejected" || status === "withdrawn" || status === "failed"
        ? "bad"
        : "neutral";

export function Button({ className = "", ...props }: ComponentProps<"button">) {
  return (
    <button
      {...props}
      className={`inline-flex h-12 items-center justify-center rounded-full bg-neutral-950 px-6 text-base font-semibold text-white transition-opacity disabled:opacity-40 ${className}`}
    />
  );
}

export function QuietButton({ className = "", ...props }: ComponentProps<"button">) {
  return (
    <button
      {...props}
      className={`inline-flex h-12 items-center justify-center rounded-full bg-neutral-100 px-6 text-base font-semibold text-neutral-950 transition-opacity disabled:opacity-40 ${className}`}
    />
  );
}

export function ButtonLink({ className = "", ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={`inline-flex h-12 items-center justify-center rounded-full bg-neutral-950 px-6 text-base font-semibold text-white ${className}`}
    />
  );
}

export const fieldClass =
  "w-full rounded-2xl bg-neutral-100 px-4 py-3 text-base outline-none placeholder:text-neutral-500 focus:bg-neutral-200/70";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-sm text-neutral-500">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-900">
      {children}
    </p>
  );
}

/** A grey block standing in for content that is loading. */
export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-16 animate-pulse rounded-[22px] bg-neutral-100" />
      ))}
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="break-all font-mono text-[13px]">{children}</span>;
}
