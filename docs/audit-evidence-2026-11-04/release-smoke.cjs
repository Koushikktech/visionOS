const { chromium } = require('/Users/koushikk/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const fs = require('node:fs/promises');
const base='http://127.0.0.1:3017';
const out='/Users/koushikk/Documents/projects/visionOS/docs/audit-evidence-2026-11-04';
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const results=[];
 try {
 const ctx=await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
 await ctx.route('**/*',r=>r.request().url().startsWith(base)||r.request().url().startsWith('data:')?r.continue():r.abort());
 const p=await ctx.newPage(); const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base);await p.getByRole('main',{name:'visionOS Studio',exact:true}).waitFor();
 results.push({check:'Studio loads without forced modal',pass:await p.getByRole('dialog').count()===0});
 await p.screenshot({path:out+'/studio-1440.png',fullPage:true});
 await p.getByRole('button',{name:'AI setup',exact:true}).click();
 const dialog=p.getByRole('dialog',{name:'Connect an AI provider'});await dialog.waitFor();
 await dialog.getByRole('combobox',{name:'Provider',exact:true}).selectOption('openai');
 await dialog.getByRole('button',{name:'Connect test Plus subscription',exact:true}).click();
 const fake=await p.evaluate(()=>({account:JSON.parse(localStorage.getItem('visionos_chatgpt_account')||'null'),provider:localStorage.getItem('visionos_ai_provider')}));
 results.push({check:'Public test-subscription control persists fabricated live credential',observed:fake.account?.connected&&fake.account?.token?.startsWith('chatgpt_sub_'),provider:fake.provider,plan:fake.account?.plan});
 await p.screenshot({path:out+'/fake-subscription-connection.png'});
 await p.keyboard.press('Escape');
 for(const size of [[320,568],[768,1024],[1024,500]]){
 await p.setViewportSize({width:size[0],height:size[1]});
 await p.getByRole('button',{name:'AI setup',exact:true}).click();await dialog.waitFor();
 const b=await dialog.boundingBox();results.push({check:'Provider dialog bounds '+size.join('x'),pass:b.x>=0&&b.y>=0&&b.x+b.width<=size[0]+1&&b.y+b.height<=size[1]+1,rootOverflow:await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
 await p.screenshot({path:out+'/provider-'+size.join('x')+'.png'});await p.keyboard.press('Escape');
 }
 await p.setViewportSize({width:1024,height:768});
 await p.getByRole('button',{name:/Try the sample|Try sample|Try the Field Notes sample/}).first().click();
 await p.locator('.tl-canvas').waitFor();await p.waitForTimeout(1800);
 results.push({check:'Sample opens canvas',pass:await p.locator('.tl-canvas').count()===1});
 await p.getByRole('button',{name:'Back to Studio',exact:true}).click();
 results.push({check:'Returning Studio suspends app iframes',pass:await p.locator('iframe').count()===0});
 results.push({check:'Uncaught browser errors in smoke flow',errors});
 await ctx.close();
 const auth=await browser.newContext();const ap=await auth.newPage();let exchanges=0;
 await auth.route('**/api/auth/openai/token',async r=>{exchanges++;await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,accessToken:'AUDIT_NOT_A_REAL_TOKEN',email:'audit@example.invalid'})})});
 await ap.goto(base);
 await ap.evaluate(()=>{localStorage.setItem('visionos_pkce_state','expected-state');localStorage.setItem('visionos_pkce_code_verifier','expected-verifier')});
 await ap.goto(base+'/auth/openai/callback?code=AUDIT_NOT_REAL&state=wrong-state');await ap.waitForTimeout(500);
 results.push({check:'OAuth callback with mismatched state',exchangeCalls:exchanges,persistedConnected:await ap.evaluate(()=>JSON.parse(localStorage.getItem('visionos_chatgpt_account')||'null')?.connected||false),note:'Token endpoint mocked; no real provider contacted'});
 await auth.close();
 } finally {await browser.close();await fs.writeFile(out+'/smoke-results.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results,null,2));}
})().catch(e=>{console.error(e.stack);process.exitCode=1});
