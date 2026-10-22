import { z } from "zod";
import type { ReportQuery } from "../services/reporting.js";

export const reportQuerySchema = z.object({
  period: z.enum(["day", "week", "month", "year"]).default("week"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
});

export function parseReportQuery(query: unknown): ReportQuery {
  const parsed = reportQuerySchema.parse(query);
  const zone = process.env.APP_TIME_ZONE ?? "America/Sao_Paulo";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date()).filter((part) => part.type !== "literal").map(({ type, value }) => [type, value]));
  const dateValue = parsed.date ?? `${parts.year}-${parts.month}-${parts.day}`;
  const date = new Date(`${dateValue}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateValue) {
    throw Object.assign(new Error("Invalid report date"), { statusCode: 400 });
  }
  return { period: parsed.period, date: dateValue };
}
