import { describe, expect, it } from 'vitest';

import { MAX_LINKED_APP_URL_LENGTH, linkedAppHost, parseLinkedAppUrl } from '@/lib/linked-url';
import { parseArtifactSource } from '@/types/portal';

describe('linked app URLs', () => {
  it('accepts an HTTPS URL and returns the normalised href', () => {
    expect(parseLinkedAppUrl(' https://covetrus-better-buying.azurewebsites.net/ ')).toBe('https://covetrus-better-buying.azurewebsites.net/');
  });

  it('rejects http, javascript, credentialed, and over-long values', () => {
    expect(() => parseLinkedAppUrl('http://example.com')).toThrow(/HTTPS/i);
    expect(() => parseLinkedAppUrl('javascript:alert(1)')).toThrow(/HTTPS|valid/i);
    expect(() => parseLinkedAppUrl('https://user:pass@example.com/app')).toThrow(/username or password/i);
    expect(() => parseLinkedAppUrl(`https://example.com/${'a'.repeat(MAX_LINKED_APP_URL_LENGTH)}`)).toThrow(/500 characters/i);
    expect(() => parseLinkedAppUrl('')).toThrow(/HTTPS URL/i);
  });

  it('exposes the destination host for launcher copy', () => {
    expect(linkedAppHost('https://covetrus-better-buying.azurewebsites.net/path')).toBe('covetrus-better-buying.azurewebsites.net');
  });
});

describe('artifact source mapping', () => {
  it('keeps linked and uploaded sources distinct from bundled', () => {
    expect(parseArtifactSource('linked')).toBe('linked');
    expect(parseArtifactSource('uploaded')).toBe('uploaded');
    expect(parseArtifactSource('bundled')).toBe('bundled');
    expect(parseArtifactSource('nope')).toBe('bundled');
  });
});
