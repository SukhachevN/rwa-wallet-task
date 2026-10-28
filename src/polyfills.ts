if (typeof globalThis.process === 'undefined') {
  (globalThis as typeof globalThis & { process: { env: Record<string, string> } }).process = {
    env: { NODE_ENV: import.meta.env.MODE },
  };
} else if (!globalThis.process.env) {
  globalThis.process.env = { NODE_ENV: import.meta.env.MODE };
}
