import type { Operation, ExecutionSession, Plan } from './types/client';

export function createInitialOperationFromPlan(plan: Plan, instanceId: string): Operation {
  const opId = plan.backend_operation_id || plan.plan_id;
  const totalFiles = plan.changes?.length || 0;
  return {
    operation_id: opId,
    installation_id: instanceId,
    target_installation_id: plan.mod_id,
    mod_id: plan.mod_id,
    mod_title: plan.mod_title,
    version_id: plan.version_id,
    version_str: plan.version_str,
    kind: plan.kind,
    state: 'planned',
    phase: 'planned',
    can_rollback: false,
    progress: {
      stage: '计划已确认，正在初始化写入事务...',
      current_file: '',
      processed_files: 0,
      total_files: totalFiles,
      bytes_processed: 0,
      total_bytes: plan.bytes_required,
      percent: 0,
    },
    backup_id: `snapshot_${opId}`,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

export function isTerminalOperation(op: Operation): boolean {
  return (
    op.state === 'committed' ||
    op.state === 'rolled_back' ||
    op.state === 'needs_manual_recovery' ||
    op.phase === 'committed' ||
    op.phase === 'rolled_back' ||
    op.phase === 'needs_manual_recovery'
  );
}

export function mergeOperationIntoList(operations: Operation[], op: Operation): Operation[] {
  const index = operations.findIndex((item) => item.operation_id === op.operation_id);
  if (index >= 0) {
    const updated = [...operations];
    updated[index] = op;
    return updated;
  }
  return [op, ...operations];
}

export interface ExecutionCoordinatorOptions {
  activeInstanceId: () => string;
  onSessionChange: (session: ExecutionSession | null) => void;
  onOperationsChange: (updater: (prev: Operation[]) => Operation[]) => void;
  getOperation: (operationId: string) => Promise<Operation>;
  pollIntervalMs?: number;
}

export class ExecutionCoordinator {
  private activeTimer: any = null;
  private currentSession: ExecutionSession | null = null;
  private sessionGeneration = 0;
  private options: ExecutionCoordinatorOptions;

  constructor(options: ExecutionCoordinatorOptions) {
    this.options = options;
  }

  getCurrentSession(): ExecutionSession | null {
    return this.currentSession;
  }

  getSessionGeneration(): number {
    return this.sessionGeneration;
  }

  private isSessionValid(generation: number, targetInstanceId: string, operationId: string): boolean {
    return (
      this.sessionGeneration === generation &&
      this.options.activeInstanceId() === targetInstanceId &&
      this.currentSession?.operation_id === operationId
    );
  }

  stopPolling() {
    if (this.activeTimer !== null) {
      clearInterval(this.activeTimer);
      this.activeTimer = null;
    }
  }

  startSession(plan: Plan, targetInstanceId: string): ExecutionSession {
    this.stopPolling();
    const generation = ++this.sessionGeneration;
    const opId = plan.backend_operation_id || plan.plan_id;
    const initialOp = createInitialOperationFromPlan(plan, targetInstanceId);

    const session: ExecutionSession = {
      operation_id: opId,
      installation_id: targetInstanceId,
      plan_id: plan.plan_id,
      kind: plan.kind,
      mod_title: plan.mod_title,
      mod_id: plan.mod_id,
      operation: initialOp,
      is_finished: false,
      error: null,
    };

    this.currentSession = session;
    this.options.onSessionChange(session);
    this.options.onOperationsChange((prev) => mergeOperationIntoList(prev, initialOp));

    let isPolling = false;
    const interval = this.options.pollIntervalMs ?? 200;
    this.activeTimer = setInterval(async () => {
      if (isPolling) return;
      if (!this.isSessionValid(generation, targetInstanceId, opId)) {
        if (this.sessionGeneration === generation) {
          this.stopPolling();
        }
        return;
      }

      isPolling = true;
      try {
        const detail = await this.options.getOperation(opId);
        if (!this.isSessionValid(generation, targetInstanceId, opId)) {
          if (this.sessionGeneration === generation) {
            this.stopPolling();
          }
          return;
        }
        if (!detail) return;

        const finished = isTerminalOperation(detail);
        const updatedSession: ExecutionSession = {
          ...session,
          operation: detail,
          is_finished: finished,
          error: detail.error?.message || null,
        };
        this.currentSession = updatedSession;
        this.options.onSessionChange(updatedSession);
        this.options.onOperationsChange((prev) => mergeOperationIntoList(prev, detail));

        if (finished) {
          this.stopPolling();
        }
      } catch {
        // Ignore transient poll error: do not remove task or mark success
      } finally {
        isPolling = false;
      }
    }, interval);

    return session;
  }

  async finishSession(
    operationId: string,
    targetInstanceId: string,
    error?: Error | null
  ): Promise<void> {
    if (
      this.options.activeInstanceId() !== targetInstanceId ||
      this.currentSession?.operation_id !== operationId
    ) {
      return;
    }

    this.stopPolling();
    const generation = ++this.sessionGeneration;

    try {
      const detail = await this.options.getOperation(operationId);
      if (this.isSessionValid(generation, targetInstanceId, operationId) && detail) {
        const finished = isTerminalOperation(detail) || !!error;
        const updatedSession: ExecutionSession = {
          operation_id: operationId,
          installation_id: targetInstanceId,
          plan_id: this.currentSession?.plan_id || operationId,
          kind: this.currentSession?.kind || detail.kind,
          mod_title: this.currentSession?.mod_title || detail.mod_title,
          mod_id: this.currentSession?.mod_id || detail.mod_id,
          operation: detail,
          is_finished: finished,
          error: error?.message || detail.error?.message || null,
        };
        this.currentSession = updatedSession;
        this.options.onSessionChange(updatedSession);
        this.options.onOperationsChange((prev) => mergeOperationIntoList(prev, detail));
        return;
      }
    } catch {
      // If fetching fails, still finalize current session with error if present
    }

    if (
      this.isSessionValid(generation, targetInstanceId, operationId) &&
      this.currentSession
    ) {
      const updatedSession: ExecutionSession = {
        ...this.currentSession,
        is_finished: true,
        error: error ? error.message : this.currentSession.error,
      };
      this.currentSession = updatedSession;
      this.options.onSessionChange(updatedSession);
    }
  }

  clearSession() {
    this.sessionGeneration++;
    this.stopPolling();
    this.currentSession = null;
    this.options.onSessionChange(null);
  }
}
