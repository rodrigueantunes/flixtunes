"use strict";

const { DatabaseSync } = require("node:sqlite");

const [, , source, destination] = process.argv;
if (!source || !destination) {
  console.error("Usage: node backup-sqlite.cjs SOURCE.db DESTINATION.db");
  process.exit(2);
}

const database = new DatabaseSync(source);
try {
  database.exec("PRAGMA wal_checkpoint(FULL)");
  database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
} finally {
  database.close();
}
