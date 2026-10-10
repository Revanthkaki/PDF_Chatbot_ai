import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { dataDirectory, store } from "../src/lib/store";
import { extract } from "../src/lib/extract";

loadEnvConfig(process.cwd());
const database = store();
let running = true;
process.on("SIGTERM", () => { running = false; });
process.on("SIGINT", () => { running = false; });
async function run() {
  console.log("Document worker ready; durable SQLite queue enabled.");
  while (running) {
    const id = database.claim();
    if (!id) { await new Promise(resolve => setTimeout(resolve, 800)); continue; }
    const document = database.get(id);
    if (!document) continue;
    try {
      const bytes = await readFile(path.join(dataDirectory(), "files", id));
      const result = await extract(bytes, document.kind, value => database.progress(id, value));
      database.finish(id, result.segments, result.text);
      console.log(`Indexed ${document.name}: ${result.segments.length} source segments.`);
    } catch (error) { database.fail(id, error instanceof Error ? error.message : "Document processing failed."); }
  }
  database.db.close();
}
run().catch(error => { console.error(error); process.exitCode = 1; });