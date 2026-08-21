const { chromium } = require('playwright');
const path = require('path'); const fs = require('fs');
const BASE='https://portfolion.taebro.com', EMAIL='test@portfolion.com', PASSWORD='test1234';
const OUT=path.join('/Users/calmonion/Project/PortfoliOn','screenshots','uat79','pc');
(async()=>{
  const r=await fetch(`${BASE}/api/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:EMAIL,password:PASSWORD})});
  const {access_token,refresh_token}=await r.json();
  const b=await chromium.launch({headless:true});
  const ctx=await b.newContext({viewport:{width:1440,height:900}});
  const p=await ctx.newPage();
  await p.goto(BASE,{waitUntil:'domcontentloaded'});
  await p.evaluate(([a,rr])=>{localStorage.setItem('access_token',a);localStorage.setItem('refresh_token',rr);},[access_token,refresh_token]);
  await p.goto(BASE+'/',{waitUntil:'domcontentloaded'});
  // wait up to 35s for report list content
  try{ await p.waitForFunction(()=>{const t=document.body.innerText||'';return !t.includes('불러오는 중') && document.querySelectorAll('.stock-card').length>0;},{timeout:35000}); }catch(e){console.log('list wait timeout');}
  await p.waitForTimeout(1500);
  await p.screenshot({path:path.join(OUT,'10-reports.png'),fullPage:true}); console.log('list shot. cards=', (await p.$$('.stock-card')).length);
  // open first card with report
  const cards=await p.$$('.stock-card'); let opened=false;
  for(let i=0;i<Math.min(cards.length,8)&&!opened;i++){try{await cards[i].scrollIntoViewIfNeeded();await cards[i].click();await p.waitForTimeout(2500);opened=await p.evaluate(()=>[...document.querySelectorAll('.tab-btn')].some(x=>/요약|지표|사업분석|히스토리/.test(x.textContent)));}catch{}}
  if(opened){await p.waitForTimeout(1500);await p.screenshot({path:path.join(OUT,'20-detail-summary.png'),fullPage:true});console.log('detail summary shot');
    // 사업분석 tab (consensus buy/sell, insider, target)
    const dd=await p.evaluateHandle(()=>{const e=[...document.querySelectorAll('.tab-btn')].find(x=>/사업분석/.test(x.textContent));if(e){e.click();return true;}return false;});
    if(await dd.jsonValue()){await p.waitForTimeout(2500);await p.screenshot({path:path.join(OUT,'22-detail-deepdive.png'),fullPage:true});console.log('deepdive shot');}
  } else console.log('detail not opened');
  await b.close();
})().catch(e=>{console.error('FATAL',e);process.exit(1);});
