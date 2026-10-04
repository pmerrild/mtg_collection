"""UX recovery checks against a disposable local Site; wishlist responses are controlled fixtures."""
import argparse,json
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:4182');args=parser.parse_args()
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1440,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(args.url+'/#collection');page.get_by_role('heading',name='Collection',exact=True).wait_for()
 page.get_by_role('navigation').get_by_role('button',name='Decks',exact=True).click();page.get_by_role('heading',name='Decks',exact=True).wait_for()
 page.get_by_role('navigation').get_by_role('button',name='Collection',exact=True).click();page.get_by_label('Search collection').fill(page.locator('.card-cell strong').first.inner_text());page.wait_for_timeout(50);collection_hash=page.evaluate('location.hash');page.locator('.card-cell').first.click();detail=page.get_by_role('dialog');detail.get_by_label('Where is this card?',exact=True).fill('Unsaved route UX QA')
 prompts=[]
 def keep_editing(dialog):prompts.append(dialog.message);dialog.dismiss()
 page.once('dialog',keep_editing);page.go_back();page.wait_for_function("location.hash.startsWith('#collection')");assert detail.is_visible();assert page.evaluate('location.hash')==collection_hash;assert len(prompts)==1;assert detail.get_by_label('Where is this card?',exact=True).input_value()=='Unsaved route UX QA'
 def discard(dialog):prompts.append(dialog.message);dialog.accept()
 page.once('dialog',discard);page.evaluate("location.hash='#decks'");page.get_by_role('heading',name='Decks',exact=True).wait_for();assert page.get_by_role('dialog').count()==0;assert len(prompts)==2
 fixtures=lambda name:{'items':[{'name':name,'printing_key':None,'finish':None,'quantity':3,'estimate':None,'decks':['QA selection']}],'copies':3,'estimate':0,'priced_copies':0}
 behavior=['ready'];pending=[]
 def wishlist(route):
  if behavior[0]=='hold':pending.append(route)
  elif behavior[0]=='fail':route.fulfill(status=503,content_type='application/json',body=json.dumps({'detail':'Controlled wishlist failure'}))
  else:route.fulfill(status=200,content_type='application/json',body=json.dumps(fixtures('Current UX requirement')))
 page.route('**/api/wishlist?*',wishlist)
 page.evaluate("location.hash='missing'");page.get_by_role('button',name='Track wanted',exact=True).wait_for();assert page.get_by_role('button',name='Export for Scryfall',exact=True).is_enabled()
 behavior[0]='hold';page.get_by_role('button',name='Share copies',exact=True).click();page.get_by_role('status').filter(has_text='Updating missing cards').wait_for();assert page.get_by_role('button',name='Export for Scryfall',exact=True).is_disabled();assert page.get_by_role('button',name='Track wanted',exact=True).count()==0;assert page.get_by_text('Current UX requirement',exact=True).count()==0;assert page.locator('.wishlist-summary').count()==0
 behavior[0]='fail';page.get_by_role('button',name='Assembled together',exact=True).click();page.get_by_role('alert').filter(has_text='Controlled wishlist failure').wait_for();assert page.get_by_role('button',name='Export for Scryfall',exact=True).is_disabled();assert page.get_by_role('button',name='Track wanted',exact=True).is_disabled()
 behavior[0]='ready';page.get_by_role('button',name='Retry missing cards',exact=True).click();page.get_by_role('button',name='Track wanted',exact=True).wait_for();expect(page.get_by_role('button',name='Track wanted',exact=True)).to_be_enabled();expect(page.get_by_role('button',name='Export for Scryfall',exact=True)).to_be_enabled()
 assert pending
 pending.pop(0).fulfill(status=200,content_type='application/json',body=json.dumps(fixtures('Obsolete delayed UX requirement')));page.wait_for_timeout(100);assert page.get_by_text('Obsolete delayed UX requirement',exact=True).count()==0;assert page.get_by_text('Current UX requirement',exact=True).count()==1
 assert not errors,errors
 browser.close()
print('Passed browser Back continue-editing, hash-route discard with one prompt, query-keyed Missing results, pending/failed action blocking, retry, and obsolete-response rejection. No API writes or browser errors.')
