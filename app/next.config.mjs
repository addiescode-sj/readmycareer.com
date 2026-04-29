import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

/** @type {import('next').NextConfig} */

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://lh3.googleusercontent.com",
      "connect-src 'self' https://*.supabase.co",
      "font-src 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
  // Node.js-only packages excluded from Edge Runtime
  transpilePackages: ["@readmycareer/agents"],
  experimental: {
    serverComponentsExternalPackages: [
      "@modelcontextprotocol/sdk",
      "@pinecone-database/pinecone",
      "@google/generative-ai",
      "@google/adk",
      "@mikro-orm/core",
      "@mikro-orm/knex",
      "pdf-parse",
      "mammoth",
    ],
  },
};

export default withNextIntl(nextConfig);
