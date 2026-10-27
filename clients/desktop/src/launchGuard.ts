import type { Operation } from './types/client';

/**
 * 事务仍在进行时的判定口径，与后端 journal 阶段一一对应：
 * planned（计划已确认、尚未落 journal）与 recoverable（prepared / applying /
 * committing）。其余状态（committed / rolled_back / needs_manual_recovery /
 * query_failed）都已停止写文件，因此不再阻止启动游戏——needs_manual_recovery 的
 * 剩余工作是一次显式回滚，把用户锁在游戏之外只会让人更没有退路。
 */
export function isOperationInProgress(operation: Operation): boolean {
  return operation.state === 'planned' || operation.state === 'recoverable';
}

/** 当前实例任意事务仍在进行时，写操作与启动游戏都必须被阻止。 */
export function hasInProgressTransaction(operations: Operation[]): boolean {
  return operations.some(isOperationInProgress);
}

/** 后端在事务进行时拒绝启动游戏返回的稳定错误码（见 LaunchMASInstance）。 */
export const TRANSACTION_IN_PROGRESS = 'transaction_in_progress';

export function isTransactionInProgressError(error: unknown): boolean {
  const detail = error instanceof Error ? error.message : String(error);
  return detail.includes(TRANSACTION_IN_PROGRESS);
}

/**
 * 启动失败的提示文案。事务拦截要说明「为什么」和「接下来做什么」；
 * 其他失败保留后端原始错误码，便于用户抄给维护者。
 */
export function describeLaunchFailure(error: unknown): string {
  if (isTransactionInProgressError(error)) {
    return '事务进行中，游戏启动已被阻止。请等待事务提交或回滚完成后再启动游戏。';
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `启动失败：${detail}`;
}
