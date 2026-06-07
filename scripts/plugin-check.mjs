import { createBot } from "@hyrhythm/hytale-client";
import path from "node:path";
import { mkdir } from "node:fs/promises";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
  const outDir = path.resolve(process.cwd(), ".runs", `plugin-check-${Date.now()}`);
  await mkdir(outDir, { recursive: true });
  const bot = await createBot({
    host: "127.0.0.1",
    port: 5520,
    username: "BotAdmin2",
    uuid: "0a0a2e6a-98a0-4cb0-8ee2-36403d1f0a4e",
    auth: { domain: "auth.sanasol.ws" }
  });

  await bot.trace.enable({ outputDir: outDir });
  await bot.connect();
  await bot.waitForReady(15000);
  bot.chat("/op self");
  await delay(1000);
  bot.chat("/plugin list");
  await delay(1500);
  bot.chat("/plugin load com.hyrhythm:HyRhythm");
  await delay(1500);
  bot.chat("/plugin list");
  await delay(2000);
  await bot.trace.flush(outDir);
  await bot.disconnect();
  console.log(outDir);
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
