import React, { act } from 'react';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '../context/AppContext';
import { useAuthorWorkspace } from './useAuthorWorkspace';

test('author workspace requests only visible pages and refreshes after mutation', async (t) => {
  t.mock.timers.enable({apis:['setTimeout']});
  const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost/'});
  const original = {window:globalThis.window,document:globalThis.document,fetch:globalThis.fetch};
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
  const calls:string[]=[];
  let failed=false;
  globalThis.fetch=(async(input,init)=>{
    const url=new URL(String(input),'http://localhost');calls.push(url.pathname+url.search);
    if(url.pathname==='/api/v1/session')return Response.json({user:{id:'author',display_name:'Author'},roles:['author'],csrf_token:'csrf'});
    if(url.pathname==='/api/v1/mods')return Response.json({items:[]});
    if(url.pathname.endsWith('/edit'))return Response.json({id:'v',mod_id:'m',state:'draft',version:'updated',dependencies:[]});
    if(!url.searchParams.has('page_size'))throw Error('unbounded author request '+url);
    const page=Number(url.searchParams.get('page'));
    if(url.pathname==='/api/v1/author/mods')return Response.json({items:[{mod:{id:'m'+page,title:'Mine '+page,summary:'',author:{id:'author'},category:'submod'},is_published:false}],page,total:12,page_size:10});
    if(url.pathname.endsWith('/versions')){
      if(failed)return Response.json({code:'unavailable'},{status:503});
      return Response.json({items:[{id:'v',mod_id:'m'+page,version:'1.0',state:'draft',dependencies:[],size_bytes:0,sha256:''}],scan_reports:{},page,total:23,page_size:10});
    }
    if(url.pathname.endsWith('/submissions'))return Response.json({items:[],total:0,page:1,page_size:10});
    throw Error('unexpected '+url);
  }) as typeof fetch;
  let workspace:ReturnType<typeof useAuthorWorkspace>;
  function Probe(){workspace=useAuthorWorkspace();return <div>{workspace.activeMod?.title}:{workspace.activeModVersions.length}:{workspace.versionRequest.error}</div>}
  const root=createRoot(dom.window.document.getElementById('root')!);
  const settle=async()=>{await act(async()=>{await new Promise<void>(resolve=>setImmediate(resolve))})};
  try{
    await act(async()=>root.render(<AppProvider><Probe/></AppProvider>));await settle();
    assert.equal(workspace!.userMods.length,1);
    assert.ok(calls.includes('/api/v1/author/mods?page=1&page_size=10'));
    assert.equal(calls.some(path=>path.includes('/submissions')),false);
    await act(async()=>workspace!.changeModPage(2));await settle();
    assert.equal(workspace!.activeMod?.title,'Mine 2');
    assert.ok(calls.includes('/api/v1/author/mods/m2/versions?page=1&page_size=10'));
    await act(async()=>workspace!.changeVersionPage(3));await settle();
    assert.ok(calls.includes('/api/v1/author/mods/m2/versions?page=3&page_size=10'));
    const count=calls.length;
    await act(async()=>{await workspace!.app.editVersion('v','updated','',[])});await settle();
    assert.ok(calls.length>count+1,'mutation reloads visible pages');
    failed=true;
    await act(async()=>workspace!.changeVersionPage(2));await settle();
    assert.equal(workspace!.versionRequest.error,'unavailable');
    failed=false;
    await act(async()=>workspace!.versionRequest.reload());await settle();
    assert.equal(workspace!.versionRequest.error,undefined);
    await act(async()=>workspace!.setWorkbenchView('submissions'));await settle();
    assert.ok(calls.includes('/api/v1/author/submissions?page=1&page_size=10'));
    await act(async()=>workspace!.changeHistoryState('rejected'));await settle();
    assert.ok(calls.includes('/api/v1/author/submissions?page=1&page_size=10&state=rejected'));
  }finally{await act(async()=>root.unmount());t.mock.timers.reset();dom.window.close();Object.assign(globalThis,original)}
});
