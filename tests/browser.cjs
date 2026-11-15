/* End-to-end smoke suite. Requires Playwright and seeded local/API test servers.
   HERMES_TEST_LOCAL defaults to http://127.0.0.1:8080; HERMES_TEST_API to :8081.
   The local fixture must contain >2,000 crew-1 records; artifacts go to HERMES_QA_DIR. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const local=process.env.HERMES_TEST_LOCAL||'http://127.0.0.1:8080';
const api=process.env.HERMES_TEST_API||'http://127.0.0.1:8081';
const out=process.env.HERMES_QA_DIR||'/tmp/hermes-qa';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||chromium.executablePath(),headless:true,args:['--no-sandbox','--no-zygote','--disable-gpu']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const waitHistory=()=>page.waitForFunction(()=>document.getElementById('history-feedback')?.textContent.includes('recorded samples ·'),{timeout:30000});
 try{
  await page.goto(local+'/index.php');
  await page.waitForFunction(()=>document.getElementById('last-updated').textContent.startsWith('Last reading:'));
  assert.equal(await page.locator('html').getAttribute('lang'),'en');
  assert.ok((await page.title()).includes('Hermes'));assert.ok(await page.locator('#dashboard-data').isVisible());
  assert.equal(await page.locator('#crew-form button img').count(),3);
  assert.ok(await page.getByRole('button',{name:'Avery Sinclair'}).isVisible());
  assert.ok(await page.locator('#mission-alerts').isVisible());
  await page.screenshot({path:path.join(out,'dashboard-data.png'),fullPage:true});
  await page.click('[data-view="graphs"]');await waitHistory();
  assert.equal(await page.locator('[data-chart] svg').count(),26);
  await page.screenshot({path:path.join(out,'dashboard-graphs.png'),fullPage:true});
  await page.reload();await waitHistory();assert.ok(await page.locator('#dashboard-graphs').isVisible());
  await page.click('#scenario-form button[value="3"]');
  await page.waitForFunction(()=>document.querySelector('#scenario-form button[value="3"]').getAttribute('aria-pressed')==='true');
  await page.getByRole('button',{name:'Maya Okafor'}).click();await waitHistory();
  assert.equal(await page.getByRole('button',{name:'Maya Okafor'}).getAttribute('aria-pressed'),'true');
  assert.ok((await page.locator('#crew-label').innerText()).includes('Astronaut 02'));
  await page.click('.nav a[href^="statistics.php"]');await waitHistory();
  assert.ok(page.url().includes('astro=2'));
  await page.getByRole('button',{name:'Avery Sinclair'}).click();
  await page.waitForFunction(()=>Number(document.getElementById('sample-count').textContent.replaceAll(',',''))>2000);
  await waitHistory();
  assert.equal(await page.locator('#statistics-rows tr').count(),26);
  assert.equal(await page.locator('[data-chart] svg').count(),26);
  assert.equal(await page.locator('#distribution-chart .normal-path').count(),1);
  assert.equal(await page.locator('#history-rows tr').count(),25);
  assert.equal(await page.locator('#history-rows tr:first-child td').count(),28);
  await page.screenshot({path:path.join(out,'statistics.png'),fullPage:true});
  await page.selectOption('#metric-select','bone_loss_rate');
  await page.waitForFunction(()=>document.getElementById('distribution-chart').textContent.includes('σ = 0'));
  assert.equal(await page.locator('#distribution-chart .normal-path').count(),0);
  await page.selectOption('#metric-select','heart_rate');
  await page.click('#history-next');assert.equal(await page.locator('#follow-latest').isChecked(),false);
  assert.ok((await page.locator('#history-page').innerText()).includes('Page 2'));
  const frozen=await page.locator('#history-rows tr:first-child').innerText();
  await page.waitForTimeout(1200);assert.equal(await page.locator('#history-rows tr:first-child').innerText(),frozen);
  await page.check('#follow-latest');assert.ok((await page.locator('#history-page').innerText()).includes('Page 1'));
  const downloadPromise=page.waitForEvent('download');await page.click('#export-history');const download=await downloadPromise;
  const file=path.join(out,download.suggestedFilename());await download.saveAs(file);
  const csv=fs.readFileSync(file,'utf8');assert.ok(csv.split('\r\n').length>2000);assert.ok(csv.includes('"sensor_availability"'));assert.ok(csv.includes('"bp_diastolic"'));
  await page.selectOption('#graph-group','environment');assert.equal(await page.locator('.chart-card:visible').count(),7);
  await page.selectOption('#history-range','custom');await page.fill('#history-start','2000-01-01T00:00');await page.fill('#history-end','2000-01-02T00:00');await page.click('#apply-range');
  await page.waitForFunction(()=>document.getElementById('history-feedback').textContent.startsWith('0 recorded samples'));
  assert.equal(await page.locator('#export-history').isDisabled(),true);assert.ok((await page.locator('#distribution-chart').innerText()).includes('No numeric'));
  await page.selectOption('#history-range','all');await waitHistory();
  for(const route of ['cardiovascular.php','musculoskeletal.php','immune_stress.php','energy_sleep.php']){
   await page.goto(local+'/'+route);await waitHistory();assert.ok(await page.locator('.trend-path').count()>0);
   assert.ok(await page.locator('#mission-alerts').isVisible());
  }
  await page.goto(local+'/statistics.php');await waitHistory();assert.ok(page.url().includes('statistics.php'));
  await page.goto(api+'/statistics.php');await waitHistory();
  assert.ok(Number((await page.locator('#sample-count').innerText()).replaceAll(',',''))>2000);
  assert.ok((await page.locator('#data-source').innerText()).includes('Telemetry API'));
  await page.getByRole('button',{name:'Maya Okafor'}).click();await waitHistory();assert.ok(Number((await page.locator('#sample-count').innerText()).replaceAll(',',''))<100);
  await page.goto(api+'/index.php?astro=99&view=graphs');await waitHistory();assert.ok((await page.locator('#notice-slot').innerText()).includes('Waiting for telemetry'));
  assert.equal(await page.locator('[data-chart] svg').count(),0);
  await page.goto(local+'/index.php?view=data');await page.route('**/data.php**',route=>route.abort());
  await page.waitForFunction(()=>document.getElementById('api-state').textContent==='OFFLINE');
  await page.unroute('**/data.php**');await page.waitForFunction(()=>document.getElementById('api-state').textContent==='ONLINE');
  await page.setViewportSize({width:390,height:844});await page.goto(local+'/statistics.php');await waitHistory();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await page.screenshot({path:path.join(out,'statistics-mobile.png'),fullPage:true});
  await page.goto(local+'/index.php?view=data');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));
  await page.screenshot({path:path.join(out,'dashboard-mobile.png'),fullPage:true});
  assert.deepEqual(errors,[]);console.log('Browser checks passed: local/API charts, all 26 fields, >2,000 rows, distributions, filters, CSV, crew/scenarios, persistence, offline recovery, mobile.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
