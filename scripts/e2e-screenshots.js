// End-to-end UI check + screenshots. Usage: BASE=http://localhost:3000 node scripts/e2e-screenshots.js
const puppeteer = require('puppeteer-core');
const BASE = process.env.BASE || 'http://localhost:3000';
const OUT = (process.env.OUT||__dirname + '/../screenshots/');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const bal = async () => Number((await page.$eval('#balance', e => e.textContent)).replace(/,/g, ''));
  const shot = async (n) => { await sleep(300); await page.screenshot({ path: OUT + n + '.png' }); console.log('shot', n); };
  const user = 'player' + Date.now().toString().slice(-6);

  await page.goto(BASE + '/#/login', { waitUntil: 'networkidle0' });
  await shot('01-signup');
  await page.type('input[name=username]', user); await page.type('input[name=password]', 'demo1234');
  await page.click('#authSubmit'); await page.waitForSelector('.vip');
  console.log('signed up', user, 'balance', await bal());
  await shot('02-dashboard');

  await page.click('#bonusCard'); await page.waitForSelector('[data-claim=welcome]');
  await shot('03-bonuses');
  await page.click('[data-claim=welcome]'); await sleep(600);
  await page.click('#bonusCard'); await page.waitForSelector('[data-claim=daily]'); await page.click('[data-claim=daily]'); await sleep(600);
  console.log('after bonuses', await bal());

  await page.click('#depositBtn'); await page.waitForSelector('#depGo');
  await page.click('[data-amt="2500"]'); await shot('04-deposit');
  await page.click('#depGo'); await sleep(600);
  console.log('after deposit', await bal());

  await page.click('#bellBtn'); await sleep(400); await shot('05-notifications'); await page.click('#bellBtn');

  for (const g of ['slots', 'dice', 'plinko', 'crash']) {
    await page.goto(BASE + '/#/game/' + g, { waitUntil: 'networkidle0' }); await page.waitForSelector('#playBtn');
    await page.$eval('#betAmt', e => e.value = 250);
    const before = await bal();
    await page.click('#playBtn');
    await page.waitForFunction(() => document.querySelector('#result').textContent.trim().length > 0, { timeout: 60000 });
    await sleep(400);
    console.log(g, 'before', before, 'after', await bal(), '|', await page.$eval('#result', e => e.textContent));
    await shot('06-' + g);
  }
  const finalBal = await bal();
  await page.goto(BASE + '/#/history', { waitUntil: 'networkidle0' }); await sleep(500); await shot('07-history-bets');
  await page.click('[data-t=txns]'); await shot('08-history-transactions');
  await page.goto(BASE + '/#/profile', { waitUntil: 'networkidle0' }); await sleep(300); await shot('09-profile');
  await page.reload({ waitUntil: 'networkidle0' }); await sleep(300);
  console.log('after reload', await bal(), 'expected', finalBal);
  await page.click('#logout'); await page.waitForSelector('#authForm');
  await page.click('[data-m=login]'); await page.type('input[name=username]', user); await page.type('input[name=password]', 'demo1234');
  await page.click('#authSubmit'); await page.waitForSelector('.vip'); await sleep(300);
  console.log('after re-login', await bal());
  await shot('10-dashboard-after-play');
  await page.setViewport({ width: 1280, height: 860 }); await page.reload({ waitUntil: 'networkidle0' }); await shot('11-desktop');
  console.log('page errors:', errors);
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
