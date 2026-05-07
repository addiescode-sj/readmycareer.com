import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";
import { SessionLayout } from "@/components/SessionLayout";
import { AuthListener } from "@/components/AuthListener";
import ParticleNetwork from "@/components/ui/ParticleNetwork";
import { Toaster } from "sonner";

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
  const isLanding = pathname === "/";

  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      </head>
      <body className="min-h-screen bg-background font-sans antialiased">
        <NextIntlClientProvider messages={messages}>
          <AuthListener />
          <ParticleNetwork />
          <Toaster position="top-center" richColors />
          {isDashboard || isLanding ? (
            <div className="relative z-10">
              {children}
            </div>
          ) : (
            <div className="relative z-10">
              <SessionLayout upload={upload} goal={goal} plan={plan} chat={chat} />
            </div>
          )}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
