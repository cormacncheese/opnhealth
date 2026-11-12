import type { Metadata } from "next";
import { Suspense } from "react";
import { PageTitle } from "@/components/ui";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <div className="mx-auto max-w-md">
      <PageTitle title="Sign in">
        Enter your email and we will send you a sign-in code. There is no password. An account is created the
        first time you sign in.
      </PageTitle>
      <Suspense>
        <LoginForm />
      </Suspense>
    </div>
  );
}
