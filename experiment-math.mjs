// Matter's gravity scale is .001 px/ms² at Earth gravity.
export const PIXELS_PER_METRE = 1000 / 9.81;
export const STEP_MS = 1000 / 60;
const LIMIT = 1201;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function trackPath(center, length, degrees, curved, reversed, bounds) {
  const slope = Math.tan(degrees * Math.PI / 180);
  const run = Math.min(length * PIXELS_PER_METRE / Math.hypot(1, slope),
    bounds.width - 32, (bounds.height - 108) / (slope * (curved ? .5 : 1)));
  if (run < 32) return null;
  const rise = run * slope * (curved ? .5 : 1);
  const left = clamp(center.x - run / 2, 16, bounds.width - run - 16);
  const top = clamp(center.y - rise / 2, 50, bounds.height - rise - 58);
  const count = curved ? 12 : 1;
  return Array.from({length: count + 1}, (_, i) => {
    const t = i / count;
    return {x: left + (reversed ? 1 - t : t) * run,
      y: top + rise * (curved ? 2 * t - t * t : t)};
  });
}

export function axisBetween(start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  return {x: dx / length, y: -dy / length};
}

export function measurePosition(body, time) {
  const pixelsPerTick = PIXELS_PER_METRE * STEP_MS / 1000;
  return {
    t: time,
    x: body.position.x / PIXELS_PER_METRE,
    y: -body.position.y / PIXELS_PER_METRE,
    vx: body.velocity.x / pixelsPerTick,
    vy: -body.velocity.y / pixelsPerTick
  };
}

export function motionRecorder() {
  let rows = [], start = null, startedAt = 0, reason = '';
  return {
    start(body, time) {
      startedAt = time;
      start = measurePosition(body, 0);
      rows = [{...start, x: 0, y: 0, ax: null, ay: null}];
      reason = '';
    },
    sample(body, time) {
      if (!start || reason || rows.length >= LIMIT) return null;
      const previous = rows.at(-1);
      const sample = measurePosition(body, (time - startedAt) / 1000);
      const dt = sample.t - previous.t;
      if (dt <= 0) return null;
      const row = {...sample, x: sample.x - start.x, y: sample.y - start.y,
        ax: (sample.vx - previous.vx) / dt, ay: (sample.vy - previous.vy) / dt};
      rows.push(row);
      if (rows.length >= LIMIT) reason = '20-second sample limit reached';
      return row;
    },
    stop(message) { if (start && !reason) reason = message; },
    get rows() { return rows; },
    get recording() { return Boolean(start && !reason); },
    get reason() { return reason; }
  };
}

export function projected(row, axis) {
  return {
    s: row.x * axis.x + row.y * axis.y,
    v: row.vx * axis.x + row.vy * axis.y,
    a: row.ax === null ? null : row.ax * axis.x + row.ay * axis.y
  };
}

export function motionCSV(rows, axis) {
  const header = 'time_s,dx_m,dy_up_m,vx_m_s,vy_up_m_s,ax_m_s2,ay_up_m_s2,projected_displacement_m,projected_velocity_m_s,projected_acceleration_m_s2';
  return [header, ...rows.map(row => {
    const {s, v, a} = projected(row, axis);
    return [row.t, row.x, row.y, row.vx, row.vy, row.ax, row.ay, s, v, a]
      .map(value => value === null ? '' : value.toFixed(6)).join(',');
  })].join('\r\n');
}
