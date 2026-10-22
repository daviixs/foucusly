import type { FastifyPluginAsync } from "fastify";
import type { AppDatabase } from "../../db.js";
import { getReportDetail } from "../../services/reporting.js";
import { parseReportQuery } from "../report-query.js";

interface Options { db: AppDatabase; }

export const reportDetailRoutes: FastifyPluginAsync<Options> = async (app, { db }) => {
  app.get("/api/reports/detail", async (request) => ({ sessions: getReportDetail(db, parseReportQuery(request.query)) }));
};
