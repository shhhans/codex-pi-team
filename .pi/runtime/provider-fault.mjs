const QUOTA_CODE = 'account_quota_exceeded';

function errorText(input) {
  if (typeof input === 'string') return input;
  if (input == null) return '';
  try { return JSON.stringify(input); } catch { return String(input); }
}

function resetDetails(text) {
  // Provider error text commonly embeds this phrase in a JSON error object.
  const match = text.match(/reset\s+at\s+(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\s*([+-])(\d{2}):?(\d{2}))?(?:\s+([A-Za-z_][A-Za-z0-9_/-]*))?/i);
  if (!match) return { reset_at: null, time: null };
  const [, date, clock, sign, hours, minutes, zone] = match;
  if (!sign && !/^(UTC|GMT|Z)$/i.test(zone || '')) return { reset_at: null, time: { local: `${date} ${clock}`, offset: null, zone: zone || null } };
  const offset = sign ? `${sign}${hours}:${minutes}` : 'Z';
  const millis = Date.parse(`${date}T${clock}${offset}`);
  if (!Number.isFinite(millis)) return { reset_at: null, time: null };
  return {
    reset_at: new Date(millis).toISOString(),
    time: { local: `${date} ${clock}`, offset: sign ? `${sign}${hours}:${minutes}` : 'UTC', zone: zone || null },
  };
}

export function classifyProviderFault(errorMessage, { provider = null, model = null, now = Date.now() } = {}) {
  const text = errorText(errorMessage);
  if (!/\bAccountQuotaExceeded\b/i.test(text)) {
    return { code: null, message: 'Provider error; quota exhaustion was not identified.', reset_at: null,
      time: null, observed_at: new Date(now).toISOString(), provider, model };
  }
  const parsed = resetDetails(text);
  return { code: QUOTA_CODE, message: parsed.reset_at
      ? `Account quota exceeded; reset expected at ${parsed.reset_at}.`
      : 'Account quota exceeded; reset time unavailable.',
    reset_at: parsed.reset_at, time: parsed.time, observed_at: new Date(now).toISOString(), provider, model };
}

export function assertProviderResumeAllowed(session, { now = Date.now(), force = false } = {}) {
  const fault = session?.provider_fault;
  if (force || fault?.code !== QUOTA_CODE || !fault.reset_at) return true;
  const reset = Date.parse(fault.reset_at);
  if (!Number.isFinite(reset) || reset <= new Date(now).getTime()) return true;
  throw new Error(`Cannot resume: provider account quota is expected to reset at ${fault.reset_at}. Use an explicit forced retry to override.`);
}
