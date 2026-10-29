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

interface VersionArchiveUploaderProps {
  version: ModVersion;
  /** 模组声明的发布平台：决定分平台上传时出现哪些平台的按钮。 */
  declaredPlatforms: readonly Platform[] | undefined;
  /** 正在上传时禁用全部按钮，避免两个上传同时写同一个版本。 */
  busy: boolean;
  onPick: (platform: AssetPlatform | '') => void;
}

const uploadButtonClass =
  'px-3 py-1.5 font-medium text-neutral-800 bg-white hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed rounded border border-neutral-300 flex items-center gap-1.5 transition-colors';

const shapeButtonClass = (active: boolean) =>
  `px-2.5 py-1 rounded transition-colors ${active ? 'bg-white text-neutral-900 shadow-xs' : 'text-neutral-600 hover:text-neutral-900'}`;

export const VersionArchiveUploader: React.FC<VersionArchiveUploaderProps> = ({ version, declaredPlatforms, busy, onPick }) => {
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
                  ? `${assetPlatformLabel(platform)}：重新上传 (${formatBytes(asset.size_bytes)})`
                  : `上传 ${assetPlatformLabel(platform)} 归档`}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-neutral-500">
          这个版本按平台分包，不会再接受全平台共用的包。
          {missing.length > 0
            ? `还需上传 ${missing.map(assetPlatformLabel).join('、')} 归档，提交审核前必须补全已声明的平台。`
            : '每个平台的归档与扫描报告都独立保存。'}
        </p>
      </div>
    );
  }

  if (shape === 'shared') {
    return (
      <div className="space-y-1">
        <button type="button" disabled={busy} onClick={() => onPick('')} className={uploadButtonClass}>
          <Upload className="h-3.5 w-3.5 text-neutral-600" />
          重新上传 ZIP 归档（全平台共用）
        </button>
        <p className="text-[11px] text-neutral-500">
          这个版本只有一个归档，Windows 与 Android 安装的是同一份字节。要改成按平台分包，请删除这个草稿版本后重建：同一版本不能混用两种形状。
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex w-fit items-center rounded bg-neutral-100 p-0.5 text-[11px] font-medium">
        <button type="button" aria-pressed={shapeChoice === 'shared'} onClick={() => setShapeChoice('shared')} className={shapeButtonClass(shapeChoice === 'shared')}>
          全平台共用一个包
        </button>
        <button type="button" aria-pressed={shapeChoice === 'split'} onClick={() => setShapeChoice('split')} className={shapeButtonClass(shapeChoice === 'split')}>
          按平台分别上传
        </button>
      </div>

      {shapeChoice === 'shared' ? (
        <>
          <button type="button" disabled={busy} onClick={() => onPick('')} className={uploadButtonClass}>
            <Upload className="h-3.5 w-3.5 text-neutral-600" />
            上传 ZIP 归档（全平台共用）
          </button>
          <p className="text-[11px] text-neutral-500">一个归档服务所有平台，Windows 与 Android 安装同一份字节。</p>
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            {declared.map((platform) => (
              <button key={platform} type="button" disabled={busy} onClick={() => onPick(platform)} className={uploadButtonClass}>
                <Upload className="h-3.5 w-3.5 text-neutral-600" />
                上传 {assetPlatformLabel(platform)} 归档
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-500">
            {declared.length > 1
              ? '每个平台各自上传自己的包；本版本一旦按平台上传，就不能再换回全平台共用包。'
              : `模组只声明了 ${assetPlatformLabel(declared[0] ?? '')} 平台；要同时发布另一个平台，请先在「编辑模组」里勾选它。`}
          </p>
        </>
      )}
    </div>
  );
};
