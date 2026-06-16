// Tiny argv helper covering the flag styles the Python argparse CLIs accepted:
// boolean flags (--skip-llm-judge), and options as either "--name value" or "--name=value".

export function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

export function getOption(argv: string[], name: string, fallback: string): string {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === name) {
      return argv[i + 1] ?? fallback;
    }
    if (a.startsWith(name + "=")) {
      return a.slice(name.length + 1);
    }
  }
  return fallback;
}

export function getIntOption(argv: string[], name: string, fallback: number): number {
  const raw = getOption(argv, name, String(fallback));
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}
