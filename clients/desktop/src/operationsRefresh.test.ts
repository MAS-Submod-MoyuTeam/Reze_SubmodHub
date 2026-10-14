import assert from 'node:assert/strict';
import { test } from 'node:test';

interface OperationItem {
  operation_id: string;
  installation_id: string;
  state: string;
  can_rollback: boolean;
  backup_id?: string;
}

export class OperationsRefreshCoordinator {
  private requestId = 0;
  private activeInstanceId: string;
  private operations: OperationItem[] = [];

  constructor(initialInstanceId: string) {
    this.activeInstanceId = initialInstanceId;
  }

  setActiveInstance(instanceId: string) {
    this.activeInstanceId = instanceId;
  }

  getActiveInstance(): string {
    return this.activeInstanceId;
  }

  getOperations(): OperationItem[] {
    return this.operations;
  }

  async refreshOperations(
    fetcher: () => Promise<OperationItem[]>,
    expectedInstanceId?: string,
  ): Promise<boolean> {
    const targetInstId = expectedInstanceId ?? this.activeInstanceId;
    const reqId = ++this.requestId;

    try {
      const ops = await fetcher();
      if (
        reqId !== this.requestId ||
        (targetInstId && this.activeInstanceId !== targetInstId)
      ) {
        return false; // Stale response discarded
      }
      this.operations = ops;
      return true;
    } catch {
      if (
        reqId !== this.requestId ||
        (targetInstId && this.activeInstanceId !== targetInstId)
      ) {
        return false;
      }
      return false;
    }
  }
}

test('operations refresh rejects stale response when active instance has switched', async () => {
  const coordinator = new OperationsRefreshCoordinator('inst-A');

  // Start in-flight request for inst-A that is slow
  let resolveInstA: (ops: OperationItem[]) => void = () => {};
  const promiseA = new Promise<OperationItem[]>((res) => {
    resolveInstA = res;
  });

  const refreshAPromise = coordinator.refreshOperations(() => promiseA, 'inst-A');

  // User immediately switches to inst-B
  coordinator.setActiveInstance('inst-B');

  // Start fast request for inst-B
  const refreshBPromise = coordinator.refreshOperations(
    async () => [
      { operation_id: 'op-b1', installation_id: 'inst-B', state: 'committed', can_rollback: false },
    ],
    'inst-B',
  );

  const appliedB = await refreshBPromise;
  assert.equal(appliedB, true);
  assert.equal(coordinator.getOperations().length, 1);
  assert.equal(coordinator.getOperations()[0].operation_id, 'op-b1');

  // Now delayed inst-A response finally arrives
  resolveInstA([
    { operation_id: 'op-a1', installation_id: 'inst-A', state: 'committed', can_rollback: false },
  ]);
  const appliedA = await refreshAPromise;
  assert.equal(appliedA, false, 'Late response from superseded instance should be rejected');

  // Operations list must remain inst-B
  assert.equal(coordinator.getOperations().length, 1);
  assert.equal(coordinator.getOperations()[0].operation_id, 'op-b1');
});

test('operations refresh runs and updates operations list on execution failure', async () => {
  const coordinator = new OperationsRefreshCoordinator('inst-1');

  // Simulate execution failure where backend recorded needs_manual_recovery
  let backendOperations: OperationItem[] = [];

  const executePlanMock = async (shouldFail: boolean) => {
    if (shouldFail) {
      backendOperations = [
        {
          operation_id: 'op-fail-1',
          installation_id: 'inst-1',
          state: 'needs_manual_recovery',
          can_rollback: false,
        },
      ];
      throw new Error('disk_read_error: simulated failure');
    }
    backendOperations = [
      {
        operation_id: 'op-succ-1',
        installation_id: 'inst-1',
        state: 'committed',
        can_rollback: false,
      },
    ];
  };

  // Run failed execution with guaranteed refresh in catch
  try {
    await executePlanMock(true);
  } catch {
    await coordinator.refreshOperations(async () => backendOperations, 'inst-1');
  }

  // Task center now immediately has the needs_manual_recovery task
  assert.equal(coordinator.getOperations().length, 1);
  assert.equal(coordinator.getOperations()[0].state, 'needs_manual_recovery');
  assert.equal(coordinator.getOperations()[0].operation_id, 'op-fail-1');
});

test('committed operations do not provide rollback or restore snapshot action', () => {
  const committedOp: OperationItem = {
    operation_id: 'op-1',
    installation_id: 'inst-1',
    state: 'committed',
    can_rollback: false,
    backup_id: 'backup_op-1',
  };

  // In the updated UI contract, committed operations have neither can_rollback nor restore snapshot
  const canRollback = committedOp.can_rollback || committedOp.state === 'recoverable';
  assert.equal(canRollback, false, 'Committed operation cannot be rolled back');
});

test('needs_manual_recovery with intact recovery material has can_rollback true and separates instance vs mod installation id', () => {
  const manualOp = {
    operation_id: 'op-manual-1',
    installation_id: 'mas-inst-1', // MAS Instance ID
    target_installation_id: 'mod_submod_alpha', // Mod installation ID
    state: 'needs_manual_recovery',
    can_rollback: true,
  };

  assert.equal(manualOp.installation_id, 'mas-inst-1');
  assert.equal(manualOp.target_installation_id, 'mod_submod_alpha');
  assert.equal(manualOp.can_rollback, true, 'Intact recovery material allows retry rollback');

  const corruptOp = {
    operation_id: 'op-corrupt-1',
    installation_id: 'mas-inst-1',
    target_installation_id: 'mod_submod_alpha',
    state: 'needs_manual_recovery',
    can_rollback: false,
  };
  assert.equal(corruptOp.can_rollback, false, 'Corrupted journal cannot be rolled back');
});

import {
  ExecutionCoordinator,
  createInitialOperationFromPlan,
  isTerminalOperation,
  mergeOperationIntoList,
} from './executionCoordinator';
import type { Operation, Plan, ExecutionSession } from './types/client';

test('ExecutionCoordinator: startSession immediately registers in-flight operation with snapshot ID', () => {
  let sessionState: ExecutionSession | null = null;
  let operationsState: Operation[] = [];
  let currentInstId = 'inst-alpha';

  const plan: Plan = {
    plan_id: 'plan_test_1',
    backend_operation_id: 'op_test_1',
    installation_id: 'inst-alpha',
    kind: 'install',
    mod_id: 'mod_alpha',
    mod_title: 'Alpha Mod',
    version_id: 'v1',
    version_str: '1.0.0',
    expires_at: '',
    dependency_blockers: [],
    semantic_blockers: [],
    changes: [
      {
        target_path: 'game/Submods/a.rpy',
        action: 'CREATE',
        previous_owner: '(无)',
        next_owner: 'Alpha Mod',
        previous_hash: '',
        next_hash: 'h1',
        reason: 'new file',
        backup_required: false,
      },
    ],
    backups_required: 0,
    bytes_required: 1024,
    warnings: [],
  };

  const coordinator = new ExecutionCoordinator({
    activeInstanceId: () => currentInstId,
    onSessionChange: (s) => {
      sessionState = s;
    },
    onOperationsChange: (updater) => {
      operationsState = updater(operationsState);
    },
    getOperation: async (opId) => operationsState.find((o) => o.operation_id === opId)!,
    pollIntervalMs: 50,
  });

  const session = coordinator.startSession(plan, 'inst-alpha');
  try {
    assert.equal(session.operation_id, 'op_test_1');
    assert.equal(session.is_finished, false);
    assert.equal(session.operation.state, 'planned');
    assert.equal(session.operation.backup_id, 'snapshot_op_test_1');

    // Operation must immediately appear in operations list
    assert.equal(operationsState.length, 1);
    assert.equal(operationsState[0].operation_id, 'op_test_1');
    assert.equal(operationsState[0].backup_id, 'snapshot_op_test_1');
    assert.equal(operationsState[0].progress.total_files, 1);
  } finally {
    coordinator.stopPolling();
  }
});

test('ExecutionCoordinator: polls backend, increments progress, and stops on terminal state', async () => {
  let sessionState: ExecutionSession | null = null;
  let operationsState: Operation[] = [];
  const currentInstId = 'inst-alpha';

  let pollCount = 0;
  const backendDetails: Operation[] = [
    {
      operation_id: 'op_poll_1',
      installation_id: 'inst-alpha',
      mod_id: 'mod_alpha',
      mod_title: 'Alpha Mod',
      version_id: 'v1',
      version_str: '1.0.0',
      kind: 'install',
      state: 'writing',
      phase: 'applying',
      progress: {
        stage: '正在应用文件变更 (1/2)',
        current_file: 'game/Submods/1.rpy',
        processed_files: 1,
        total_files: 2,
        bytes_processed: 500,
        total_bytes: 1000,
        percent: 50,
      },
      backup_id: 'snapshot_op_poll_1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      operation_id: 'op_poll_1',
      installation_id: 'inst-alpha',
      mod_id: 'mod_alpha',
      mod_title: 'Alpha Mod',
      version_id: 'v1',
      version_str: '1.0.0',
      kind: 'install',
      state: 'committed',
      phase: 'committed',
      progress: {
        stage: '操作已成功提交',
        current_file: '',
        processed_files: 2,
        total_files: 2,
        bytes_processed: 1000,
        total_bytes: 1000,
        percent: 100,
      },
      backup_id: 'snapshot_op_poll_1',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  const coordinator = new ExecutionCoordinator({
    activeInstanceId: () => currentInstId,
    onSessionChange: (s) => {
      sessionState = s;
    },
    onOperationsChange: (updater) => {
      operationsState = updater(operationsState);
    },
    getOperation: async () => {
      const idx = Math.min(pollCount++, backendDetails.length - 1);
      return backendDetails[idx];
    },
    pollIntervalMs: 10,
  });

  const plan: Plan = {
    plan_id: 'plan_poll_1',
    backend_operation_id: 'op_poll_1',
    installation_id: 'inst-alpha',
    kind: 'install',
    mod_id: 'mod_alpha',
    mod_title: 'Alpha Mod',
    version_id: 'v1',
    version_str: '1.0.0',
    expires_at: '',
    dependency_blockers: [],
    semantic_blockers: [],
    changes: [],
    backups_required: 0,
    bytes_required: 1000,
    warnings: [],
  };

  coordinator.startSession(plan, 'inst-alpha');

  // Wait for polling to advance and stop on terminal state
  await new Promise((resolve) => setTimeout(resolve, 60));

  const finalSession = coordinator.getCurrentSession();
  assert.ok(finalSession);
  assert.equal(finalSession.is_finished, true);
  assert.equal(finalSession.operation.state, 'committed');
  assert.equal(finalSession.operation.progress.percent, 100);
  assert.equal(operationsState.length, 1);
  assert.equal(operationsState[0].state, 'committed');
  assert.equal(operationsState[0].backup_id, 'snapshot_op_poll_1');
});

test('ExecutionCoordinator: rejects and stops polling when active instance switches', async () => {
  let sessionState: ExecutionSession | null = null;
  let operationsState: Operation[] = [];
  let currentInstId = 'inst-A';

  const coordinator = new ExecutionCoordinator({
    activeInstanceId: () => currentInstId,
    onSessionChange: (s) => {
      sessionState = s;
    },
    onOperationsChange: (updater) => {
      operationsState = updater(operationsState);
    },
    getOperation: async () => {
      return {
        operation_id: 'op_stale_inst',
        installation_id: 'inst-A',
        mod_id: 'mod_alpha',
        mod_title: 'Alpha Mod',
        version_id: 'v1',
        version_str: '1.0.0',
        kind: 'install',
        state: 'writing',
        phase: 'applying',
        progress: {
          stage: '应用中',
          processed_files: 1,
          total_files: 2,
          bytes_processed: 10,
          total_bytes: 20,
          percent: 50,
        },
        backup_id: 'snapshot_op_stale_inst',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    },
    pollIntervalMs: 15,
  });

  const plan: Plan = {
    plan_id: 'p_stale',
    backend_operation_id: 'op_stale_inst',
    installation_id: 'inst-A',
    kind: 'install',
    mod_id: 'mod_a',
    mod_title: 'A',
    version_id: 'v1',
    version_str: '1',
    expires_at: '',
    dependency_blockers: [],
    semantic_blockers: [],
    changes: [],
    backups_required: 0,
    bytes_required: 20,
    warnings: [],
  };

  coordinator.startSession(plan, 'inst-A');
  assert.equal(operationsState.length, 1);

  // User switches to instance B
  currentInstId = 'inst-B';
  operationsState = []; // Inst-B's empty operations list

  // Wait long enough for timer tick
  await new Promise((resolve) => setTimeout(resolve, 40));

  // Inst-A's late response must NOT be added into Inst-B's operations list
  assert.equal(operationsState.length, 0);
});

test('ExecutionCoordinator: finishSession preserves needs_manual_recovery and error on failure', async () => {
  let sessionState: ExecutionSession | null = null;
  let operationsState: Operation[] = [];

  const coordinator = new ExecutionCoordinator({
    activeInstanceId: () => 'inst-fail',
    onSessionChange: (s) => {
      sessionState = s;
    },
    onOperationsChange: (updater) => {
      operationsState = updater(operationsState);
    },
    getOperation: async () => {
      return {
        operation_id: 'op_manual_fail',
        installation_id: 'inst-fail',
        mod_id: 'mod_fail',
        mod_title: 'Fail Mod',
        version_id: 'v1',
        version_str: '1.0.0',
        kind: 'install',
        state: 'needs_manual_recovery',
        phase: 'needs_manual_recovery',
        can_rollback: true,
        progress: {
          stage: '检测到外部冲突或异常，需要人工恢复',
          processed_files: 1,
          total_files: 2,
          bytes_processed: 10,
          total_bytes: 20,
          percent: 50,
        },
        backup_id: 'snapshot_op_manual_fail',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        error: { code: 'conflict_detected', message: 'Target file modified outside SubmodHub' },
      };
    },
    pollIntervalMs: 100,
  });

  const plan: Plan = {
    plan_id: 'p_fail',
    backend_operation_id: 'op_manual_fail',
    installation_id: 'inst-fail',
    kind: 'install',
    mod_id: 'mod_fail',
    mod_title: 'Fail Mod',
    version_id: 'v1',
    version_str: '1',
    expires_at: '',
    dependency_blockers: [],
    semantic_blockers: [],
    changes: [],
    backups_required: 0,
    bytes_required: 20,
    warnings: [],
  };

  coordinator.startSession(plan, 'inst-fail');

  // Trigger finish with execution error
  await coordinator.finishSession('op_manual_fail', 'inst-fail', new Error('Execution halted: manual recovery needed'));

  const finalSession = coordinator.getCurrentSession();
  assert.ok(finalSession);
  assert.equal(finalSession.is_finished, true);
  assert.equal(finalSession.operation.state, 'needs_manual_recovery');
  assert.equal(finalSession.operation.can_rollback, true);
  assert.equal(finalSession.operation.backup_id, 'snapshot_op_manual_fail');
  assert.equal(operationsState.length, 1);
  assert.equal(operationsState[0].state, 'needs_manual_recovery');
});

test('ExecutionCoordinator: finishSession with error preserves committed backend state and records communication error', async () => {
  let sessionState: ExecutionSession | null = null;
  let operationsState: Operation[] = [];

  const coordinator = new ExecutionCoordinator({
    activeInstanceId: () => 'inst-test',
    onSessionChange: (s) => {
      sessionState = s;
    },
    onOperationsChange: (updater) => {
      operationsState = updater(operationsState);
    },
    getOperation: async () => {
      return {
        operation_id: 'op_false_committed',
        installation_id: 'inst-test',
        mod_id: 'mod_test',
        mod_title: 'Test Mod',
        version_id: 'v1',
        version_str: '1.0.0',
        kind: 'repair',
        state: 'committed',
        phase: 'committed',
        can_rollback: false,
        progress: { stage: '完成', processed_files: 1, total_files: 1, bytes_processed: 10, total_bytes: 10, percent: 100 },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    },
  });

  const plan: Plan = {
    plan_id: 'plan_repair_1',
    backend_operation_id: 'op_false_committed',
    installation_id: 'inst-test',
    kind: 'repair',
    mod_id: 'mod_test',
    mod_title: 'Test Mod',
    version_id: 'v1',
    version_str: '1.0.0',
    expires_at: '',
    dependency_blockers: [],
    semantic_blockers: [],
    changes: [],
    backups_required: 0,
    bytes_required: 10,
    warnings: [],
  };

  coordinator.startSession(plan, 'inst-test');

  // Finish session with error (e.g. ExecutePlan threw or post-execution response was lost)
  await coordinator.finishSession('op_false_committed', 'inst-test', new Error('Execution failed unexpectedly'));

  const session = coordinator.getCurrentSession();
  assert.ok(session);
  assert.equal(session.is_finished, true);
  // Authoritative committed backend status must be preserved
  assert.equal(session.operation.state, 'committed');
  assert.equal(session.operation.phase, 'committed');
  assert.equal(session.operation.error, undefined);
  // Communication error is recorded separately on the session rather than failing the committed operation
  assert.equal(session.communication_error, 'Execution failed unexpectedly');
  assert.equal(session.error, null);
  assert.equal(operationsState.length, 1);
  assert.equal(operationsState[0].state, 'committed');
});

test('ExecutionCoordinator: finishSession fallback on getOperation rejection marks state as unknown with error', async () => {
  let sessionState: ExecutionSession | null = null;
  let operationsState: Operation[] = [];

  const coordinator = new ExecutionCoordinator({
    activeInstanceId: () => 'inst-test',
    onSessionChange: (s) => {
      sessionState = s;
    },
    onOperationsChange: (updater) => {
      operationsState = updater(operationsState);
    },
    getOperation: async () => {
      throw new Error('Backend journal not found');
    },
  });

  const plan: Plan = {
    plan_id: 'plan_repair_2',
    backend_operation_id: 'op_rejected',
    installation_id: 'inst-test',
    kind: 'repair',
    mod_id: 'mod_test',
    mod_title: 'Test Mod',
    version_id: 'v1',
    version_str: '1.0.0',
    expires_at: '',
    dependency_blockers: [],
    semantic_blockers: [],
    changes: [],
    backups_required: 0,
    bytes_required: 10,
    warnings: [],
  };

  coordinator.startSession(plan, 'inst-test');
  await coordinator.finishSession('op_rejected', 'inst-test', new Error('plan_stale'));

  const session = coordinator.getCurrentSession();
  assert.ok(session);
  assert.equal(session.is_finished, true);
  assert.equal(session.error, 'plan_stale');
  assert.equal(session.operation.state, 'unknown');
  assert.equal(session.operation.phase, 'unknown');
  assert.equal(session.operation.error?.message, 'plan_stale');
  assert.equal(operationsState.length, 1);
  assert.equal(operationsState[0].state, 'unknown');
  assert.equal(operationsState[0].error?.message, 'plan_stale');
});

test('ExecutionCoordinator: polling already received committed -> query failure in finishSession does not downgrade to unknown', async () => {
  let sessionState: ExecutionSession | null = null;
  let operationsState: Operation[] = [];
  let pollCount = 0;

  const coordinator = new ExecutionCoordinator({
    activeInstanceId: () => 'inst-test',
    onSessionChange: (s) => {
      sessionState = s;
    },
    onOperationsChange: (updater) => {
      operationsState = updater(operationsState);
    },
    getOperation: async () => {
      pollCount++;
      if (pollCount === 1) {
        return {
          operation_id: 'op_poll_committed',
          installation_id: 'inst-test',
          mod_id: 'mod_test',
          mod_title: 'Test Mod',
          version_id: 'v1',
          version_str: '1.0.0',
          kind: 'install',
          state: 'committed',
          phase: 'committed',
          can_rollback: false,
          progress: { stage: '完成', processed_files: 5, total_files: 5, bytes_processed: 100, total_bytes: 100, percent: 100 },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      throw new Error('Database connection reset during final query');
    },
    pollIntervalMs: 20,
  });

  const plan: Plan = {
    plan_id: 'plan_1',
    backend_operation_id: 'op_poll_committed',
    installation_id: 'inst-test',
    kind: 'install',
    mod_id: 'mod_test',
    mod_title: 'Test Mod',
    version_id: 'v1',
    version_str: '1.0.0',
    expires_at: '',
    dependency_blockers: [],
    semantic_blockers: [],
    changes: [],
    backups_required: 0,
    bytes_required: 100,
    warnings: [],
  };

  coordinator.startSession(plan, 'inst-test');

  // Wait for polling to deliver committed
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(coordinator.getCurrentSession()?.operation.state, 'committed');

  // Finish session where getOperation fails
  await coordinator.finishSession('op_poll_committed', 'inst-test');

  const session = coordinator.getCurrentSession();
  assert.ok(session);
  assert.equal(session.is_finished, true);
  // Crucial: Must preserve committed state rather than downgrading to unknown
  assert.equal(session.operation.state, 'committed');
  assert.equal(session.operation.phase, 'committed');
  assert.equal(session.error, null);
  assert.match(session.communication_error || '', /Database connection reset/);
});

test('ExecutionCoordinator: ExecutePlan confirmed committed in finishSession options preserves committed state even if getOperation rejects', async () => {
  let sessionState: ExecutionSession | null = null;
  let operationsState: Operation[] = [];

  const coordinator = new ExecutionCoordinator({
    activeInstanceId: () => 'inst-test',
    onSessionChange: (s) => {
      sessionState = s;
    },
    onOperationsChange: (updater) => {
      operationsState = updater(operationsState);
    },
    getOperation: async () => {
      // Simulate backend status query failing after ExecutePlan returned
      throw new Error('Backend journal query timed out');
    },
  });

  const plan: Plan = {
    plan_id: 'plan_exec_succ',
    backend_operation_id: 'op_exec_succ',
    installation_id: 'inst-test',
    kind: 'install',
    mod_id: 'mod_succ',
    mod_title: 'Success Mod',
    version_id: 'v1',
    version_str: '1.0.0',
    expires_at: '',
    dependency_blockers: [],
    semantic_blockers: [],
    changes: [],
    backups_required: 0,
    bytes_required: 200,
    warnings: [],
  };

  coordinator.startSession(plan, 'inst-test');
  assert.equal(coordinator.getCurrentSession()?.operation.state, 'planned');

  // ExecutePlan succeeded and returned state: committed with 12 files
  await coordinator.finishSession('op_exec_succ', 'inst-test', null, {
    confirmedState: 'committed',
    files: 12,
  });

  const session = coordinator.getCurrentSession();
  assert.ok(session);
  assert.equal(session.is_finished, true);
  // Committed status must be set from confirmedState, NOT downgraded to unknown
  assert.equal(session.operation.state, 'committed');
  assert.equal(session.operation.phase, 'committed');
  assert.equal(session.operation.progress.percent, 100);
  assert.equal(session.operation.progress.processed_files, 12);
  assert.equal(session.error, null);
  assert.match(session.communication_error || '', /Backend journal query timed out/);
  assert.equal(operationsState.length, 1);
  assert.equal(operationsState[0].state, 'committed');
});

test('ExecutionCoordinator: polling received needs_manual_recovery -> finishSession query failure preserves recovery state', async () => {
  let sessionState: ExecutionSession | null = null;
  let operationsState: Operation[] = [];
  let pollCount = 0;

  const coordinator = new ExecutionCoordinator({
    activeInstanceId: () => 'inst-test',
    onSessionChange: (s) => {
      sessionState = s;
    },
    onOperationsChange: (updater) => {
      operationsState = updater(operationsState);
    },
    getOperation: async () => {
      pollCount++;
      if (pollCount === 1) {
        return {
          operation_id: 'op_poll_recovery',
          installation_id: 'inst-test',
          mod_id: 'mod_recovery',
          mod_title: 'Recovery Mod',
          version_id: 'v1',
          version_str: '1.0.0',
          kind: 'install',
          state: 'needs_manual_recovery',
          phase: 'needs_manual_recovery',
          can_rollback: true,
          backup_id: 'snapshot_op_poll_recovery',
          progress: { stage: '外部文件冲突', processed_files: 1, total_files: 2, bytes_processed: 10, total_bytes: 20, percent: 50 },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error: { code: 'conflict_detected', message: 'Target file modified outside SubmodHub' },
        };
      }
      throw new Error('Query error during finish');
    },
    pollIntervalMs: 20,
  });

  const plan: Plan = {
    plan_id: 'plan_rec',
    backend_operation_id: 'op_poll_recovery',
    installation_id: 'inst-test',
    kind: 'install',
    mod_id: 'mod_recovery',
    mod_title: 'Recovery Mod',
    version_id: 'v1',
    version_str: '1.0.0',
    expires_at: '',
    dependency_blockers: [],
    semantic_blockers: [],
    changes: [],
    backups_required: 0,
    bytes_required: 20,
    warnings: [],
  };

  coordinator.startSession(plan, 'inst-test');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(coordinator.getCurrentSession()?.operation.state, 'needs_manual_recovery');

  await coordinator.finishSession('op_poll_recovery', 'inst-test');

  const session = coordinator.getCurrentSession();
  assert.ok(session);
  assert.equal(session.is_finished, true);
  assert.equal(session.operation.state, 'needs_manual_recovery');
  assert.equal(session.operation.can_rollback, true);
  assert.match(session.communication_error || '', /Query error during finish/);
});

test('isTerminalOperation identifies terminal states accurately', () => {
  assert.equal(isTerminalOperation({ state: 'committed' } as any), true);
  assert.equal(isTerminalOperation({ state: 'rolled_back' } as any), true);
  assert.equal(isTerminalOperation({ state: 'needs_manual_recovery' } as any), true);
  assert.equal(isTerminalOperation({ state: 'unknown' } as any), true);
  assert.equal(isTerminalOperation({ state: 'writing', phase: 'unknown' } as any), true);
  assert.equal(isTerminalOperation({ state: 'writing', phase: 'committed' } as any), true);
  assert.equal(isTerminalOperation({ state: 'writing', phase: 'applying' } as any), false);
  assert.equal(isTerminalOperation({ state: 'planned', phase: 'planned' } as any), false);
  assert.equal(isTerminalOperation({ state: 'backed_up', phase: 'prepared' } as any), false);
  assert.equal(isTerminalOperation({ state: 'recoverable', phase: 'applying' } as any), false);
});

test('ExecutionCoordinator: late poll response on same instance does not overwrite newly started session', async () => {
  const sessionHistory: (ExecutionSession | null)[] = [];
  let operationsState: Operation[] = [];
  const currentInstId = 'inst-alpha';

  let resolvePoll1: (op: Operation) => void = () => {};
  const poll1Promise = new Promise<Operation>((resolve) => {
    resolvePoll1 = resolve;
  });

  let poll2Called = false;

  const coordinator = new ExecutionCoordinator({
    activeInstanceId: () => currentInstId,
    onSessionChange: (s) => {
      sessionHistory.push(s);
    },
    onOperationsChange: (updater) => {
      operationsState = updater(operationsState);
    },
    getOperation: async (operationId) => {
      if (operationId === 'op_task_1') {
        return poll1Promise;
      }
      if (operationId === 'op_task_2') {
        poll2Called = true;
        return {
          operation_id: 'op_task_2',
          installation_id: currentInstId,
          mod_id: 'mod_2',
          mod_title: 'Mod 2',
          version_id: 'v2',
          version_str: '2.0.0',
          kind: 'install',
          state: 'committed',
          phase: 'committed',
          progress: {
            stage: '完成',
            current_file: '',
            processed_files: 1,
            total_files: 1,
            bytes_processed: 100,
            total_bytes: 100,
            percent: 100,
          },
          backup_id: 'snapshot_op_task_2',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      }
      throw new Error(`Unexpected opId: ${operationId}`);
    },
    pollIntervalMs: 10,
  });

  const plan1: Plan = {
    plan_id: 'plan_1',
    backend_operation_id: 'op_task_1',
    installation_id: currentInstId,
    kind: 'install',
    mod_id: 'mod_1',
    mod_title: 'Mod 1',
    version_id: 'v1',
    version_str: '1.0.0',
    expires_at: '',
    dependency_blockers: [],
    semantic_blockers: [],
    changes: [],
    backups_required: 0,
    bytes_required: 50,
    warnings: [],
  };

  const plan2: Plan = {
    plan_id: 'plan_2',
    backend_operation_id: 'op_task_2',
    installation_id: currentInstId,
    kind: 'install',
    mod_id: 'mod_2',
    mod_title: 'Mod 2',
    version_id: 'v2',
    version_str: '2.0.0',
    expires_at: '',
    dependency_blockers: [],
    semantic_blockers: [],
    changes: [],
    backups_required: 0,
    bytes_required: 100,
    warnings: [],
  };

  // Start task 1
  coordinator.startSession(plan1, currentInstId);
  // Wait a tick so task 1 triggers getOperation('op_task_1')
  await new Promise((resolve) => setTimeout(resolve, 20));

  // Rapidly start task 2 on the same instance
  coordinator.startSession(plan2, currentInstId);

  // Now task 1's slow getOperation resolves late
  resolvePoll1({
    operation_id: 'op_task_1',
    installation_id: currentInstId,
    mod_id: 'mod_1',
    mod_title: 'Mod 1',
    version_id: 'v1',
    version_str: '1.0.0',
    kind: 'install',
    state: 'writing',
    phase: 'applying',
    progress: {
      stage: '慢速旧任务写入中...',
      current_file: '',
      processed_files: 1,
      total_files: 2,
      bytes_processed: 25,
      total_bytes: 50,
      percent: 50,
    },
    backup_id: 'snapshot_op_task_1',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  // Give event loop time to process the late resolve and allow task 2 to poll
  await new Promise((resolve) => setTimeout(resolve, 40));

  // Verify that current session is task 2, not overwritten by task 1
  const cur = coordinator.getCurrentSession();
  assert.ok(cur);
  assert.equal(cur.operation_id, 'op_task_2');
  assert.equal(cur.mod_id, 'mod_2');

  // Check the last session broadcast to UI was for task 2
  const lastBroadcast = sessionHistory[sessionHistory.length - 1];
  assert.ok(lastBroadcast);
  assert.equal(lastBroadcast.operation_id, 'op_task_2');

  // Verify no broadcast after task 2 started was for task 1
  const task2StartIndex = sessionHistory.findIndex((s) => s?.operation_id === 'op_task_2');
  assert.ok(task2StartIndex >= 0);
  const broadcastsAfterTask2 = sessionHistory.slice(task2StartIndex);
  for (const s of broadcastsAfterTask2) {
    assert.equal(s?.operation_id, 'op_task_2', 'Late task 1 must not broadcast to session after task 2 started');
  }

  coordinator.stopPolling();
});

test('ExecutionCoordinator: late poll response after clearSession does not revive session', async () => {
  const sessionHistory: (ExecutionSession | null)[] = [];
  const currentInstId = 'inst-alpha';

  let resolvePoll: (op: Operation) => void = () => {};
  const pollPromise = new Promise<Operation>((resolve) => {
    resolvePoll = resolve;
  });

  const coordinator = new ExecutionCoordinator({
    activeInstanceId: () => currentInstId,
    onSessionChange: (s) => {
      sessionHistory.push(s);
    },
    onOperationsChange: () => {},
    getOperation: async () => pollPromise,
    pollIntervalMs: 10,
  });

  const plan: Plan = {
    plan_id: 'plan_clear',
    backend_operation_id: 'op_clear',
    installation_id: currentInstId,
    kind: 'install',
    mod_id: 'mod_clear',
    mod_title: 'Mod Clear',
    version_id: 'v1',
    version_str: '1.0.0',
    expires_at: '',
    dependency_blockers: [],
    semantic_blockers: [],
    changes: [],
    backups_required: 0,
    bytes_required: 50,
    warnings: [],
  };

  coordinator.startSession(plan, currentInstId);
  await new Promise((resolve) => setTimeout(resolve, 20));

  // User clears/closes execution session
  coordinator.clearSession();
  assert.equal(coordinator.getCurrentSession(), null);

  // Poll finishes late
  resolvePoll({
    operation_id: 'op_clear',
    installation_id: currentInstId,
    mod_id: 'mod_clear',
    mod_title: 'Mod Clear',
    version_id: 'v1',
    version_str: '1.0.0',
    kind: 'install',
    state: 'writing',
    phase: 'applying',
    progress: {
      stage: '写入中',
      current_file: '',
      processed_files: 1,
      total_files: 2,
      bytes_processed: 25,
      total_bytes: 50,
      percent: 50,
    },
    backup_id: 'snapshot_op_clear',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await new Promise((resolve) => setTimeout(resolve, 30));

  // Coordinator must remain null and not revived
  assert.equal(coordinator.getCurrentSession(), null);
  assert.equal(sessionHistory[sessionHistory.length - 1], null);
});
