import type { FastifyPluginAsync } from "fastify";
import type { AppDatabase } from "../../db.js";
import { reportDetailRoutes } from "./detail.js";
import { reportRankingRoutes } from "./ranking.js";
import { reportSummaryRoutes } from "./summary.js";

interface Options { db: AppDatabase; }

export const reportRoutes: FastifyPluginAsync<Options> = async (app, options) => {
  await app.register(reportSummaryRoutes, options);
  await app.register(reportDetailRoutes, options);
  await app.register(reportRankingRoutes, options);
};
