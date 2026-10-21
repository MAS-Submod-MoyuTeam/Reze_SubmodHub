import { useCallback, useEffect, useState } from 'react';
import { useApp, type AppContextType } from '../context/AppContext';
import { mapServerScanReport } from '../context/scanReport';
import type { ModSummary, ModVersion, Submission } from '../types/submodhub';
import { listAuthorWorkspace, listAuthorVersions, listAuthorSubmissions, type ApiAuthorModItem, type ApiAuthorSubmission, type ApiVersion } from '../../../ui/submission-api';
import { useReviewPage } from './useReviewPage';

export function mapAuthorMod({ mod, is_published }: ApiAuthorModItem): ModSummary {
  return {
    ...mod, description: mod.description || mod.summary || '', tags: mod.tags || [],
    supported_platforms: (mod.supported_platforms || []) as ModSummary['supported_platforms'],
    mas_version_range: mod.mas_version_range || '', recommended_priority: mod.recommended_priority || 0,
    latest_version_id: mod.latest_version_id || '', downloads_count: 0, created_at: '', updated_at: '',
    is_published, source_type: mod.source_type || 'local', github_source_code: Boolean(mod.github_source_code),
  };
}

export function mapAuthorVersion(version: ApiVersion): ModVersion {
  return { ...version, state: version.state as ModVersion['state'], release_notes: version.release_notes || '',
    dependencies: (version.dependencies || []) as ModVersion['dependencies'], created_at: version.created_at || '',
    is_immutable: version.state === 'published' || version.state === 'approved' };
}

function mapSubmission(item: ApiAuthorSubmission): Submission {
  return { id: item.id, mod_id: item.mod_id, version_id: item.version_id, author_id: item.author_id,
    mod_title: item.mod_title, author_name: item.author_name, version_str: item.version_str, category: item.category,
    state: item.state as Submission['state'], submitted_at: item.created_at || '', mark_latest: item.mark_latest,
    reviewer_id: item.reviewer_id, decision_reason: item.reason, decided_at: item.decided_at, published_at: item.published_at,
    scan_report_id: item.scan_report_snapshot ? `scan_submission_${item.id}` : undefined };
}

type AuthorActions = Pick<AppContextType, 'createModDraft' | 'updateModDraft' | 'createCandidateVersion' | 'uploadArchiveAndScan' | 'uploadDetailImages' | 'submitVersionForReview' | 'setLatestPublishedVersion' | 'unpublishVersion' | 'markVersionDeprecated' | 'clearVersionDeprecation' | 'deleteVersion' | 'unpublishMod' | 'deleteModDraft' | 'editVersion' | 'syncModReleases'>;

export function useAuthorWorkspace() {
  const app = useApp();
  const { cacheAuthorPage } = app;
  const userId = app.currentUser?.id;
  const [workbenchView, setWorkbenchView] = useState<'mods' | 'submissions'>('mods');
  const [selectedModId, setSelectedId] = useState('');
  const [modPage, setModPage] = useState(1);
  const [modPageSize, setModPageSize] = useState(10);
  const [versionPage, setVersionPage] = useState(1);
  const [versionPageSize, setVersionPageSize] = useState(10);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(10);
  const [historyState, setHistoryState] = useState('all');
  const [revision, setRevision] = useState(0);
  const [focusModId, setFocusModId] = useState('');
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    if (!userId) return;
    const timer = window.setInterval(refresh, 60_000);
    return () => window.clearInterval(timer);
  }, [userId, refresh]);
  const base = `${(import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '')}/api/v1`;
  const loadMods = useCallback(async (signal: AbortSignal) => {
    const result = await listAuthorWorkspace(base, { page: modPage, pageSize: modPageSize, focusModId }, signal);
    const items = result.items.map(mapAuthorMod);
    if (!signal.aborted) cacheAuthorPage({ mods: items });
    return { ...result, items };
  }, [base, modPage, modPageSize, focusModId, userId, revision, cacheAuthorPage]);
  const modRequest = useReviewPage(loadMods, !!userId && workbenchView === 'mods');
  const userMods = (modRequest.data?.items || []).map((item) => app.mods.find((mod) => mod.id === item.id) || item);
  const activeMod = userMods.find((mod) => mod.id === selectedModId) || userMods[0];
  const activeModId = activeMod?.id;
  const loadVersions = useCallback(async (signal: AbortSignal) => {
    const result = await listAuthorVersions(base, activeModId!, { page: versionPage, pageSize: versionPageSize }, signal);
    const items = result.items.map(mapAuthorVersion);
    const reports = Object.fromEntries(result.items.flatMap((version) => {
      const report = version.scan_report_id && result.scan_reports?.[version.scan_report_id];
      return report ? [[version.scan_report_id!, mapServerScanReport(version.id, report)]] : [];
    }));
    if (!signal.aborted) cacheAuthorPage({ versions: items, scanReports: reports });
    return { ...result, items };
  }, [base, activeModId, versionPage, versionPageSize, userId, revision, cacheAuthorPage]);
  const versionRequest = useReviewPage(loadVersions, !!userId && !!activeModId && workbenchView === 'mods');
  const activeModVersions = (versionRequest.data?.items || []).map((item) => app.versions.find((version) => version.id === item.id) || item);
  const loadHistory = useCallback(async (signal: AbortSignal) => {
    const result = await listAuthorSubmissions(base, { page: historyPage, pageSize: historyPageSize, state: historyState }, signal);
    const items = result.items.map(mapSubmission);
    const reports = Object.fromEntries(result.items.flatMap((item) => item.scan_report_snapshot ? [[`scan_submission_${item.id}`, mapServerScanReport(item.version_id, item.scan_report_snapshot)]] : []));
    const versions = result.items.flatMap((item) => item.current_version ? [mapAuthorVersion(item.current_version)] : []);
    if (!signal.aborted) cacheAuthorPage({ submissions: items, versions, scanReports: reports });
    return { ...result, items };
  }, [base, historyPage, historyPageSize, historyState, userId, revision, cacheAuthorPage]);
  const historyRequest = useReviewPage(loadHistory, !!userId && workbenchView === 'submissions');
  useEffect(() => { if (modRequest.data) setModPage(modRequest.data.page); }, [modRequest.data]);
  useEffect(() => { if (versionRequest.data) setVersionPage(versionRequest.data.page); }, [versionRequest.data]);
  useEffect(() => { if (historyRequest.data) setHistoryPage(historyRequest.data.page); }, [historyRequest.data]);
  const setSelectedModId = (id: string) => {
    setSelectedId(id); setVersionPage(1);
    if (!userMods.some((mod) => mod.id === id)) setFocusModId(id);
  };
  // All existing mutation paths refresh the visible query, including source sync.
  // Refresh on failure too: another session may have changed the server state.
  function wrap<A extends unknown[], R>(action: (...args: A) => Promise<R>) {
    return async (...args: A): Promise<R> => { try { return await action(...args); } finally { refresh(); } };
  }
  const actions: AuthorActions = {
    createModDraft: wrap(app.createModDraft), updateModDraft: wrap(app.updateModDraft), createCandidateVersion: wrap(app.createCandidateVersion),
    uploadArchiveAndScan: wrap(app.uploadArchiveAndScan), uploadDetailImages: wrap(app.uploadDetailImages), submitVersionForReview: wrap(app.submitVersionForReview),
    setLatestPublishedVersion: wrap(app.setLatestPublishedVersion), unpublishVersion: wrap(app.unpublishVersion), markVersionDeprecated: wrap(app.markVersionDeprecated),
    clearVersionDeprecation: wrap(app.clearVersionDeprecation), deleteVersion: wrap(app.deleteVersion), unpublishMod: wrap(app.unpublishMod),
    deleteModDraft: wrap(app.deleteModDraft), editVersion: wrap(app.editVersion), syncModReleases: wrap(app.syncModReleases),
  };
  return { app: { ...app, ...actions }, workbenchView, setWorkbenchView, selectedModId, setSelectedModId,
    userMods, activeMod, activeModVersions, authorSubmissions: historyRequest.data?.items || [],
    modRequest, versionRequest, historyRequest,
    modPageSize, versionPageSize, historyPageSize, historyState,
    changeModPage: (page: number) => { setFocusModId(''); setModPage(page); setSelectedId(''); setVersionPage(1); },
    changeModPageSize: (size: number) => { setFocusModId(''); setModPageSize(size); setModPage(1); setSelectedId(''); setVersionPage(1); },
    changeVersionPage: setVersionPage,
    changeVersionPageSize: (size: number) => { setVersionPageSize(size); setVersionPage(1); },
    changeHistoryPage: setHistoryPage,
    changeHistoryPageSize: (size: number) => { setHistoryPageSize(size); setHistoryPage(1); },
    changeHistoryState: (state: string) => { setHistoryState(state); setHistoryPage(1); },
  };
}
