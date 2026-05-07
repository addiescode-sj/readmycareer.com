"use client";

import { useSearchParams } from "next/navigation";
import LandingPage from "@/components/landing/LandingPage";
import OnboardingFlow from "@/components/OnboardingFlow";

export default function RootRouter() {
  const searchParams = useSearchParams();
  if (searchParams.get("new") === "true") {
    return <OnboardingFlow />;
  }
  return <LandingPage />;
}
