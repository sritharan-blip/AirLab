export const ARENA = {width: 960, height: 540, floor: 475};
const TICK = 1000 / 60;
const limit = (number, min, max) => Math.max(min, Math.min(max, number));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const launcher = {x: 164, y: 344};
export const SIEGE_SECTORS = [
  {name: 'Lunar Front', gravity: .86, color: '#3cf8ff'},
  {name: 'Ember Belt', gravity: 1.06, color: '#ff8755'},
  {name: 'Void Citadel', gravity: .64, color: '#df8bff'}
];
const towers = (...rows) => rows.map(([x, height, armored]) => ({x, rows: height, armored}));
export const SIEGE_MISSIONS = [
  {name: 'Signal Outpost', sector: 0, shots: 4, towers: towers([689, 2], [809, 1])},
  {name: 'Twin Relay', sector: 0, shots: 5, towers: towers([640, 3], [773, 2], [874, 1])},
  {name: 'Crown Station', sector: 0, shots: 5, towers: towers([624, 2], [749, 4], [873, 3])},
  {name: 'Shield Protocol', sector: 0, shots: 5, pulse: 1, towers: towers([675, 2, true], [848, 3])},
  {name: 'Ash Gate', sector: 1, shots: 5, pulse: 1, towers: towers([645, 1], [814, 3, true]), barrier: [565, 424, 21, 102]},
  {name: 'Molten Convoy', sector: 1, shots: 6, pulse: 1, towers: towers([587, 1], [716, 2], [852, 1, true])},
  {name: 'Crater Lock', sector: 1, shots: 6, pulse: 1, towers: towers([638, 2], [756, 3, true], [877, 2]), barrier: [527, 414, 18, 122]},
  {name: 'Ember Throne', sector: 1, shots: 6, pulse: 2, towers: towers([619, 1, true], [761, 4, true], [884, 2])},
  {name: 'Phantom Signal', sector: 2, shots: 5, pulse: 1, towers: towers([671, 4, true], [833, 2])},
  {name: 'Rift Wall', sector: 2, shots: 6, pulse: 2, towers: towers([639, 3], [764, 2, true], [866, 3]), barrier: [557, 415, 17, 120]},
  {name: 'Blacklight Fleet', sector: 2, shots: 7, pulse: 2, towers: towers([592, 2, true], [699, 4], [803, 3], [904, 2, true])},
  {name: 'Last Citadel', sector: 2, shots: 7, pulse: 2, towers: towers([627, 3, true], [754, 4, true], [885, 3, true]), barrier: [545, 423, 18, 104]}
];

export const CITRUS_ARENAS = [
  {name: 'Moon Market', goal: 160, pace: 1, hue: '#ff9a44'},
  {name: 'Dragon Street', goal: 240, pace: 1.13, hue: '#ff5a9e'},
  {name: 'Storm Gate', goal: 320, pace: 1.27, hue: '#8dda6c'}
];
export const CITRUS_PHASES = ['Lantern Rush', 'Neon Surge', 'Midnight Frenzy'];

export function crossesCircle(a, b, circle) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq < 9) return false;
  const t = limit(((circle.x - a.x) * dx + (circle.y - a.y) * dy) / lengthSq, 0, 1);
  return Math.hypot(circle.x - (a.x + t * dx), circle.y - (a.y + t * dy)) <= circle.radius;
}

export function orbitBreaker(Matter) {
  const {Bodies, Body, Composite, Engine, Events} = Matter;
  let engine, bodies, cores, shots, stage, score, owner, pull, probe, status, shotTime, accumulator, pulses;
  const sparks = [];

  function reset(index = 0, previousScore = 0) {
    if (engine) Events.off(engine);
    engine = Engine.create({enableSleeping: true});
    stage = Number.isInteger(index) && SIEGE_MISSIONS[index] ? index : 0;
    const mission = SIEGE_MISSIONS[stage];
    engine.gravity.y = SIEGE_SECTORS[mission.sector].gravity;
    shots = mission.shots;
    pulses = mission.pulse ?? 0;
    score = previousScore;
    bodies = []; cores = []; sparks.length = 0;
    owner = null; pull = launcher; probe = null;
    status = 'ready'; shotTime = 0; accumulator = 0;
    Composite.add(engine.world, Bodies.rectangle(ARENA.width / 2, ARENA.floor + 30, ARENA.width * 3, 60, {isStatic: true}));
    if (mission.barrier) {
      const barrier = Bodies.rectangle(...mission.barrier, {isStatic: true, restitution: .2});
      barrier.plugin.kind = 'bulkhead';
      barrier.plugin.size = mission.barrier.slice(2);
      bodies.push(barrier);
    }
    for (const tower of mission.towers) {
      for (let row = 0; row < tower.rows; row++) {
        for (const side of [-1, 1]) {
          const post = Bodies.rectangle(tower.x + side * 24, ARENA.floor - 20 - row * 50, 13, 40, {density: .006, friction: .6});
          post.plugin.kind = 'post'; bodies.push(post);
        }
        const beam = Bodies.rectangle(tower.x, ARENA.floor - 45 - row * 50, 69, 10, {density: .007, friction: .6});
        beam.plugin.kind = 'beam'; bodies.push(beam);
      }
      const core = Bodies.circle(tower.x, ARENA.floor - 50 * tower.rows - 15, 15, {density: .003, restitution: .15});
      core.plugin = {kind: 'core', armor: tower.armored ? 1 : 0, hitAt: -Infinity};
      cores.push(core); bodies.push(core);
    }
    Composite.add(engine.world, bodies);
    const damaged = new Set();
    Events.on(engine, 'collisionStart', ({pairs}) => {
      if (!probe) return;
      for (const {bodyA, bodyB} of pairs) {
        const core = bodyA.plugin.kind === 'core' ? bodyA : bodyB.plugin.kind === 'core' ? bodyB : null;
        if (!core) continue;
        const other = core === bodyA ? bodyB : bodyA;
        const impact = Math.hypot(bodyA.velocity.x - bodyB.velocity.x, bodyA.velocity.y - bodyB.velocity.y);
        if (impact > (other === probe ? 2 : 3.7)) damaged.add(core);
      }
    });
    Events.on(engine, 'afterUpdate', () => {
      for (const core of damaged) damage(core);
      damaged.clear();
    });
  }

  function damage(core) {
    const now = engine.timing.timestamp;
    if (!cores.includes(core) || now - core.plugin.hitAt < 160) return;
    core.plugin.hitAt = now;
    if (core.plugin.armor) {
      core.plugin.armor--;
      sparks.push({...core.position, label: 'SHIELD DOWN'});
      return;
    }
    sparks.push({...core.position});
    score += 100;
    cores = cores.filter(body => body !== core);
    bodies = bodies.filter(body => body !== core);
    Composite.remove(engine.world, core);
  }

  function pulse() {
    if (status !== 'flight' || !pulses || !probe) return false;
    const center = probe.position;
    if (center.x < 280 || center.x > ARENA.width || center.y < 0 || center.y > ARENA.floor) return false;
    pulses--;
    sparks.push({...center, label: 'NOVA', radius: 145});
    for (const body of [...bodies]) {
      if (body.isStatic) continue;
      const gap = distance(body.position, center);
      if (gap >= 145) continue;
      const power = 7 * (1 - gap / 145);
      Matter.Sleeping.set(body, false);
      Body.setVelocity(body, {x: body.velocity.x + (body.position.x - center.x) / (gap || 1) * power,
        y: body.velocity.y + (body.position.y - center.y) / (gap || 1) * power - 4});
      if (body.plugin.kind === 'core') damage(body);
    }
    return true;
  }

  function begin(point, id) {
    if (status !== 'ready' || owner !== null || distance(launcher, point) > 59) return;
    owner = id;
    move(point, id);
  }
  function move(point, id) {
    if (id !== owner) return;
    const ratio = Math.min(1, 122 / (distance(launcher, point) || 1));
    pull = {x: launcher.x + (point.x - launcher.x) * ratio, y: launcher.y + (point.y - launcher.y) * ratio};
  }
  function release(commit, id) {
    if (id !== owner) return;
    owner = null;
    if (commit && distance(pull, launcher) >= 16) {
      probe = Bodies.circle(pull.x, pull.y, 15, {density: .016, restitution: .38, frictionAir: 0, friction: .23});
      Body.setVelocity(probe, aim());
      Composite.add(engine.world, probe);
      shots--;
      shotTime = 0;
      status = 'flight';
    }
    pull = launcher;
  }
  function aim() { return {x: (launcher.x - pull.x) * .219, y: (launcher.y - pull.y) * .219}; }
  function step(ms) {
    if (status !== 'ready' && status !== 'flight') return;
    accumulator += ms;
    while (accumulator >= TICK && (status === 'ready' || status === 'flight')) {
      accumulator -= TICK;
      Engine.update(engine, TICK);
      if (!probe) continue;
      shotTime += TICK;
      if (!cores.length) {
        status = stage === SIEGE_MISSIONS.length - 1 ? 'won' : 'clear';
        score += shots * 20;
      } else if (shotTime > 5600 || (shotTime > 1450 && probe.speed < .16) ||
          probe.position.x > ARENA.width + 100 || probe.position.x < -90 || probe.position.y > ARENA.height + 150) {
        Composite.remove(engine.world, probe);
        probe = null;
        status = shots > 0 ? 'ready' : 'lost';
      }
    }
  }
  reset();
  return {
    reset, begin, move, release, aim, step, pulse, launcher, sparks,
    cancel() { if (owner !== null) release(false, owner); },
    next() { if (status === 'clear') reset(stage + 1, score); },
    get activePull() { return owner !== null; },
    get pull() { return pull; }, get probe() { return probe; },
    get bodies() { return bodies; }, get cores() { return cores.length; },
    get shots() { return shots; }, get score() { return score; }, get status() { return status; },
    get stage() { return stage + 1; }, get name() { return SIEGE_MISSIONS[stage].name; },
    get sector() { return SIEGE_MISSIONS[stage].sector; }, get gravity() { return engine.gravity.y; },
    get pulses() { return pulses; }, get canPulse() {
      return Boolean(status === 'flight' && pulses && probe && probe.position.x >= 280 &&
        probe.position.x <= ARENA.width && probe.position.y >= 0 && probe.position.y <= ARENA.floor);
    }
  };
}

const fruitNames = ['peach', 'lime', 'plum', 'melon', 'orange'];
export function citrusCircuit({random = Math.random} = {}) {
  let objects, swipes, sparks, score, shields, time, combo, lastHit, untilWave, status, wave, arena, phase;
  function reset(index = 0) {
    arena = Number.isInteger(index) && CITRUS_ARENAS[index] ? index : 0;
    objects = []; swipes = new Map(); sparks = []; score = 0; shields = 3; time = 0;
    combo = 0; lastHit = -1e5; untilWave = 700; status = 'ready'; wave = 0;
    phase = 0;
  }
  function spawnWave() {
    wave++;
    const count = wave % 3 === 0 || phase === 2 ? 4 : 3;
    const hazard = wave >= 3 && (wave + arena + phase) % (phase === 2 ? 3 : 2) === 1;
    const golden = phase && wave % 5 === 0;
    const speed = 1 + .06 * arena + .04 * phase;
    for (let i = 0; i < count; i++) {
      const x = 125 + i * 222 + random() * 90;
      objects.push({
        x, y: 583 + random() * 23, vx: (480 - x) * .38 + (random() - .5) * 110,
        vy: (-665 - random() * 140) * speed, radius: 24 + random() * 9, spin: (random() - .5) * 4,
        angle: random() * 6.28, entered: false,
        kind: hazard && i === 1 ? 'drone' : golden && i === 2 ? 'gold' :
          fruitNames[Math.floor(random() * fruitNames.length)]
      });
    }
  }
  function step(ms) {
    if (status !== 'playing') return;
    time += ms;
    if (time >= 35000) { status = 'finished'; swipes.clear(); return; }
    phase = time < 12000 ? 0 : time < 24000 ? 1 : 2;
    untilWave -= ms;
    if (untilWave <= 0) {
      spawnWave();
      untilWave += (1350 - phase * 250) / CITRUS_ARENAS[arena].pace;
    }
    const seconds = ms / 1000;
    for (const object of objects) {
      object.vy += 860 * seconds;
      object.x += object.vx * seconds;
      object.y += object.vy * seconds;
      object.angle += object.spin * seconds;
      if (object.y < ARENA.height - object.radius) object.entered = true;
      if (object.entered && object.y > ARENA.height + object.radius + 14) {
        object.remove = true;
        if (object.kind !== 'drone') combo = 0;
      }
    }
    objects = objects.filter(object => !object.remove);
    if (time - lastHit > 650) combo = 0;
  }
  function begin(point, id) { if (status === 'playing') swipes.set(id, point); }
  function move(point, id) {
    const previous = swipes.get(id);
    if (!previous || status !== 'playing') return;
    const delta = distance(previous, point);
    // Keep the last cut point until the tip has travelled past small tracking jitter.
    if (point.inside && previous.inside && delta < 3) return;
    swipes.set(id, point);
    if (!point.inside || !previous.inside || delta > 360) return;
    for (const object of objects) {
      if (object.remove || !object.entered || !crossesCircle(previous, point, object)) continue;
      object.remove = true;
      const hit = {x: object.x, y: object.y, kind: object.kind, radius: object.radius};
      sparks.push(hit);
      if (object.kind === 'drone') {
        hit.label = '−1 shield';
        shields--;
        combo = 0; lastHit = -1e5;
        if (shields === 0) { status = 'finished'; swipes.clear(); break; }
      } else {
        combo = time - lastHit < 650 ? combo + 1 : 1;
        lastHit = time;
        const points = (object.kind === 'gold' ? 45 : 10) + Math.min(6, combo - 1) * 5;
        score += points;
        hit.label = '+' + points;
      }
    }
    return {a: previous, b: point};
  }
  reset();
  return {
    reset, begin, move, step,
    start() { if (status === 'ready') status = 'playing'; },
    release(_, id) { swipes.delete(id); },
    cancel() { swipes.clear(); },
    get objects() { return objects; }, get swipes() { return swipes; }, get sparks() { return sparks; },
    get score() { return score; }, get shields() { return shields; }, get combo() { return combo; },
    get seconds() { return Math.max(0, 35 - Math.floor(time / 1000)); }, get status() { return status; },
    get phase() { return phase; }, get arena() { return arena; },
    get goal() { return CITRUS_ARENAS[arena].goal; }, get qualified() {
      return status === 'finished' && time >= 35000 && score >= CITRUS_ARENAS[arena].goal;
    }
  };
}
