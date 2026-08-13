/** Format a number as Indian Rupee with comma separators: ₹1,25,000 */
export function formatCurrency(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN');
}

/** Format a date consistently throughout the app */
export { format } from 'date-fns';
