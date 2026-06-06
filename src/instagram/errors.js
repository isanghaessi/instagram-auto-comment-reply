const NON_DELIVERABILITY_CODES = new Set([4, 17, 32, 190, 613]);

export class InstagramApiError extends Error {
  constructor(message, { status, body, code, errorSubcode, rawBody } = {}) {
    super(message || 'Instagram API request failed');
    this.name = 'InstagramApiError';
    this.status = status;
    this.body = body;
    this.code = code;
    this.errorSubcode = errorSubcode;
    this.rawBody = rawBody;
  }
}

export function isDeliverabilityError(error) {
  if (!(error instanceof InstagramApiError)) {
    return false;
  }

  if (Number(error.status) >= 500) {
    return false;
  }

  const code = Number(error.code);
  if (NON_DELIVERABILITY_CODES.has(code) || code === 100) {
    return false;
  }

  const message = String(error.message || '').toLowerCase();
  if (/(oauth|access token|rate limit|permission|insufficient scope|system error|temporar(?:y|ily)|invalid recipient id|recipient field is required)/.test(message)) {
    return false;
  }

  return [
    /cannot send message to this user/,
    /not allowed to message this user/,
    /user is unavailable/,
    /recipient is unavailable/,
    /(?:user|recipient|account)\s+(?:has\s+)?blocked\b/,
    /\bblocked\s+(?:you|your account|by this user|by the user)\b/,
    /cannot receive messages/
  ].some((pattern) => pattern.test(message));
}
