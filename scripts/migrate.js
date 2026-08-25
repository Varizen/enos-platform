#!/usr/bin/env node
// Runs DB migrations using pg directly — no psql CLI required on Railway.
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

  const scripts = [
    path.join(__dirname, "../db/001_core_schema.sql"),
    path.join(__dirname, "../db/002_seed_data.sql"),
  ];

  for (const file of scripts) {
    const sql = fs.readFileSync(file, "utf8");
    console.log(`Running ${path.basename(file)}...`);
    try {
      await pool.query(sql);
      console.log(`  ✓ ${path.basename(file)} complete`);
    } catch (err) {
      // Ignore "already exists" errors so re-runs are safe
      if (err.code === "42P07" || err.code === "42710" || err.code === "42P06") {
        console.log(`  ✓ ${path.basename(file)} already applied (skipped)`);
      } else {
        console.error(`  ✗ ${path.basename(file)} failed:`, err.message);
        process.exit(1);
      }
    }
  }

  await pool.end();
  console.log("Migrations complete.");
}

migrate();
