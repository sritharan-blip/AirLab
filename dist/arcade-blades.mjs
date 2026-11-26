export const BLADES = [
  {id: 'moonsteel', name: 'Moonsteel', type: 'Katana', tint: '#90deff', steel: '#eaffff', grip: '#21416c', length: 124, curve: 9, width: 5, guard: 11},
  {id: 'ember', name: 'Ember Crown', type: 'Tachi', tint: '#ff8b53', steel: '#fff2a9', grip: '#781b30', length: 139, curve: 18, width: 6, guard: 13},
  {id: 'jade', name: 'Jade Viper', type: 'Jian', tint: '#73ffa6', steel: '#ebffcb', grip: '#184b46', length: 126, curve: 0, width: 7, guard: 12, double: true},
  {id: 'storm', name: 'Storm Fang', type: 'Saber', tint: '#b2a2ff', steel: '#f6d7ff', grip: '#3f2269', length: 110, curve: 24, width: 11, guard: 15, knuckle: true},
  {id: 'eclipse', name: 'Eclipse', type: 'Greatsword', tint: '#ff84cd', steel: '#ffdbef', grip: '#531b57', length: 147, curve: 0, width: 14, guard: 20, double: true},
  {id: 'dawn', name: 'Dawn Needle', type: 'Rapier', tint: '#ffdc7a', steel: '#fffdf0', grip: '#674226', length: 136, curve: 0, width: 3, guard: 16, double: true, knuckle: true}
];

export const BLADE_SPRITE = {width: 208, height: 72, tipX: 199, tipY: 29};

// The last point on the blade is the origin. Gameplay draws this exact pixel
// at the projected fingertip, regardless of the chosen blade length or angle.
export function paintBlade(ctx, blade) {
  const {tipX, tipY} = BLADE_SPRITE;
  const {length, curve, width, guard, tint, steel, grip} = blade;
  const axis = curve * .84;
  ctx.save();
  ctx.translate(tipX, tipY);

  ctx.lineWidth = 1.5;
  ctx.fillStyle = grip;
  ctx.strokeStyle = tint;
  ctx.beginPath();
  ctx.roundRect(-length - 38, axis - 5, 40, 10, 3);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = tint;
  for (let x = -length - 33; x < -length - 5; x += 8) {
    ctx.beginPath();
    ctx.moveTo(x - 3, axis); ctx.lineTo(x, axis - 3);
    ctx.lineTo(x + 3, axis); ctx.lineTo(x, axis + 3);
    ctx.closePath(); ctx.fill();
  }
  if (blade.knuckle) {
    ctx.beginPath();
    ctx.moveTo(-length, axis + guard);
    ctx.quadraticCurveTo(-length - 29, axis + guard + 4, -length - 35, axis + 4);
    ctx.lineWidth = 2.5; ctx.stroke();
  }
  ctx.fillStyle = tint;
  ctx.beginPath();
  ctx.roundRect(-length - 5, axis - guard, 7, guard * 2, 3);
  ctx.fill();

  const shine = ctx.createLinearGradient(-length, axis - width, -length, axis + width);
  shine.addColorStop(0, tint); shine.addColorStop(.49, steel);
  shine.addColorStop(.55, tint); shine.addColorStop(1, grip);
  ctx.beginPath();
  ctx.moveTo(-length, axis - width);
  if (blade.double) {
    ctx.lineTo(-length * .15, -width * .72); ctx.lineTo(0, 0);
    ctx.lineTo(-length * .15, width * .72); ctx.lineTo(-length, width);
  } else {
    ctx.quadraticCurveTo(-length * .42, curve - width, 0, 0);
    ctx.quadraticCurveTo(-length * .19, width * 1.3, -length, axis + width);
  }
  ctx.closePath();
  ctx.fillStyle = shine; ctx.fill();
  ctx.strokeStyle = steel; ctx.lineWidth = 1.1; ctx.stroke();
  ctx.restore();
}
