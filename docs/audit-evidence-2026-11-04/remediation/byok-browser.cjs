// Local production-build regression checks. No real provider credentials are used.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/Users/koushikk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const BASE = process.env.AUDIT_BASE_URL || 'http://127.0.0.1:3017';
const OUT = __dirname;
const API_KEY = 'sk-audit-retained-not-a-real-key-123456789';
const OLD_TOKEN = 'legacy-oauth-audit-not-a-real-token-12345';
const FAKE = 'chatgpt_sub_audit_123456789';
(async () => {
 const browser = await chromium.launch({executablePath:process.env.AUDIT_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const results=[];
 try {
  const c=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const p=await c.newPage();p.setDefaultTimeout(15000);const errors=[];let sent=[];
  p.on('pageerror',e=>errors.push(e.message));
  await c.route('**/api/ai/chat',async r=>{sent.push(JSON.parse(r.request().postData()||'{}'));await r.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Audit provider rejected the API key.'})});});
  await p.goto(BASE);await p.getByRole('button',{name:'AI setup',exact:true}).waitFor();
  await p.evaluate(({API_KEY,OLD_TOKEN,FAKE})=>{
   for(const store of [localStorage,sessionStorage]){
    for(const prefix of ['visionos','canvasos']){
     store.setItem(prefix+'_openai_api_keys',JSON.stringify([FAKE,OLD_TOKEN,API_KEY]));
     store.setItem(prefix+'_openai_api_key',FAKE);
    }
    store.setItem('visionos_chatgpt_account',JSON.stringify({connected:true,type:'oauth',token:OLD_TOKEN,refreshToken:'audit-refresh-not-real'}));
    store.setItem('visionos_chatgpt_oauth_token',OLD_TOKEN);
    store.setItem('visionos_pkce_state','audit-old-state');
    store.setItem('visionos_pkce_code_verifier','audit-old-verifier');
   }
   localStorage.setItem('visionos_ai_provider','openai');
  },{API_KEY,OLD_TOKEN,FAKE});
  await p.reload();await p.getByRole('button',{name:'AI setup',exact:true}).click();
  const dialog=p.getByRole('dialog',{name:'Connect an AI provider'});await dialog.waitFor();
  await dialog.getByRole('combobox',{name:'Provider',exact:true}).selectOption('openai');
  assert.equal(await dialog.getByRole('button',{name:/ChatGPT|subscription/i}).count(),0,'No OAuth or fake subscription controls');
  const storage=await p.evaluate(()=>({local:JSON.parse(localStorage.getItem('visionos_openai_api_keys')||'[]'),session:JSON.parse(sessionStorage.getItem('visionos_openai_api_keys')||'[]'),oldAccount:localStorage.getItem('visionos_chatgpt_account'),oldToken:localStorage.getItem('visionos_chatgpt_oauth_token')}));
  assert.deepEqual(storage.local,[API_KEY]);assert.deepEqual(storage.session,[API_KEY]);assert(!storage.oldAccount&&!storage.oldToken,'Legacy account storage cleared');
  results.push({check:'Legacy fake/OAuth tokens removed; genuine API key preserved in both stores',pass:true});
  await dialog.getByRole('textbox',{name:'OpenAI API key',exact:true}).fill(FAKE);
  await p.getByRole('button',{name:'Save key',exact:true}).click();
  assert(await dialog.isVisible(),'Known fake credential is rejected without closing setup');
  assert.deepEqual(await p.evaluate(()=>JSON.parse(localStorage.getItem('visionos_openai_api_keys')||'[]')),[API_KEY]);
  await dialog.getByRole('textbox',{name:'OpenAI API key',exact:true}).fill('');
  results.push({check:'Pasting a fabricated token cannot replace a valid API key',pass:true});
  for(const [w,h] of [[320,568],[768,1024],[1024,500]]){
   await p.setViewportSize({width:w,height:h});
   await p.waitForFunction(()=>{
    const b=document.querySelector('[role=dialog]')?.getBoundingClientRect();
    return b&&b.x>=-1&&b.y>=-1&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1;
   });
   const b=await dialog.boundingBox();assert(b.x>=-1&&b.y>=-1&&b.x+b.width<=w+1&&b.y+b.height<=h+1);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await p.screenshot({path:path.join(OUT,'provider-'+w+'x'+h+'.png')});
  }
  results.push({check:'API-key setup viewport bounds',pass:true,sizes:['320x568','768x1024','1024x500']});
  await p.keyboard.press('Escape');await p.setViewportSize({width:1024,height:768});
  await p.getByPlaceholder('Describe what you want to make…').fill('Keep this draft until I explicitly send it.');
  await p.getByRole('button',{name:'Open in canvas',exact:true}).click();
  const input=p.getByRole('textbox',{name:'Ask AI',exact:true});await input.waitFor();
  assert.equal(await input.inputValue(),'Keep this draft until I explicitly send it.');assert.equal(sent.length,0);
  await p.getByRole('button',{name:'Send prompt',exact:true}).click();
  await p.getByText('Audit provider rejected the API key.',{exact:false}).first().waitFor();
  assert.equal(sent.length,1);const body=sent[0];assert(!('chatgptOAuthToken' in body));
  assert(body.openaiApiKey===API_KEY||body.openaiApiKeys?.includes(API_KEY),'Request uses retained API key');
  assert(!JSON.stringify(body).includes(OLD_TOKEN)&&!JSON.stringify(body).includes(FAKE));
  results.push({check:'Draft does not auto-send; explicit request uses API key only',pass:true});
  for(const [w,h] of [[320,568],[768,1024],[1024,500],[1440,900]]) {
   await p.setViewportSize({width:w,height:h});
   for(const expanded of [false,true]) {
    const toggle=p.getByRole('button',{name:expanded?'Expand panel':'Collapse panel',exact:true});
    if(await toggle.count()) await toggle.click();
    await p.waitForFunction(()=>{
     const panel=document.querySelector('.studio-ai-panel__surface');const b=panel?.getBoundingClientRect();
     return b&&b.x>=-1&&b.y>=-1&&b.right<=innerWidth+1&&b.bottom<=innerHeight+1;
    });
    const panel=p.locator('.studio-ai-panel__surface');
    assert.equal(await panel.evaluate(e=>e.scrollWidth>e.clientWidth+1),false);
    const field=await input.boundingBox();assert(field.y>=0&&field.y+field.height<=h+1,'Send input stays within viewport');
   }
  }
  results.push({check:'Actual AI panel compact/default/expanded bounds and input access',pass:true,sizes:['320x568','768x1024','1024x500','1440x900']});
  await p.setViewportSize({width:1024,height:768});
  await p.getByRole('button',{name:'Close Ask AI',exact:true}).click();
  await p.getByRole('button',{name:'Back to Studio',exact:true}).click();
  await p.getByRole('button',{name:'AI setup',exact:true}).click();
  await dialog.getByRole('combobox',{name:'Provider',exact:true}).selectOption('openrouter');
  await dialog.getByRole('textbox',{name:/API key/i}).fill('sk-or-audit-not-real-123456789');
  await p.getByRole('button',{name:'Save key',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(sent.length,1);
  results.push({check:'Saving provider settings does not send another request',pass:true});
  for(const endpoint of ['/api/auth/openai/token','/api/ai/openai-check']){
   const res=await c.request.post(BASE+endpoint,{data:{code:'audit-not-real',codeVerifier:'audit-not-real'}});assert.equal(res.status(),404);results.push({check:endpoint+' removed',pass:true});
  }
  const res=await c.request.get(BASE+'/auth/openai/callback?code=audit-not-real&state=wrong');assert.equal(res.status(),404);
  results.push({check:'Unsafe OAuth callback removed',pass:true});
  assert.deepEqual(errors,[]);results.push({check:'No uncaught browser errors',pass:true});await c.close();
  const fresh=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});
  let freshRequests=0;
  await fresh.route('**/api/ai/chat',async r=>{freshRequests++;await r.fulfill({status:401,contentType:'application/json',body:JSON.stringify({error:'Audit key rejected.'})});});
  const q=await fresh.newPage();await q.goto(BASE);
  await q.getByPlaceholder('Describe what you want to make…').fill('My unsent first prompt');
  await q.getByRole('button',{name:'Open in canvas',exact:true}).click();
  const qi=q.getByRole('textbox',{name:'Ask AI',exact:true});await qi.waitFor();
  await q.getByRole('button',{name:'Send prompt',exact:true}).click();
  const qd=q.getByRole('dialog',{name:'Connect an AI provider'});await qd.waitFor();assert.equal(freshRequests,0);
  await qd.getByRole('combobox',{name:'Provider',exact:true}).selectOption('openai');
  await qd.getByRole('textbox',{name:'OpenAI API key',exact:true}).fill(API_KEY);
  await q.getByRole('button',{name:'Save key',exact:true}).click();await qd.waitFor({state:'hidden'});
  assert.equal(freshRequests,0);assert.equal(await qi.inputValue(),'My unsent first prompt');
  await q.getByRole('button',{name:'Send prompt',exact:true}).click();
  await q.getByText('Audit key rejected.',{exact:false}).first().waitFor();assert.equal(freshRequests,1);
  results.push({check:'Missing-key setup preserves first draft; Save never sends',pass:true});await fresh.close();
 } finally {await browser.close();await fs.writeFile(path.join(OUT,'byok-browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
