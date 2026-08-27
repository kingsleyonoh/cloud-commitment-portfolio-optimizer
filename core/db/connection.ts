export type DatabaseEnvironment = Readonly<Record<string, string | undefined>>;

export class DatabasePrerequisiteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabasePrerequisiteError";
  }
}

export function requireDatabaseUrl(source: DatabaseEnvironment): string {
  const databaseUrl = source.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new DatabasePrerequisiteError(
      "DATABASE_URL is required. Start the isolated local PostgreSQL service and provide its database URL.",
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new DatabasePrerequisiteError("DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new DatabasePrerequisiteError("DATABASE_URL must be a PostgreSQL URL.");
  }
  if (!parsed.pathname || parsed.pathname === "/") {
    throw new DatabasePrerequisiteError("DATABASE_URL must name an explicit database.");
  }

  return databaseUrl;
}
