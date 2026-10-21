import { createDatabase } from "./db.js";
import { buildServer } from "./server.js";

const database = createDatabase();
const app = buildServer(database);
const port = Number(process.env.PORT ?? 3001);

try {
  await app.listen({ port, host: process.env.HOST ?? "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  database.close();
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    database.close();
    process.exit(0);
  });
}
