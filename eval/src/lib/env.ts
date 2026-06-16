// Loads the repository-root .env into process.env, mirroring the Python harness's
// `load_dotenv(Path(__file__).parent.parent / ".env")`. Node >= 20.12 ships
// process.loadEnvFile, so no third-party dotenv dependency is required.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

let loaded = false;

/** Idempotently loads <repo-root>/.env. Missing files are ignored (env may come from the shell). */
export function loadRootEnv(): void {
  if (loaded) return;
  loaded = true;
  // src/lib/env.ts → walk up to the repo root (eval/ is one level below root).
  const here = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(here, "..", "..", "..", ".env");
  try {
    // process.loadEnvFile does not overwrite variables already present in the
    // environment, matching python-dotenv's default behaviour.
    process.loadEnvFile(envPath);
  } catch {
    // No .env file (or unreadable) — rely on the ambient environment.
  }
}

/** Returns the Google API key from either of the two accepted env var names. */
export function googleApiKey(): string | undefined {
  return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
}
