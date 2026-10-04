"""Read-only layout/overview/Settings/set-checklist UX verification; local preview with controlled set fixtures."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:4182');args=parser.parse_args();shots=Path('/tmp/mtg-structure-qa');shots.mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1366,'height':768},color_scheme='dark');errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(10000)
 page.goto(args.url);page.get_by_role('heading',name='Overview',exact=True).wait_for();state=page.request.get(args.url+'/api/state').json();before=state['summary']['copies']
 nav=page.get_by_role('navigation',name='Main navigation');main=page.locator('main')
 def go(label):nav.get_by_role('button',name=label,exact=True).click();page.wait_for_timeout(80)
 def bounds(label):
  dimensions=page.evaluate("({body:document.body.scrollHeight,doc:document.documentElement.scrollHeight,height:innerHeight,width:innerWidth,shell:document.querySelector('.app-shell').getBoundingClientRect().height,mainWidth:document.querySelector('main').scrollWidth,mainClient:document.querySelector('main').clientWidth,documentWidth:document.documentElement.scrollWidth})")
  assert dimensions['body']<=dimensions['height']+1 and dimensions['doc']<=dimensions['height']+1 and abs(dimensions['shell']-dimensions['height'])<1,(label,dimensions)
  assert dimensions['mainWidth']<=dimensions['mainClient']+1 and dimensions['documentWidth']<=dimensions['width'],(label,dimensions)
  main.evaluate('e=>e.scrollTop=e.scrollHeight');page.wait_for_timeout(30);assert page.evaluate('scrollY')==0
  box=main.bounding_box();assert box['y']>=0 and box['y']+box['height']<=dimensions['height']+1
  main.evaluate('e=>e.scrollTop=0')
 for mode in ['light','dark']:
  go('Settings');page.get_by_role('group',name='Appearance').get_by_role('button',name=mode.title(),exact=True).click()
  for width,height in [(1366,768),(1280,720),(1024,768),(390,844),(360,640)]:
   page.set_viewport_size({'width':width,'height':height})
   for label in ['Overview','Collection','Decks','Missing','Review','Settings']:
    go(label);bounds((mode,width,height,label))
    assert page.get_by_role('combobox',name='Appearance',exact=True).count()==0
    if label!='Settings':assert page.get_by_role('group',name='Appearance',exact=True).count()==0
    if (width,height) in [(1366,768),(390,844)]:page.screenshot(path=str(shots/f'{label.lower()}-{mode}-{width}.png'))
   page.get_by_role('tab',name='Data & prices',exact=True).click();bounds((mode,width,'settings-data'))
   if width in [1366,390]:page.screenshot(path=str(shots/f'settings-data-{mode}-{width}.png'))
   page.get_by_role('tab',name='Recovery',exact=True).click();page.get_by_role('heading',name='Collection recovery',exact=True).wait_for();bounds((mode,width,'settings-recovery'))
   page.get_by_role('button',name='Deck revisions',exact=True).click();page.get_by_role('heading',name='Deck revisions and deleted decks',exact=True).wait_for();bounds((mode,width,'settings-revisions'))
   if width in [1366,390]:page.screenshot(path=str(shots/f'settings-recovery-{mode}-{width}.png'))
   go('Collection');page.get_by_role('navigation',name='Collection sections').get_by_role('link',name='Set progress',exact=True).click();page.get_by_role('heading',name='Set progress',exact=True).wait_for();page.locator('.set-row').first.wait_for();bounds((mode,width,'sets'))
   if width in [1366,390]:page.screenshot(path=str(shots/f'sets-{mode}-{width}.png'))
 page.set_viewport_size({'width':1366,'height':768});go('Settings');page.get_by_role('tab',name='Preferences',exact=True).click();page.get_by_role('group',name='Appearance').get_by_role('button',name='System',exact=True).click();page.emulate_media(color_scheme='light');page.wait_for_function("document.documentElement.dataset.theme==='light'");page.emulate_media(color_scheme='dark');page.wait_for_function("document.documentElement.dataset.theme==='dark'");page.get_by_role('group',name='Appearance').get_by_role('button',name='Dark',exact=True).click();page.reload();page.get_by_role('group',name='Appearance').wait_for();assert page.evaluate('document.documentElement.dataset.theme')=='dark'
 page.evaluate("location.hash='settings?section=data'");expect(page.get_by_role('tab',name='Data & prices',exact=True)).to_have_attribute('aria-selected','true');page.evaluate("location.hash='settings?section=invalid'");expect(page.get_by_role('tab',name='Preferences',exact=True)).to_have_attribute('aria-selected','true')
 page.get_by_role('tab',name='Preferences',exact=True).focus();page.keyboard.press('ArrowRight');expect(page.get_by_role('tab',name='Data & prices',exact=True)).to_be_focused();expect(page.get_by_role('tab',name='Data & prices',exact=True)).to_have_attribute('aria-selected','true')
 go('Overview');assert page.get_by_text('Unknown',exact=True).count()>0 or state['summary']['priced_copies']>0
 for deck in state['decks'][:6]:
  row=page.locator('.overview-deck').filter(has=page.get_by_role('link',name=deck['name'],exact=True))
  if row.count() and (not deck['readiness']['list']['complete'] or not deck['list_confirmed']):assert 'Ready to assemble' not in row.inner_text()
 first=page.locator('.overview-deck').first;first.get_by_role('link',name='View missing',exact=True).click();page.get_by_role('heading',name='Missing cards and acquisitions',exact=True).wait_for();assert 'deck=' in page.url;assert page.locator('.deck-pills input:checked').count()==1
 go('Collection');page.set_viewport_size({'width':390,'height':844});first_y=page.locator('.mobile-card-row').first.bounding_box()['y'];assert first_y<480,first_y
 page.get_by_role('button',name='Filters',exact=True).click();page.get_by_role('dialog',name='Filters and saved views').wait_for();page.screenshot(path=str(shots/'filter-dark-390.png'));page.keyboard.press('Escape')
 page.set_viewport_size({'width':700,'height':1000});page.evaluate("document.documentElement.style.fontSize='32px'")
 for label in ['Overview','Collection','Decks','Missing','Review','Settings']:go(label);bounds(('200% text',label))
 page.get_by_role('tab',name='Data & prices',exact=True).click();bounds('200% settings-data');page.get_by_role('tab',name='Recovery',exact=True).click();bounds('200% recovery')
 page.evaluate("document.documentElement.style.fontSize='16px'");page.set_viewport_size({'width':1366,'height':768})
 # Full, partial-ownership and offline set responses are fixtures in this browser only.
 sample={'code':'abc','name':'Example edition','owned_printings':1,'copies':3,'total':None,'verified_owned':0,'needs_verification':1,'percent':None,'missing_count':None,'fetched_at':None,'scope':'english-paper-all-printings-v1'};phase=['fail'];cache=[False];verified=[False]
 def fixtures(route):
  path=route.request.url.split('/api/')[1]
  if path.endswith('/refresh'):
   if phase[0]=='fail':route.fulfill(status=400,content_type='application/json',body=json.dumps({'detail':'Controlled offline checklist failure'}));return
   cache[0]=True;route.fulfill(status=200,content_type='application/json',body='{"catalog_loaded":true}');return
  value={**sample}
  if cache[0]:value.update(total=2,verified_owned=1,percent=50 if verified[0] else None,needs_verification=0 if verified[0] else 1,missing_count=1 if verified[0] else None,fetched_at='2026-10-04T10:00:00Z')
  if path=='sets':body={'items':[value]}
  else:body={**value,'items':([{'id':'one','name':'Known printing','number':'1','owned':True},{'id':'two','name':'Variant printing','number':'2','owned':False}] if cache[0] else []),'count':2 if cache[0] else 0,'pages':1}
  route.fulfill(status=200,content_type='application/json',body=json.dumps(body))
 page.route('**/api/sets**',fixtures);go('Collection');page.get_by_role('link',name='Set progress',exact=True).click();page.get_by_role('button',name='Open set',exact=True).click();dialog=page.get_by_role('dialog',name='Example edition');dialog.get_by_text('Completion unknown',exact=True).wait_for();dialog.get_by_role('button',name='Load checklist',exact=True).click();dialog.get_by_role('alert').filter(has_text='Controlled offline').wait_for();assert dialog.get_by_text('Completion unknown',exact=True).count()==1
 phase[0]='ready';dialog.get_by_role('button',name='Load checklist',exact=True).click();expect(dialog.get_by_role('button',name='Missing printings',exact=True)).to_be_disabled();dialog.get_by_text('No verified copy',exact=True).wait_for()
 verified[0]=True;dialog.get_by_role('button',name='Refresh checklist',exact=True).click();dialog.get_by_text('50% complete',exact=True).wait_for();expect(dialog.get_by_role('button',name='Missing printings',exact=True)).to_be_enabled();dialog.get_by_text('Missing',exact=True).wait_for();page.keyboard.press('Escape')
 assert page.request.get(args.url+'/api/state').json()['summary']['copies']==before;assert not errors,errors
 browser.close()
print('Passed bounded main scrolling for all pages at 5 laptop/mobile sizes, Settings tabs/theme buttons/OS persistence, Overview incomplete targets/deep links, early mobile cards, 200% text, and unknown/offline/verified set-checklist states. No inventory writes or browser errors.')
