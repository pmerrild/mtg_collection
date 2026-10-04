"""Collection workflows against seeded disposable local Worker storage only."""
import argparse,csv,io,re,time
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
parser=argparse.ArgumentParser();parser.add_argument('--url',default='http://127.0.0.1:4182');args=parser.parse_args()
shots=Path('/tmp/mtg-collection-qa');shots.mkdir(exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1440,'height':1050});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(args.url+'/#collection');page.get_by_role('heading',name='Collection',exact=True).wait_for()
 initial=page.request.get(args.url+'/api/state').json();owned=initial['summary']['copies']
 for view in initial['saved_filters']:
  if view['name'].startswith('QA advanced '):
   latest=page.request.get(args.url+'/api/state').json();page.request.delete(args.url+'/api/filters/'+view['id'],headers={'X-Vault-Revision':str(latest['revision'])})
 page.reload();page.get_by_role('heading',name='Collection',exact=True).wait_for()
 page.get_by_role('button',name=re.compile('^Filters')).click()
 colors=page.get_by_role('dialog',name='Filters and saved views').get_by_role('group',name='Colors',exact=True)
 colors.get_by_label('Blue',exact=True).check();colors.get_by_label('Black',exact=True).check();page.get_by_label('Colors match mode').select_option('all')
 page.get_by_label('Owned copies min').fill('2');page.get_by_role('dialog',name='Filters and saved views').get_by_role('button',name=re.compile('^Show .* printings$')).click();page.get_by_label('Sort collection',exact=True).select_option('quantity')
 page.wait_for_function("location.hash.includes('color_mode=all')&&location.hash.includes('quantity_min=2')")
 bookmarked=page.url
 page.get_by_role('button',name=re.compile('^Filters')).click();page.get_by_role('button',name='Save current filters',exact=True).click();dialog=page.get_by_role('dialog',name='Save collection view');view='QA advanced '+str(time.time_ns());dialog.get_by_label('View name',exact=True).fill(view);dialog.get_by_role('button',name='Save view',exact=True).click();dialog.wait_for(state='hidden')
 page.get_by_role('dialog',name='Filters and saved views').get_by_role('button',name='Cancel',exact=True).click();page.get_by_role('button',name='Clear filters',exact=True).last.click();page.get_by_role('button',name=re.compile('^Filters')).click();page.get_by_role('button',name=view,exact=True).click()
 assert 'color=' not in page.url
 page.get_by_role('dialog',name='Filters and saved views').get_by_role('button',name='Cancel',exact=True).click();assert 'color=' not in page.url
 page.get_by_role('button',name=re.compile('^Filters')).click();page.get_by_role('button',name=view,exact=True).click();page.get_by_role('dialog',name='Filters and saved views').get_by_role('button',name=re.compile('^Show .* printings$')).click()
 assert page.get_by_label('Sort collection',exact=True).input_value()=='quantity'
 page.reload();page.get_by_role('heading',name='Collection',exact=True).wait_for();page.get_by_role('button',name=re.compile('^Filters')).click();assert page.get_by_label('Colors match mode').input_value()=='all';assert page.get_by_label('Owned copies min').input_value()=='2'
 page.get_by_role('dialog',name='Filters and saved views').get_by_role('button',name='Cancel',exact=True).click();page.get_by_role('button',name='Remove Colors filter',exact=True).click();assert 'color=' not in page.url
 page.get_by_role('button',name='Clear filters',exact=True).last.click()
 page.get_by_role('checkbox',name='Select current page',exact=True).check();page.get_by_role('button',name='Next page',exact=True).click();page.get_by_role('checkbox',name=re.compile('^Select ')).nth(1).check()
 assert page.get_by_text('31 selected',exact=True).count()==1
 page.get_by_role('button',name='Actions',exact=True).click();page.get_by_role('dialog',name='Selected printing actions').get_by_role('button',name='Export selected',exact=True).click();dialog=page.get_by_role('dialog',name='Export for Scryfall');dialog.get_by_label('Export file format').select_option('csv');page.wait_for_function("document.querySelector('.export-text')?.value.includes('printing_key')")
 content=dialog.get_by_label('Exported decklist').input_value();assert len(list(csv.DictReader(io.StringIO(content.lstrip('\ufeff')))))==31
 with page.expect_download() as download:dialog.get_by_role('button',name='Download',exact=True).click()
 assert download.value.suggested_filename.endswith('.csv');page.keyboard.press('Escape')
 page.get_by_role('button',name='Actions',exact=True).click();page.get_by_role('dialog',name='Selected printing actions').get_by_role('button',name='Set location',exact=True).click();dialog=page.get_by_role('dialog',name='Set storage location');dialog.get_by_text('Review selected printings',exact=True).click();assert dialog.locator('.bulk-review li').count()==31
 label='Bulk QA '+str(time.time_ns());dialog.get_by_label('New storage location',exact=True).fill(label);dialog.get_by_role('button',name='Apply to 31 printings',exact=True).click();dialog.wait_for(state='hidden')
 collection=page.request.get(args.url+'/api/collection').json();assert sum(c['location']==label for c in collection)==31
 page.get_by_role('button',name='Actions',exact=True).click();page.get_by_role('dialog',name='Selected printing actions').get_by_role('button',name='Keep copies',exact=True).click();dialog=page.get_by_role('dialog',name='Set copies to keep')
 latest=page.request.get(args.url+'/api/state').json();card=collection[0];assert page.request.patch(args.url+'/api/locations',headers={'X-Vault-Revision':str(latest['revision'])},data={'key':card['key'],'location':'Concurrent QA'}).ok
 dialog.get_by_label('Keep at least this many copies per printing',exact=True).fill('4');dialog.get_by_role('button',name='Apply to 31 printings',exact=True).click();dialog.get_by_role('alert').wait_for();assert 'another tab' in dialog.get_by_role('alert').inner_text();dialog.get_by_role('button',name='Cancel',exact=True).click()
 page.get_by_label('Collection actions',exact=True).click();page.get_by_role('button',name='Reload collection',exact=True).click();page.wait_for_timeout(300)
 page.get_by_role('button',name='Clear selection',exact=True).click();page.get_by_role('button',name=re.compile('^Filters')).click();page.get_by_label('Collection view',exact=True).select_option('duplicates');page.get_by_role('dialog',name='Filters and saved views').get_by_role('button',name=re.compile('^Show .* printings$')).click()
 duplicate=page.request.get(args.url+'/api/collection').json();candidate=next(c for c in duplicate if c['quantity']>1 and c['tradeable']>0)
 page.get_by_label('Search collection').fill(candidate['name']);page.get_by_role('checkbox',name='Select '+candidate['name']+' '+candidate['printing_key'],exact=True).check()
 page.get_by_role('button',name='Actions',exact=True).click();page.get_by_role('dialog',name='Selected printing actions').get_by_role('button',name='Keep copies',exact=True).click();dialog=page.get_by_role('dialog',name='Set copies to keep');dialog.get_by_label('Keep at least this many copies per printing',exact=True).fill(str(candidate['quantity']));dialog.get_by_role('button',name='Apply to 1 printings',exact=True).click();dialog.wait_for(state='hidden')
 updated=page.request.get(args.url+'/api/collection').json();assert next(c for c in updated if c['key']==candidate['key'])['tradeable']==0
 page.get_by_role('button',name='Actions',exact=True).click();page.get_by_role('dialog',name='Selected printing actions').get_by_role('button',name='Track wanted',exact=True).click();dialog=page.get_by_role('dialog',name='Track wanted copies');dialog.get_by_label('Wanted quantity per printing',exact=True).fill('2');dialog.get_by_label('Finish',exact=True).select_option('foil');dialog.get_by_role('button',name='Apply to 1 printings',exact=True).click();dialog.wait_for(state='hidden')
 assert page.request.get(args.url+'/api/state').json()['summary']['copies']==owned
 page.get_by_role('button',name='Clear filters',exact=True).last.click();page.get_by_role('button',name=re.compile('^Filters')).click();page.get_by_label('Collection view',exact=True).select_option('trade');page.get_by_role('dialog',name='Filters and saved views').get_by_role('button',name=re.compile('^Show .* printings$')).click();page.get_by_label('Collection actions',exact=True).click();page.get_by_role('button',name='Export',exact=True).click();dialog=page.get_by_role('dialog',name='Export for Scryfall');page.wait_for_function("document.querySelector('.export-text')?.value.length>0")
 expected=sum(c['tradeable'] for c in page.request.get(args.url+'/api/collection').json());actual=sum(int(line.split(' ',1)[0]) for line in dialog.get_by_label('Exported decklist').input_value().splitlines());assert actual==expected;page.keyboard.press('Escape');expect(page.get_by_label('Collection actions',exact=True)).to_be_focused()
 page.set_viewport_size({'width':390,'height':844});page.get_by_role('button',name=re.compile('^Filters')).click();page.get_by_label('Collection view',exact=True).select_option('');page.get_by_role('dialog',name='Filters and saved views').get_by_role('button',name=re.compile('^Show .* printings$')).click();page.wait_for_timeout(100)
 assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');assert page.locator('.mobile-card-row').first.bounding_box()['y']<600
 page.get_by_role('checkbox',name=re.compile('^Select ')).nth(1).check();page.screenshot(path=str(shots/'selected-mobile.png'))
 page.get_by_role('button',name=re.compile('^Filters')).click();assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.get_by_label('Reservations',exact=True).select_option('none');page.screenshot(path=str(shots/'filters-mobile.png'))
 page.keyboard.press('Escape');page.set_viewport_size({'width':700,'height':1000});page.evaluate("document.documentElement.style.fontSize='32px'");assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
 assert not errors,errors
 browser.close()
print('Passed advanced filters, chips, bookmark reload, saved sort, selection across pages, selected CSV download, bulk preview/location, stale-write rejection, keep preferences, wanted tracking, trade export quantities, mobile selection, and 200% text; ownership unchanged.')
