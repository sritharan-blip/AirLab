import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {CITRUS_ARENAS, SIEGE_MISSIONS, citrusCircuit, crossesCircle, orbitBreaker} from '../dist/arcade-games.mjs';

const sandbox = {module: {exports: {}}, console};
sandbox.exports = sandbox.module.exports;
runInNewContext(readFileSync(new URL('../dist/vendor/matter.min.js', import.meta.url), 'utf8'), sandbox);
const Matter = sandbox.module.exports;

test('slingshot tracks one hand, cancels without spending a shot, and scores a real impact', () => {
  const game = orbitBreaker(Matter);
  game.begin(game.launcher, 'left');
  game.move({x: 59, y: 359}, 'left');
  assert.equal(game.activePull, true);
  game.release(true, 'right');
  assert.equal(game.status, 'ready');
  game.cancel();
  assert.equal(game.shots, 4);
  assert.equal(game.activePull, false);
  game.begin(game.launcher, 'left');
  game.move({x: 59, y: 359}, 'left');
  game.release(true, 'left');
  assert.equal(game.status, 'flight');
  assert.equal(game.shots, 3);
  for (let i = 0; i < 300; i++) game.step(1000 / 60);
  assert.ok(game.score >= 100, 'Aimed probe hit a signal core');
  assert.ok(game.cores < 2);
});

test('slicing uses the swept segment, rewards streaks, and will not re-score with a second hand', () => {
  const game = citrusCircuit({random: () => .5});
  game.start();
  for (let i = 0; i < 62; i++) game.step(1000 / 60);
  const fruit = game.objects.filter(item => item.entered)[0];
  assert.ok(fruit, 'the first wave reaches the playfield');
  const cut = (obj, id) => {
    game.begin({x: obj.x - 60, y: obj.y, inside: true}, id);
    game.move({x: obj.x + 60, y: obj.y, inside: true}, id);
  };
  cut(fruit, 'left');
  cut(fruit, 'right');
  assert.equal(game.score, 10);
  cut(game.objects.find(item => item.entered && !item.remove), 'right');
  assert.equal(game.score, 25);
  assert.equal(game.combo, 2);
  game.cancel();
  assert.equal(game.swipes.size, 0);
  assert.equal(crossesCircle({x: 0, y: 40}, {x: 150, y: 40}, {x: 75, y: 45, radius: 12}), true);
  assert.equal(crossesCircle({x: 0, y: 40}, {x: 150, y: 40}, {x: 75, y: 70, radius: 12}), false);
});

test('a blade cuts along the visible tip path and ignores hovering, jitter and re-entry', () => {
  const game = citrusCircuit({random: () => .5});
  game.start();
  for (let i = 0; i < 62; i++) game.step(1000 / 60);
  const [fruit] = game.objects.filter(item => item.entered);
  const at = (dx, inside = true) => ({x: fruit.x + dx, y: fruit.y, inside});
  assert.equal(game.move(at(0), 'hand'), undefined);
  game.begin(at(0), 'hand');
  assert.equal(game.move(at(1), 'hand'), undefined);
  game.move(at(-30, false), 'hand');
  assert.equal(game.move(at(-60), 'hand'), undefined);
  assert.equal(game.score, 0);
  assert.deepEqual(game.move(at(60), 'hand'), {a: at(-60), b: at(60)});
  assert.equal(game.score, 10);
});

test('drone hits cost shields and a fruit round ends on the timer', () => {
  const game = citrusCircuit({random: () => .5});
  game.start();
  for (let i = 0; i < 360 && game.shields === 3; i++) {
    game.step(1000 / 60);
    const hazard = game.objects.find(item => item.kind === 'drone' && item.entered && item.y > 50 && item.y < 420);
    if (hazard) {
      game.begin({x: hazard.x - 70, y: hazard.y, inside: true}, 'hand');
      game.move({x: hazard.x + 70, y: hazard.y, inside: true}, 'hand');
    }
  }
  assert.equal(game.shields, 2);
  assert.equal(game.score, 0);
  for (let i = 0; i < 2200; i++) game.step(1000 / 60);
  assert.equal(game.status, 'finished');
  assert.equal(game.seconds, 0);
});

test('Nova is charged per mission and can break shields near a live probe', () => {
  const game = orbitBreaker(Matter);
  assert.equal(SIEGE_MISSIONS.length, 12);
  game.reset(3);
  const armored = game.bodies.find(body => body.plugin.armor);
  assert.equal(game.pulses, 1);
  assert.equal(game.pulse(), false);
  game.begin(game.launcher, 'hand');
  game.move({x: 46, y: 363}, 'hand');
  game.release(true, 'hand');
  for (let i = 0; i < 40 && game.probe.position.x < 598; i++) game.step(1000 / 60);
  assert.equal(game.canPulse, true);
  assert.equal(game.pulse(), true);
  assert.equal(game.pulses, 0);
  assert.equal(armored.plugin.armor, 0);
  assert.equal(game.pulse(), false);
  assert.ok(game.sparks.some(hit => hit.label === 'NOVA'));
});

test('Citrus Circuit reaches all three phases and grades a surviving high score', () => {
  for (const [index, arena] of CITRUS_ARENAS.entries()) {
    const game = citrusCircuit({random: () => .5});
    game.reset(index);
    game.start();
    const phases = new Set();
    let cutGold = false;
    for (let i = 0; i < 2200 && game.status === 'playing'; i++) {
      game.step(1000 / 60);
      phases.add(game.phase);
      for (const fruit of game.objects) {
        if (!fruit.entered || fruit.remove || fruit.y > 380 || fruit.kind === 'drone') continue;
        const sameLane = game.objects.some(item => item.kind === 'drone' &&
          item.entered && !item.remove && Math.abs(item.y - fruit.y) < 42 && Math.abs(item.x - fruit.x) < 90);
        if (sameLane) continue;
        game.begin({x: fruit.x - 37, y: fruit.y, inside: true}, 'hand');
        game.move({x: fruit.x + 37, y: fruit.y, inside: true}, 'hand');
        if (fruit.kind === 'gold' && fruit.remove) cutGold = true;
      }
    }
    assert.deepEqual([...phases], [0, 1, 2]);
    assert.equal(game.goal, arena.goal);
    assert.equal(game.status, 'finished');
    assert.equal(game.qualified, true, `${arena.name}: ${game.score}`);
    assert.equal(cutGold, true);
  }
});
