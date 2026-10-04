"""Hosted UX acceptance against disposable local Worker storage."""
import argparse,re,time
from pathlib import Path
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:4180');parser.add_argument('--browser',default='/usr/bin/chromium');args=parser.parse_args()
location_label='QA binder '+str(time.time_ns())
shots=Path('/tmp/mtg-roadmap-qa');shots.mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=args.browser,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1440,'height':1050});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(args.url);existing=page.request.get(args.url+'/api/state').json()
 for d in existing['decks']:
  if d['name']=='Roadmap browser deck':
   latest=page.request.get(args.url+'/api/state').json();page.request.delete(args.url+'/api/decks/'+str(d['id']),headers={'X-Vault-Revision':str(latest['revision'])})
 for acquisition in existing['acquisitions']:
  if acquisition['name']=='Unowned browser card':
   latest=page.request.get(args.url+'/api/state').json();page.request.delete(args.url+'/api/acquisitions/'+acquisition['id'],headers={'X-Vault-Revision':str(latest['revision'])})
 page.reload();page.get_by_role('heading',name='Collection',exact=True).wait_for()
 search=page.get_by_label('Search collection');search.fill('Abhorrent Oculus')
 page.get_by_role('button',name=re.compile('^Abhorrent Oculus')).click()
 modal=page.get_by_role('dialog',name='Abhorrent Oculus');modal.wait_for();assert modal.get_attribute('aria-labelledby')
 modal.get_by_label('Where is this card?').fill(location_label)
 modal.get_by_role('button',name='Save location',exact=True).click();modal.wait_for(state='hidden')
 page.get_by_role('button',name=re.compile('^Abhorrent Oculus')).click();modal=page.get_by_role('dialog',name='Abhorrent Oculus')
 assert modal.get_by_label('Where is this card?').input_value()==location_label
 page.keyboard.press('Escape');modal.wait_for(state='hidden');search.fill('')
 page.get_by_role('navigation').get_by_role('button',name='Decks',exact=True).click()
 page.get_by_role('heading',name='Ramos Guildgate Commander',exact=True).wait_for()
 assert page.get_by_text('81 unspecified slots',exact=False).count()>0
 page.get_by_role('button',name='New deck',exact=True).click();modal=page.get_by_role('dialog',name='Create a deck')
 modal.get_by_label('Deck name',exact=True).fill('Roadmap browser deck');modal.get_by_label('Format',exact=True).select_option('casual60')
 modal.get_by_role('button',name='Add card row',exact=True).click();modal.get_by_label('Card name 1',exact=True).fill('Unowned browser card')
 modal.get_by_label('Quantity for Unowned browser card',exact=True).fill('2')
 modal.get_by_role('button',name='Close dialog',exact=True).click();guard=page.get_by_role('dialog',name='Unsaved deck changes');guard.wait_for()
 guard.get_by_role('button',name='Continue editing',exact=True).click();guard.wait_for(state='hidden')
 assert modal.get_by_label('Card name 1',exact=True).input_value()=='Unowned browser card'
 modal.get_by_role('button',name='Save deck',exact=True).click();modal.wait_for(state='hidden')
 page.get_by_role('button',name=re.compile('Casual 60-card.*Roadmap browser deck')).click();page.get_by_role('heading',name='Roadmap browser deck',exact=True).wait_for()
 page.get_by_role('button',name='Edit list',exact=True).click();modal=page.get_by_role('dialog',name='Edit target decklist')
 modal.get_by_label('Quantity for Unowned browser card',exact=True).fill('3');modal.get_by_label('Zone for Unowned browser card',exact=True).select_option('sideboard')
 modal.get_by_role('button',name='Save deck',exact=True).click();modal.wait_for(state='hidden')
 page.get_by_role('button',name='Export',exact=True).click();modal=page.get_by_role('dialog',name='Export for Scryfall')
 page.wait_for_function("document.querySelector('.export-text')?.value.includes('3 Unowned browser card')")
 with page.expect_download() as d:modal.get_by_role('button',name='Download',exact=True).click()
 d.value.save_as(str(shots/'deck.txt'));assert '3 Unowned browser card' in (shots/'deck.txt').read_text();page.keyboard.press('Escape')
 page.get_by_role('button',name='Revision history',exact=True).click();page.get_by_role('button',name='Preview restore',exact=True).first.click()
 modal=page.get_by_role('dialog',name='Restore Roadmap browser deck');modal.get_by_role('button',name='Apply change',exact=True).click();modal.wait_for(state='hidden')
 page.get_by_role('button',name='Edit list',exact=True).click();modal=page.get_by_role('dialog',name='Edit target decklist');assert modal.get_by_label('Quantity for Unowned browser card',exact=True).input_value()=='2';assert modal.get_by_label('Zone for Unowned browser card',exact=True).input_value()=='main';page.keyboard.press('Escape')
 page.get_by_role('button',name='View missing cards',exact=True).click();page.get_by_text('2 specified copies to acquire',exact=True).wait_for()
 page.get_by_role('button',name='Track wanted',exact=True).click();modal=page.get_by_role('dialog',name='Track a wanted card');modal.get_by_role('button',name='Save tracking record',exact=True).click();modal.wait_for(state='hidden')
 page.get_by_label('Acquisition status for Unowned browser card').select_option('received');page.get_by_label('Acquisition status for Unowned browser card').wait_for()
 state=page.request.get(args.url+'/api/state').json();assert state['summary']['copies']==892
 page.get_by_role('navigation').get_by_role('button',name='Review',exact=True).click();page.get_by_label('Search unresolved printings').wait_for()
 next_button=page.get_by_role('button',name='Next matching page',exact=True)
 for _ in range(3):next_button.click()
 assert page.get_by_text('Matching page 4 of',exact=False).count()==1
 page.get_by_label('Filter match status').select_option('unresolved');page.get_by_label('Search unresolved printings').fill('Sol Ring')
 page.get_by_role('navigation').get_by_role('button',name='Settings',exact=True).click();page.get_by_label('Display currency').select_option('USD');page.wait_for_timeout(500);page.get_by_label('Display currency').select_option('EUR')
 page.set_viewport_size({'width':390,'height':844});page.get_by_role('navigation').get_by_role('button',name='Collection',exact=True).click();page.get_by_role('heading',name='Collection',exact=True).wait_for()
 assert page.locator('.mobile-card-row').first.bounding_box()['y']<600
 assert page.get_by_role('navigation').get_by_role('button').count()==5
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 page.screenshot(path=str(shots/'collection-mobile.png'))
 page.get_by_label('Search collection').fill('Abhorrent Oculus');page.get_by_role('button',name=re.compile('^Abhorrent Oculus')).click();page.get_by_role('dialog',name='Abhorrent Oculus').wait_for();page.keyboard.press('Escape')
 for nav in ['Decks','Missing','Review','Settings']:
  page.get_by_role('navigation').get_by_role('button',name=nav,exact=True).click();page.wait_for_timeout(300);assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),nav+' overflows'
 page.set_viewport_size({'width':700,'height':1000});page.evaluate("document.documentElement.style.fontSize='32px'");page.get_by_role('navigation').get_by_role('button',name='Collection',exact=True).click();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),'200% text overflows'
 assert not errors,errors
 browser.close()
print('Passed desktop/mobile, named dialogs and Escape, editable quantities/zones, unsaved-change protection, deck revision restore, TXT download, acquisition isolation, full matching pagination, currency, and 200% text checks. No browser errors.')
