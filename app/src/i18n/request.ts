import { getRequestConfig } from "next-intl/server";
import { headers } from "next/headers";

/** Detect locale from Accept-Language header; falls back to 'ko'. */
function detectLocale(acceptLanguage: string | null): "ko" | "en" {
  if (!acceptLanguage) return "en";
  const langs = acceptLanguage
    .split(",")
    .map((l) => l.split(";")[0].trim().toLowerCase());
  for (const lang of langs) {
    if (lang.startsWith("ko")) return "ko";
    if (lang.startsWith("en")) return "en";
  }
  return "en";
}

export default getRequestConfig(async () => {
  const headersList = await headers();
  const locale = detectLocale(headersList.get("accept-language"));

  const messages =
    locale === "en"
      ? (await import("../../messages/en.json")).default
      : (await import("../../messages/ko.json")).default;

  return { locale, messages };
});
