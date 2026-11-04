process.env.PLAYWRIGHT_BROWSERS_PATH='/private/tmp/visionos-playwright-browsers';
const {chromium}=require('/Users/koushikk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert=require('node:assert/strict');
const base='http://127.0.0.1:3005';
const shapeId='shape:cross-tab-network-fixture';
const code=`<!doctype html><html><head><title>Cross-tab permission fixture</title></head><body>
<h1>Cross-tab fixture</h1><p id="network">Waiting</p>
<script>
let requestNumber=0;
function ping(){const request=++requestNumber;fetch('https://allowed.invalid/data?tick='+request).then(r=>r.text()).then(text=>{document.getElementById('network').textContent=text}).catch(()=>{document.getElementById('network').textContent='Needs website access'})}
ping();setInterval(ping,350);
</script></body></html>`;
async function wait(check,label,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,80))}throw Error('Timed out: '+label)}
async function getEditor(page){return page.evaluate(()=>{const el=document.querySelector('.tl-canvas');if(!el)return false;let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];for(let i=0;f&&i<160;i++,f=f.return)for(const v of Object.values(f.memoizedProps||{}))if(v&&typeof v.getCurrentPageShapes==='function'){window.__qaEditor=v;return true}return false})}
function appFrame(page){return page.frameLocator('iframe.visionos-artifact-frame').frameLocator('#visionos-app-runner')}
async function openPermissions(page){await page.getByRole('button',{name:/Review .*website|Review website access/}).first().click();return page.getByRole('dialog',{name:'Website access',exact:true})}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
 let pageA,pageB;
 try{
  const context=await browser.newContext({viewport:{width:1024,height:768}});
  await context.addInitScript(()=>{if(window===window.top)localStorage.setItem('visionos_onboarded_v1','true')});
  const hits=[];
  await context.route(/^https:\/\/(allowed|denied|images)\.invalid\//,async route=>{const url=route.request().url();hits.push({url,page:route.request().frame().page()===pageA?'A':route.request().frame().page()===pageB?'B':'other'});await route.fulfill({status:200,contentType:'text/plain',headers:{'access-control-allow-origin':'*'},body:'Approved fixture response'})});
  const errors={A:[],B:[]};
  pageA=await context.newPage();pageA.setDefaultTimeout(20000);pageA.on('pageerror',e=>errors.A.push(String(e)));await pageA.goto(base);await pageA.locator('.tl-canvas').waitFor();assert.equal(await getEditor(pageA),true);
  await pageA.evaluate(({shapeId,code})=>{const e=window.__qaEditor;e.createShape({id:shapeId,type:'artifact',x:100,y:160,props:{w:700,h:430,title:'Cross-tab fixture',code,storage:{},networkEnabled:false,runtimePaused:false}});e.setSelectedShapes([shapeId]);e.zoomToSelection({animation:{duration:0}})},{shapeId,code});
  await appFrame(pageA).getByText('Needs website access',{exact:true}).waitFor();assert.equal(hits.length,0,'unapproved requests are not dispatched');
  let dialog=await openPermissions(pageA);await dialog.getByRole('checkbox',{name:'https://allowed.invalid',exact:true}).check();await dialog.getByRole('checkbox',{name:/Remember .*this code version/}).first().check();await dialog.getByRole('button',{name:'Allow and reload app',exact:true}).click();await dialog.waitFor({state:'detached'});await appFrame(pageA).getByText('Approved fixture response',{exact:true}).waitFor();await wait(async()=>hits.some(x=>x.page==='A'),'A makes approved requests');
  const grantA=await pageA.evaluate(()=>JSON.parse(localStorage.getItem('visionos_artifact_network_grants_v1')||'{"apps":[]}').apps.find(x=>x.shapeId==='shape:cross-tab-network-fixture'));
  assert.ok(grantA,'remembered grant persisted');assert.deepEqual(grantA.origins,['https://allowed.invalid']);
  pageB=await context.newPage();pageB.setDefaultTimeout(20000);pageB.on('pageerror',e=>errors.B.push(String(e)));await pageB.goto(base);await pageB.locator('.tl-canvas').waitFor();assert.equal(await getEditor(pageB),true);
  await wait(async()=>await pageB.evaluate(()=>Boolean(window.__qaEditor?.getShape('shape:cross-tab-network-fixture'))),'same board artifact appears in B');
  const boardA=await pageA.evaluate(()=>({page:window.__qaEditor.getCurrentPageId(),source:window.__qaEditor.getShape('shape:cross-tab-network-fixture')?.props.code}));
  const boardB=await pageB.evaluate(()=>({page:window.__qaEditor.getCurrentPageId(),source:window.__qaEditor.getShape('shape:cross-tab-network-fixture')?.props.code}));
  assert.deepEqual(boardB,boardA,'both tabs use the same board page and exact app source');
  const grantB=await pageB.evaluate(()=>JSON.parse(localStorage.getItem('visionos_artifact_network_grants_v1')||'{"apps":[]}').apps.find(x=>x.shapeId==='shape:cross-tab-network-fixture'));
  assert.deepEqual({workspaceKey:grantB.workspaceKey,epoch:grantB.epoch,shapeId:grantB.shapeId,sourceFingerprint:grantB.sourceFingerprint},{workspaceKey:grantA.workspaceKey,epoch:grantA.epoch,shapeId:grantA.shapeId,sourceFingerprint:grantA.sourceFingerprint},'both tabs share the grant identity and epoch');
  await appFrame(pageB).getByText('Approved fixture response',{exact:true}).waitFor();await wait(async()=>hits.some(x=>x.page==='B'),'B automatically uses remembered grant');
  const bHitCountBefore=hits.filter(x=>x.page==='B').length;
  assert.ok(bHitCountBefore>0,'B made approved requests before revocation');
  await pageA.bringToFront();dialog=await openPermissions(pageA);await dialog.getByRole('button',{name:'Remove access to https://allowed.invalid',exact:true}).click();
  await wait(async()=>await dialog.getByRole('button',{name:'Remove access to https://allowed.invalid',exact:true}).count()===0,'A removed remembered grant');
  await pageB.bringToFront();
  await pageB.getByText('Paused for review',{exact:true}).waitFor();
  await pageB.locator('iframe.visionos-artifact-frame').waitFor({state:'detached'});
  const postPauseCount=hits.length;await pageB.waitForTimeout(1200);
  assert.equal(hits.length,postPauseCount,'no allowed fixture requests continue after cross-tab revocation');
  assert.equal(hits.filter(x=>x.page==='B').length,bHitCountBefore,'B made no further approved requests after pausing');
  assert.equal(hits.some(x=>x.url.includes('denied.invalid')||x.url.includes('images.invalid')),false,'no unapproved endpoint was requested');
  assert.deepEqual(errors,{A:[],B:[]});
  const result={engine:'Chromium',sameBoardPage:boardA.page===boardB.page,sameArtifactId:shapeId,sameSource:true,sameEpoch:grantA.epoch,tabBUsedRememberedOrigin:true,tabARevokedOrigin:true,tabBPaused:true,tabBFrameRemoved:true,noApprovedRequestsAfterPause:true,noUnapprovedRequests:true,requestsBeforeAndAfter: {tabBBefore:bHitCountBefore,tabBAfter:hits.filter(x=>x.page==='B').length,total:hits.length},pageErrors:errors};
  process.stdout.write(JSON.stringify(result,null,2)+'\n');
  await context.close();
 }finally{await browser.close()}
})().catch(e=>{console.error(e.stack);process.exit(1)});
