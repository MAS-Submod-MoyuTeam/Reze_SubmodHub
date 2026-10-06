import React, { useState } from 'react';
import { X, Code2, ShieldAlert, Cpu, Sparkles, Database, Check } from 'lucide-react';

interface ContractInspectorProps {
  isOpen: boolean;
  onClose: () => void;
  currentScenario: string;
  onSelectScenario: (scenario: string) => void;
}

export const ContractInspector: React.FC<ContractInspectorProps> = ({
  isOpen,
  onClose,
  currentScenario,
  onSelectScenario,
}) => {
  const [activeTab, setActiveTab] = useState<'scenarios' | 'bindings' | 'statemachine' | 'errors'>('scenarios');

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 bg-black/80 backdrop-blur-md z-50 flex flex-col animate-in fade-in duration-150">
      {/* Top Header */}
      <div className="shrink-0 h-14 px-5 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 className="w-5 h-5 text-rose-400" />
          <div>
            <h3 className="text-sm font-bold text-slate-100">
              SubmodHub 接口契约与设计规范检视器
            </h3>
            <p className="text-[10px] text-slate-400 font-mono">
              docs/aegis/specs/2026-09-25-submodhub-design.md
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs */}
      <div className="px-5 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center gap-2 overflow-x-auto text-xs no-scrollbar">
        <button
          onClick={() => setActiveTab('scenarios')}
          className={`px-3 py-1.5 rounded-xl font-medium shrink-0 transition-all ${
            activeTab === 'scenarios'
              ? 'bg-rose-500 text-white font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          场景与状态预设
        </button>
        <button
          onClick={() => setActiveTab('bindings')}
          className={`px-3 py-1.5 rounded-xl font-medium shrink-0 transition-all ${
            activeTab === 'bindings'
              ? 'bg-rose-500 text-white font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Go 客户端绑定契约
        </button>
        <button
          onClick={() => setActiveTab('statemachine')}
          className={`px-3 py-1.5 rounded-xl font-medium shrink-0 transition-all ${
            activeTab === 'statemachine'
              ? 'bg-rose-500 text-white font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          操作状态机
        </button>
        <button
          onClick={() => setActiveTab('errors')}
          className={`px-3 py-1.5 rounded-xl font-medium shrink-0 transition-all ${
            activeTab === 'errors'
              ? 'bg-rose-500 text-white font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          错误码映射矩阵
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
        {activeTab === 'scenarios' && (
          <div className="space-y-3">
            <p className="text-slate-300 leading-relaxed">
              一键切换 Android 客户端的关键异常与业务场景，验证界面是否满足契约要求：
            </p>

            <div className="space-y-2">
              {[
                {
                  id: 'normal',
                  title: '🟢 正常就绪 (Normal Flow)',
                  desc: 'SAF 持久权限有效，MAS 离线，目录与哈希健全，可正常执行安装、更新与调序。',
                },
                {
                  id: 'permission_lost',
                  title: '🟡 Android SAF 权限失效 (permission_lost)',
                  desc: '系统撤销了 MAS 文档树访问授权。禁止一切写入，引导重新授权。',
                },
                {
                  id: 'game_running',
                  title: '🔴 MAS 游戏运行中 (game_running)',
                  desc: '检测到 Monika After Story 进程处于活跃状态。锁定写入并弹出保护警告。',
                },
                {
                  id: 'external_change',
                  title: '🟠 文件哈希漂移暂停 (external_change)',
                  desc: '写入前检测到本地脚本被手动修改。触发暂停，不覆盖用户改动，等待恢复。',
                },
                {
                  id: 'dependency_missing',
                  title: '🟣 依赖缺失与版本不兼容 (dependency_blockers)',
                  desc: '安装计划检测到前置依赖缺失或 MAS 版本不满足，生成阻断预览并禁用写入。',
                },
                {
                  id: 'offline',
                  title: '⚪ 离线只读缓存 (offline)',
                  desc: '无网络状态，展示本地 SQLite 缓存目录，仅允许安装已在本地的归档包。',
                },
              ].map((s) => (
                <button
                  key={s.id}
                  onClick={() => onSelectScenario(s.id)}
                  className={`w-full p-3.5 rounded-2xl border text-left transition-all ${
                    currentScenario === s.id
                      ? 'bg-rose-500/15 border-rose-500 text-rose-200 shadow-md ring-1 ring-rose-500'
                      : 'bg-slate-950/60 border-slate-800 hover:bg-slate-850 text-slate-300'
                  }`}
                >
                  <div className="flex items-center justify-between font-semibold">
                    <span>{s.title}</span>
                    {currentScenario === s.id && <Check className="w-4 h-4 text-rose-400" />}
                  </div>
                  <p className="text-[11px] text-slate-400 mt-1 leading-normal">{s.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'bindings' && (
          <div className="space-y-3 font-mono text-[11px]">
            <p className="text-slate-400 font-sans text-xs">
              面向 Wails v3 的跨平台 Go 客户端绑定清单（Android / Windows 统一契约）：
            </p>

            {[
              {
                func: 'ListInstallations()',
                output: 'Installation[] (id, label, platform, saf_tree_uri, permission_state, mas_version)',
                note: '枚举探测到的 MAS 实例与 SAF 授权状态',
              },
              {
                func: 'SelectInstallation(platform_result)',
                output: 'Installation | invalid_mas_root',
                note: '验证选定目录并持久化存储凭据',
              },
              {
                func: 'RefreshCatalog(filter)',
                output: 'ModSummary[], cursor',
                note: '带离线缓存回退的公共模组目录检索',
              },
              {
                func: 'PreviewInstall(inst_id, version_id)',
                output: 'Plan (dependency_blockers, semantic_blockers, changes, bytes_required)',
                note: '生成原子写入计划（无文件写入，仅计算）',
              },
              {
                func: 'PreviewPriority(inst_id, mod_id -> priority)',
                output: 'ImpactedFiles[]',
                note: '先显示哪些文件在生效层发生改变',
              },
              {
                func: 'ApplyPlan(plan_id)',
                output: 'operation_id, status',
                note: '确认并启动 6 阶段原子事务',
              },
              {
                func: 'GetOperation(operation_id)',
                output: 'Operation (stage, progress, drift_detail)',
                note: '冷重启后凭 operation_id 重连权威状态',
              },
              {
                func: 'RecoverOperation(op_id, action)',
                output: 'operation_id, status',
                note: '处理 external_change 文件漂移决策',
              },
            ].map((b, i) => (
              <div key={i} className="p-3 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
                <div className="text-rose-400 font-bold">{b.func}</div>
                <div className="text-slate-300">
                  <span className="text-slate-500">Output: </span>
                  {b.output}
                </div>
                <div className="text-slate-400 font-sans text-[11px]">{b.note}</div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'statemachine' && (
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-slate-200">
              操作生命周期状态机 (Operation State Machine)
            </h4>

            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-3 font-mono text-[11px]">
              <div className="flex items-center gap-2 text-rose-300">
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                <span>planned → downloading → scanning → backed_up → writing → committed</span>
              </div>
              <div className="text-slate-400 text-xs font-sans leading-relaxed">
                失败态转换：
                <ul className="list-disc pl-4 mt-1 space-y-1 text-slate-400">
                  <li><strong>blocked:</strong> 存在依赖或进程冲突，拒绝启动写入。</li>
                  <li><strong>recoverable:</strong> 检测到外部修改 (external_change)，暂停并等待用户决策。</li>
                  <li><strong>rolling_back / rolled_back:</strong> 异常中断时由本地备份完整恢复。</li>
                </ul>
              </div>
            </div>

            <h4 className="text-xs font-semibold text-slate-200 pt-2">
              候选版本状态流 (Version Lifecycle)
            </h4>
            <div className="p-3 bg-slate-950 rounded-2xl border border-slate-800 font-mono text-[11px] text-slate-300">
              draft → uploaded → scanning → ready_for_review → approved → published
            </div>
          </div>
        )}

        {activeTab === 'errors' && (
          <div className="space-y-2 font-mono text-[11px]">
            {[
              { code: 'permission_lost', action: '重新调起 Android SAF 授权器重新授权' },
              { code: 'game_running', action: '提示用户退出 MAS，释放文件读写锁' },
              { code: 'external_change', action: '暂停写入，展示预期与实测哈希，禁止盲目覆盖' },
              { code: 'dependency_missing', action: '阻断安装，高亮显示缺失的模组及版本要求' },
              { code: 'insufficient_space', action: '计算所需空间并提示清理存储' },
              { code: 'invalid_mas_root', action: '引导重新选择正确的 MAS 游戏根目录' },
              { code: 'offline', action: '切入只读模式，允许阅读本地缓存和已下载 ZIP' },
            ].map((err, i) => (
              <div key={i} className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 flex items-start gap-2">
                <span className="text-rose-400 font-bold shrink-0">{err.code}:</span>
                <span className="text-slate-300 font-sans text-xs">{err.action}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-4 bg-slate-950 border-t border-slate-800 text-center">
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
        >
          关闭检视器
        </button>
      </div>
    </div>
  );
};
