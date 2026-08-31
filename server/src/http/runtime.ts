import { AuthService } from "../auth/service.js";
import { createWechatLoginProvider } from "../auth/provider.js";
import { registerAuthRoutes } from "../auth/routes.js";
import { createDatabaseClient } from "../database/client.js";
import { registerFamilyRoutes } from "../family/routes.js";
import { FamilyService } from "../family/service.js";
import { createHttpServer } from "./server.js";

export async function createRuntimeHttpServer() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to start the server");
  }

  const database = createDatabaseClient(databaseUrl);
  const authService = new AuthService(database, createWechatLoginProvider());
  const familyService = new FamilyService(database);
  const app = await createHttpServer({
    registerRoutes(server) {
      registerAuthRoutes(server, authService);
      registerFamilyRoutes(server, authService, familyService);
      server.addHook("onClose", async () => {
        await database.$disconnect();
      });
    },
  });
  return app;
}
