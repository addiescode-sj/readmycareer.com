import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { SessionLayout } from "@/components/SessionLayout";

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

  return (
    <html lang={locale}>
      <body className="min-h-screen bg-gray-50">
        <NextIntlClientProvider messages={messages}>
          <SessionLayout upload={upload} goal={goal} plan={plan} chat={chat} />
          {/* children = page.tsx (empty slot) — no rendering needed */}
          <div className="hidden">{children}</div>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
