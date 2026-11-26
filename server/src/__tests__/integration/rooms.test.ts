/**
 * Rooms integration test.
 *
 * Boots the real server (Express + Socket.IO) on the embedded database and
 * drives it with real socket clients. No external services needed; the DM
 * falls back to template responses when no LLM key is set.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { io as connect, type Socket } from 'socket.io-client';
import type { AddressInfo } from 'net';
import type { AppContext } from '../../app';

// Keep this suite hermetic: embedded DB, no LLM, no action cooldown.
// Tests never call a real model, whatever the local .env says.
process.env.DM_PROVIDER = 'template';
// ...and are never locked behind a private server's access code.
process.env.ACCESS_CODE = '';
// Set to empty (not deleted) so a later .env load cannot bring the real values back.
for (const k of ['DATABASE_URL', 'DB_HOST', 'DB_PASSWORD', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY']) {
  process.env[k] = '';
}
process.env.ACTION_COOLDOWN_MS = '0';
process.env.ROOM_CREATE_LIMIT = '1000';
process.env.AUTH_LIMIT = '1000';

let ctx: AppContext;
let baseUrl: string;
const sockets: Socket[] = [];

const token = (n: number) => `test-player-token-${String(n).padStart(4, '0')}`;

function client(): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = connect(baseUrl, { transports: ['websocket'], forceNew: true });
    sockets.push(s);
    s.once('connect', () => resolve(s));
    s.once('connect_error', reject);
  });
}

function once<T = any>(s: Socket, event: string, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), ms);
    s.once(event, (data: T) => { clearTimeout(timer); resolve(data); });
  });
}

/** Resolves true if the event fires within ms, false otherwise. */
function heard(s: Socket, event: string, ms = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const handler = () => { clearTimeout(timer); resolve(true); };
    const timer = setTimeout(() => { s.off(event, handler); resolve(false); }, ms);
    s.once(event, handler);
  });
}

async function createRoom(): Promise<any> {
  const res = await fetch(`${baseUrl}/api/rooms`, { method: 'POST' });
  expect(res.status).toBe(201);
  return res.json();
}

async function join(s: Socket, code: string, n: number, characterId?: string, playerName = `Player ${n}`) {
  const confirmed = once(s, 'join_confirmed');
  // room_update is the last thing the server sends for a join, so waiting for it
  // means the opening narration and seat broadcast are no longer in flight.
  const settled = once(s, 'room_update');
  s.emit('join_room', { code, playerToken: token(n), playerName, characterId });
  await settled;
  return confirmed;
}

beforeAll(async () => {
  const { initializeDatabase } = await import('../../persistence');
  const { createApp } = await import('../../app');
  await initializeDatabase();
  ctx = createApp();
  await new Promise<void>(resolve => ctx.httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${(ctx.httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const s of sockets) s.disconnect();
  ctx.io.close();
  const { closeDatabase } = await import('../../persistence');
  await closeDatabase();
});

describe('rooms', () => {
  test('creating a table returns a code and four open seats', async () => {
    const room = await createRoom();
    expect(room.code).toMatch(/^[A-Z2-9]{5}$/);
    expect(room.seats).toHaveLength(4);
    expect(room.seats.every((s: any) => !s.taken)).toBe(true);

    const res = await fetch(`${baseUrl}/api/rooms/${room.code.toLowerCase()}`);
    expect(res.status).toBe(200);
    expect((await res.json()).code).toBe(room.code);
  });

  test('unknown table: 404 over HTTP, room_error over the socket', async () => {
    expect((await fetch(`${baseUrl}/api/rooms/ZZZZZ`)).status).toBe(404);
    const s = await client();
    const err = once(s, 'room_error');
    s.emit('join_room', { code: 'ZZZZZ', playerToken: token(99) });
    expect((await err).code).toBe('not_found');
  });

  test('each table gets its own campaign and characters', async () => {
    const a = await createRoom();
    const b = await createRoom();
    const idsA = new Set(a.seats.map((s: any) => s.characterId));
    expect(b.seats.some((s: any) => idsA.has(s.characterId))).toBe(false);
  });

  test('a seat can only be held by one player', async () => {
    const room = await createRoom();
    const seat = room.seats[0].characterId;
    const [p1, p2] = [await client(), await client()];

    const confirmed = await join(p1, room.code, 1, seat);
    expect(confirmed.characterId).toBe(seat);

    const err = once(p2, 'room_error');
    p2.emit('join_room', { code: room.code, playerToken: token(2), characterId: seat });
    expect((await err).code).toBe('seat_taken');

    const view = await (await fetch(`${baseUrl}/api/rooms/${room.code}`)).json();
    const taken = view.seats.find((s: any) => s.characterId === seat);
    expect(taken.taken).toBe(true);
    expect(taken.playerName).toBe('Player 1');
    expect(taken.connected).toBe(true);
  });

  test('seat updates are pushed to everyone at the table', async () => {
    const room = await createRoom();
    const [p1, p2] = [await client(), await client()];
    await join(p1, room.code, 1, room.seats[0].characterId);

    const update = once(p1, 'room_update');
    await join(p2, room.code, 2, room.seats[1].characterId);
    const view = await update;
    expect(view.seats.filter((s: any) => s.taken)).toHaveLength(2);
  });

  test('actions stay inside their own table', async () => {
    const [roomA, roomB] = [await createRoom(), await createRoom()];
    const [a1, a2, b1] = [await client(), await client(), await client()];
    await join(a1, roomA.code, 1, roomA.seats[0].characterId);
    await join(a2, roomA.code, 2, roomA.seats[1].characterId);
    await join(b1, roomB.code, 3, roomB.seats[0].characterId);

    const a2Action = once(a2, 'player_action');
    const a2Narration = once(a2, 'dm_narration');
    const a1Result = once(a1, 'action_result');
    const bHeardAction = heard(b1, 'player_action', 800);
    const bHeardNarration = heard(b1, 'dm_narration', 800);

    a1.emit('player_message', { message: 'I look around the village square.' });

    expect((await a2Action).content).toBe('I look around the village square.');
    expect((await a2Action).characterName).toBe(roomA.seats[0].name);
    expect((await a2Narration).content.length).toBeGreaterThan(0);
    expect((await a1Result).success).toBe(true);
    expect(await bHeardAction).toBe(false);
    expect(await bHeardNarration).toBe(false);
  });

  test('spectators cannot act', async () => {
    const room = await createRoom();
    const s = await client();
    const confirmed = await join(s, room.code, 1);
    expect(confirmed.characterId).toBeNull();
    const err = once(s, 'error');
    s.emit('player_message', { message: 'hello' });
    expect((await err).message).toContain('seat');
  });

  test('a dropped player keeps their seat and can reclaim it', async () => {
    const room = await createRoom();
    const seat = room.seats[2].characterId;
    const [p1, other] = [await client(), await client()];
    await join(other, room.code, 2);
    await join(p1, room.code, 1, seat);

    const dropped = once(other, 'room_update');
    p1.disconnect();
    const afterDrop = (await dropped).seats.find((s: any) => s.characterId === seat);
    expect(afterDrop.taken).toBe(true);
    expect(afterDrop.connected).toBe(false);

    // Someone else cannot grab it while it is being held...
    const err = once(other, 'room_error');
    other.emit('join_room', { code: room.code, playerToken: token(2), characterId: seat });
    expect((await err).code).toBe('seat_taken');

    // ...but the same player returns to it without naming it.
    const back = await client();
    const confirmed = await join(back, room.code, 1);
    expect(confirmed.characterId).toBe(seat);
  });

  test('an abandoned seat can be taken over after the hold expires', async () => {
    const room = await createRoom();
    const seat = room.seats[0].characterId;
    const p1 = await client();
    await join(p1, room.code, 1, seat);
    p1.disconnect();
    await new Promise(r => setTimeout(r, 100));

    const live = ctx.rooms.get(room.code)!;
    live.seats.get(seat)!.disconnectedAt = Date.now() - 60 * 60 * 1000;

    const p2 = await client();
    const confirmed = await join(p2, room.code, 2, seat);
    expect(confirmed.characterId).toBe(seat);
  });

  test('leaving gives the seat up', async () => {
    const room = await createRoom();
    const seat = room.seats[0].characterId;
    const [p1, watcher] = [await client(), await client()];
    await join(watcher, room.code, 2);
    await join(p1, room.code, 1, seat);

    const update = once(watcher, 'room_update');
    p1.emit('leave_room');
    expect((await update).seats.find((s: any) => s.characterId === seat).taken).toBe(false);
  });

  test("a player cannot move another player's token", async () => {
    const room = await createRoom();
    const [mine, theirs] = [room.seats[0].characterId, room.seats[1].characterId];
    const [p1, p2] = [await client(), await client()];
    await join(p1, room.code, 1, mine);
    await join(p2, room.code, 2, theirs);

    const forged = heard(p2, 'token_moved');
    p1.emit('move_token', { id: theirs, x: 3, y: 3 });
    expect(await forged).toBe(false);

    const real = once(p2, 'token_moved');
    p1.emit('move_token', { id: mine, x: 4, y: 5 });
    expect(await real).toEqual({ id: mine, x: 4, y: 5 });
  });

  test('actions on one table run one at a time', async () => {
    const room = await createRoom();
    const live = ctx.rooms.get(room.code)!;
    const order: string[] = [];
    const slow = ctx.rooms.enqueue(live, async () => {
      await new Promise(r => setTimeout(r, 60));
      order.push('first');
    });
    const fast = ctx.rooms.enqueue(live, async () => { order.push('second'); });
    await Promise.all([slow, fast]);
    expect(order).toEqual(['first', 'second']);
  });

  test('idle empty tables are swept, occupied ones are kept', async () => {
    const [empty, busy] = [await createRoom(), await createRoom()];
    const s = await client();
    await join(s, busy.code, 1);

    const future = Date.now() + 24 * 60 * 60 * 1000;
    ctx.rooms.sweep(future);
    expect(ctx.rooms.get(empty.code)).toBeUndefined();
    expect(ctx.rooms.get(busy.code)).toBeDefined();
  });

  test('joining sends the map and the health of the whole party', async () => {
    const room = await createRoom();
    const s = await client();
    const tokens = once<any[]>(s, 'tokens_update');
    const party = once<any[]>(s, 'party_update');
    await join(s, room.code, 1, room.seats[0].characterId);
    const ids = room.seats.map((x: any) => x.characterId).sort();
    expect((await tokens).map(t => t.id).sort()).toEqual(ids);
    expect((await tokens).every(t => t.type === 'pc' && Number.isInteger(t.x) && Number.isInteger(t.y))).toBe(true);
    expect((await party).map(m => m.characterId).sort()).toEqual(ids);
    expect((await party).every(m => m.hp.max > 0 && m.hp.current === m.hp.max)).toBe(true);
  });

  test('moves off the map or onto another token are refused and undone', async () => {
    const room = await createRoom();
    const [mine, other] = room.seats.map((x: any) => x.characterId);
    const s = await client();
    const tokens = once<any[]>(s, 'tokens_update');
    await join(s, room.code, 1, mine);
    const start = (await tokens).find(t => t.id === mine);
    const blocker = (await tokens).find(t => t.id === other);

    for (const target of [{ x: -1, y: 3 }, { x: 30, y: 3 }, { x: 3, y: 99 }, { x: blocker.x, y: blocker.y }, { x: 'a', y: 2 }]) {
      const rejected = once(s, 'move_rejected');
      const reset = once<any[]>(s, 'tokens_update');
      s.emit('move_token', { id: mine, ...target });
      await rejected;
      const back = (await reset).find(t => t.id === mine);
      expect({ x: back.x, y: back.y }).toEqual({ x: start.x, y: start.y });
    }
  });

  test('in a fight you move only on your turn and only as far as your speed', async () => {
    const room = await createRoom();
    const mine = room.seats[0].characterId;
    const live = ctx.rooms.get(room.code)!;
    const s = await client();
    await join(s, room.code, 1, mine);
    const speed = live.state._characters!.find(c => c.id === mine)!.speed ?? 30;
    const me = live.board.tokens.get(mine)!;
    const [x0, y0] = [me.x, me.y];

    const fighter = (id: string, sourceId: string, type: string, name: string) =>
      ({ id, sourceId, type, name, hp: { current: 7, max: 7 }, ac: 12, conditions: [], initiative: 10 });
    live.state.combatEncounter = {
      round: 1,
      currentTurnIndex: 0,
      initiativeOrder: [fighter('gob-1', 'gob-1', 'monster', 'Goblin'), fighter('pc-1', mine, 'pc', 'Hero')],
    } as any;
    ctx.rooms.syncTable(live);
    expect(live.board.tokens.get('gob-1')?.type).toBe('monster');

    // The goblin's turn: no moving.
    let rejected = once(s, 'move_rejected');
    s.emit('move_token', { id: mine, x: x0 + 1, y: y0 });
    await rejected;

    // My turn: within speed is fine, beyond it is not.
    (live.state.combatEncounter as any).currentTurnIndex = 1;
    const reach = Math.floor(speed / 5);
    s.emit('move_token', { id: mine, x: x0 + reach, y: y0 });
    rejected = once(s, 'move_rejected');
    s.emit('move_token', { id: mine, x: x0 + reach + 1, y: y0 });
    await rejected;
    expect({ x: me.x, y: me.y }).toEqual({ x: x0 + reach, y: y0 });

    // The fight ends: enemy tokens leave the map.
    live.state.combatEncounter = null;
    ctx.rooms.syncTable(live);
    expect(live.board.tokens.has('gob-1')).toBe(false);
  });

  test('the character creator lists every race and class', async () => {
    const options = await (await fetch(`${baseUrl}/api/character-options`)).json();
    expect(options.races).toHaveLength(9);
    expect(options.classes).toHaveLength(12);
    expect(options.classes.every((c: any) => c.blurb.length > 0)).toBe(true);
  });

  test('every race and class combination makes a playable character', async () => {
    const { buildCharacter, RACE_NAMES, CLASS_NAMES } = await import('../../rooms/character-builder');
    const { resolveCombatStats } = await import('../../combat/stat-resolver');
    for (const race of RACE_NAMES) {
      for (const klass of CLASS_NAMES) {
        const sheet = buildCharacter({ name: 'Test Hero', race, class: klass }) as any;
        expect(sheet.hp.max).toBeGreaterThan(0);
        expect(sheet.ac).toBeGreaterThanOrEqual(10);
        expect(sheet.speed).toBeGreaterThanOrEqual(25);
        expect(Object.values(sheet.abilities).every((a: any) => a.score >= 8 && a.score <= 17)).toBe(true);
        const stats = resolveCombatStats(sheet);
        expect(stats.primaryWeapon.name).not.toBe('Unarmed Strike');
        if (sheet.spellsKnown) expect(Object.keys(sheet.spellSlots ?? {}).length).toBeGreaterThan(0);
      }
    }
  });

  test('a player can make their own character and play it', async () => {
    const room = await createRoom();
    const [maker, watcher] = [await client(), await client()];
    await join(watcher, room.code, 2, room.seats[0].characterId);

    const grown = new Promise<any>(resolve => {
      const handler = (view: any) => { if (view.seats.length === 5) { watcher.off('room_update', handler); resolve(view); } };
      watcher.on('room_update', handler);
    });
    const confirmed = once(maker, 'join_confirmed');
    const sheet = once(maker, 'character_update');
    maker.emit('create_character', {
      code: room.code, playerToken: token(1), playerName: 'Ana',
      character: { name: '  Kira <b>Stormborn</b>  ', race: 'Half-Orc', class: 'Barbarian', backstory: 'Raised by wolves.' },
    });
    const me = await confirmed;
    expect(me.characterName).toBe('Kira bStormbornb');
    expect((await sheet).hp.max).toBeGreaterThanOrEqual(12);

    const view = await grown;
    const seat = view.seats.find((x: any) => x.characterId === me.characterId);
    expect(seat).toMatchObject({ race: 'Half-Orc', class: 'Barbarian', taken: true, playerName: 'Ana' });
    expect(ctx.rooms.get(room.code)!.board.tokens.has(me.characterId)).toBe(true);

    // The new character can act like any other.
    const result = once(maker, 'action_result', 8000);
    maker.emit('player_message', { message: 'I sniff the air.' });
    expect((await result).success).toBe(true);

    // One custom character per player per table.
    const again = once(maker, 'room_error');
    maker.emit('create_character', {
      code: room.code, playerToken: token(1), character: { name: 'Second Try', race: 'Elf', class: 'Wizard' },
    });
    expect((await again).code).toBe('already_created');
  });

  test('bad character requests are refused', async () => {
    const room = await createRoom();
    const s = await client();
    const tries: Array<[any, string]> = [
      [{ name: 'X', race: 'Elf', class: 'Wizard' }, 'bad_request'],
      [{ name: 'Fine Name', race: 'Robot', class: 'Wizard' }, 'bad_request'],
      [{ name: 'Fine Name', race: 'Elf', class: 'Hacker' }, 'bad_request'],
      [{ name: room.seats[0].name.toUpperCase(), race: 'Elf', class: 'Wizard' }, 'name_taken'],
    ];
    for (const [character, code] of tries) {
      const err = once(s, 'room_error');
      s.emit('create_character', { code: room.code, playerToken: token(7), character });
      expect((await err).code).toBe(code);
    }
    expect(ctx.rooms.get(room.code)!.seats.size).toBe(4);
  });

  test('a table stops taking new characters at six', async () => {
    const room = await createRoom();
    const names = ['Ada One', 'Bea Two', 'Cy Three'];
    const codes: string[] = [];
    for (let i = 0; i < names.length; i++) {
      const s = await client();
      const outcome = Promise.race([once(s, 'join_confirmed').then(() => 'ok'), once(s, 'room_error').then((e: any) => e.code)]);
      s.emit('create_character', { code: room.code, playerToken: token(20 + i), character: { name: names[i], race: 'Human', class: 'Fighter' } });
      codes.push(await outcome);
    }
    expect(codes).toEqual(['ok', 'ok', 'table_full']);
  });

  test('the adventure list is public but the game master notes are not', async () => {
    const data = await (await fetch(`${baseUrl}/api/adventures`)).json();
    expect(data.defaultId).toBe('goblin-den');
    expect(data.adventures[0].id).toBe('goblin-den');
    expect(data.adventures.length).toBeGreaterThanOrEqual(2);
    const ids = data.adventures.map((a: any) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const a of data.adventures) {
      expect(a.title && a.tagline && a.summary && a.levels && a.credit).toBeTruthy();
      expect(a.dmBrief).toBeUndefined();
      expect(a.opening).toBeUndefined();
    }
  });

  test('a table plays the adventure it was opened with', async () => {
    const { ADVENTURES } = await import('../../content/adventures');
    const adventure = ADVENTURES[ADVENTURES.length - 1];
    const res = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adventureId: adventure.id }),
    });
    expect(res.status).toBe(201);
    const room = await res.json();
    expect(room.campaignName).toBe(adventure.title);
    expect(room.seats).toHaveLength(4);
    expect(JSON.stringify(room)).not.toContain(adventure.dmBrief.slice(0, 40));

    const live = ctx.rooms.get(room.code)!;
    expect(live.state._adventure?.dmBrief).toBe(adventure.dmBrief);

    const s = await client();
    const opening = once(s, 'dm_narration');
    await join(s, room.code, 1, room.seats[0].characterId);
    expect((await opening).content).toBe(adventure.opening);

    const result = once(s, 'action_result', 8000);
    s.emit('player_message', { message: 'I look for whoever is in charge.' });
    expect((await result).success).toBe(true);
  });

  test('an unknown adventure is refused', async () => {
    const res = await fetch(`${baseUrl}/api/rooms`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adventureId: 'no-such-adventure' }),
    });
    expect(res.status).toBe(400);
  });

  test('the character sheet carries worn items by body slot and the rest in the bag', async () => {
    const room = await createRoom();
    const fighter = room.seats.find((x: any) => x.class === 'Fighter');
    const s = await client();
    const sheet = once<any>(s, 'character_update');
    await join(s, room.code, 1, fighter.characterId);
    const inv = (await sheet).inventory;
    expect(Object.keys(inv.equipped).sort()).toEqual(
      ['chest', 'feet', 'greaves', 'hands', 'head', 'legs', 'mainHand', 'neck', 'offHand', 'shoulders']);
    expect(inv.equipped.mainHand.name).toBe('Battleaxe');
    expect(inv.equipped.chest.name).toBe('Chain Mail');
    expect(inv.equipped.offHand.name).toBe('Shield');
    expect(inv.equipped.head).toBeNull();
    expect(inv.bag.map((i: any) => i.name)).toEqual(['Handaxe', "Explorer's Pack", 'Torch']);
    expect(inv.bag.find((i: any) => i.name === 'Torch').quantity).toBe(5);
    expect(inv.coins).toMatchObject({ gp: 10, sp: 5, cp: 10 });
  });

  test('the character sheet lists abilities, saves, all skills and spells', async () => {
    const room = await createRoom();
    const wizard = room.seats.find((x: any) => x.class === 'Wizard');
    const s = await client();
    const update = once<any>(s, 'character_update');
    await join(s, room.code, 1, wizard.characterId);
    const sheet = (await update).sheet;
    expect(sheet.abilities.map((a: any) => a.key)).toEqual(['str', 'dex', 'con', 'int', 'wis', 'cha']);
    expect(sheet.abilities.find((a: any) => a.key === 'int')).toMatchObject({ score: 17, modifier: 3 });
    expect(sheet.skills).toHaveLength(18);
    expect(sheet.skills.find((k: any) => k.name === 'Arcana')).toMatchObject({ modifier: 5, proficient: true });
    expect(sheet.skills.find((k: any) => k.name === 'Athletics')).toMatchObject({ modifier: -1, proficient: false });
    const saves = Object.fromEntries(sheet.savingThrows.map((v: any) => [v.key, v]));
    expect(saves.int).toMatchObject({ modifier: 5, proficient: true });
    expect(saves.str).toMatchObject({ modifier: -1, proficient: false });
    expect(sheet.passivePerception).toBe(13);
    expect(sheet.spellcasting).toMatchObject({ saveDC: 13, attackBonus: 5 });
    expect(sheet.spells.map((x: any) => x.name)).toContain('Magic Missile');
    expect(sheet.proficiencies.languages).toContain('Elvish');
  });

});

describe('dice', () => {
  test('a skill check uses the sheet modifier, is seen by the table and goes to the Dungeon Master', async () => {
    const room = await createRoom();
    const wizard = room.seats.find((x: any) => x.class === 'Wizard');
    const [roller, friend] = [await client(), await client()];
    await join(roller, room.code, 1, wizard.characterId);
    await join(friend, room.code, 2, room.seats.find((x: any) => x.class === 'Fighter').characterId);

    const seen = once<any>(friend, 'dice_roll');
    const mine = once<any>(roller, 'dice_roll');
    const narrated = once<any>(friend, 'dm_narration', 8000);
    roller.emit('roll', { kind: 'skill', key: 'Arcana' });
    const roll = await seen;
    expect(await mine).toEqual(roll);
    expect(roll.label).toBe('Arcana check');
    expect(roll.characterName).toBe(wizard.name);
    // Arcana is +5 for this wizard: the total is always the die plus five.
    const die = Number(roll.detail.match(/d20 \((\d+)\)/)![1]);
    expect(die).toBeGreaterThanOrEqual(1);
    expect(die).toBeLessThanOrEqual(20);
    expect(roll.total).toBe(die + 5);
    expect(typeof (await narrated).content).toBe('string');
  });

  test('saves, abilities, advantage and loose dice all roll within range', async () => {
    const room = await createRoom();
    const s = await client();
    await join(s, room.code, 1, room.seats.find((x: any) => x.class === 'Wizard').characterId);
    const roll = async (request: unknown) => { const r = once<any>(s, 'dice_roll'); s.emit('roll', request); return r; };

    const save = await roll({ kind: 'save', key: 'int' });
    expect(save.label).toBe('Intelligence saving throw');
    expect(save.total).toBeGreaterThanOrEqual(6);
    expect(save.total).toBeLessThanOrEqual(25);

    const str = await roll({ kind: 'ability', key: 'str' });
    expect(str.total).toBeGreaterThanOrEqual(0);
    expect(str.total).toBeLessThanOrEqual(19);

    const adv = await roll({ kind: 'skill', key: 'perception', mode: 'advantage' });
    const [a, b, kept] = adv.detail.match(/\((\d+), (\d+): advantage keeps (\d+)\)/)!.slice(1).map(Number);
    expect(kept).toBe(Math.max(a, b));
    expect(adv.total).toBe(kept + 3);

    for (let i = 0; i < 20; i++) {
      const loose = await roll({ kind: 'dice', notation: '2d6+3' });
      expect(loose.total).toBeGreaterThanOrEqual(5);
      expect(loose.total).toBeLessThanOrEqual(15);
    }
  });

  test('nonsense rolls and rolls from spectators are refused', async () => {
    const room = await createRoom();
    const s = await client();
    await join(s, room.code, 1, room.seats[0].characterId);
    for (const bad of [{ kind: 'dice', notation: '999d6' }, { kind: 'dice', notation: 'd7' }, { kind: 'dice', notation: 'drop table' },
                       { kind: 'skill', key: 'Hacking' }, { kind: 'save', key: 'luck' }, {}, null]) {
      const refused = once(s, 'error');
      s.emit('roll', bad);
      await refused;
    }
    const watcher = await client();
    await join(watcher, room.code, 2);
    const refused = once(watcher, 'error');
    watcher.emit('roll', { kind: 'dice', notation: '1d20' });
    await refused;
    expect(await heard(s, 'dice_roll', 300)).toBe(false);
  });
});

describe('loot and gear', () => {
  test('loot gives every standing character gold, and found items can be worn', async () => {
    process.env.LOOT_ITEM_CHANCE = '1';
    const { awardLoot, equipItem, unequipItem } = await import('../../rooms/loot');
    const { buildInventoryView } = await import('../../combat/inventory-view');
    const { buildCharacter } = await import('../../rooms/character-builder');
    const { magicItems } = await import('../../data/dungeoneer');
    expect(magicItems().length).toBeGreaterThan(200);

    const hero = buildCharacter({ name: 'Loot Tester', race: 'Human', class: 'Wizard' }) as any;
    const fallen = buildCharacter({ name: 'Fallen Friend', race: 'Elf', class: 'Rogue' }) as any;
    fallen.hp.current = 0;
    const before = hero.equipment.currency.gp;
    const loot = awardLoot([hero, fallen]);
    expect(loot.changed).toEqual([hero]);
    expect(hero.equipment.currency.gp).toBeGreaterThan(before);
    expect(fallen.equipment.currency.gp).toBe(10);
    expect(loot.lines[0]).toContain('gold');

    // Wear something that fits a slot; carried things are refused.
    hero.equipment.inventory.push(
      { name: 'Boots of Elvenkind', type: 'wondrous', rarity: 'uncommon', description: 'Quiet steps.' },
      { name: 'Winged Boots', type: 'wondrous', rarity: 'uncommon' },
      { name: 'Bag of Holding', type: 'wondrous', rarity: 'uncommon' },
    );
    let view = buildInventoryView(hero);
    expect(view.bag.find(i => i.name === 'Boots of Elvenkind')?.canEquip).toBe('feet');
    expect(view.bag.find(i => i.name === 'Bag of Holding')?.canEquip).toBeUndefined();
    expect(equipItem(hero, 'Bag of Holding').ok).toBe(false);
    expect(equipItem(hero, 'Boots of Elvenkind').ok).toBe(true);
    view = buildInventoryView(hero);
    expect(view.equipped.feet).toMatchObject({ name: 'Boots of Elvenkind', canRemove: true });

    // A second pair replaces the first, which goes back in the bag.
    expect(equipItem(hero, 'Winged Boots').ok).toBe(true);
    view = buildInventoryView(hero);
    expect(view.equipped.feet?.name).toBe('Winged Boots');
    expect(view.bag.some(i => i.name === 'Boots of Elvenkind')).toBe(true);
    expect(unequipItem(hero, 'Winged Boots').ok).toBe(true);
    expect(buildInventoryView(hero).equipped.feet).toBeNull();
  });

  test('wearing an item at the table updates the sheet and tells the others', async () => {
    const room = await createRoom();
    const wizard = room.seats.find((x: any) => x.class === 'Wizard');
    const [me, friend] = [await client(), await client()];
    await join(me, room.code, 1, wizard.characterId);
    await join(friend, room.code, 2, room.seats.find((x: any) => x.class === 'Fighter').characterId);
    const live = ctx.rooms.get(room.code)!;
    const sheet = live.state._characters!.find(c => c.id === wizard.characterId)! as any;
    sheet.equipment.inventory.push({ name: 'Cloak of Protection', type: 'wondrous', rarity: 'uncommon' });

    const update = once<any>(me, 'character_update');
    const told = once<any>(friend, 'player_action');
    me.emit('equip_item', { name: 'Cloak of Protection' });
    expect((await update).inventory.equipped.shoulders.name).toBe('Cloak of Protection');
    expect((await told).content).toContain('Cloak of Protection');

    const refused = once(me, 'error');
    me.emit('equip_item', { name: 'Spellbook' });
    await refused;
  });

  test('spell and condition text comes with the sheet and the reference', async () => {
    const room = await createRoom();
    const s = await client();
    const update = once<any>(s, 'character_update');
    await join(s, room.code, 1, room.seats.find((x: any) => x.class === 'Wizard').characterId);
    const missile = (await update).sheet.spells.find((x: any) => x.name === 'Magic Missile');
    expect(missile.description.length).toBeGreaterThan(40);
    const rules = (await (await fetch(`${baseUrl}/api/conditions`)).json()).conditions;
    expect(rules.map((c: any) => c.name)).toContain('Poisoned');
    expect((await (await fetch(`${baseUrl}/api/about`)).json()).license).toBe('AGPL-3.0-or-later');
  });
});

describe('scenes', () => {
  test('the scene line is taken off the narration and only known scenes count', async () => {
    const { splitSceneTag, sceneFromText, sceneInstruction } = await import('../../rooms/scenes');
    expect(splitSceneTag('You descend into the dark.\nSCENE: cave')).toEqual({ text: 'You descend into the dark.', scene: 'cave' });
    expect(splitSceneTag('The gulls cry.\n\n**SCENE: Ship**')).toEqual({ text: 'The gulls cry.', scene: 'ship' });
    expect(splitSceneTag('Odd place.\nSCENE: moonbase')).toEqual({ text: 'Odd place.', scene: null });
    expect(splitSceneTag('No tag here.')).toEqual({ text: 'No tag here.', scene: null });
    expect(sceneFromText('We row out to the island at dawn')).toBe('coast');
    expect(sceneFromText('I polish my boots')).toBeNull();
    expect(sceneInstruction('cave')).toContain('SCENE:');
  });

  test('a table starts in a scene that suits its adventure and follows the story', async () => {
    const room = await createRoom();
    const [a, b] = [await client(), await client()];
    const first = once<any>(a, 'scene_update');
    await join(a, room.code, 1, room.seats[0].characterId);
    expect((await first).key).toBe('village');
    await join(b, room.code, 2, room.seats[1].characterId);

    const moved = once<any>(b, 'scene_update', 8000);
    a.emit('player_message', { message: 'We follow the tracks down into the cave mouth.' });
    expect((await moved).key).toBe('cave');
    expect(ctx.rooms.get(room.code)!.state._scene).toBe('cave');

    // Someone who joins later sees where the party is now.
    const late = await client();
    const current = once<any>(late, 'scene_update');
    await join(late, room.code, 3);
    expect((await current).key).toBe('cave');
  });

  test('every adventure opens on a known scene', async () => {
    const { ADVENTURES } = await import('../../content/adventures');
    const { isScene, sceneFromText, DEFAULT_SCENE } = await import('../../rooms/scenes');
    for (const adv of ADVENTURES) {
      const scene = sceneFromText(`${adv.startLocation.name}. ${adv.startLocation.description}`)
        ?? sceneFromText(`${adv.title}. ${adv.tagline}`) ?? DEFAULT_SCENE;
      expect(isScene(scene)).toBe(true);
    }
  });
});

describe('accounts', () => {
  const post = (path: string, body: unknown, cookie?: string) =>
    fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      body: JSON.stringify(body),
    });
  const cookieOf = (res: Response) => (res.headers.get('set-cookie') ?? '').split(';')[0];

  async function signUp(email: string, name = 'Ana'): Promise<string> {
    const res = await post('/api/auth/register', { email, password: 'correct horse', name });
    expect(res.status).toBe(201);
    return cookieOf(res);
  }

  function signedInClient(cookie: string): Promise<Socket> {
    return new Promise((resolve, reject) => {
      const s = connect(baseUrl, { transports: ['websocket'], forceNew: true, extraHeaders: { Cookie: cookie } });
      sockets.push(s);
      s.once('connect', () => resolve(s));
      s.once('connect_error', reject);
    });
  }

  test('sign up, sign in, sign out', async () => {
    const res = await post('/api/auth/register', { email: '  New.Player@Example.com ', password: 'correct horse', name: 'Ana' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.account).toMatchObject({ email: 'new.player@example.com', displayName: 'Ana' });
    expect(JSON.stringify(body)).not.toContain('scrypt');
    const cookie = cookieOf(res);
    expect(res.headers.get('set-cookie')).toContain('HttpOnly');

    const me = await (await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })).json();
    expect(me.account.email).toBe('new.player@example.com');
    expect((await (await fetch(`${baseUrl}/api/auth/me`)).json()).account).toBeNull();

    expect((await post('/api/auth/register', { email: 'new.player@example.com', password: 'another one' })).status).toBe(409);
    expect((await post('/api/auth/login', { email: 'new.player@example.com', password: 'wrong horse' })).status).toBe(401);
    expect((await post('/api/auth/login', { email: 'nobody@example.com', password: 'correct horse' })).status).toBe(401);
    expect((await post('/api/auth/register', { email: 'not-an-email', password: 'correct horse' })).status).toBe(400);
    expect((await post('/api/auth/register', { email: 'short@example.com', password: 'short' })).status).toBe(400);

    const login = await post('/api/auth/login', { email: 'NEW.player@example.com', password: 'correct horse' });
    expect(login.status).toBe(200);

    await post('/api/auth/logout', {}, cookie);
    expect((await (await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } })).json()).account).toBeNull();
    expect((await fetch(`${baseUrl}/api/characters`)).status).toBe(401);
  });

  test('a signed-in player keeps a character and brings it to another table with its progress', async () => {
    const cookie = await signUp('keeper@example.com');
    const roster = async () =>
      (await (await fetch(`${baseUrl}/api/characters`, { headers: { Cookie: cookie } })).json()).characters;
    expect(await roster()).toEqual([]);

    // Make a character at the first table.
    const first = await createRoom();
    const s1 = await signedInClient(cookie);
    const joined = once(s1, 'join_confirmed');
    s1.emit('create_character', { code: first.code, character: { name: 'Kira Stormborn', race: 'Human', class: 'Fighter' } });
    const me = await joined;
    const saved = await roster();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ name: 'Kira Stormborn', race: 'Human', class: 'Fighter', level: 1 });

    // Progress made at the table is written back to the roster.
    const live = ctx.rooms.get(first.code)!;
    const sheet = live.state._characters!.find(c => c.id === me.characterId)!;
    sheet.experiencePoints = 250;
    sheet.level = 2;
    (sheet.hp as any).current = 3;
    ctx.rooms.syncTable(live);
    await new Promise(r => setTimeout(r, 300));
    expect((await roster())[0].level).toBe(2);

    // The same account on another device gets the seat back without a browser token.
    const s2 = await signedInClient(cookie);
    const back = once(s2, 'join_confirmed');
    s2.emit('join_room', { code: first.code });
    expect((await back).characterId).toBe(me.characterId);

    // Bring the character to a second table: same progress, but rested.
    const second = await createRoom();
    const s3 = await signedInClient(cookie);
    const arrived = once(s3, 'join_confirmed');
    const update = once<any>(s3, 'character_update');
    s3.emit('bring_character', { code: second.code, savedCharacterId: saved[0].id });
    expect((await arrived).characterName).toBe('Kira Stormborn');
    const brought = await update;
    expect(brought.level).toBe(2);
    expect(brought.hp.current).toBe(brought.hp.max);

    // Not twice at the same table, and not by someone else.
    const again = once(s3, 'room_error');
    s3.emit('bring_character', { code: second.code, savedCharacterId: saved[0].id });
    expect((await again).code).toBe('already_here');

    const otherCookie = await signUp('thief@example.com', 'Ben');
    const thief = await signedInClient(otherCookie);
    const refused = once(thief, 'room_error');
    thief.emit('bring_character', { code: second.code, savedCharacterId: saved[0].id });
    expect((await refused).code).toBe('bad_request');
    expect((await fetch(`${baseUrl}/api/characters/${saved[0].id}`, { method: 'DELETE', headers: { Cookie: otherCookie } })).status).toBe(404);

    // The owner can delete it.
    expect((await fetch(`${baseUrl}/api/characters/${saved[0].id}`, { method: 'DELETE', headers: { Cookie: cookie } })).status).toBe(200);
    expect(await roster()).toEqual([]);
  });

  test('guests can still play, but their characters are not saved', async () => {
    const room = await createRoom();
    const s = await client();
    const joined = once(s, 'join_confirmed');
    s.emit('create_character', { code: room.code, playerToken: token(77), character: { name: 'Passing Guest', race: 'Elf', class: 'Rogue' } });
    const me = await joined;
    expect(ctx.rooms.get(room.code)!.seats.get(me.characterId)!.savedCharacterId).toBeUndefined();
    const refused = once(s, 'room_error');
    s.emit('bring_character', { code: room.code, savedCharacterId: '00000000-0000-0000-0000-000000000000' });
    expect((await refused).code).toBe('bad_request');
  });
});
