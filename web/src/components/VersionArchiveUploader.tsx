/**
 * 版本归档上传控件（本站上传源）。
 *
 * 版本还没有任何归档时，作者先选这个版本怎么发：一个包服务所有平台，还是按平台
 * 各传一个。选了之后形状就落盘了，服务端不允许同一个版本两种形状混用，所以这里
 * 不再给已上传的版本换形状的入口，只保留「按自己已有的形状重新上传」。
 */

import React, { useState } from 'react';
import { Upload } from 'lucide-react';
import { assetPlatformLabel, type AssetPlatform, type ModVersion, type Platform } from '../types/submodhub';
import { formatBytes } from './formatBytes';
import { missingPlatformArchives, uploadPlatforms, versionArchiveShape, versionUploadPlatforms } from './versionShipping';
import { useI18n } from '../i18n';
import { valueSegmentClass } from './selectionStyles';

interface VersionArchiveUploaderProps {
  version: ModVersion;
  /** 模组声明的发布平台：决定分平台上传时出现哪些平台的按钮。 */
  declaredPlatforms: readonly Platform[] | undefined;
  /** 正在上传时禁用全部按钮，避免两个上传同时写同一个版本。 */
  busy: boolean;
  onPick: (platform: AssetPlatform | '') => void;
}

const uploadButtonClass =
  'px-3 py-1.5 font-medium text-neutral-800 bg-white hover:bg-neutral-100 hover:border-neutral-400 active:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-neutral-300 flex items-center gap-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600';

// 形状二选一：选中项走统一的实心主色口径（见 selectionStyles）。
const shapeButtonClass = (active: boolean) =>
  `${valueSegmentClass(active, 'px-2.5 py-1 rounded')} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600`;

export const VersionArchiveUploader: React.FC<VersionArchiveUploaderProps> = ({ version, declaredPlatforms, busy, onPick }) => {
  const { t } = useI18n();
  const shape = versionArchiveShape(version);
  // 只对「还没有归档」的版本有意义：一旦落盘，形状由数据决定，不再由这个选择决定。
  const [shapeChoice, setShapeChoice] = useState<'shared' | 'split'>('shared');
  const declared = uploadPlatforms(declaredPlatforms);

  if (shape === 'split') {
    const missing = missingPlatformArchives(version, declared);
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          {versionUploadPlatforms(version, declaredPlatforms).map((platform) => {
            const asset = version.platform_assets?.find((entry) => entry.platform === platform);
            return (
              <button key={platform} type="button" disabled={busy} onClick={() => onPick(platform)} className={uploadButtonClass}>
                <Upload className="h-3.5 w-3.5 text-neutral-600" />
                {asset
                  ? t('upload.reuploadPlatform', { platform: assetPlatformLabel(platform), size: formatBytes(asset.size_bytes, t('common.unknown')) })
                  : t('upload.uploadPlatform', { platform: assetPlatformLabel(platform) })}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-neutral-500">
          {t('upload.splitExplain')}
          {missing.length > 0
            ? t('upload.splitMissing', { platforms: missing.map(assetPlatformLabel).join(t('upload.joiner')) })
            : t('upload.splitOk')}
        </p>
      </div>
    );
  }

  if (shape === 'shared') {
    return (
      <div className="space-y-1">
        <button type="button" disabled={busy} onClick={() => onPick('')} className={uploadButtonClass}>
          <Upload className="h-3.5 w-3.5 text-neutral-600" />
          {t('upload.reuploadShared')}
        </button>
        <p className="text-[11px] text-neutral-500">{t('upload.sharedExplain')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex w-fit items-center rounded bg-neutral-100 p-0.5 text-[11px] font-medium">
        <button type="button" aria-pressed={shapeChoice === 'shared'} onClick={() => setShapeChoice('shared')} className={shapeButtonClass(shapeChoice === 'shared')}>
          {t('upload.sharedChoice')}
        </button>
        <button type="button" aria-pressed={shapeChoice === 'split'} onClick={() => setShapeChoice('split')} className={shapeButtonClass(shapeChoice === 'split')}>
          {t('upload.splitChoice')}
        </button>
      </div>

      {shapeChoice === 'shared' ? (
        <>
          <button type="button" disabled={busy} onClick={() => onPick('')} className={uploadButtonClass}>
            <Upload className="h-3.5 w-3.5 text-neutral-600" />
            {t('upload.uploadShared')}
          </button>
          <p className="text-[11px] text-neutral-500">{t('upload.sharedLedger')}</p>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {declared.map((platform) => (
              <button key={platform} type="button" disabled={busy} onClick={() => onPick(platform)} className={uploadButtonClass}>
                <Upload className="h-3.5 w-3.5 text-neutral-600" />
                {t('upload.uploadPlatform', { platform: assetPlatformLabel(platform) })}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-500">
            {declared.length > 1
              ? t('upload.splitLedger')
              : t('upload.onlyDeclared', { platform: assetPlatformLabel(declared[0] ?? '') })}
          </p>
        </>
      )}
    </div>
  );
};
