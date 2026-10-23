import type { Operation, ExecutionSession, Plan, OperationState } from './types/client';

export interface FinishSessionOptions {
  confirmedState?: OperationState | string;
  files?: number;
}

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
    op.state === 'query_failed' ||
    op.phase === 'committed' ||
    op.phase === 'rolled_back' ||
    op.phase === 'needs_manual_recovery' ||
    op.phase === 'query_failed'
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
    error?: Error | null,
    options?: FinishSessionOptions
  ): Promise<void> {
    if (
      this.options.activeInstanceId() !== targetInstanceId ||
      this.currentSession?.operation_id !== operationId
    ) {
      return;
    }

    this.stopPolling();
    const generation = ++this.sessionGeneration;

    let detail: Operation | null = null;
    let queryError: Error | null = null;

    try {
      detail = await this.options.getOperation(operationId);
    } catch (err) {
      queryError = err instanceof Error ? err : new Error(String(err));
    }

    if (!this.isSessionValid(generation, targetInstanceId, operationId) || !this.currentSession) {
      return;
    }

    if (detail) {
      const isCommitted =
        detail.state === 'committed' ||
        detail.phase === 'committed' ||
        options?.confirmedState === 'committed';
      const finished = isTerminalOperation(detail) || !!error || isCommitted;
      let finalOp: Operation = { ...detail };
      if (options?.confirmedState === 'committed' && finalOp.state !== 'committed') {
        finalOp.state = 'committed';
        finalOp.phase = 'committed';
        if (finalOp.progress) {
          finalOp.progress.percent = 100;
        }
      }
      if (options?.files !== undefined && (finalOp.progress.processed_files === 0 || !finalOp.progress.processed_files)) {
        finalOp.progress.processed_files = options.files;
        finalOp.progress.total_files = Math.max(finalOp.progress.total_files, options.files);
      }
      if (error && !isCommitted) {
        finalOp = {
          ...finalOp,
          error: finalOp.error || { code: 'execute_error', message: error.message },
        };
      }
      const updatedSession: ExecutionSession = {
        operation_id: operationId,
        installation_id: targetInstanceId,
        plan_id: this.currentSession.plan_id || operationId,
        kind: this.currentSession.kind || finalOp.kind,
        mod_title: this.currentSession.mod_title || finalOp.mod_title,
        mod_id: this.currentSession.mod_id || finalOp.mod_id,
        operation: finalOp,
        is_finished: finished,
        error: isCommitted ? (detail.error?.message || null) : (detail.error?.message || error?.message || null),
        communication_error: (error && isCommitted) ? error.message : null,
      };
      this.currentSession = updatedSession;
      this.options.onSessionChange(updatedSession);
      this.options.onOperationsChange((prev) => mergeOperationIntoList(prev, finalOp));
      return;
    }

    // Detail query failed or returned empty:
    // Check if we already have a confirmed terminal state (e.g. from polling or passed options)
    const currentOp = this.currentSession.operation;
    const isCommitted =
      options?.confirmedState === 'committed' ||
      currentOp.state === 'committed' ||
      currentOp.phase === 'committed';
    const isNeedsManual =
      options?.confirmedState === 'needs_manual_recovery' ||
      currentOp.state === 'needs_manual_recovery' ||
      currentOp.phase === 'needs_manual_recovery';
    const isRolledBack =
      options?.confirmedState === 'rolled_back' ||
      currentOp.state === 'rolled_back' ||
      currentOp.phase === 'rolled_back';

    const queryErrorMsg = queryError?.message || '后端状态查询失败';

    if (isCommitted) {
      // Confirmed committed state MUST be preserved.
      // Display query or communication exception separately.
      const finalOp: Operation = {
        ...currentOp,
        state: 'committed',
        phase: 'committed',
        progress: {
          ...currentOp.progress,
          percent: 100,
          stage: currentOp.progress?.stage || '已提交',
        },
      };
      if (options?.files !== undefined && (finalOp.progress.processed_files === 0 || !finalOp.progress.processed_files)) {
        finalOp.progress.processed_files = options.files;
        finalOp.progress.total_files = Math.max(finalOp.progress.total_files, options.files);
      }
      const commError = error
        ? (queryError ? `${error.message} (查询异常: ${queryErrorMsg})` : error.message)
        : (queryError ? `后端状态查询失败: ${queryErrorMsg}` : null);

      const updatedSession: ExecutionSession = {
        ...this.currentSession,
        operation: finalOp,
        is_finished: true,
        error: currentOp.error?.message || null,
        communication_error: commError,
      };
      this.currentSession = updatedSession;
      this.options.onSessionChange(updatedSession);
      this.options.onOperationsChange((prev) => mergeOperationIntoList(prev, finalOp));
      return;
    }

    if (isNeedsManual || isRolledBack) {
      // Confirmed terminal recovery/rollback state MUST be preserved.
      const commError = error
        ? (queryError ? `${error.message} (查询异常: ${queryErrorMsg})` : error.message)
        : (queryError ? `后端状态查询失败: ${queryErrorMsg}` : null);

      const updatedSession: ExecutionSession = {
        ...this.currentSession,
        is_finished: true,
        error: currentOp.error?.message || error?.message || null,
        communication_error: commError,
      };
      this.currentSession = updatedSession;
      this.options.onSessionChange(updatedSession);
      this.options.onOperationsChange((prev) => mergeOperationIntoList(prev, currentOp));
      return;
    }

    // Only when there is no confirmed terminal state / determined result do we fall back to query_failed
    const fallbackOp: Operation = {
      ...currentOp,
      state: 'query_failed',
      phase: 'query_failed',
      progress: {
        ...currentOp.progress,
        stage: '后端状态查询失败，结果未知',
      },
      error: error
        ? { code: 'query_failed', message: error.message }
        : queryError
          ? { code: 'query_failed', message: queryError.message }
          : currentOp.error,
    };
    const updatedSession: ExecutionSession = {
      ...this.currentSession,
      operation: fallbackOp,
      is_finished: true,
      error: error ? error.message : (queryError ? queryError.message : (this.currentSession.error || '后端状态查询失败')),
      communication_error: error ? error.message : (queryError ? queryError.message : null),
    };
    this.currentSession = updatedSession;
    this.options.onSessionChange(updatedSession);
    this.options.onOperationsChange((prev) => mergeOperationIntoList(prev, fallbackOp));
  }

  clearSession() {
    this.sessionGeneration++;
    this.stopPolling();
    this.currentSession = null;
    this.options.onSessionChange(null);
  }
}
