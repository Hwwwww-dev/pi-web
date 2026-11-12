/**
 * How much of the current reply has arrived, in characters.
 *
 * The composer's beam uses it to work out how fast the reply is streaming, and
 * the chat publishes it rather than threading it through props: a chunk lands
 * dozens of times a second, and the composer is memoized so a new prop per
 * chunk would re-render the whole input bar.
 */
type Listener = () => void;

let characters = 0;
const listeners = new Set<Listener>();

export function getStreamCharacters(): number {
  return characters;
}

export function publishStreamCharacters(next: number): void {
  if (next === characters) return;
  characters = next;
  for (const listener of listeners) listener();
}

export function subscribeStreamCharacters(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
