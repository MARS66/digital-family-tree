import "dotenv/config";

import { createApplication } from "./application.js";

function parsePort(value: string | undefined): number {
  if (value === undefined) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("PORT must be an integer between 0 and 65535");
  }
  return port;
}

const smokeMode = process.env.SERVER_BOOTSTRAP_SMOKE === "1";
const application = await createApplication({
  host: process.env.HOST ?? "127.0.0.1",
  port: smokeMode ? 0 : parsePort(process.env.PORT),
});

const stop = async () => {
  await application.stop();
};

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

try {
  await application.start();
  if (smokeMode) await application.stop();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
