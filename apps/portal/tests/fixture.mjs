// A small fictional Atlas for the Portal's tests: a harbour ferry, told in three accounts.
// It holds one of everything the reader shows.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDirectory } from '../../../tests/support/temp.mjs';
import { prepareChangeFromDisk, saveDraft } from '../../../library/src/authoring.mjs';

const json = value => `${JSON.stringify(value, null, 2)}\n`;
export const sha256 = text => createHash('sha256').update(text).digest('hex');

/** A Point or a Facet as its file holds it: a JSON header, the title and the prose. */
export const record = (header, title, body) => `---\n${JSON.stringify(header)}\n---\n# ${title}\n\n${body}\n`;
/** A Check as its file holds it: its header, its title and its four sections; `requirement` says what it holds the Atlas to. */
export const check = (id, title, { status = 'active', level = 'advisory', requirement = 'It holds.' } = {}) =>
  `---\n${JSON.stringify({ id, status, level })}\n---\n# ${title}\n\n## Requirement\n\n${requirement}\n\n## Verification\n\nA reader looks.\n\n## Failure\n\nIt does not hold.\n`;
const style = '# Plain accounts\n\nEach account states one claim and develops it. See [the rules](https://example.org/rules).\n';

/** Save a proposed change: `changes` is `[{ path, content }]`, content null to remove a file. Returns the saved draft. */
export async function propose(root, changes, reason) {
  return saveDraft(root, { plan: await prepareChangeFromDisk(root, { changes, reason }) });
}

export const policy = '# Company policy\n\nRefunds are paid the same day.\n';
/** The section of the crossing log that a reference with the fragment `#week-45` cites. */
export const week = '## Week 45\n\nForty crossings, none late.\n';
export const sources = {
  'sources/log.md': `# Crossing log\n\n${week}`,
  'sources/notice.md': '# Harbour notice\n\nThe mouth closes in a gale.\n',
  'sources/chart.md': '# Chart\n\nDepths at the mouth.\n',
};

const fogBody = `The master stops sailing when the far quay cannot be seen. The limit is
[the radar's reach](../../vessel/points/radar.md), and the choice is explained in
[how the limit follows the radar](../facets/fog-radar.md).

A stopped sailing is [refunded](refund.md). The harbour's own
[closing rule](../../harbour/points/base.md) is a separate matter, set out in the
[harbour rules](https://example.org/harbour-rules) and recorded in
[the crossing log](../../../sources/log.md#week-45).

<script>alert('authored')</script>

<img src="x" onerror="alert(1)">

![Chart of the harbour mouth](chart.png) and a [bad link](javascript:alert(1)).

| Visibility | Sailing |
| --- | --- |
| 200 metres or more | on the hour |
| less | stopped |

\`\`\`
fog < 200 m: stop
\`\`\`
`;

/** Every authored file of the fixture, by path. */
export function files() {
  return new Map([
    ['atlas.json', json({ format: 'atlas/1.2', id: 'ferry', title: 'Harbour ferry', trees: ['trees/service', 'trees/vessel', 'trees/harbour'] })],
    ['style.md', style],
    ['trees/service/tree.json', json({ id: 'service', title: 'Service', scope: 'What a passenger can rely on, and where that stops.', base: 'service-base', children: [
      { point: 'service-timetable', children: [{ point: 'service-fog', children: [{ point: 'service-refund', children: [{ point: 'service-claim' }] }] }] },
      { point: 'service-crew' },
      { point: 'service-count' },
    ] })],
    ['trees/service/points/base.md', record({ id: 'service-base', sources: [
      { uri: 'sources/log.md', title: 'Crossing log', role: 'evidence', locator: 'Week 45', sha256: sha256(sources['sources/log.md']) },
      { uri: 'sources/notice.md', title: 'Harbour notice', role: 'background', sha256: sha256('an earlier notice') },
      { uri: 'sources/gone.md', role: 'example', sha256: sha256('What it held.\n') },
      { uri: 'sources/chart.md', role: 'implementation' },
      { uri: '../outside/policy.md', title: 'Company policy', role: 'history', sha256: sha256(policy) },
      { uri: 'https://example.org/harbour-rules', title: 'Harbour rules' },
    ], uncertainty: 'Whether the hourly sailing holds in winter is not recorded.' }, 'The ferry sails on the hour while the harbour is open', 'A passenger can plan on a sailing every hour. [The timetable](timetable.md) says when that holds.')],
    ['trees/service/points/timetable.md', record({ id: 'service-timetable' }, 'The timetable holds in daylight', 'Between sunrise and sunset the ferry leaves on the hour. [Fog](fog.md) is the one exception the master decides.')],
    ['trees/service/points/fog.md', record({ id: 'service-fog', type: 'decision', status: 'selected', uncertainty: 'The 200 metre figure was not measured on this vessel.' }, 'Sailings stop in fog below 200 metres', fogBody)],
    ['trees/service/points/refund.md', record({ id: 'service-refund' }, 'A stopped sailing is refunded in full & "at once"', 'The fare is returned the same day. [The quay office](claim.md) pays it.')],
    ['trees/service/points/claim.md', record({ id: 'service-claim' }, 'A refund is claimed at the quay office', 'The passenger shows the ticket at the quay office.')],
    ['trees/service/points/crew.md', record({ id: 'service-crew' }, 'Two crew sail every crossing', 'A master and a deckhand are aboard on every crossing.')],
    ['trees/service/points/count.md', record({ id: 'service-count', type: 'observation', observedAt: '2026-11-03', sources: [{ uri: 'sources/log.md#week-45', role: 'evidence', sha256: sha256(week) }] }, 'Forty crossings were counted in the first week of November', 'The log shows forty crossings and no late sailing.')],
    ['trees/service/facets/fog-radar.md', record({ id: 'fog-radar', on: 'service-fog', via: 'vessel', targets: ['vessel-radar'], uncertainty: 'The radar was last checked in 2025.' }, 'The fog limit is the radar\'s reach', 'The service stops where [the radar](../../vessel/points/radar.md) stops seeing. A longer reach would move the limit.')],
    ['trees/service/facets/gale.md', record({ id: 'gale', on: 'service-timetable', via: 'harbour', targets: ['harbour-base'], sources: [{ uri: 'sources/notice.md', title: 'Harbour notice', role: 'evidence' }] }, 'A gale closes the timetable too', 'When the harbour closes, no sailing leaves, whatever the hour.')],
    ['trees/vessel/tree.json', json({ id: 'vessel', title: 'Vessel', scope: 'What the hull and its instruments can do.', base: 'vessel-base', children: [{ point: 'vessel-radar' }, { point: 'vessel-engine' }] })],
    ['trees/vessel/points/base.md', record({ id: 'vessel-base' }, 'One hull carries sixty passengers', 'The ferry is a single hull licensed for sixty.')],
    ['trees/vessel/points/radar.md', record({ id: 'vessel-radar' }, 'The radar reaches 200 metres in fog', 'In fog the set resolves a quay wall at 200 metres.')],
    ['trees/vessel/points/engine.md', record({ id: 'vessel-engine', sources: [{ uri: 'sources/trials.md', title: 'Sea trials', role: 'evidence' }, { uri: 'sources/log.md#week-46', role: 'evidence' }] }, 'The engine holds < 5 knots at idle', 'At idle the vessel makes 4 knots, slower than [the timetable](../../service/points/timetable.md) needs.')],
    ['trees/vessel/facets/seats.md', record({ id: 'crew-seats', on: 'vessel-base', via: 'service', targets: ['service-crew'] }, 'Two of the sixty places are the crew\'s', 'The licence counts everyone aboard, so [two crew](../../service/points/crew.md) leave fifty-eight seats.')],
    ['trees/vessel/facets/duty.md', record({ id: 'radar-duty', on: 'vessel-radar', via: 'service', targets: ['service-fog'] }, 'The radar is kept running for the fog rule', 'Because the service stops by the radar\'s reach, the set runs on every crossing.')],
    ['trees/harbour/tree.json', json({ id: 'harbour', title: 'Harbour', scope: 'When the harbour authority opens and closes the mouth.', base: 'harbour-base', children: [{ point: 'harbour-signal' }] })],
    ['trees/harbour/points/base.md', record({ id: 'harbour-base' }, 'The harbour authority closes the mouth in a gale', 'Above force 8 the mouth is closed to all traffic.')],
    ['trees/harbour/points/signal.md', record({ id: 'harbour-signal' }, 'A red light at the mole means closed', 'The light is shown from the mole head, and [the ferry stops](../../service/points/fog.md) for it as it does for fog.')],
    ...Object.entries(sources),
  ]);
}

/**
 * Write the fixture into a fresh folder. Returns `{ root, workspace, write, remove }`: the Atlas root,
 * the folder that holds it (and `outside/`, which the Atlas cites but is not granted by default),
 * and functions that change one file under the root. The folder is removed when the test ends.
 */
export async function atlas(t, change = () => {}) {
  const workspace = await tempDirectory('portal-');
  const root = path.join(workspace, 'atlas');
  const write = async (file, content) => {
    await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await fs.writeFile(path.join(root, file), content);
  };
  const contents = files();
  change(contents);
  for (const [file, content] of contents) await write(file, content);
  await fs.mkdir(path.join(workspace, 'outside'));
  await fs.writeFile(path.join(workspace, 'outside/policy.md'), policy);
  t.after(() => fs.rm(workspace, { recursive: true, force: true }));
  return { root, workspace, write, remove: file => fs.rm(path.join(root, file)) };
}

export const reason = 'Stop sailing at 300 metres, and announce a stopped sailing at both quays';

/**
 * A proposed change that touches one of everything: a Point whose title, standing, prose and
 * uncertainty change; one whose sources change; a new Point; a removed one; a changed Facet;
 * and an account whose scope changes. Returns `[{ path, content }]` for `propose`.
 */
export function changes() {
  const records = files();
  const edit = (file, ...pairs) => {
    let text = records.get(file);
    for (let index = 0; index < pairs.length; index += 2) {
      if (!text.includes(pairs[index])) throw new Error(`The fixture no longer holds: ${pairs[index]}`);
      text = text.replace(pairs[index], pairs[index + 1]);
    }
    return { path: file, content: text };
  };
  const service = JSON.parse(records.get('trees/service/tree.json'));
  service.children[0].children[0].children[0].children = [{ point: 'service-notice' }];
  return [
    edit('trees/service/points/fog.md',
      '"status":"selected"', '"status":"proposed"',
      'The 200 metre figure was not measured on this vessel.', 'The 300 metre figure is the harbour authority\'s, not measured on this vessel.',
      'below 200 metres', 'below 300 metres',
      'The master stops sailing when the far quay cannot be seen.', 'The master stops sailing when the far quay cannot be seen from the bridge.',
      'A stopped sailing is [refunded](refund.md).', 'The mate may also stop a sailing when the master is ashore.\n\nA stopped sailing is [refunded](refund.md).',
      '```\nfog < 200 m: stop\n```\n', ''),
    edit('trees/service/points/base.md',
      '"locator":"Week 45"', '"locator":"Weeks 45 and 46"',
      `"sha256":"${sha256('an earlier notice')}"`, `"sha256":"${sha256(sources['sources/notice.md'])}"`,
      `{"uri":"sources/gone.md","role":"example","sha256":"${sha256('What it held.\n')}"},`, '{"uri":"sources/log.md#week-45","title":"The week in full","role":"example"},',
      ',"uncertainty":"Whether the hourly sailing holds in winter is not recorded."', ''),
    { path: 'trees/service/points/claim.md', content: null },
    { path: 'trees/service/points/notice.md', content: record({ id: 'service-notice' }, 'A stopped sailing is announced at both quays', 'A board at each quay shows the next sailing.') },
    { path: 'trees/service/tree.json', content: json(service) },
    edit('trees/service/facets/fog-radar.md', 'A longer reach would move the limit.', 'A longer reach would move the limit, and the harbour authority now asks for 300 metres.'),
    edit('trees/harbour/tree.json', 'When the harbour authority opens and closes the mouth.', 'When the harbour authority opens and closes the mouth, and how it says so.'),
  ];
}
