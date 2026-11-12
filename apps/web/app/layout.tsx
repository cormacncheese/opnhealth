import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Open Data Intelligence Layer", template: "%s · Open Data Intelligence Layer" },
  description:
    "An open record of what is in the products people buy: lab reports, public data and every decision made about them.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <SiteHeader />
        <main className="mx-auto w-full max-w-3xl flex-1 px-5 pb-24 pt-8">{children}</main>
        <footer className="mx-auto w-full max-w-3xl px-5 pb-10 text-sm text-neutral-500">
          Code under Apache-2.0. Data under the Open Database License. Every record on this site can be traced
          to its source in the <Link className="underline" href="/records">public ledger</Link>.
        </footer>
      </body>
    </html>
  );
}
