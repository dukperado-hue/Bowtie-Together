import asyncio, json, pathlib
from playwright.async_api import async_playwright
URL='http://127.0.0.1:38151'
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(headless=True,args=['--no-sandbox'])
  a=await browser.new_context(viewport={'width':1440,'height':950})
  b=await browser.new_context(viewport={'width':1440,'height':950})
  p1=await a.new_page();p2=await b.new_page()
  errors=[]
  p1.on('pageerror',lambda e:errors.append('p1 '+str(e)))
  p2.on('pageerror',lambda e:errors.append('p2 '+str(e)))
  await p1.goto(URL);await p1.screenshot(path='Bowtie-Together-Preview.png',full_page=False)
  print('initial title',await p1.title())
  await p1.locator('#liveShareButton').click()
  print('modal visible',await p1.locator('#liveModal').get_attribute('class'))
  await p1.locator('#liveCreate').click()
  await p1.wait_for_function("document.querySelector('#liveRoomCode')?.textContent?.length === 16", timeout=10000)
  code=(await p1.locator('#liveRoomCode').text_content()).strip()
  print('created room',code)
  await p1.locator('#liveCancel').click()
  await p2.goto(URL+'/#room='+code)
  await p2.wait_for_function("document.querySelector('#liveRoomBadge')?.textContent?.length===16",timeout=15000)
  await p2.wait_for_timeout(1200)
  print('browser2 connected',await p2.locator('#liveStatus').text_content())
  # Add threat on first browser, will open editor. Save actual changed title.
  await p1.locator('#addThreatTop').click()
  await p1.wait_for_timeout(300)
  print('editor present',await p1.locator('#drawerTitle').text_content())
  await p1.locator('#form-title').fill('Unstable approach')
  await p1.locator('#editorForm button[type="submit"]').click()
  await p2.wait_for_function("document.body.innerText.includes('Unstable approach')",timeout=15000)
  print('remote got threat',await p2.get_by_text('Unstable approach').count())
  # Concurrent additions on both sides
  await asyncio.gather(p1.locator('#addConsequenceTop').click(),p2.locator('#addThreatTop').click())
  await p1.wait_for_timeout(300);await p2.wait_for_timeout(300)
  await p1.locator('#form-title').fill('Aircraft damage')
  await p2.locator('#form-title').fill('Runway contamination')
  await asyncio.gather(p1.locator('#editorForm button[type="submit"]').click(),p2.locator('#editorForm button[type="submit"]').click())
  await p1.wait_for_timeout(1000);await p2.wait_for_timeout(1000)
  # check final server snapshot
  import urllib.request
  r=json.load(urllib.request.urlopen(f'{URL}/api/rooms/{code}'))
  print('server threats', [x['title'] for x in r['project']['threats']]);print('consequences',[x['title'] for x in r['project']['consequences']]);
  print('js errors',errors)
  await p1.screenshot(path='Bowtie-Together-Live-Desktop.png',full_page=False)
  mobile=await browser.new_context(viewport={'width':390,'height':844},is_mobile=True,device_scale_factor=1,has_touch=True)
  pm=await mobile.new_page();pm.on('pageerror',lambda e:errors.append('mobile '+str(e)))
  await pm.goto(URL+'/#room='+code);await pm.wait_for_timeout(1000)
  await pm.screenshot(path='Bowtie-Together-Mobile.png',full_page=False)
  print('mobile app title',await pm.title(),'errors',errors)
  assert not errors
  assert len(r['project']['threats'])>=2 and len(r['project']['consequences'])>=1
  await browser.close()
asyncio.run(main())
