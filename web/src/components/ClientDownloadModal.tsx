import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { fetchAppRelease, type AppRelease, type AppReleaseAsset } from '../../../ui/app-release-api';
import { formatBytes } from './formatBytes';
import {
  deliveryLabel,
  detectDevicePlatform,
  githubDownloadURL,
  listClientDownloads,
  pickSameReleaseAsset,
  platformLabel,
  resolveDownloadRoute,
  shortHash,
  type ClientDownloadOption,
  type DownloadPlatform,
} from './clientDownload';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ExternalLink,
  FileCheck2,
  Laptop,
  Loader2,
  RefreshCw,
  Smartphone,
  X,
} from 'lucide-react';

/** 超过该快照年龄，主 API 可能已经看不到新版本（与客户端自更新的判定一致）。 */
export const SNAPSHOT_STALE_SECONDS = 30 * 60;

function apiBase(): string {
  return `${((import.meta as any).env?.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
}

/** 错误原文只用于排障提示，不该把整段 HTML 灌进弹窗。 */
const MAX_ERROR_DETAIL = 160;

function errorMessageFor(error: unknown): string {
  const raw = (error instanceof Error ? error.message : String(error)).slice(0, MAX_ERROR_DETAIL);
  if (raw.includes('app_release_unavailable')) {
    return '站点还没有取得最新 Release 的元数据，暂时无法给出下载地址。稍后重试即可。';
  }
  return `无法获取客户端下载信息（${raw}）。请稍后重试。`;
}

interface ClientDownloadPanelProps {
  status: 'loading' | 'ready' | 'error';
  release: AppRelease | null;
  errorMessage?: string;
  device: DownloadPlatform;
  onDownload: (asset: AppReleaseAsset) => void;
  onRetry: () => void;
}

const PlatformIcon: React.FC<{ platform: 'windows' | 'android' }> = ({ platform }) =>
  platform === 'android' ? (
    <Smartphone className="w-4 h-4 text-emerald-700" />
  ) : (
    <Laptop className="w-4 h-4 text-neutral-700" />
  );

const AssetCard: React.FC<{
  option: ClientDownloadOption;
  device: DownloadPlatform;
  onDownload: (asset: AppReleaseAsset) => void;
}> = ({ option, device, onDownload }) => {
  const { asset, platform } = option;
  // 展示与实际跳转必须用同一份判定，避免「写着本站下载、点下去是 GitHub」。
  const route = resolveDownloadRoute(asset);
  const hosted = route.source === 'cloudreve';
  const hash = shortHash(asset.sha256);

  return (
    <div className="border border-neutral-200 rounded-lg p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <PlatformIcon platform={platform} />
          <span className="text-sm font-semibold text-neutral-900">{platformLabel(platform)}</span>
          {platform === device && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">
              当前设备
            </span>
          )}
        </div>
        <span className="text-[11px] font-mono text-neutral-500 tabular-nums">{formatBytes(asset.size_bytes)}</span>
      </div>

      <div className="font-mono text-[11px] text-neutral-600 truncate" title={asset.name}>
        {asset.name}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-500">
        <span className="flex items-center gap-1">
          <FileCheck2 className="w-3.5 h-3.5" />
          来源：{deliveryLabel(route.source)}
        </span>
        {hash && <span className="font-mono" title={asset.sha256}>SHA-256 {hash}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-0.5">
        <button
          onClick={() => onDownload(asset)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 hover:bg-emerald-800 rounded transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          {hosted ? '从本站下载' : '从 GitHub 下载'}
        </button>
        {hosted && (
          <a
            href={githubDownloadURL(asset)}
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-700 bg-white border border-neutral-200 hover:bg-neutral-50 rounded transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5 text-neutral-500" />
            GitHub 直链
          </a>
        )}
      </div>

      {route.needsFreshLink && (
        <p className="text-[11px] text-neutral-500">
          节点直链已临期：点击下载会先换一条新链接，换不到就直接走 GitHub。
        </p>
      )}
    </div>
  );
};

/** 纯展示部分：不取数据、不读写浏览器状态，便于直接单测。 */
export const ClientDownloadPanel: React.FC<ClientDownloadPanelProps> = ({
  status,
  release,
  errorMessage,
  device,
  onDownload,
  onRetry,
}) => {
  const options = release ? listClientDownloads(release.assets, device) : [];
  const stale = Boolean(release && release.snapshot_age_seconds > SNAPSHOT_STALE_SECONDS);

  return (
    <div className="px-5 py-4 space-y-4">
      {status === 'loading' && (
        <div className="flex items-center gap-2 text-xs text-neutral-500 py-6 justify-center">
          <Loader2 className="w-4 h-4 animate-spin" />
          正在获取最新客户端版本信息…
        </div>
      )}

      {status === 'error' && (
        <div className="space-y-3">
          <div className="p-3 rounded border border-rose-200 bg-rose-50 text-rose-900 text-xs space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-700" />
              下载信息不可用
            </div>
            <p className="leading-relaxed">{errorMessage || '请稍后重试。'}</p>
          </div>
          <div className="flex items-center justify-end">
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-800 bg-neutral-100 hover:bg-neutral-200 rounded"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              重试
            </button>
          </div>
        </div>
      )}

      {status === 'ready' && release && (
        <>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-neutral-500">
            <span className="font-semibold text-neutral-900">v{release.version}</span>
            {release.published_at && <span>发布于 {new Date(release.published_at).toLocaleDateString()}</span>}
            <span>·</span>
            <span>优先使用本站节点，节点不可用时才走 GitHub</span>
          </div>

          {stale && (
            <div className="p-2.5 rounded border border-amber-200 bg-amber-50 text-amber-900 text-[11px] leading-relaxed">
              站点已有 {Math.round(release.snapshot_age_seconds / 60)} 分钟没有成功读取 GitHub 发布信息，
              这里可能不是最新版本，可前往 GitHub Releases 确认。
            </div>
          )}

          {options.length === 0 ? (
            <div className="py-6 text-center text-xs text-neutral-500 space-y-2">
              <CheckCircle2 className="w-6 h-6 text-neutral-300 mx-auto" />
              当前发布没有可安装的 Windows / Android 资产。
            </div>
          ) : (
            <div className="space-y-2.5">
              {options.map((option) => (
                <AssetCard key={option.asset.name} option={option} device={device} onDownload={onDownload} />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-neutral-100 text-[11px] text-neutral-500">
            <span>下载后请用 SHA-256 校验文件完整性</span>
            <div className="flex items-center gap-3">
              {release.checksum_url && (
                <a
                  href={release.checksum_url}
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-neutral-900"
                >
                  <FileCheck2 className="w-3.5 h-3.5" />
                  SHA256SUMS.txt
                </a>
              )}
              {release.release_url && (
                <a
                  href={release.release_url}
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:text-neutral-900"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  前往 GitHub Releases
                </a>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

interface ClientDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ClientDownloadModal: React.FC<ClientDownloadModalProps> = ({ isOpen, onClose }) => {
  const { showToast } = useApp();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [attempt, setAttempt] = useState(0);

  const device = useMemo(() => detectDevicePlatform(navigator.userAgent || ''), []);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setStatus('loading');
    setErrorMessage('');
    fetchAppRelease(apiBase())
      .then((next) => {
        if (!active) return;
        setRelease(next);
        setStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        setRelease(null);
        setErrorMessage(errorMessageFor(error));
        setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [isOpen, attempt]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const expectedTag = release?.tag_name ?? '';
  const handleDownload = useCallback(
    async (asset: AppReleaseAsset) => {
      let route = resolveDownloadRoute(asset);

      // 节点直链只有几分钟有效期：过了就别再交付这份描述。
      // 重取只允许替换同一个 release 的直链，tag 变了就整份作废——否则会出现
      // 「说明写着 A 版本、装上的是 B 版本」，这条与客户端自更新的契约一致。
      if (route.needsFreshLink) {
        try {
          const fresh = await fetchAppRelease(apiBase());
          const next = pickSameReleaseAsset(fresh, expectedTag, asset.name);
          if (next) {
            setRelease(fresh);
            route = resolveDownloadRoute(next);
          }
        } catch {
          // 取不到新描述就按已算好的 GitHub 回落走，过期直链不会再被使用。
        }
      }

      if (!route.href) {
        showToast('error', '无法解析下载地址，请稍后重试。');
        return;
      }
      const link = document.createElement('a');
      link.href = route.href;
      link.rel = 'noopener';
      document.body.append(link);
      link.click();
      link.remove();
    },
    [expectedTag, showToast],
  );

  if (!isOpen) return null;

  const title = release ? `下载 RezeHub 客户端 v${release.version}` : '下载 RezeHub 客户端';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/40 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="client-download-title"
    >
      <div className="bg-white rounded-lg border border-neutral-200 shadow-xl max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
        <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Download className="w-4 h-4 text-emerald-700 shrink-0" />
            <h3 id="client-download-title" className="text-sm font-semibold text-neutral-900 truncate">
              {title}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="text-neutral-400 hover:text-neutral-600 p-1 rounded shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="overflow-y-auto">
          <ClientDownloadPanel
            status={status}
            release={release}
            errorMessage={errorMessage}
            device={device}
            onDownload={handleDownload}
            onRetry={() => setAttempt((value) => value + 1)}
          />
        </div>
      </div>
    </div>
  );
};
