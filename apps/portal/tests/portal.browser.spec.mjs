import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import http from 'node:http';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startPortal } from '../src/server.mjs';
import { exportPortal } from '../src/export.mjs';
import { openModel, searchIndex } from '../src/model.mjs';
import { searchPage } from '../../../library/src/search.mjs';
import { atlas, propose, changes, reason, files, record, check, sources } from './fixture.mjs';

// The reader in a browser, at a wide and a narrow window, on the fixture Atlas and on a real one
// (Meta-Atlas, or the Atlas ATLAS_BROWSER_ATLAS names): a margin item opens a panel and Close
// gives the focus back, panels nest, a link in the main column goes to its page, a Facet has a
// page, a Point and a Decision named by their kind, Outline, Help, search, the keyboard, a proposed
// change, the pages without the script (the help page among them), and an
// export under a sub-path. At every step the page passes axe, does not scroll sideways and keeps
// to the two patterns as drawn. Screenshots go to ATLAS_BROWSER_SHOTS, or beside the results.
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const results = process.env.ATLAS_BROWSER_RESULTS ?? path.join(repo, 'tmp/portal-browser');
const shots = process.env.ATLAS_BROWSER_SHOTS ?? path.join(results, 'screenshots');
const sizes = [['1440', { width: 1440, height: 900 }], ['375', { width: 375, height: 812 }]];
const sites = {};
const cleanups = [];
const problems = new WeakMap();

/**
 * The Points of a real Atlas the walk opens, each chosen for its step: one whose margin holds a development with a
 * margin of its own (the nested panel), one with a Facet said of it that draws on a claim and another claim in its
 * margin to open first (the Facet panel), and one whose prose refers to a claim its outline does not show (navigation).
 */
/** What a search for `query` lists, as the Library ranks the model's index: the line that ends the list when some are left out, or null. */
function shownOf(model, query) {
  const { results, available } = searchPage(searchIndex(model).records, { query, limit: 12, presentation: 'summary' });
  return available > results.length ? `${results.length} of ${available} shown` : null;
}

function walkOf(model) {
  const { points, facets, accounts } = model.atlas;
  const outlined = point => new Set([point.id, ...point.above, ...point.children, ...(point.parent === null ? [] : points.get(point.parent).children)]);
  const pick = (step, fits) => {
    const found = [...points.values()].find(fits);
    if (!found) throw new Error(`This Atlas has no Point for the ${step}.`);
    return found;
  };
  const nest = pick('nested panel: a Point with a development that develops further', point => point.children.some(id => points.get(id).children.length));
  const development = nest.children.map(id => points.get(id)).find(child => child.children.length);
  const drawing = point => point.attached.find(key => facets.get(key).targets.length);
  const host = pick('Facet panel: a Point with a Facet that draws on a claim, and another claim in its margin', point => drawing(point) && (point.parent !== null || point.children.length));
  const facet = facets.get(drawing(host));
  const linking = pick('navigation: a Point whose prose refers to a claim its outline does not show', point => point.linksTo.some(id => !outlined(point).has(id)));
  return {
    nest: { page: nest.id, title: nest.title, development: development.id, developmentTitle: development.title, nested: development.children[0], nestedTitle: points.get(development.children[0]).title },
    facet: { page: host.id, key: facet.key, title: facet.title, kind: `${accounts.get(facet.account).title} · Facet, seen from ${accounts.get(facet.via).title}`, target: facet.targets[0] },
    plain: { page: pick('kind: a Point without a Type', point => !point.standing).id },
    decision: [...points.values()].filter(point => point.standing?.type === 'decision').map(point => ({ page: point.id, kind: `Decision · ${point.standing.status}` }))[0] ?? null,
    link: { page: linking.id, referred: linking.linksTo.find(id => !outlined(linking).has(id)) },
    query: development.title, found: development.id, shown: shownOf(model, development.title),
  };
}

test.beforeAll(async () => {
  await mkdir(shots, { recursive: true });
  const fixture = await atlas({ after: cleanup => cleanups.push(cleanup) }, records => {
    records.set('.checks/tone.md', check('tone', 'Every claim is a plain sentence'));
    records.set('.checks/hours.md', check('hours', 'Every sailing has an hour', { level: 'required' }));
    // A long log, so that a cited section lies far down the log's own page; the section the count cites keeps its stamp.
    records.set('sources/log.md', `${sources['sources/log.md']}${Array.from({ length: 30 }, (_, index) => `## Week ${46 + index}\n\n${'Every crossing sailed on the hour. '.repeat(12).trim()}\n`).join('\n')}`);
    records.set('trees/vessel/points/engine.md', records.get('trees/vessel/points/engine.md').replace('#week-46', '#week-70'));
  });
  const draft = await propose(fixture.root, changes(), reason);
  // A change to the Atlas itself and to what it is held to, with an account's file rewritten while nothing in it differs.
  const held = await propose(fixture.root, [
    { path: 'atlas.json', content: `${JSON.stringify({ ...JSON.parse(files().get('atlas.json')), title: 'The harbour ferry', trees: ['trees/vessel', 'trees/service', 'trees/harbour'] }, null, 2)}\n` },
    { path: '.checks/tone.md', content: null },
    { path: '.checks/dates.md', content: check('dates', 'Every observation carries its date') },
    { path: '.checks/hours.md', content: check('hours', 'Every sailing has an hour and a quay', { status: 'retired', level: 'required', requirement: 'Each sailing names its hour and its quay.' }) },
    { path: 'trees/harbour/tree.json', content: `${JSON.stringify(JSON.parse(files().get('trees/harbour/tree.json')), null, 4)}\n` },
  ], 'Lead with the vessel, and hold observations to their dates');
  // A change whose Atlas as proposed does not validate: what it writes is named by its files.
  const broken = await propose(fixture.root, [{ path: 'trees/service/points/fog.md', content: files().get('trees/service/points/fog.md').replace('"status":"selected"', '"status":"perhaps"') },
    { path: 'trees/service/points/stray.md', content: record({ id: 'service-stray' }, 'A claim placed nowhere', 'Nothing develops it.') }], 'Leave the decision open, and add a claim');
  // A change the Library refuses for itself: it alters the Style together with an account.
  const refused = await propose(fixture.root, [{ path: 'style.md', content: '# Plain accounts, dated\n\nEach account states one claim and develops it.\n\nEvery observation carries its date.\n' },
    { path: 'trees/vessel/tree.json', content: files().get('trees/vessel/tree.json').replace('"title": "Vessel"', '"title": "The vessel"') }], 'Date every observation, and rename an account');
  sites.fixture = {
    portal: await startPortal(fixture.root, { timeZone: 'UTC' }), draft: draft.id, refused: refused.id, held: held.id, broken: broken.id,
    // The fixture's walk opens one Point for every step.
    walk: { nest: { page: 'service-fog', title: 'Sailings stop in fog below 200 metres', development: 'service-refund', developmentTitle: 'A stopped sailing is refunded in full & "at once"', nested: 'service-claim', nestedTitle: 'A refund is claimed at the quay office' },
      facet: { page: 'service-fog', key: 'service:fog-radar', title: 'The fog limit is the radar\'s reach', kind: 'Service · Facet, seen from Vessel', target: 'vessel-radar' },
      plain: { page: 'service-crew' }, decision: { page: 'service-fog', kind: 'Decision · selected' },
      link: { page: 'service-fog', referred: 'harbour-base' }, query: 'radar reach', found: 'vessel-radar', shown: shownOf(await openModel(fixture.root), 'radar reach') },
  };
  const real = path.resolve(process.env.ATLAS_BROWSER_ATLAS ?? path.join(repo, 'meta-atlas'));
  sites.atlas = { portal: await startPortal(real), walk: walkOf(await openModel(real)) };

  // An export of the fixture, served under a sub-path by a plain static server.
  const output = path.join(results, 'export');
  await rm(output, { recursive: true, force: true });
  await exportPortal(fixture.root, output, { all: true });
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const server = http.createServer(async (request, response) => {
    const address = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (!address.startsWith('/kept/here/')) { response.writeHead(404); response.end(); return; }
    let file = path.join(output, address.slice('/kept/here/'.length));
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      response.writeHead(200, { 'Content-Type': `${types[path.extname(file)]}; charset=utf-8` });
      response.end(await readFile(file));
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  sites.export = { url: `http://127.0.0.1:${server.address().port}/kept/here/`, close: () => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }) };
  cleanups.push(() => rm(output, { recursive: true, force: true }));
});
test.afterAll(async () => {
  await sites.fixture?.portal.close();
  await sites.atlas?.portal.close();
  await sites.export?.close();
  for (const cleanup of cleanups) await cleanup();
});
test.beforeEach(async ({ page }) => {
  problems.set(page, []);
  page.on('pageerror', error => problems.get(page).push(error.message));
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) problems.get(page).push(message.text()); });
});
test.afterEach(async ({ page }) => {
  expect(problems.get(page), 'no errors or warnings in the console').toEqual([]);
});

const shot = (page, name, options = {}) => page.screenshot({ path: path.join(shots, `${name}.png`), ...options });
const fragment = page => new URL(page.url()).hash;
/**
 * The two patterns, as the page is drawn: outside a margin every name is an underlined link; in a
 * margin every name carries ▸ (▾ when open) and no underline; a native disclosure carries the same
 * marks and none stands in a margin; the only things with a border that can be pressed or typed in
 * are Outline, Help, Close and the search field; and nothing is opened inside a margin.
 */
async function patterns(page) {
  const broken = await page.evaluate(() => {
    const shown = element => element.getClientRects().length > 0;
    const underlined = element => getComputedStyle(element).textDecorationLine.includes('underline');
    const mark = element => getComputedStyle(element, '::before').content;
    const bordered = element => ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(getComputedStyle(element)[`border${side}Width`]) > 0);
    const name = element => (element.getAttribute('aria-label') ?? element.textContent).trim().slice(0, 60);
    const found = [];
    for (const link of document.querySelectorAll('a')) {
      if (!shown(link) || link.matches('a.control')) continue;
      // What cites a source is listed in its page's margin as names that go, as in any list.
      if (link.closest('.cited')) {
        if (link.matches('.opens') || !underlined(link) || !/^(?:none|normal)$/.test(mark(link))) found.push(`in what cites a source, not an underlined name: ${name(link)}`);
      } else if (link.closest('.margin')) {
        if (!link.matches('.opens') || underlined(link) || !mark(link).includes(link.getAttribute('aria-expanded') === 'true' ? '▾' : '▸')) found.push(`in a margin, not a name that opens: ${name(link)}`);
      } else if (link.matches('.opens') || !(underlined(link) || [...link.querySelectorAll('.claim')].some(underlined)) || !/^(?:none|normal)$/.test(mark(link))) found.push(`outside a margin, not an underlined name: ${name(link)}`);
    }
    for (const summary of document.querySelectorAll('summary')) {
      if (!shown(summary)) continue;
      if (!mark(summary).includes(summary.parentElement.open ? '▾' : '▸') || underlined(summary)) found.push(`a disclosure without its mark: ${name(summary)}`);
      if (summary.closest('.margin')) found.push(`a disclosure inside a margin: ${name(summary)}`);
    }
    for (const control of document.querySelectorAll('a, button, input, summary, select, textarea, [tabindex], [role="button"], [contenteditable]')) {
      if (!shown(control)) continue;
      const one = control.matches('.strip .control, button.close, .ask > input');
      if (bordered(control) !== one) found.push(`${one ? 'without its border' : 'a border on what is not Outline, Help, Close or the search field'}: ${name(control)}`);
      if (control.matches('button') && (underlined(control) || !['Outline', '?', 'Close'].includes(control.textContent))) found.push(`a button that is not Outline, Help or Close, or is underlined: ${name(control)}`);
    }
    if (document.querySelector('.margin .panel, .margin dialog, .margin details')) found.push('something opens inside a margin');
    return found;
  });
  expect(broken, 'the two patterns hold as drawn').toEqual([]);
}
async function sound(page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  expect(violations.map(item => `${item.id}: ${item.nodes.map(node => node.target.join(' ')).join(', ')}`)).toEqual([]);
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: window.innerWidth }));
  expect(scroll, 'no sideways scroll').toBeLessThanOrEqual(width);
  const small = await page.evaluate(() => {
    const size = (element, part) => parseFloat(getComputedStyle(element, part).fontSize);
    const found = [];
    for (const element of document.querySelectorAll('body *')) {
      if (!element.getClientRects().length) continue;
      if ([...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim()) && size(element) < 10) found.push(`${size(element)}px: ${element.textContent.trim().slice(0, 40)}`);
      for (const part of ['::before', '::after']) if (!/^(?:none|normal)$/.test(getComputedStyle(element, part).content) && size(element, part) < 10) found.push(`${size(element, part)}px ${part}: ${element.textContent.trim().slice(0, 40)}`);
    }
    return found;
  });
  expect(small, 'nothing is set below 10px').toEqual([]);
  await patterns(page);
}
async function focusShown(page) {
  expect(await page.evaluate(() => { const style = getComputedStyle(document.activeElement); return `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor}`; })).toBe('solid 2px rgb(61, 98, 136)');
}

for (const [label, viewport] of sizes) for (const which of ['fixture', 'atlas']) {
  test(`${which} at ${label}: a reader opens panels from the margin, goes by links, jumps by Outline, reads Help and searches`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { portal, walk } = sites[which];
    const at = id => new URL(`${id}/`, portal.url).href, address = at(walk.nest.page);
    const item = (within, token) => within.locator(`:scope > .row > .margin a.opens[data-open="${token}"]`);
    const doc = page.locator('main.doc');

    await page.goto(portal.url);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Search the Points and Facets' })).toBeVisible();
    await sound(page);
    await shot(page, `${which}-home-${label}`);
    await page.locator('details.outline > summary').first().click();
    await sound(page);
    await shot(page, `${which}-home-outline-${label}`);

    // A page names the kind of record it shows: a Point without a Type as a Point, a Decision by its Type and standing.
    await page.goto(at(walk.plain.page));
    await expect(page.locator('article [data-standing]')).toHaveText('Point');
    await sound(page);
    await shot(page, `${which}-plain-point-${label}`);
    if (walk.decision) {
      await page.goto(at(walk.decision.page));
      await expect(page.locator('article [data-standing]')).toHaveText(walk.decision.kind);
      await sound(page);
      await shot(page, `${which}-decision-${label}`);
    }

    await page.goto(address);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(walk.nest.title);
    const margin = page.getByRole('navigation', { name: 'Where this stands' });
    await expect(margin.locator('[aria-current="page"]')).toHaveText(walk.nest.title);
    await expect(margin.locator('[aria-current="page"]')).not.toHaveAttribute('href');
    await sound(page);
    await shot(page, `${which}-point-${label}`);

    // A margin item opens a panel in the main column, under the Point; Close gives the focus back to the item.
    const development = item(doc, walk.nest.development);
    await expect(development).toHaveAttribute('aria-expanded', 'false');
    await development.click();
    const panel = doc.locator(':scope > .panel');
    await expect(panel.locator(':scope > .row > .point > h2 a')).toHaveText(walk.nest.developmentTitle);
    await expect(panel.locator(':scope > .row > .point > h2 a')).toHaveAttribute('href', new RegExp(`/${walk.nest.development}/$`));
    await expect(panel.locator(':scope > .row .body').first()).toBeInViewport();
    await expect(development).toHaveAttribute('aria-expanded', 'true');
    await expect(margin.locator('.panel')).toHaveCount(0);
    expect(fragment(page)).toBe(`#${walk.nest.development}`);
    await sound(page);
    await shot(page, `${which}-panel-${label}`);
    await panel.locator(':scope > .row').getByRole('button', { name: 'Close' }).click();
    await expect(panel).toHaveCount(0);
    await expect(development).toHaveAttribute('aria-expanded', 'false');
    await expect(development).toBeFocused();
    await expect(development).toBeInViewport();
    expect(fragment(page)).toBe('');

    // A panel has its own margin, and an item there opens inside the panel: panels nest.
    await development.click();
    const inner = item(panel, walk.nest.nested);
    await inner.click();
    const nested = panel.locator(':scope > .panel');
    await expect(nested.locator(':scope > .row > .point > h2 a')).toHaveText(walk.nest.nestedTitle);
    await expect(inner).toHaveAttribute('aria-expanded', 'true');
    expect(fragment(page)).toBe(`#${walk.nest.development}/${walk.nest.nested}`);
    await sound(page);
    await shot(page, `${which}-nested-${label}`);
    // Escape closes the innermost panel, and only it.
    await page.keyboard.press('Escape');
    await expect(nested).toHaveCount(0);
    await expect(panel).toHaveCount(1);
    await expect(inner).toBeFocused();
    expect(fragment(page)).toBe(`#${walk.nest.development}`);

    // One thing is open per margin: a Facet opened from the same margin replaces the panel and all under it.
    let opened = development;
    if (walk.facet.page === walk.nest.page) {
      await inner.click();
      await expect(nested).toHaveCount(1);
    } else {
      await page.goto(at(walk.facet.page));
      opened = doc.locator(`:scope > .row > .margin a.opens:not([data-open="${walk.facet.key}"])`).first();
      await opened.click();
      await expect(panel).toHaveCount(1);
    }
    await item(doc, walk.facet.key).click();
    await expect(panel.locator(':scope > .row > .point > h2 a')).toHaveText(walk.facet.title);
    await expect(doc.locator('.panel')).toHaveCount(1);
    await expect(panel.locator(':scope > .row > .point .kind .cap')).toHaveText(walk.facet.kind);
    await expect(panel.getByRole('heading', { name: /^Said of/ })).toHaveCount(0);
    await expect(item(panel, walk.facet.target)).toBeVisible();
    await expect(opened).toHaveAttribute('aria-expanded', 'false');
    expect(fragment(page)).toBe(`#${walk.facet.key}`);
    await sound(page);
    await shot(page, `${which}-facet-panel-${label}`);

    // A link in the main column goes to the page it names, and opens nothing.
    await panel.locator(':scope > .row > .point > h2 a').click();
    await expect(page).toHaveURL(new RegExp(`/_/facet/${walk.facet.key.replace(':', '/')}/$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(walk.facet.title);
    await expect(page.getByRole('heading', { name: /^Said of/ })).toBeVisible();
    await sound(page);
    await shot(page, `${which}-facet-page-${label}`);
    // On a Facet's page Outline opens at the Point it is said of, and marks no Point as the page.
    await page.getByRole('button', { name: 'Outline' }).click();
    await expect(page.getByRole('dialog', { name: 'Outline' }).locator(`a[data-id="${walk.facet.page}"]`)).toBeInViewport();
    await expect(page.getByRole('dialog', { name: 'Outline' }).locator('[aria-current]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.goto(at(walk.link.page));
    await item(doc, walk.link.referred).click();
    await expect(panel).toHaveCount(1);
    await page.locator(`article[data-point] > [data-prose] a[href$="/${walk.link.referred}/"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/${walk.link.referred}/$`));
    await expect(page.locator('.panel')).toHaveCount(0);

    // A page loaded with a fragment opens the chain the fragment names.
    await page.goto(portal.url);
    await page.goto(`${address}#${walk.nest.development}/${walk.nest.nested}`);
    await expect(nested.locator(':scope > .row > .point > h2 a')).toHaveText(walk.nest.nestedTitle);
    await expect(nested).toBeInViewport();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(doc.locator('.panel')).toHaveCount(0);
    await expect(development).toBeFocused();

    // Outline: the reader's place is marked, Escape closes it and the focus returns.
    const contents = page.getByRole('button', { name: 'Outline' });
    await expect(contents).toHaveText('Outline');
    await contents.click();
    const dialog = page.getByRole('dialog', { name: 'Outline' });
    await expect(dialog.getByRole('heading', { name: 'Outline' })).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[aria-current="page"]')).toHaveText(walk.nest.title);
    await expect(dialog.locator('[aria-current="page"]')).toBeInViewport();
    await expect(dialog.locator('details[open]')).toHaveCount(1);
    await sound(page);
    await shot(page, `${which}-outline-${label}`);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(contents).toBeFocused();
    await contents.click();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toHaveCount(0);
    await contents.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(3, 3);
    await expect(dialog).toHaveCount(0);

    // Help: the words, the moves and the marks over the page, from "?" at the right end of the strip; Escape, Close and
    // a click outside close it, and each time the focus returns to "?".
    const help = page.getByRole('button', { name: 'Help' });
    await expect(help).toHaveText('?');
    expect(await page.evaluate(() => {
      const strip = document.querySelector('.strip'), tools = strip.lastElementChild, help = tools.lastElementChild;
      const right = element => element.getBoundingClientRect().right;
      return tools.matches('.tools') && help.matches('button.help') && [...strip.querySelectorAll('a, button, input')].every(other => right(other) <= right(help) + 0.5);
    }), '"?" ends the strip, the last of the reader\'s tools at its right').toBe(true);
    await help.click();
    const helpDialog = page.getByRole('dialog', { name: 'Help' });
    await expect(helpDialog).toBeVisible();
    await expect(helpDialog.getByRole('heading', { level: 2 })).toHaveText(['Help', 'The words', 'Moving around', 'The marks']);
    await expect(helpDialog.locator('dt')).toHaveText(['Atlas', 'Tree', 'Point', 'Decision', 'Observation', 'Facet', 'An underlined name', 'A name with ▸', 'Next', 'Outline', 'Search', 'Escape',
      'new, changed, removed', 'stamped', '△ changed since this was checked', '✗ missing', '○ not checked here', '↗']);
    await expect(helpDialog.getByRole('button', { name: 'Close' })).toBeFocused();
    await sound(page);
    await shot(page, `${which}-help-${label}`);
    await page.keyboard.press('Escape');
    await expect(helpDialog).toHaveCount(0);
    await expect(help).toBeFocused();
    await help.click();
    await helpDialog.getByRole('button', { name: 'Close' }).click();
    await expect(helpDialog).toHaveCount(0);
    await expect(help).toBeFocused();
    await help.click();
    await expect(helpDialog).toBeVisible();
    await page.mouse.click(3, 3);
    await expect(helpDialog).toHaveCount(0);
    await expect(help).toBeFocused();
    // The help page itself, with the script: drawn as every page is, its strip without "?", which would lead to itself.
    await page.goto(new URL('_/help/', portal.url).href);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Help');
    await expect(page.getByRole('button', { name: 'Help' })).toHaveCount(0);
    await sound(page);
    await shot(page, `${which}-help-page-${label}`);
    await page.goto(address);

    // Search goes to a page.
    await page.keyboard.press('/');
    const field = page.getByRole('searchbox', { name: 'Search the Points and Facets' });
    await expect(field).toBeFocused();
    await field.fill(walk.query);
    const hit = page.locator(`.results a[href$="/${walk.found}/"]`);
    await expect(hit).toBeVisible();
    // Each result carries an excerpt of its text to choose by, and at most twelve are listed.
    expect(await page.locator('.results li').count()).toBeLessThanOrEqual(12);
    for (const words of await page.locator('.results a .excerpt').allTextContents()) expect(words.trim().length, 'an excerpt under each result').toBeGreaterThan(0);
    await expect(page.locator('.results a .excerpt')).toHaveCount(await page.locator('.results li').count());
    // When more match than are listed, the list ends by saying how many of how many it shows.
    if (walk.shown) await expect(page.locator('.results > p.says')).toHaveText(walk.shown);
    else await expect(page.locator('.results > p.says')).toHaveCount(0);
    await sound(page);
    await shot(page, `${which}-search-${label}`);
    await hit.click();
    await expect(page).toHaveURL(new RegExp(`/${walk.found}/$`));
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  });
}

for (const [label, viewport] of sizes) {
  test(`a proposed change at ${label}: what differs is listed, and a Point reads as proposed with its differences`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { portal, draft } = sites.fixture;
    await page.goto(portal.url);
    await expect(page.getByRole('heading', { name: 'Proposed changes' })).toBeVisible();
    await page.getByRole('link', { name: reason }).click();
    await expect(page).toHaveURL(new RegExp(`/_/draft/${draft}/$`));
    await expect(page.getByText('Proposed change', { exact: true })).toBeVisible();
    await expect(page.getByText('Ready to apply')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What differs', exact: true })).toBeVisible();
    await expect(page.getByRole('searchbox')).toHaveCount(0);
    await sound(page);
    await shot(page, `draft-${label}`);

    await page.getByRole('link', { name: 'Sailings stop in fog below 300 metres' }).click();
    await expect(page).toHaveURL(new RegExp(`/_/draft/${draft}/service-fog/$`));
    await expect(page.locator('[data-prose] .added')).toContainText('The mate may also stop a sailing');
    await page.locator('[data-prose] .altered summary').click();
    await expect(page.locator('[data-prose] .altered .before')).toContainText('The master stops sailing when the far quay cannot be seen.');
    const margin = page.getByRole('navigation', { name: 'Where this stands' });
    await expect(margin.locator('[aria-current="page"]')).toHaveText('Sailings stop in fog below 300 metreschanged');
    await expect(margin.locator('a.opens[data-open="service:fog-radar"]')).toContainText('changed');
    await sound(page);
    await shot(page, `draft-point-${label}`);

    // Under a proposed change a margin item still opens here, as proposed, with what differs in it marked.
    await margin.locator('a.opens[data-open="service-refund"]').click();
    const panel = page.locator('main.doc > .panel');
    await expect(panel.locator('a.opens[data-open="service-notice"]')).toContainText('new');
    await expect(panel.locator('a.opens[data-open="service-claim"]')).toContainText('removed');
    await panel.locator('a.opens[data-open="service-claim"]').click();
    await expect(panel.locator('.panel .body .gone')).toContainText('The passenger shows the ticket at the quay office.');
    await sound(page);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await margin.locator('a.opens[data-open="service:fog-radar"]').click();
    await expect(panel.locator('.body .altered')).toContainText('the harbour authority now asks for 300 metres');
    await page.keyboard.press('Escape');
    await page.getByRole('link', { name: 'The Atlas as it is' }).click();
    await expect(page).toHaveURL(new RegExp('/service-fog/$'));
    await expect(page.getByText('Proposed change', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sailings stop in fog below 200 metres');

    // A change that cannot be applied says why, and what it proposes still reads: here, the Style.
    await page.goto(new URL(`_/draft/${sites.fixture.refused}/`, portal.url).href);
    await expect(page.getByText('Invalid: it cannot be applied as it stands')).toBeVisible();
    await expect(page.getByText('STYLE_CHANGE_ALONE')).toBeVisible();
    await expect(page.getByText('its title', { exact: true })).toBeVisible();
    await expect(page.getByText('To apply')).toHaveCount(0);
    await sound(page);
    await shot(page, `draft-invalid-${label}`);
    await page.getByRole('link', { name: 'Plain accounts, dated' }).click();
    await expect(page).toHaveURL(new RegExp(`/_/draft/${sites.fixture.refused}/_/style/$`));
    await expect(page.locator('.body .added')).toContainText('Every observation carries its date.');
    await sound(page);
    await shot(page, `draft-style-${label}`);
    // The Style has no page in the Atlas as it is: from the Style as proposed, the way back is home.
    await page.getByRole('link', { name: 'The Atlas as it is' }).click();
    await expect(page).toHaveURL(portal.url);
    await expect(page.getByText('Proposed change', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Written as')).toHaveCount(0);

    // A change to the Atlas itself opens what differs, in words; each Check that differs shows its text, and under it one "Before" with what differs of what it was.
    await page.goto(new URL(`_/draft/${sites.fixture.held}/`, portal.url).href);
    const first = page.locator('ol.accounts > li').first();
    await expect(first.locator('h3')).toHaveText('This Atlaschanged');
    await expect(first.getByText('its title, the order of its Trees', { exact: true })).toBeVisible();
    await expect(first.locator('ol.order > li')).toHaveText(['Vessel', 'Service', 'Harbour']);
    await expect(page.getByText('its file only', { exact: true })).toBeVisible();
    const hours = page.locator('.held', { hasText: 'Every sailing has an hour and a quay' });
    await expect(hours.locator('> .body')).toContainText('Each sailing names its hour and its quay.');
    const was = hours.locator('> .before');
    await expect(was).toHaveCount(1);
    await expect(was).not.toHaveAttribute('open');
    await was.locator('summary').click();
    await expect(was.locator('.named')).toHaveText('Every sailing has an hour');
    await expect(was.locator('.cap')).toHaveText('Required · active');
    await expect(was.locator('.body')).toContainText('It holds.');
    await expect(page.locator('.held', { hasText: 'Every claim is a plain sentence' }).locator('> .named.gone')).toBeVisible();
    await sound(page);
    await shot(page, `draft-held-${label}`, { fullPage: true });

    // A change whose Atlas as proposed does not validate names what it writes by its files, and none of them is a link.
    await page.goto(new URL(`_/draft/${sites.fixture.broken}/`, portal.url).href);
    await expect(page.getByRole('heading', { name: 'Files', exact: true })).toBeVisible();
    await expect(page.locator('.claims .file')).toHaveText(['trees/service/points/fog.md', 'trees/service/points/stray.md']);
    await expect(page.locator('.claims a')).toHaveCount(0);
    await sound(page);
    await shot(page, `draft-files-${label}`, { fullPage: true });
  });
}

for (const [label, viewport] of sizes) {
  test(`a cited source at ${label}: its page shows the file as it is now, lands on the section cited, and leads back to what cites it`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const { portal } = sites.fixture;
    await page.goto(new URL('vessel-engine/', portal.url).href);
    await page.locator('details.rests > summary').click();
    const cited = page.locator('.sources a', { hasText: 'sources/log.md#week-70' });
    await expect(cited).toHaveAttribute('href', '../_/source/?uri=sources%2Flog.md%23week-70#week-70');
    await sound(page);
    await cited.click();
    await expect(page).toHaveURL(/\/_\/source\/\?uri=sources%2Flog\.md%23week-70#week-70$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('sources/log.md');
    const section = page.locator('#week-70');
    await expect(section).toHaveText('Week 70');
    await expect(section).toBeInViewport();
    await expect(page.getByRole('heading', { level: 1 })).not.toBeInViewport();
    expect(await page.evaluate(() => document.querySelector(':target')?.id), 'the cited section is the target').toBe('week-70');
    expect(fragment(page), 'the script leaves the fragment as it is').toBe('#week-70');
    await sound(page);
    await shot(page, `fixture-source-${label}`);
    const margin = page.getByRole('navigation', { name: 'What cites it' });
    await expect(margin.getByRole('link')).toHaveText(['The ferry sails on the hour while the harbour is open', 'Forty crossings were counted in the first week of November', 'The engine holds < 5 knots at idle']);
    await margin.getByRole('link', { name: 'Forty crossings were counted in the first week of November' }).click();
    await expect(page).toHaveURL(/\/service-count\/$/);
    // The last Point of a Tree leads on to the top Point of the next, under that Tree's name.
    await expect(page.locator('.onward .cap')).toHaveText('Next, in Vessel');
    await expect(page.locator('.onward a')).toHaveAttribute('href', '../vessel-base/');
    await sound(page);
    await shot(page, `fixture-tree-end-${label}`, { fullPage: true });
    // Prose that names a file the Atlas cites goes to that file's page, landing on the section it names.
    await page.goto(new URL('service-fog/', portal.url).href);
    await page.locator('[data-prose] a', { hasText: 'the crossing log' }).click();
    await expect(page).toHaveURL(/\/_\/source\/\?uri=sources%2Flog\.md%23week-45#week-45$/);
    await expect(page.locator('#week-45')).toBeInViewport();
  });
}

test('the keyboard alone reaches everything, in reading order, with focus shown', async ({ page }) => {
  const { portal } = sites.fixture;
  await page.goto(new URL('service-fog/', portal.url).href);
  const stops = [];
  for (let stop = 0; stop < 6; stop++) {
    await page.keyboard.press('Tab');
    stops.push(await page.evaluate(() => document.activeElement.getAttribute('aria-label') ?? document.activeElement.textContent.trim()));
    await focusShown(page);
  }
  expect(stops).toEqual(['Harbour ferry', 'Outline', 'Search the Points and Facets', 'Help', 'the radar\'s reach', 'how the limit follows the radar']);

  // A margin item, opened and closed from the keyboard; the focus returns to it.
  const development = page.locator('nav.margin a.opens[data-open="service-refund"]');
  await development.focus();
  await page.keyboard.press('Enter');
  const panel = page.locator('main.doc > .panel');
  await expect(panel.locator('.body')).toBeVisible();
  await expect(development).toBeFocused();
  await expect(development).toHaveAttribute('aria-expanded', 'true');
  // The panel follows the margin in reading order: its Close, its title, then its own margin.
  const after = [];
  for (let stop = 0; stop < 40 && after.at(-1) !== 'A refund is claimed at the quay office'; stop++) {
    await page.keyboard.press('Tab');
    after.push(await page.evaluate(() => document.activeElement.textContent.trim()));
  }
  expect(after.slice(-4)).toEqual(['Close', 'A stopped sailing is refunded in full & "at once"', 'The quay office', 'A refund is claimed at the quay office']);
  await focusShown(page);
  await page.keyboard.press('Enter');
  await expect(panel.locator('.panel .body')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel.locator('.panel')).toHaveCount(0);
  await expect(panel.locator('a.opens[data-open="service-claim"]')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect(development).toBeFocused();

  // Outline holds the focus while it is open, and gives it back.
  const contents = page.getByRole('button', { name: 'Outline' });
  await contents.focus();
  await page.keyboard.press('Space');
  const dialog = page.getByRole('dialog', { name: 'Outline' });
  await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement.closest('dialog')))).toBe(true);
  await focusShown(page);
  await page.keyboard.press('Escape');
  await expect(contents).toBeFocused();
  // So does Help, opened from the keyboard.
  const help = page.getByRole('button', { name: 'Help' });
  await help.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Help' }).getByRole('button', { name: 'Close' })).toBeFocused();
  await focusShown(page);
  await page.keyboard.press('Escape');
  await expect(help).toBeFocused();

  // Search: the slash, the arrows, Escape, and Enter to a page.
  await page.keyboard.press('/');
  const field = page.getByRole('searchbox', { name: 'Search the Points and Facets' });
  await expect(field).toBeFocused();
  // A result names its Tree and its kind, as its panel does: a Point's Type and standing, or Point, or the Tree a Facet is seen from.
  await page.keyboard.type('sailing');
  await expect(page.locator('.results a[href$="/service-fog/"] .cap')).toHaveText('Service · Decision · selected');
  await expect(page.locator('.results a[href$="/service-count/"] .cap')).toHaveText('Service · Observation · 3 November 2026');
  await expect(page.locator('.results a[href$="/service-refund/"] .cap')).toHaveText('Service · Point');
  await expect(page.locator('.results a[href$="/_/facet/service/gale/"] .cap')).toHaveText('Service · Facet, seen from Harbour');
  await expect(page.locator('.results > p.says')).toHaveCount(0);
  await shot(page, 'fixture-search-standing-1440');
  // When more match than twelve, the list says so, and it is neither a result nor a link.
  await field.fill('the');
  await expect(page.locator('.results > p.says')).toHaveText('12 of 15 shown');
  await expect(page.locator('.results li')).toHaveCount(12);
  await page.locator('.results > p.says').scrollIntoViewIfNeeded();
  await sound(page);
  await shot(page, 'fixture-search-count-1440');
  await field.fill('');
  await page.keyboard.type('quay office');
  await expect(page.locator('.results a').first()).toBeVisible();
  await expect(page.locator('.results a').first().locator('.excerpt')).toHaveText('The passenger shows the ticket at the quay office.');
  await expect(page.locator('.results a[href$="/service-refund/"] .excerpt'), 'the excerpt reads as words, without the marks of a link').toHaveText('The fare is returned the same day. The quay office pays it.');
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.results a').first()).toBeFocused();
  await focusShown(page);
  await page.keyboard.press('ArrowUp');
  await expect(field).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(field).toHaveValue('');
  await expect(page.locator('.results')).toBeHidden();
  await page.keyboard.press('/');
  await page.keyboard.type('quay office');
  await expect(page.locator('.results a').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/service-claim\/$/);
});

test('the pages read without the script: every name is a link to a page', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const { portal } = sites.fixture;
  await page.goto(new URL('service-fog/', portal.url).href);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sailings stop in fog below 200 metres');
  const margin = page.getByRole('navigation', { name: 'Where this stands' });
  await expect(margin.getByRole('link')).toHaveText(['The ferry sails on the hour while the harbour is open', 'The timetable holds in daylight', 'A stopped sailing is refunded in full & "at once"', 'The fog limit is the radar\'s reach', 'The radar reaches 200 metres in fog', 'The harbour authority closes the mouth in a gale', 'A red light at the mole means closed', 'The radar is kept running for the fog rule']);
  await expect(page.getByRole('searchbox')).toHaveCount(0);
  await shot(page, 'fixture-point-without-script-1440');
  await margin.getByRole('link', { name: 'The fog limit is the radar\'s reach' }).click();
  await expect(page).toHaveURL(/\/_\/facet\/service\/fog-radar\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('The fog limit is the radar\'s reach');
  await expect(page.locator('[data-prose]')).toContainText('The service stops where the radar stops seeing.');
  await page.getByRole('navigation', { name: 'Where this stands' }).getByRole('link', { name: 'The radar reaches 200 metres in fog' }).click();
  await expect(page).toHaveURL(/\/vessel-radar\/$/);
  // Help is a page of its own, which "?" leads to.
  await page.getByRole('link', { name: 'Help' }).click();
  await expect(page).toHaveURL(/\/_\/help\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Help');
  await expect(page.locator('[data-help] dt')).toHaveCount(18);
  await expect(page.locator('[data-help] h2')).toHaveText(['The words', 'Moving around', 'The marks']);
  await expect(page.getByRole('link', { name: 'Help' })).toHaveCount(0);
  await patterns(page);
  await shot(page, 'fixture-help-without-script-1440');
  await page.goBack();
  await expect(page).toHaveURL(/\/vessel-radar\/$/);
  await page.getByRole('link', { name: 'Outline' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbour ferry');
  await page.locator('details.outline > summary').first().click();
  await expect(page.getByRole('link', { name: 'A refund is claimed at the quay office' })).toBeVisible();
  await page.getByRole('link', { name: 'The ferry sails on the hour while the harbour is open' }).click();
  await expect(page.locator('details.rests .sources').first()).toBeHidden();
  await page.locator('details.rests > summary').click();
  await expect(page.locator('details.rests .sources').first()).toBeVisible();
  await patterns(page);

  // A proposed change reads without the script too: what differs, and each Point as proposed.
  await page.goto(portal.url);
  await page.getByRole('link', { name: reason }).click();
  await expect(page.getByText('its scope', { exact: true })).toBeVisible();
  await expect(page.getByText('When the harbour authority opens and closes the mouth, and how it says so.')).toBeVisible();
  await patterns(page);
  await shot(page, 'draft-without-script-1440');
  await page.getByRole('link', { name: 'Sailings stop in fog below 300 metres' }).click();
  await expect(page.locator('[data-prose] .altered .before > p')).toBeHidden();
  await page.locator('[data-prose] .altered summary').click();
  await expect(page.locator('[data-prose] .altered .before > p')).toBeVisible();
  await patterns(page);
  await page.getByRole('navigation', { name: 'Where this stands' }).getByRole('link', { name: 'A stopped sailing is refunded' }).click();
  await expect(page).toHaveURL(new RegExp(`/_/draft/${sites.fixture.draft}/service-refund/$`));
  await expect(page.getByRole('navigation', { name: 'Where this stands' }).getByRole('link', { name: 'A refund is claimed at the quay office' })).toContainText('removed');
  await context.close();
});

test('an export reads the same under a sub-path', async ({ page }) => {
  await page.goto(sites.export.url);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Harbour ferry');
  await expect(page.getByRole('heading', { name: 'Proposed changes' })).toHaveCount(0);
  await sound(page);
  await page.getByRole('link', { name: 'The ferry sails on the hour while the harbour is open' }).click();
  await expect(page).toHaveURL(`${sites.export.url}service-base/`);
  await page.locator('nav.margin a.opens[data-open="service-timetable"]').click();
  const panel = page.locator('main.doc > .panel');
  await expect(panel.locator('.body')).toContainText('Between sunrise and sunset');
  await panel.locator('a.opens[data-open="service:gale"]').click();
  await expect(panel.locator('.panel .body')).toContainText('When the harbour closes, no sailing leaves');
  await panel.locator('.panel > .row > .point > h2 a').click();
  await expect(page).toHaveURL(`${sites.export.url}_/facet/service/gale/`);
  await page.getByRole('button', { name: 'Outline' }).click();
  await expect(page.getByRole('dialog', { name: 'Outline' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Help' }).click();
  await expect(page.getByRole('dialog', { name: 'Help' }).locator('dt').first()).toHaveText('Atlas');
  await page.keyboard.press('Escape');
  // A Facet found by search goes to its page under the sub-path too.
  await page.getByRole('searchbox', { name: 'Search the Points and Facets' }).fill('gale closes the timetable');
  await expect(page.locator('.results a').first()).toHaveAttribute('href', `${sites.export.url}_/facet/service/gale/`);
  await page.getByRole('searchbox', { name: 'Search the Points and Facets' }).fill('red light mole');
  await page.locator('.results a').first().click();
  await expect(page).toHaveURL(`${sites.export.url}harbour-signal/`);
  await sound(page);
  await shot(page, 'export-point-1440');
});
