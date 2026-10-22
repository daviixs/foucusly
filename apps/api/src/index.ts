import { createDatabase } from "./db.js";
import { buildServer } from "./server.js";
import { getVapidKeys } from "./push/vapid.js";
import { createWebPushSender } from "./push/webpush-sender.js";
import { startPushScheduler } from "./push/scheduler.js";

const database = createDatabase();
const sender = createWebPushSender(getVapidKeys(database));
const app = buildServer(database, { pushSender: sender });
const port = Number(process.env.PORT ?? 3001);

try {
  await app.listen({ port, host: process.env.HOST ?? "127.0.0.1" });
} catch (error) {
  app.log.error(error);
  database.close();
  process.exit(1);
}

const stopScheduler = await startPushScheduler(database, sender, Number(process.env.PUSH_POLL_INTERVAL_MS ?? 15_000));

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    stopScheduler();
    await app.close();
    database.close();
    process.exit(0);
  });
}
