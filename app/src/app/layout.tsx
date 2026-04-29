import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { SessionLayout } from "@/components/SessionLayout";
import { AuthListener } from "@/components/AuthListener";

export const metadata: Metadata = {
  title: "readmycareer.com — AI Career Coach",
  description: "Resume gap analysis + weekly career plans + AI chat coaching",
};

export default async function RootLayout({
  children,
  upload,
  goal,
  plan,
  chat,
}: {
  children: ReactNode;
  upload: ReactNode;
  goal: ReactNode;
  plan: ReactNode;
  chat: ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "/";
  const isDashboard = pathname.startsWith("/dashboard");

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-gray-50">
        <NextIntlClientProvider messages={messages}>
          <AuthListener />
          {isDashboard ? (
            children
          ) : (
            <SessionLayout upload={upload} goal={goal} plan={plan} chat={chat} />
          )}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
