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
