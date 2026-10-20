import React, { useCallback, useEffect, useState } from 'react';
import { readSession } from '../../../ui/auth-api';
import { fetchDownloadNodes, saveDownloadNode, deleteDownloadNode, retryDownloadMirrors, testDownloadNode, type DownloadNode, type DownloadNodeInput, type DownloadNodeSettings } from '../../../ui/settings-api';

const blank = (): DownloadNodeInput => ({id:'',name:'',type:'cloudreve',enabled:true,weight:1,capabilities:['cloudreve'],password:'',api_base_url:'',username:'',directory:'/SubmodHub',allowed_download_origins:[]});
const field = 'w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:border-emerald-600';
const button = 'rounded border border-neutral-300 px-3 py-2 text-xs font-medium hover:bg-neutral-50 disabled:opacity-40';
const failure = (error: unknown) => {
 const message = error instanceof Error ? error.message : '';
 if (message.includes('conflict')) return '设置已被修改。请刷新节点列表后重试，表单内容已保留。';
 if (message.includes('authentication')) return '认证失败，请检查网页登录用户名与密码。';
 if (message.includes('timeout')) return '连接超时，请检查节点状态后重试。';
 if (message.includes('master_key')) return '服务端尚未配置有效主密钥，暂时无法保存新凭据。';
 if (message.includes('forbidden')) return '权限不足，请重新登录并确认管理员权限。';
 return '操作失败，请检查配置或稍后重试。';
};
export function DownloadNodeSettings({ apiBase }: { apiBase: string }) {
 const [settings,setSettings]=useState<DownloadNodeSettings|null>(null);
 const [input,setInput]=useState<DownloadNodeInput>(blank);
 const [editing,setEditing]=useState(false);
 const [open,setOpen]=useState(false);
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');
 const [deleteID,setDeleteID]=useState('');
 const load=useCallback(async()=>{setLoading(true);try{setSettings(await fetchDownloadNodes(apiBase));setError('');}catch(err){setError(failure(err));}finally{setLoading(false);}},[apiBase]);
 useEffect(()=>{void load();},[load]);
 const edit=(node: DownloadNode)=>{
 if(node.type==='builtin')return;
 setInput({id:node.id,name:node.name,type:node.type,enabled:node.enabled,weight:node.weight,capabilities:node.capabilities,base_url:node.base_url,api_base_url:node.api_base_url,username:node.username,directory:node.directory,allowed_download_origins:node.allowed_download_origins,password:''});setEditing(true);setOpen(true);setError('');setNotice('');
 };
 const save=async(event: React.FormEvent)=>{
 event.preventDefault();if(busy||!settings)return;setBusy(true);setError('');setNotice('');
 try{const session=await readSession(apiBase);setSettings(await saveDownloadNode(input,settings.revision,session.csrf_token,editing,apiBase));setInput(blank());setOpen(false);setNotice('节点配置已保存。镜像将在后台逐步补齐。');}
 catch(err){setError(failure(err));setInput(old=>({...old,password:''}));}finally{setBusy(false);}
 };
 const remove=async()=>{
 if(busy||!settings||!deleteID)return;setBusy(true);setError('');
 try{const session=await readSession(apiBase);setSettings(await deleteDownloadNode(deleteID,settings.revision,session.csrf_token,apiBase));setDeleteID('');setNotice('节点配置已删除，网盘对象保留。');}catch(err){setError(failure(err));}finally{setBusy(false);}
 };
 const retry=async(node: DownloadNode)=>{
 if(busy||!settings)return;setBusy(true);setError('');setNotice('');
 try{const session=await readSession(apiBase);const result=await retryDownloadMirrors(node.id,settings.revision,session.csrf_token,apiBase);setNotice(`已重新排队 ${result.retried} 个失败镜像。`);setSettings(await fetchDownloadNodes(apiBase));}catch(err){setError(failure(err));}finally{setBusy(false);}
 };
 const test=async(node: DownloadNode)=>{
 if(busy||!settings)return;setBusy(true);setError('');setNotice('');
 try{const session=await readSession(apiBase);const result=await testDownloadNode(node.id,settings.revision,session.csrf_token,apiBase);if(result.ok)setNotice(`连接测试通过（${result.elapsed_ms} ms）。仅验证认证与目录元数据，尚未验证文件上传及大包交付。`);else setError(failure(new Error(result.error_code)));setSettings(await fetchDownloadNodes(apiBase));}
 catch(err){setError(failure(err));}finally{setInput(old=>({...old,password:''}));setBusy(false);}
 };
 return <section className="bg-white border border-neutral-200 rounded-lg p-5 space-y-5" aria-labelledby="download-nodes-title">
 <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 pb-3"><div><h2 id="download-nodes-title" className="text-sm font-semibold text-neutral-900">下载交付节点</h2><p className="mt-1 text-xs text-neutral-500">Cloudreve 存储与直链 · GitHub 转发</p></div><div className="flex gap-2"><button type="button" className={button} disabled={busy||loading} onClick={()=>void load()}>刷新列表</button><button type="button" className={button} disabled={busy||!settings} onClick={()=>{setInput(blank());setEditing(false);setOpen(true);setError('');}}>添加节点</button></div></div>
 <p className="text-xs text-neutral-600">主服务器始终可用；普通包优先交付已校验的外部镜像。精灵包继续由主服务器处理。</p>
 {error&&<p role="alert" className="p-3 rounded border border-red-200 bg-red-50 text-xs text-red-700">{error}</p>}
 {notice&&<p role="status" className="p-3 rounded border border-emerald-200 bg-emerald-50 text-xs text-emerald-800">{notice}</p>}
 {loading?<p className="text-xs text-neutral-500">正在加载节点…</p>:settings&&<>
 {settings.builtin_fallback&&<p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded p-3">没有启用的外部节点，下载流量将由主服务器承担。</p>}
 {!settings.master_key_configured&&<p className="text-xs text-amber-800">服务端未配置凭据主密钥，无法保存新密码或节点密钥。</p>}
 <ul className="divide-y divide-neutral-100">{settings.items.map(node=><li key={node.id} className="py-4 flex flex-wrap justify-between items-start gap-3"><div className="min-w-0"><h3 className="text-sm font-medium text-neutral-900 break-words">{node.name}<span className="ml-2 text-xs text-neutral-500">{node.type==='builtin'?'内置 · 不可删除':node.type==='cloudreve'?'Cloudreve 存储与直链':'GitHub 转发'}</span></h3><p className="text-xs text-neutral-500 mt-1">{node.enabled?'已启用':'已停用'} · 权重 {node.weight} · {node.status==='available'?'连接可用':node.status==='failed'?'检测失败':node.type==='builtin'?'始终可用':'尚未检测'}{node.credential_configured?' · 凭据已配置':''}</p>{node.mirror_states&&<p className="text-xs text-neutral-500 mt-1">镜像：就绪 {node.mirror_states.ready||0} · 等待 {node.mirror_states.pending||0} · 上传 {node.mirror_states.uploading||0} · 失败 {node.mirror_states.failed||0}</p>}{node.last_checked_at&&<p className="text-xs text-neutral-400 mt-1">最近检测：{new Date(node.last_checked_at).toLocaleString()}</p>}{node.error_code&&<p className="text-xs text-red-700 mt-1">{failure(new Error(node.error_code))}</p>}</div>{node.type!=='builtin'&&<div className="flex gap-2"><button type="button" className={button} disabled={busy} onClick={()=>void test(node)}>测试连接</button>{!!node.mirror_states?.failed&&<button type="button" className={button} disabled={busy} onClick={()=>void retry(node)}>重试失败镜像</button>}<button type="button" className={button} disabled={busy} onClick={()=>edit(node)}>编辑<span className="sr-only"> {node.name}</span></button><button type="button" className={button} disabled={busy} onClick={()=>setDeleteID(node.id)}>删除<span className="sr-only"> {node.name}</span></button></div>}</li>)}</ul>
 </>}
 {deleteID&&<div role="alert" className="rounded border border-amber-200 bg-amber-50 p-4 space-y-3 text-xs text-amber-900"><p>删除此节点的配置与凭据？网盘对象不会删除；移除最后一个外部节点后，流量回落到主服务器。</p><div className="flex gap-2"><button type="button" className={button} disabled={busy} onClick={()=>void remove()}>确认删除</button><button type="button" className={button} disabled={busy} onClick={()=>setDeleteID('')}>取消</button></div></div>}
 {open&&<form onSubmit={save} className="border-t border-neutral-200 pt-5 space-y-4"><h3 className="text-sm font-semibold">{editing?'编辑节点':'添加节点'}</h3><fieldset disabled={busy} className="grid grid-cols-1 sm:grid-cols-2 gap-4 disabled:opacity-60">
 <label className="text-xs space-y-1">节点 ID<input required pattern="[a-zA-Z0-9_-]{1,64}" className={field} value={input.id} disabled={editing} onChange={e=>setInput({...input,id:e.target.value})}/></label>
 <label className="text-xs space-y-1">名称<input required maxLength={128} className={field} value={input.name} onChange={e=>setInput({...input,name:e.target.value})}/></label>
 <label className="text-xs space-y-1">节点类型<select className={field} value={input.type} disabled={editing} onChange={e=>{const type=e.target.value as DownloadNodeInput['type'];setInput({...input,type,capabilities:[type==='cloudreve'?'cloudreve':'github'],password:''});}}><option value="cloudreve">Cloudreve 存储与直链</option><option value="github_relay">GitHub 转发</option></select></label>
 <label className="text-xs space-y-1">选择权重<input type="number" min={1} max={100} required className={field} value={input.weight} onChange={e=>setInput({...input,weight:Number(e.target.value)})}/></label>
 {input.type==='cloudreve'?<>
 <label className="text-xs space-y-1 sm:col-span-2">Cloudreve API 地址<input type="url" required placeholder="https://disk.example/api/v3" className={field} value={input.api_base_url||''} onChange={e=>setInput({...input,api_base_url:e.target.value})}/></label>
 <label className="text-xs space-y-1">网页登录用户名<input required autoComplete="off" className={field} value={input.username||''} onChange={e=>setInput({...input,username:e.target.value})}/></label>
 <label className="text-xs space-y-1">项目专用目录<input required className={field} value={input.directory||''} onChange={e=>setInput({...input,directory:e.target.value})}/><span className="block text-neutral-500">测试连接或上传时，目录不存在会自动创建。</span></label>
 <label className="text-xs space-y-1 sm:col-span-2">下载与上传从机允许的 HTTPS origin（每行一个）<textarea required rows={3} placeholder="https://storage.example:29991" className={field} value={(input.allowed_download_origins||[]).join('\n')} onChange={e=>setInput({...input,allowed_download_origins:e.target.value.split('\n')})}/></label>
 </>:<label className="text-xs space-y-1 sm:col-span-2">节点 HTTPS 服务地址<input type="url" required placeholder="https://relay.example" className={field} value={input.base_url||''} onChange={e=>setInput({...input,base_url:e.target.value})}/></label>}
 <label className="text-xs space-y-1 sm:col-span-2">{input.type==='cloudreve'?'网页登录密码':'节点授权密钥（至少32字节）'}<input type="password" autoComplete="new-password" required={!editing} className={field} value={input.password} onChange={e=>setInput({...input,password:e.target.value})}/><span className="block text-neutral-500">{editing?'留空保留原凭据；输入新值即替换。':'仅发送到本站管理 API，加密保存在服务端。'}</span></label>
 <label className="text-xs flex gap-2 items-center"><input type="checkbox" checked={input.enabled} onChange={e=>setInput({...input,enabled:e.target.checked})}/>启用此节点</label><p className="text-xs text-neutral-500">能力：{input.type==='cloudreve'?'Cloudreve 存储与直链':'GitHub 转发'}（由类型决定）</p>
 </fieldset><div className="flex gap-2"><button type="submit" disabled={busy||(!settings?.master_key_configured&&(!editing||input.password!==''))} className="rounded bg-emerald-700 px-4 py-2 text-xs font-medium text-white disabled:opacity-40">{busy?'正在处理…':'保存节点'}</button><button type="button" className={button} disabled={busy} onClick={()=>{setInput(blank());setOpen(false);}}>取消</button></div><p className="text-xs text-neutral-500">保存后可测试连接。连接测试不创建文件；大包上传、哈希与从机下载需另行验收。</p></form>}
 </section>;
}
