"""Browser acceptance checks. Requires playwright and a Chromium executable."""
import argparse
import re
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='http://127.0.0.1:8765')
    parser.add_argument('--browser', default='/usr/bin/chromium')
    args = parser.parse_args()
    shots = Path(__file__).resolve().parents[1] / 'screenshots'
    shots.mkdir(exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=args.browser, headless=True,
            args=['--no-sandbox', '--disable-dev-shm-usage'])
        page = browser.new_page(viewport={'width': 1440, 'height': 1050}, device_scale_factor=1)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(args.url)
        page.get_by_role('heading', name='Collection', exact=True).wait_for()
        page.locator('.metric strong').first.wait_for()
        assert page.locator('.metric strong').first.inner_text() == '4'
        page.screenshot(path=str(shots / 'collection.png'), full_page=False)

        search = page.get_by_role('textbox', name='Search collection')
        search.fill('Lightning Bolt')
        page.get_by_role('button', name=re.compile('Lightning Bolt')).click()
        modal = page.get_by_role('dialog')
        modal.get_by_role('heading', name='Lightning Bolt').wait_for()
        assert modal.get_by_text('4 copies', exact=True).count() == 1
        assert modal.get_by_text('3 / 1', exact=True).count() == 1
        modal.get_by_role('button', name='Close dialog').click()
        search.fill('')

        page.get_by_role('navigation').get_by_role('button', name=re.compile('^Decks')).click()
        page.get_by_role('button', name='New deck').click()
        modal = page.get_by_role('dialog')
        modal.get_by_label('Deck name').fill('Browser smoke deck')
        modal.get_by_label('Format', exact=True).select_option('casual60')
        modal.get_by_label('Target decklist').fill('3 Unowned Browser Test Card')
        modal.get_by_role('button', name='Save deck').click()
        page.get_by_role('button', name=re.compile('Casual 60-card.*Browser smoke deck')).click()
        page.get_by_role('heading', name='Browser smoke deck', exact=True).wait_for()
        page.get_by_role('button', name='Edit list').click()
        modal = page.get_by_role('dialog')
        modal.get_by_label('Target decklist').fill('2 Unowned Browser Test Card')
        modal.get_by_role('button', name='Save deck').click()
        page.get_by_role('button', name='Export', exact=True).click()
        modal = page.get_by_role('dialog')
        exported = modal.get_by_role('textbox', name='Exported decklist')
        exported.wait_for()
        page.wait_for_function("document.querySelector('.export-text')?.value.includes('2 Unowned Browser Test Card')")
        with page.expect_download() as download:
            modal.get_by_role('button', name='Download .txt').click()
        target = shots / 'smoke-deck.txt'
        download.value.save_as(str(target))
        assert target.read_text().strip() == '2 Unowned Browser Test Card'
        target.unlink()
        modal.get_by_role('button', name='Close dialog').click()
        page.get_by_role('button', name='View missing cards').click()
        page.get_by_text('2 copies to acquire', exact=True).wait_for()
        page.get_by_role('button', name='Share copies', exact=True).click()
        page.get_by_text('2 copies to acquire', exact=True).wait_for()

        # Clean up the temporary target using the same local API as the UI.
        state = page.request.get(args.url + '/api/state').json()
        deck = next(d for d in state['decks'] if d['name'] == 'Browser smoke deck')
        result = page.request.delete(f'{args.url}/api/decks/{deck["id"]}')
        assert result.ok
        page.get_by_role('navigation').get_by_role('button', name=re.compile('^Import review')).click()
        page.get_by_role('heading', name=re.compile('^Workbook rows')).wait_for()
        page.get_by_text('No invalid source rows', exact=False).wait_for()
        page.screenshot(path=str(shots / 'import-review.png'), full_page=True)

        page.get_by_role('navigation').get_by_role('button', name='Settings', exact=True).click()
        assert page.get_by_label('Workbook path').input_value().endswith('sample-inventory.xlsx')
        assert page.get_by_label('Display currency').input_value() == 'EUR'
        page.get_by_label('Display currency').select_option('USD')
        page.wait_for_function("document.querySelector('select')?.value === 'USD'")
        page.get_by_label('Display currency').select_option('EUR')

        # Small viewport and zoom-equivalent layout check.
        page.set_viewport_size({'width': 700, 'height': 1000})
        page.get_by_role('navigation').get_by_role('button', name='Collection', exact=True).click()
        page.get_by_role('heading', name='Collection', exact=True).wait_for()
        assert page.evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Page overflows its viewport'
        assert not errors, errors
        browser.close()
        print('Browser checks passed: collection, card details, deck create/edit, TXT download, missing cards, issue review, currency settings, and responsive layout. No JavaScript errors.')


if __name__ == '__main__':
    main()
