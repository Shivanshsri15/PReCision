const MAX_MESSAGE_CHARS = 300;

/**
 * Turns Gemini SDK errors (which embed the request URL and a JSON dump of
 * quota details) into one short sentence that is safe to show in the UI.
 */
export function describeGeminiError(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  const status = /\[(\d{3})[^\]]*\]/.exec(raw)?.[1];

  if (status === '429' || /too many requests|quota/i.test(raw)) {
    const model = /model:\s*([\w.-]+)/.exec(raw)?.[1] ?? 'the Gemini model';
    if (/PerDay/i.test(raw)) {
      const limit = /limit:\s*(\d+)/.exec(raw)?.[1];
      return (
        `Gemini daily quota reached for ${model}` +
        (limit ? ` (${limit} requests/day on this key)` : '') +
        '. Try again tomorrow or use a Gemini key with billing enabled.'
      );
    }
    const retry = /retry in ([\d.]+)s/i.exec(raw)?.[1];
    return (
      `Gemini rate limit reached for ${model}. ` +
      (retry
        ? `Wait about ${Math.ceil(Number(retry))}s and try again.`
        : 'Wait a minute and try again.')
    );
  }

  if (status === '404' && /model/i.test(raw)) {
    const model =
      /models\/([\w.-]+)/.exec(raw)?.[1] ?? 'The configured Gemini model';
    const suggested = /use models\/([\w.-]+)/i.exec(raw)?.[1];
    return (
      `${model} isn't available for this Gemini key.` +
      (suggested
        ? ` Set GEMINI_MODEL to ${suggested}.`
        : ' Set GEMINI_MODEL to a supported model.')
    );
  }

  if (
    /API_KEY_INVALID|API key not valid/i.test(raw) ||
    status === '401' ||
    status === '403'
  ) {
    return 'Gemini rejected the API key. Update your key in settings and try again.';
  }

  if (status === '503' || /overloaded|unavailable/i.test(raw)) {
    return 'Gemini is temporarily unavailable. Try again in a few minutes.';
  }

  const cleaned = raw
    .replace(/^\[GoogleGenerativeAI Error\]:\s*/i, '')
    .replace(/Error fetching from \S+:\s*/i, '')
    .replace(/\s*\[\{.*$/s, '')
    .trim();
  if (!cleaned) return 'Analysis failed';
  return cleaned.length > MAX_MESSAGE_CHARS
    ? `${cleaned.slice(0, MAX_MESSAGE_CHARS)}…`
    : cleaned;
}
