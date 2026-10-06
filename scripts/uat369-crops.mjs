import { chromium } from 'playwright';
const BASE='https://portfolion.taebro.com';
const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'test@portfolion.com',password:'test1234'})});
const {access_token,refresh_token}=await r.json();
const b=await chromium.launch();
for (const [tag,vp,mob,scheme] of [['m390-light',{width:390,height:844},true,'light'],['pc1440-dark',{width:1440,height:900},false,'dark']]) {
  const ctx=await b.newContext({viewport:vp,isMobile:mob,deviceScaleFactor:1,serviceWorkers:'block'});
  await ctx.addInitScript(([a,rr,s])=>{localStorage.setItem('access_token',a);localStorage.setItem('refresh_token',rr);localStorage.setItem('pwa-install-dismissed-at',String(Date.now()));localStorage.setItem('theme',s);},[access_token,refresh_token,scheme]);
  const p=await ctx.newPage(); await p.goto(`${BASE}/analyst-report/CRCL/2026-10-07`,{waitUntil:'networkidle'}); await p.waitForSelector('[data-lens-cell]');
  await p.screenshot({path:`screenshots-uat369/crop-${tag}-top.png`});
  await p.evaluate(()=>document.getElementById('lens-5').scrollIntoView()); await p.waitForTimeout(300);
  await p.screenshot({path:`screenshots-uat369/crop-${tag}-lens5.png`});
  await p.evaluate(()=>document.getElementById('lens-8').scrollIntoView()); await p.waitForTimeout(300);
  await p.screenshot({path:`screenshots-uat369/crop-${tag}-lens8.png`});
  await ctx.close();
}
await b.close();
