import { twMerge } from 'tailwind-merge';
import { clsx, type ClassValue } from 'clsx';
import { differenceInCalendarDays } from 'date-fns';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Returns the number of calendar days between a past date and today.
 * Uses differenceInCalendarDays (not differenceInDays) so that an entry
 * from yesterday at 11 PM is correctly counted as 1 day ago, not 0.
 *
 * Accepts a JS Date or a Firestore Timestamp (anything with a .toDate() method).
 */
export function calendarDaysAgo(date: Date | { toDate(): Date }): number {
  const d = date instanceof Date ? date : date.toDate();
  return differenceInCalendarDays(new Date(), d);
}
