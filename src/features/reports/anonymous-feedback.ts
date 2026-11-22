// FP-257: pure ordering for the Board's anonymous feedback list.
//
// event_feedback rows have no author and no time, and the list must not reveal the order they
// were submitted in either. So: shuffle (Fisher-Yates), then a STABLE sort by star_rating, high
// to low, entries without a rating last. Entries with equal ratings therefore come out in a
// random order, and the order never reflects submission order.

export type AnonymousFeedbackEntry = { star_rating: number | null; feedback: string };

export function orderAnonymousFeedback<T extends AnonymousFeedbackEntry>(
  rows: readonly T[],
  random: () => number = Math.random,
): T[] {
  const shuffled = rows.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  // Array.prototype.sort is stable (ES2019), so ties keep their shuffled order.
  return shuffled.sort((a, b) => {
    if (a.star_rating === null && b.star_rating === null) return 0;
    if (a.star_rating === null) return 1;
    if (b.star_rating === null) return -1;
    return b.star_rating - a.star_rating;
  });
}
