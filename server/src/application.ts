import { createRuntimeHttpServer } from "./http/runtime.js";

interface ApplicationServer {
  listen(options: { host: string; port: number }): Promise<string>;
  close(): Promise<void>;
}

export interface ApplicationOptions {
  host?: string;
  port?: number;
  server?: ApplicationServer;
}

export interface Application {
  readonly isRunning: boolean;
  start(): Promise<string>;
  stop(): Promise<void>;
}

export async function createApplication(
  options: ApplicationOptions = {},
): Promise<Application> {
  const server = options.server ?? (await createRuntimeHttpServer());
  let isRunning = false;
  let address = "";

  return {
    get isRunning() {
      return isRunning;
    },
    async start() {
      if (isRunning) return address;
      address = await server.listen({
        host: options.host ?? "127.0.0.1",
        port: options.port ?? 3000,
      });
      isRunning = true;
      return address;
    },
    async stop() {
      if (!isRunning) return;
      await server.close();
      isRunning = false;
      address = "";
    },
  };
}
