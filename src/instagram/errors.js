const NON_DELIVERABILITY_CODES = new Set([4, 17, 32, 190, 613]);

export class InstagramApiError extends Error {
  constructor(message, { status, body, code, errorSubcode } = {}) {
    super(message || 'Instagram API request failed');
    this.name = 'InstagramApiError';
    this.status = status;
    this.body = body;
    this.code = code;
    this.errorSubcode = errorSubcode;
  }
}

export function isDeliverabilityError(error) {
  if (!(error instanceof InstagramApiError)) {
    return false;
  }

  if (NON_DELIVERABILITY_CODES.has(Number(error.code))) {
    return false;
  }

  const message = String(error.message || '').toLowerCase();
  return [
    /cannot send/,
    /not allowed to message/,
    /recipient/,
    /message to this user/,
    /user unavailable/
  ].some((pattern) => pattern.test(message));
}
