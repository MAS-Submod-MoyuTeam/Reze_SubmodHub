import React, { useState } from 'react';
import { CONTRACT_ERROR_CONFIGS } from '../data/mockData';
import { ContractErrorCode, ErrorDisplayConfig } from '../types/submodhub';
import { useApp } from '../context/AppContext';
import {
  AlertTriangle,
  AlertCircle,
  ShieldAlert,
  FolderLock,
  GitPullRequest,
  CheckCircle2,
  WifiOff,
  Cpu,
  Layers,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';

export const StateMachineShowcase: React.FC = () => {
  const { showToast } = useApp();
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedErrorCode, setSelectedErrorCode] = useState<ContractErrorCode>('external_change');

  const categories = [
    { id: 'all', label: '全部错误与阻断状态' },
    { id: 'auth', label: '身份验证与权限 (Auth/RBAC)' },
    { id: 'upload_scan', label: '上传与静态检测 (Scan)' },
    { id: 'lifecycle', label: '生命周期与幂等性' },
    { id: 'client_guard', label: '客户端安全护栏' },
    { id: 'recovery', label: '断点恢复与离线' },
  ];

  const filteredErrors = CONTRACT_ERROR_CONFIGS.filter((item) => {
    if (selectedCategory === 'all') return true;
    return item.category === selectedCategory;
  });

  const activeErrorConfig =
    CONTRACT_ERROR_CONFIGS.find((c) => c.code === selectedErrorCode) || CONTRACT_ERROR_CONFIGS[0];

  const handleSimulateToast = (cfg: ErrorDisplayConfig) => {
    showToast('error', `[${cfg.code}] ${cfg.description}`, cfg.code);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* Header */}
      <div className="bg-white border border-neutral-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-neutral-500">
            <span className="font-semibold text-neutral-900">SubmodHub 契约规范</span>
            <span>·</span>
            <span>Section 5 状态机与错误展示规范</span>
          </div>
          <h1 className="text-lg font-bold text-neutral-900 tracking-tight mt-0.5">
            契约状态机与 20+ 项标准错误码响应规范字典
          </h1>
          <p className="text-xs text-neutral-500 mt-1">
            规范明确要求：错误状态的操作入口应具有针对性，禁止使用模糊的“重试”覆盖所有情况
          </p>
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-1.5 bg-neutral-100 p-1 rounded-lg text-xs font-medium">
        {categories.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-3 py-1.5 rounded transition-colors whitespace-nowrap ${
              selectedCategory === cat.id
                ? 'bg-white text-neutral-900 shadow-xs'
                : 'text-neutral-600 hover:text-neutral-900'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Main Grid: Left List, Right Deep Interactive Mockup */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left List */}
        <div className="bg-white border border-neutral-200 rounded-lg p-4 space-y-2 lg:col-span-1 max-h-[680px] overflow-y-auto">
          <div className="text-[11px] font-bold text-neutral-400 uppercase tracking-wider px-2 py-1">
            标准错误代码清单 ({filteredErrors.length})
          </div>

          <div className="space-y-1">
            {filteredErrors.map((err) => {
              const isSelected = err.code === selectedErrorCode;

              return (
                <button
                  key={err.code}
                  onClick={() => setSelectedErrorCode(err.code)}
                  className={`w-full text-left p-2.5 rounded border transition-all text-xs space-y-1 ${
                    isSelected
                      ? 'border-neutral-900 bg-neutral-50 font-medium'
                      : 'border-neutral-200 hover:border-neutral-300 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[11px] text-neutral-900 font-semibold truncate max-w-[160px]">
                      {err.code}
                    </span>
                    <span className="text-[10px] text-neutral-400 capitalize">{err.category}</span>
                  </div>
                  <div className="text-[11px] text-neutral-500 truncate">{err.title}</div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right Preview Card */}
        <div className="bg-white border border-neutral-200 rounded-lg p-6 space-y-6 lg:col-span-2">
          {/* Header of Active Error */}
          <div className="border-b border-neutral-100 pb-4 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                {activeErrorConfig.code}
              </span>
              <h2 className="text-base font-bold text-neutral-900">{activeErrorConfig.title}</h2>
            </div>
            <p className="text-xs text-neutral-600 leading-relaxed">
              {activeErrorConfig.description}
            </p>
          </div>

          {/* Frontend Action Prescription from Spec */}
          <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-lg space-y-2 text-xs">
            <div className="font-bold text-emerald-950 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-700" />
              契约强制要求的前端动作响应规范 (Frontend Action):
            </div>
            <p className="text-emerald-900 leading-relaxed font-medium">
              {activeErrorConfig.frontend_action}
            </p>
          </div>

          {/* Sample Raw Error Payload from /api/v1 (Section 2) */}
          <div className="space-y-2 text-xs">
            <span className="font-bold text-neutral-800 uppercase tracking-wider text-[11px]">
              标准 REST /api/v1 响应 JSON 结构模拟:
            </span>
            <div className="font-mono text-[11px] bg-neutral-900 text-neutral-200 p-3 rounded-lg overflow-x-auto leading-relaxed">
              {JSON.stringify(
                {
                  code: activeErrorConfig.code,
                  message: activeErrorConfig.title,
                  details: activeErrorConfig.sample_details || {},
                },
                null,
                2
              )}
            </div>
          </div>

          {/* Simulated UI Presentation Box */}
          <div className="space-y-2">
            <span className="font-bold text-neutral-800 uppercase tracking-wider text-[11px]">
              高保真实际 UI 拦截状态模拟:
            </span>
            <div className="p-4 bg-rose-50/70 border border-rose-200 rounded-lg text-xs space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="font-bold text-rose-950">{activeErrorConfig.title}</div>
                  <div className="text-neutral-700 text-[11px] leading-relaxed">
                    {activeErrorConfig.description}
                  </div>
                </div>
              </div>

              {/* Action Buttons specific to error type */}
              <div className="pt-2 border-t border-rose-200/80 flex items-center justify-end gap-2">
                <button
                  onClick={() => handleSimulateToast(activeErrorConfig)}
                  className="px-3 py-1 text-[11px] text-neutral-700 bg-white hover:bg-neutral-50 rounded border border-neutral-300"
                >
                  触发全局 Toast 测试
                </button>
                <button
                  onClick={() => {
                    showToast('success', `已执行针对 [${activeErrorConfig.code}] 的专属前置解决流程。`);
                  }}
                  className="px-3.5 py-1 text-[11px] font-medium text-white bg-rose-700 hover:bg-rose-800 rounded transition-colors"
                >
                  执行契约修复入口
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
