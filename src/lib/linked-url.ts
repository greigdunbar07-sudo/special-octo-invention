export const MAX_LINKED_APP_URL_LENGTH = 500;

export function parseLinkedAppUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Enter an HTTPS URL for the app.');
  if (raw.length > MAX_LINKED_APP_URL_LENGTH) throw new Error('The URL must be 500 characters or fewer.');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Enter a valid HTTPS URL.');
  }
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS URLs can be linked.');
  if (parsed.username || parsed.password) throw new Error('The URL cannot include a username or password.');
  if (!parsed.hostname) throw new Error('Enter a valid HTTPS URL.');
  const href = parsed.href;
  if (href.length > MAX_LINKED_APP_URL_LENGTH) throw new Error('The URL must be 500 characters or fewer.');
  return href;
}

export function linkedAppHost(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}
