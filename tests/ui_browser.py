"""Theme, layout, filtering and undo acceptance; disposable local Worker only."""
import argparse,json,re,time
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:4182');args=parser.parse_args()
shots=Path('/tmp/mtg-ui-qa');shots.mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 context=browser.new_context(viewport={'width':1440,'height':1050},color_scheme='dark');page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));page.set_default_timeout(10000)
 page.goto(args.url+'/#collection');page.get_by_role('heading',name='Collection',exact=True).wait_for()
 assert page.evaluate('document.documentElement.dataset.theme')=='dark'
 def theme(mode):
  page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Settings',exact=True).click();page.get_by_role('group',name='Appearance',exact=True).get_by_role('button',name=mode.title(),exact=True).click();page.get_by_role('navigation',name='Main navigation').get_by_role('button',name='Collection',exact=True).click()
 if page.locator('.card-thumb').count():
  thumb=page.locator('.card-thumb').first.bounding_box();assert 35<=thumb['width']<=37 and 49<=thumb['height']<=51,thumb
 page.emulate_media(color_scheme='light');page.wait_for_function("document.documentElement.dataset.theme==='light'")
 theme('dark');page.reload();page.get_by_role('heading',name='Collection',exact=True).wait_for();assert page.evaluate('document.documentElement.dataset.theme')=='dark'
 for mode in ['light','dark']:
  theme(mode)
  for nav in ['Collection','Decks','Settings']:
   page.get_by_role('navigation').get_by_role('button',name=nav,exact=True).click();page.wait_for_timeout(150)
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),(mode,nav)
   panel=page.locator('.table-panel').first
   if panel.count():assert panel.evaluate("e=>getComputedStyle(e).backgroundColor")==('rgb(26, 30, 36)' if mode=='dark' else 'rgb(255, 255, 255)'),(mode,nav)
  assert page.get_by_role('group',name='Appearance',exact=True).get_by_role('button',name=mode.title(),exact=True).get_attribute('aria-pressed')=='true'
  page.get_by_role('navigation').get_by_role('button',name='Collection',exact=True).click()
 page.get_by_role('heading',name='Collection',exact=True).wait_for();page.wait_for_timeout(50);page.keyboard.press('/');assert page.get_by_label('Search collection').evaluate('e=>e===document.activeElement')
 page.get_by_label('Search collection').fill('');page.get_by_role('button',name=re.compile('^Filters')).click();dialog=page.get_by_role('dialog',name='Filters and saved views')
 colors=dialog.get_by_role('group',name='Colors',exact=True)
 colors.get_by_label('Blue',exact=True).check();page.keyboard.press('Escape');dialog.wait_for(state='hidden');assert 'color=' not in page.url
 assert page.get_by_role('button',name=re.compile('^Filters')).evaluate('e=>e===document.activeElement')
 page.get_by_role('button',name=re.compile('^Filters')).click();dialog=page.get_by_role('dialog',name='Filters and saved views');colors=dialog.get_by_role('group',name='Colors',exact=True);colors.get_by_label('Blue',exact=True).check();colors.get_by_label('Black',exact=True).check();dialog.get_by_label('Colors match mode').select_option('all');dialog.get_by_label('Owned copies min').fill('2')
 assert 'color=' not in page.url
 dialog.get_by_role('button',name=re.compile('^Show .* printings$')).click();assert 'color_mode=all' in page.url
 page.get_by_role('button',name='Remove Colors filter',exact=True).click();page.get_by_role('button',name='Clear filters',exact=True).click()
 # Sets search retains checked selections when no visible options match, and remains a draft.
 cards=page.request.get(args.url+'/api/collection').json();codes=sorted(set(c['set_code'] for c in cards));code=codes[0]
 page.get_by_role('button',name=re.compile('^Filters')).click();dialog=page.get_by_role('dialog',name='Filters and saved views');sets=dialog.get_by_role('group',name='Sets · 0 selected',exact=True);sets.get_by_role('checkbox',name=code,exact=True).check();dialog.get_by_label('Search sets',exact=True).fill('ZZZZnoSet');dialog.get_by_text('No sets match your search. Selected sets remain included.',exact=True).wait_for();dialog.get_by_role('group',name='Sets · 1 selected',exact=True).wait_for();dialog.get_by_role('button',name='Remove selected set '+code,exact=True).wait_for();assert 'sets=' not in page.url
 dialog.get_by_role('button',name=re.compile('^Show .* printings$')).click();assert 'sets=' in page.url
 page.get_by_role('button',name=re.compile('^Filters')).click();dialog=page.get_by_role('dialog',name='Filters and saved views');dialog.get_by_role('button',name='Remove selected set '+code,exact=True).click();dialog.get_by_role('button',name='Cancel',exact=True).click();assert 'sets=' in page.url
 page.get_by_role('button',name='Clear filters',exact=True).last.click()
 # Details retain ordered context and opening revision across background refresh/navigation.
 first_name=page.locator('.card-cell strong').nth(0).inner_text();second_name=page.locator('.card-cell strong').nth(1).inner_text();page.locator('.card-cell').first.click();detail=page.get_by_role('dialog',name=first_name,exact=True);assert detail.get_by_role('button',name='Previous result',exact=True).is_disabled();detail.get_by_text('Result 1 of '+str(len(cards)),exact=True).wait_for()
 detail.get_by_label('Where is this card?',exact=True).fill('Unsaved navigation QA')
 page.once('dialog',lambda d:d.dismiss());detail.get_by_role('button',name='Next result',exact=True).click();assert detail.is_visible()
 page.once('dialog',lambda d:d.accept());detail.get_by_role('button',name='Next result',exact=True).click();detail=page.get_by_role('dialog',name=second_name,exact=True);detail.wait_for();detail.get_by_text('Result 2 of '+str(len(cards)),exact=True).wait_for()
 latest=page.request.get(args.url+'/api/state').json();assert page.request.patch(args.url+'/api/locations',headers={'X-Vault-Revision':str(latest['revision'])},data={'key':cards[0]['key'],'location':'Background printing QA'}).ok
 page.wait_for_timeout(16000)
 detail.get_by_role('button',name='Previous result',exact=True).click();detail=page.get_by_role('dialog',name=first_name,exact=True);detail.wait_for();detail.get_by_label('Where is this card?',exact=True).fill('Stale captured revision QA');detail.get_by_role('button',name='Save location',exact=True).click();detail.get_by_role('alert').wait_for();assert 'another tab' in detail.get_by_role('alert').inner_text();page.once('dialog',lambda d:d.accept());page.keyboard.press('Escape')
 # All-results action remains available after selecting only a page.
 page.get_by_role('checkbox',name='Select current page',exact=True).check();page.get_by_role('button',name='Actions',exact=True).click();dialog=page.get_by_role('dialog',name='Selected printing actions');dialog.get_by_role('button',name='Select all '+str(len(cards))+' results',exact=True).click();dialog.get_by_text(str(len(cards))+' selected printings',exact=True).wait_for();page.keyboard.press('Escape');page.get_by_role('button',name='Clear selection',exact=True).click()
 page.get_by_role('button',name='Display',exact=True).click();dialog=page.get_by_role('dialog',name='Collection display');dialog.get_by_label('Row density').select_option('compact');dialog.get_by_role('checkbox',name='Excel Deck labels',exact=True).check();dialog.get_by_role('checkbox',name='Known value',exact=True).uncheck();dialog.get_by_role('button',name='Done',exact=True).click();assert page.get_by_role('columnheader',name='Excel Deck labels',exact=True).count()==1;assert page.get_by_role('columnheader',name='Known value',exact=True).count()==0
 page.reload();page.get_by_role('heading',name='Collection',exact=True).wait_for();assert page.locator('.density-compact').count()==1
 page.get_by_role('button',name='Display',exact=True).click();dialog=page.get_by_role('dialog',name='Collection display');dialog.get_by_label('Row density').select_option('comfortable');dialog.get_by_role('checkbox',name='Known value',exact=True).check();dialog.get_by_role('checkbox',name='Excel Deck labels',exact=True).uncheck();dialog.get_by_role('button',name='Done',exact=True).click()
 page.get_by_label('Search collection').fill('NoSuchCardUIAcceptance');page.get_by_role('heading',name='No matching cards',exact=True).wait_for();page.get_by_role('button',name='Clear filters',exact=True).last.click()
 page.get_by_role('checkbox',name='Select current page',exact=True).check();page.get_by_role('button',name='Actions',exact=True).click();dialog=page.get_by_role('dialog',name='Selected printing actions');dialog.get_by_role('button',name='Set location',exact=True).click();dialog=page.get_by_role('dialog',name='Set storage location');label='Undo QA '+str(time.time_ns());dialog.get_by_label('New storage location',exact=True).fill(label);dialog.get_by_role('button',name='Apply to 30 printings',exact=True).click();dialog.wait_for(state='hidden');page.get_by_role('button',name='Undo',exact=True).wait_for()
 before=page.request.get(args.url+'/api/state').json()['summary']['copies'];assert sum(c['location']==label for c in page.request.get(args.url+'/api/collection').json())==30
 page.get_by_role('navigation').get_by_role('button',name='Settings',exact=True).click();page.get_by_role('button',name='Undo',exact=True).click();page.locator('.undo-bar').wait_for(state='hidden');assert not any(c['location']==label for c in page.request.get(args.url+'/api/collection').json());assert page.request.get(args.url+'/api/state').json()['summary']['copies']==before
 page.get_by_role('navigation').get_by_role('button',name='Collection',exact=True).click();page.get_by_role('checkbox',name='Select current page',exact=True).check();page.get_by_role('button',name='Actions',exact=True).click();page.get_by_role('dialog',name='Selected printing actions').get_by_role('button',name='Keep copies',exact=True).click();dialog=page.get_by_role('dialog',name='Set copies to keep');dialog.get_by_label('Keep at least this many copies per printing',exact=True).fill('2');dialog.get_by_role('button',name='Apply to 30 printings',exact=True).click();dialog.wait_for(state='hidden')
 latest=page.request.get(args.url+'/api/state').json();first=page.request.get(args.url+'/api/collection').json()[0];page.request.patch(args.url+'/api/locations',headers={'X-Vault-Revision':str(latest['revision'])},data={'key':first['key'],'location':'Later UI edit'});page.get_by_role('button',name='Undo',exact=True).click();page.locator('.undo-bar').get_by_role('alert').wait_for();assert 'another tab' in page.locator('.undo-bar').get_by_role('alert').inner_text();page.get_by_role('button',name='Dismiss undo',exact=True).click()
 page.screenshot(path=str(shots/'core-desktop-dark.png'))
 page.set_viewport_size({'width':390,'height':844});page.get_by_role('button',name='Clear selection',exact=True).click();page.wait_for_timeout(100)
 initial_y=page.locator('.mobile-card-row').first.bounding_box()['y'];page.get_by_role('checkbox',name='Select current page',exact=True).check();selected_y=page.locator('.mobile-card-row').first.bounding_box()['y'];assert selected_y-initial_y<10,(initial_y,selected_y);assert selected_y<600
 page.screenshot(path=str(shots/'core-mobile-selected-dark.png'))
 page.get_by_role('button',name=re.compile('^Filters')).click();dialog=page.get_by_role('dialog',name='Filters and saved views');assert dialog.get_by_role('button',name=re.compile('^Show .* printings$')).bounding_box()['y']<844;page.screenshot(path=str(shots/'core-filter-mobile-dark.png'));page.keyboard.press('Escape')
 page.locator('main').evaluate('e=>e.scrollTop=900');page.wait_for_timeout(100);assert abs(page.locator('.collection-controls').bounding_box()['y']-page.locator('main').bounding_box()['y'])<2
 for mode in ['light','dark']:
  page.locator('main').evaluate('e=>e.scrollTop=0');theme(mode)
  for nav in ['Collection','Decks','Settings']:
   page.get_by_role('navigation').get_by_role('button',name=nav,exact=True).click();page.wait_for_timeout(100);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),('mobile',mode,nav)
 page.set_viewport_size({'width':700,'height':1000});page.evaluate("document.documentElement.style.fontSize='32px'");page.get_by_role('navigation').get_by_role('button',name='Collection',exact=True).click();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'200% text overflow'
 page.get_by_role('button',name=re.compile('^Filters')).click();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.keyboard.press('Escape')
 assert not errors,errors
 browser.close()
print('Passed System/Light/Dark persistence and OS switching, theme controls, all routes in desktop/mobile, filter drafts/cancel/focus/apply, set search/retained selections, captured printing navigation/dirty guard/stale save, select all after partial selection, density/columns, shortcut, empty reset, compact selection, sticky search, cross-page undo/stale rejection, and 200% text. No browser errors; ownership unchanged.')
