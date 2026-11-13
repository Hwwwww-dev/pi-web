/**
 * How much of a session's current reply has arrived, in characters.
 *
 * Keyed by session: keep-alive slots leave several chat windows mounted at once,
 * and a background session's stream must not be read as this one's burst. The
 * composer's beam uses it to work out how fast the reply is streaming, and the
 * chat publishes it rather than threading it through props: a chunk lands dozens
 * of times a second, and the composer is memoized so a new prop per chunk would
 * re-render the whole input bar.
 */
const charactersBySession = new Map<string, number>();

export function getStreamCharacters(sessionKey: string): number {
  return charactersBySession.get(sessionKey) ?? 0;
}

export function publishStreamCharacters(sessionKey: string, next: number): void {
  if (next > 0) {
    charactersBySession.set(sessionKey, next);
    return;
  }
  charactersBySession.delete(sessionKey);
}
