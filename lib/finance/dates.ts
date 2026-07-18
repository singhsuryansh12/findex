import { addDays, format, getDaysInMonth, parseISO, subMonths } from "date-fns";

export function formatISODate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function asDate(value: string): Date {
  return parseISO(`${value}T12:00:00`);
}

export function previousCalendarMonth(asOfDate: string) {
  const previous = subMonths(asDate(asOfDate), 1);
  const year = previous.getFullYear();
  const month = previous.getMonth();
  return {
    startDate: format(new Date(year, month, 1), "yyyy-MM-dd"),
    endDate: format(new Date(year, month, getDaysInMonth(previous)), "yyyy-MM-dd"),
  };
}

export function dateRange(startDate: string, days: number): string[] {
  const start = asDate(startDate);
  return Array.from({ length: days + 1 }, (_, index) =>
    formatISODate(addDays(start, index)),
  );
}

export function compactDate(value: string): string {
  return format(asDate(value), "MMM d");
}

export function monthLabel(value: string): string {
  return format(asDate(`${value}-01`), "MMM");
}

export function fullMonthLabel(value: string): string {
  return format(asDate(`${value}-01`), "MMMM yyyy");
}

