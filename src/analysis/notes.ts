/**
 * Ticket 25: owner notes on dates (for example a new program or travel).
 * Notes are private, owner-only, and versioned: an edit appends a new version; the latest wins.
 */
export const noteCategories = ['Training', 'Nutrition', 'Travel', 'Health', 'Life', 'Other'] as const;
export type NoteCategory = (typeof noteCategories)[number];

export interface OwnerNote {
  id: string;
  startDate: string;
  /** Same as startDate for a single-day note. */
  endDate: string;
  text: string;
  category: NoteCategory | null;
  version: number;
  updatedAt: string;
}
