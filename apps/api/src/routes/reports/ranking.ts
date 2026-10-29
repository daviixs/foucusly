import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDatabase } from "../../db.js";
import { getReportRanking } from "../../services/reporting.js";
import { parseReportQuery } from "../report-query.js";

interface Options {
  db: AppDatabase;
}
const rankingQuerySchema = z.object({ by: z.enum(["project", "task"]).default("project") });

export const reportRankingRoutes: FastifyPluginAsync<Options> = async (app, { db }) => {
  app.get("/api/reports/ranking", async (request) => {
    const query = request.query as Record<string, unknown>;
    const reportQuery = parseReportQuery(query);
    const { by } = rankingQuerySchema.parse(query);
    return { by, entries: getReportRanking(db, request.headers["x-profile-id"] as string, reportQuery, by) };
  });
};
