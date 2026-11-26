// Optical depth is drawn outside the front face. The front remains aligned
// with the existing Matter body used for collisions and picking.
const BOX = [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]];
const TRIANGLE = [[.35, .606], [-.7, 0], [.35, -.606]];

function tint(hex, amount) {
  const value = Number.parseInt(hex.slice(1), 16);
  const target = amount < 0 ? 0 : 255;
  const blend = shift => {
    const channel = (value >> shift) & 255;
    return Math.round(channel + (target - channel) * Math.abs(amount));
  };
  return `rgb(${blend(16)}, ${blend(8)}, ${blend(0)})`;
}

function face(ctx, points, fill, edge = '#fff3', lineWidth = .018) {
  ctx.beginPath();
  points.forEach(([x, y], index) => index ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = edge;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function sphere(ctx, color, shine) {
  const light = ctx.createRadialGradient(-.35, -.46, .025, -.06, -.06, 1.07);
  light.addColorStop(0, tint(color, .82));
  light.addColorStop(.27, tint(color, .33));
  light.addColorStop(.55, color);
  light.addColorStop(.85, tint(color, -.52));
  light.addColorStop(1, tint(color, -.81));
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fillStyle = light;
  ctx.fill();
  ctx.strokeStyle = tint(color, .38);
  ctx.lineWidth = .018;
  ctx.stroke();
  ctx.save();
  ctx.translate(-.37, -.54);
  ctx.rotate(-.55);
  ctx.beginPath();
  ctx.ellipse(0, 0, .25, .078, 0, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(255,255,255,${shine})`;
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.arc(.018, -.012, .93, .22, 1.18);
  ctx.strokeStyle = '#d3ffff70';
  ctx.lineWidth = .021;
  ctx.stroke();
}

function extrude(ctx, points, color, shine, depth) {
  const [dx, dy] = depth;
  for (const [index, edge] of points.entries()) {
    const end = points[(index + 1) % points.length];
    const vx = end[0] - edge[0], vy = end[1] - edge[1];
    if (vy * dx - vx * dy <= 0) continue;
    const top = vy / Math.hypot(vx, vy) < .45;
    const fill = ctx.createLinearGradient(0, -.66, .63, .5);
    fill.addColorStop(0, tint(color, top ? .46 : -.22));
    fill.addColorStop(1, tint(color, top ? .12 : -.66));
    face(ctx, [edge, [edge[0] + dx, edge[1] + dy], [end[0] + dx, end[1] + dy], end], fill);
  }
  const bevelLight = ctx.createLinearGradient(-.53, -.51, .46, .61);
  bevelLight.addColorStop(0, tint(color, .6));
  bevelLight.addColorStop(1, tint(color, -.52));
  face(ctx, points, bevelLight, '#ffffff70');

  const surface = ctx.createLinearGradient(-.47, -.44, .42, .57);
  surface.addColorStop(0, tint(color, .22));
  surface.addColorStop(.42, color);
  surface.addColorStop(1, tint(color, -.28));
  face(ctx, points.map(([x, y]) => [x * .87, y * .87]), surface, `rgba(255,255,255,${shine * .35})`, .014);
}

export function paintSolid(ctx, kind, color, material) {
  const shine = material === 'cork' ? .16 : material === 'steel' || material === 'ice' ? .76 : .48;
  if (kind === 'ball') sphere(ctx, color, shine);
  else if (kind === 'box') extrude(ctx, BOX, color, shine, [.22, -.19]);
  else extrude(ctx, TRIANGLE, color, shine, [.24, -.19]);
}
