import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL || "file:./data/vire.db";
const authToken = process.env.DATABASE_AUTH_TOKEN?.trim();

export default defineConfig(
  authToken
    ? {
        schema: "./src/db/schema.ts",
        out: "./drizzle",
        dialect: "turso",
        dbCredentials: { url, authToken },
      }
    : {
        schema: "./src/db/schema.ts",
        out: "./drizzle",
        dialect: "sqlite",
        dbCredentials: { url },
      }
);
