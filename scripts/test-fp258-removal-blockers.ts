/**
 * FP-258: removal-blocker messages and the 409 body shape (pure, no database).
 * Run: npx tsx scripts/test-fp258-removal-blockers.ts
 */
import {
  blockerResponseFields,
  blockersMessage,
  conflictBody,
  describeBlockers,
  hasBlockers,
  EMPTY_BLOCKERS,
  LAST_ADMIN_DEMOTION_MESSAGE,
  type RemovalBlockers,
} from '../src/features/members/removalBlockers';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures++;
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const B = (p: Partial<RemovalBlockers>): RemovalBlockers => ({ ...EMPTY_BLOCKERS, ...p });

console.log('=== hasBlockers');
check('empty -> false', !hasBlockers(EMPTY_BLOCKERS));
check('lastAdmin only -> true', hasBlockers(B({ lastAdmin: true })));
check('each count alone -> true',
  hasBlockers(B({ assignedMemberCount: 1 })) && hasBlockers(B({ ownedGroupCount: 1 })) && hasBlockers(B({ ownedEventCount: 1 })));

console.log('\n=== exact sentences, self audience');
check('none -> no sentences', eq(describeBlockers(EMPTY_BLOCKERS, 'self'), []) && blockersMessage(EMPTY_BLOCKERS, 'self') === '');
check('self lastAdmin', eq(describeBlockers(B({ lastAdmin: true }), 'self'),
  ["You are this community's only Administrator. Make another member an Administrator first, or email support@flockpulse.ca to close the community."]));
check('self leads 1', eq(describeBlockers(B({ assignedMemberCount: 1 }), 'self'),
  ['You lead 1 member. Ask your Administrator to assign them to another leader first.']));
check('self leads 3', eq(describeBlockers(B({ assignedMemberCount: 3 }), 'self'),
  ['You lead 3 members. Ask your Administrator to assign them to another leader first.']));
check('self groups 1 / 2', eq(describeBlockers(B({ ownedGroupCount: 1 }), 'self'),
  ['You own 1 group. Ask your Administrator to give them to someone else first.'])
  && eq(describeBlockers(B({ ownedGroupCount: 2 }), 'self'),
  ['You own 2 groups. Ask your Administrator to give them to someone else first.']));
check('self events 1 / 4', eq(describeBlockers(B({ ownedEventCount: 1 }), 'self'),
  ['You own 1 upcoming event. Ask your Administrator to give them to someone else first.'])
  && eq(describeBlockers(B({ ownedEventCount: 4 }), 'self'),
  ['You own 4 upcoming events. Ask your Administrator to give them to someone else first.']));

console.log('\n=== exact sentences, admin audience');
check('admin lastAdmin', eq(describeBlockers(B({ lastAdmin: true }), 'admin'),
  ["This is the community's only Administrator. Make another member an Administrator first."]));
check('admin leads 1 / 2', eq(describeBlockers(B({ assignedMemberCount: 1 }), 'admin'),
  ['This member leads 1 member. Reassign them first.'])
  && eq(describeBlockers(B({ assignedMemberCount: 2 }), 'admin'), ['This member leads 2 members. Reassign them first.']));
check('admin groups 1 / 2', eq(describeBlockers(B({ ownedGroupCount: 1 }), 'admin'),
  ['This member owns 1 group. Give them to someone else first.'])
  && eq(describeBlockers(B({ ownedGroupCount: 2 }), 'admin'), ['This member owns 2 groups. Give them to someone else first.']));
check('admin events 1 / 2', eq(describeBlockers(B({ ownedEventCount: 1 }), 'admin'),
  ['This member owns 1 upcoming event. Give them to someone else first.'])
  && eq(describeBlockers(B({ ownedEventCount: 2 }), 'admin'), ['This member owns 2 upcoming events. Give them to someone else first.']));

console.log('\n=== all together: order is last Admin, members led, groups, events');
const all = B({ lastAdmin: true, assignedMemberCount: 2, ownedGroupCount: 1, ownedEventCount: 3 });
const allAdmin = describeBlockers(all, 'admin');
check('admin: 4 sentences in order', allAdmin.length === 4 && /only Administrator/.test(allAdmin[0]) && /leads 2 members/.test(allAdmin[1])
  && /owns 1 group\./.test(allAdmin[2]) && /3 upcoming events/.test(allAdmin[3]));
check('admin: message joins with a space', blockersMessage(all, 'admin') === allAdmin.join(' '));
const allSelf = describeBlockers(all, 'self');
check('self: 4 sentences in order', allSelf.length === 4 && /only Administrator/.test(allSelf[0]) && /lead 2 members/.test(allSelf[1])
  && /own 1 group\./.test(allSelf[2]) && /3 upcoming events/.test(allSelf[3]));
check('two blocks only (leads + groups)', describeBlockers(B({ assignedMemberCount: 1, ownedGroupCount: 1 }), 'admin').length === 2);

console.log('\n=== no ids and no names in any message');
const combos: RemovalBlockers[] = [];
for (const la of [false, true]) for (const m of [0, 1, 5]) for (const g of [0, 1, 5]) for (const e of [0, 1, 5]) {
  combos.push({ lastAdmin: la, assignedMemberCount: m, ownedGroupCount: g, ownedEventCount: e });
}
const msgs: string[] = [LAST_ADMIN_DEMOTION_MESSAGE];
for (const c of combos) for (const a of ['self', 'admin'] as const) msgs.push(blockersMessage(c, a));
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
check(`${msgs.length} messages checked: none has a uuid or hex id`, msgs.every(m => !uuid.test(m)));
check('none contains "Cannot deactivate" / "still owns" (raw database text)', msgs.every(m => !/Cannot deactivate|still owns|still assigned|reassign them first/.test(m)));
check('demotion message text', LAST_ADMIN_DEMOTION_MESSAGE ===
  "This is the community's only Administrator, so their role can't be changed. Make another member an Administrator first.");

console.log('\n=== 409 body shape: zeros omitted, lastAdmin true or omitted');
check('counts 0 -> omitted', eq(blockerResponseFields(EMPTY_BLOCKERS), {}));
check('only positive counts are sent', eq(blockerResponseFields(B({ assignedMemberCount: 2, ownedEventCount: 1 })), { assignedMemberCount: 2, ownedEventCount: 1 }));
check('lastAdmin true is sent, false omitted',
  eq(blockerResponseFields(B({ lastAdmin: true })), { lastAdmin: true }) && !('lastAdmin' in blockerResponseFields(B({ lastAdmin: false }))));
const body = conflictBody({ message: 'm', ...B({ ownedGroupCount: 1 }) });
check('conflictBody: code + message + only the present count',
  eq(body, { error: { code: 'INVALID_STATE_TRANSITION', message: 'm', ownedGroupCount: 1 } }));
check('conflictBody serialized has no undefined/zero count keys',
  !/assignedMemberCount|ownedEventCount|lastAdmin/.test(JSON.stringify(body)) && !/":0/.test(JSON.stringify(body)));
const demotion = conflictBody({ message: LAST_ADMIN_DEMOTION_MESSAGE, lastAdmin: true } as never);
check('role PATCH 409: demotion message + lastAdmin',
  eq(demotion, { error: { code: 'INVALID_STATE_TRANSITION', message: LAST_ADMIN_DEMOTION_MESSAGE, lastAdmin: true } }));

console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
