import { randomUUID } from "node:crypto";
import type { AppStore, AuditRecord, ToolExecutionContext } from "../types.js";
import { nowIso } from "../utils/time.js";

export class AuditService {
  constructor(private readonly store: AppStore) {}

  async record(input: Omit<AuditRecord, "id" | "createdAt">): Promise<AuditRecord> {
    const record: AuditRecord = {
      ...input,
      id: randomUUID(),
      createdAt: nowIso(),
    };

    await this.store.saveAuditRecord(record);
    return record;
  }

  async recordToolAction(context: ToolExecutionContext, options: {
    action: string;
    target: string;
    destructive: boolean;
    diffSummary?: string;
    metadata?: Record<string, unknown>;
  }): Promise<AuditRecord> {
    return await this.record({
      tenantId: context.tenant.id,
      actor: context.actor,
      clientId: context.clientId,
      action: options.action,
      target: options.target,
      destructive: options.destructive,
      diffSummary: options.diffSummary,
      metadata: options.metadata ?? {},
    });
  }
}
