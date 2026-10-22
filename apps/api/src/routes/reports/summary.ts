import type { FastifyPluginAsync } from "fastify";
import type { AppDatabase } from "../../db.js";
import { getReportSummary } from "../../services/reporting.js";
import { parseReportQuery } from "../report-query.js";

interface Options { db: AppDatabase; }

export const reportSummaryRoutes: FastifyPluginAsync<Options> = async (app, { db }) => {
  app.get("/api/reports", async (request) => getReportSummary(db, parseReportQuery(request.query)));
};
