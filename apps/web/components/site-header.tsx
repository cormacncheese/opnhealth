import Link from "next/link";
import { AccountLink } from "./account-link";

const NAV = [
  { href: "/submit", label: "Submit a report" },
  { href: "/records", label: "Ledger" },
  { href: "/data", label: "Data" },
];

export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-3xl items-center gap-5 px-5 py-5 text-sm">
      <Link href="/" className="mr-auto text-base font-semibold tracking-tight">
        Open Data Intelligence Layer
      </Link>
      <nav className="hidden items-center gap-5 text-neutral-600 sm:flex">
        {NAV.map((item) => (
          <Link key={item.href} href={item.href} className="hover:text-neutral-950">
            {item.label}
          </Link>
        ))}
      </nav>
      <AccountLink />
    </header>
  );
}
