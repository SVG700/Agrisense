/**
 * Minimal structured logger: one JSON object per line on stdout/stderr.
 * Callers must not pass secrets; `redact` strips common credential fields
 * defensively anyway.
 */
const SECRET_KEYS = /key|token|secret|password|authorization/i;

function redact(value, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '[redacted]' : redact(v, depth + 1)])
  );
}

export function createLogger({ silent = false } = {}) {
  const write = (level, msg, fields) => {
    if (silent) return;
    const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...redact(fields ?? {}) });
    (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
  };
  return {
    info: (msg, fields) => write('info', msg, fields),
    warn: (msg, fields) => write('warn', msg, fields),
    error: (msg, fields) => write('error', msg, fields),
  };
}
