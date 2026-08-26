import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createImportsService } from "../../core/imports/imports-service.js";
import type { ImportsRepository } from "../../core/imports/imports-repository.js";
import type { ImportBatchRecord } from "../../core/imports/imports-types.js";
import type { Logger } from "../../core/shared/logger.js";
import type { ObjectStore } from "../../core/shared/objectStore.js";
import { createUserRequestContext } from "../../core/tenant/request-context.js";

const tenantId = "33333333-3333-4333-8333-333333333333";
const cloudAccountId = "44444444-4444-4444-8444-444444444444";
const importBatchId = "55555555-5555-4555-8555-555555555555";

describe("imports lifecycle hooks", () => {
  it("runs the post-commit hook and preserves the local import when optional delivery fails", async () => {
    const order: string[] = [];
    const repository = fakeRepository(order);
    const objectStore = fakeObjectStore(order);
    const logger = fakeLogger();
    const onImportProcessed = vi.fn(async () => {
      order.push("import-hook");
      throw new Error("optional delivery unavailable");
    });
    const service = createImportsService(repository, objectStore, logger, { onImportProcessed });

    const batch = await service.create(context(), {
      source: "synthetic",
      format: "csv",
      object_uri: "imports/synthetic/usage-valid.csv",
      cloud_account_id: cloudAccountId,
      control_totals: [],
    });

    expect(batch.id).toBe(importBatchId);
    expect(onImportProcessed).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId, batch: expect.objectContaining({ id: importBatchId }) }),
    );
    expect(order).toEqual(["object", "write", "import-hook"]);
    expect(logger.info).toHaveBeenCalledWith(
      "cloud_commitment.import.completed",
      expect.objectContaining({ importBatchId }),
    );
  });
});

function context() {
  return createUserRequestContext({
    tenantId,
    actorUserId: "66666666-6666-4666-8666-666666666666",
    role: "finops_analyst",
    requestId: "request-1",
  });
}

function fakeRepository(order: string[]): ImportsRepository {
  return {
    getCloudAccount: vi.fn(async () => ({
      id: cloudAccountId,
      provider: "aws" as const,
      isActive: true,
    })),
    list: vi.fn(),
    get: vi.fn(),
    createImport: vi.fn(async () => {
      order.push("write");
      return completedBatch;
    }),
  };
}

function fakeObjectStore(order: string[]): ObjectStore {
  return {
    put: vi.fn(),
    get: vi.fn(async () => {
      order.push("object");
      return readFile(resolve("tests/fixtures/synthetic/usage-valid.csv"));
    }),
    delete: vi.fn(),
    health: vi.fn(),
    close: vi.fn(),
  };
}

function fakeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
    flush: vi.fn(),
    close: vi.fn(),
  } as unknown as Logger;
}

const completedBatch = {
  id: importBatchId,
  cloudAccountId,
  source: "synthetic",
  format: "csv",
  status: "completed",
  objectUri: "imports/synthetic/usage-valid.csv",
  schemaVersion: "synthetic_csv:v1",
  lineCount: "3",
  errorDetails: {},
  parserWarnings: [],
  createdByUserId: "66666666-6666-4666-8666-666666666666",
  createdAt: "2026-08-26T00:00:00.000000Z",
  updatedAt: "2026-08-26T00:00:00.000000Z",
} satisfies ImportBatchRecord;
