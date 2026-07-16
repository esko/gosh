/**
 * Saved host names appear in card text, titles, search metadata, and several
 * accessible action names. Keep the shared bound small enough for those
 * surfaces while leaving ample room for descriptive names.
 */
export const PROFILE_NAME_MAX_LENGTH = 80;

/** Normalize UI, write-path, and legacy/corrupt stored profile names alike. */
export function normalizeProfileName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, PROFILE_NAME_MAX_LENGTH);
}
