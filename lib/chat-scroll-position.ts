export type ChatScrollPosition =
  | { atBottom: true }
  | {
      atBottom: false;
      anchorEntryId: string;
      anchorOffset: number;
      oldestEntryId: string | null;
    };
