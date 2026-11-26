import {axisBetween, motionCSV, motionRecorder, PIXELS_PER_METRE, projected, trackPath} from './experiment-math.mjs';

const series = {
  s: {label: 'Displacement', unit: 'm', color: '#87f8dc'},
  v: {label: 'Velocity', unit: 'm/s', color: '#a8caff'},
  a: {label: 'Acceleration', unit: 'm/s²', color: '#ffbc88'}
};
const fixed = value => Math.abs(value) < .005 ? '0.00' : value.toFixed(2);

export function createExperimentLab({get, getBounds, getTime, addPlatform, download, notify}) {
  const recorder = motionRecorder();
  const graph = get('#lab-plot'), context = graph.getContext('2d');
  const status = get('#lab-status');
  let selected = null, trial = null, lastPaint = -Infinity, dirty = true;

  function trackSettings() {
    return {
      length: Number(get('#lab-length').value) || 2.8,
      degrees: Number(get('#lab-angle').value) || 24,
      reversed: get('#lab-flip').checked
    };
  }

  function pathAt(center, curved = false) {
    const {length, degrees, reversed} = trackSettings();
    return trackPath(center, length, degrees, curved, reversed, getBounds());
  }

  function select(body) {
    if (recorder.recording) recorder.stop('Selection changed');
    selected = body;
    dirty = true;
    status.textContent = `Selected ${body.plugin.kind === 'ball' ? 'orb' : body.plugin.kind}. Press Start recording.`;
    get('#lab-start').disabled = false;
    get('#lab-stop').disabled = true;
  }

  function start(body = selected, setup = null) {
    if (!body) return false;
    selected = body;
    trial = setup;
    recorder.start(body, getTime());
    if (setup) get('#lab-axis').value = 'experiment';
    else if (get('#lab-axis').value === 'experiment') get('#lab-axis').value = 'x';
    get('#lab-experiment-axis').disabled = !setup;
    get('#lab-start').disabled = true;
    get('#lab-stop').disabled = false;
    get('#lab-csv').disabled = false;
    get('#lab-repeat').hidden = !setup;
    status.textContent = 'Recording at 60 samples per simulated second.';
    dirty = true;
    render(true);
    return true;
  }

  function stop(reason) {
    if (!recorder.recording && recorder.reason !== reason) return;
    recorder.stop(reason);
    status.textContent = reason;
    get('#lab-start').disabled = !selected;
    get('#lab-stop').disabled = true;
    dirty = true;
    render(true);
  }

  function clearSelection() {
    const hadSelection = Boolean(selected);
    selected = null;
    if (recorder.recording) stop('Scene changed. Your last recording is available.');
    else if (hadSelection) status.textContent = 'Select an object to start a new recording.';
    get('#lab-start').disabled = true;
  }

  function step(teleported) {
    if (!selected || !recorder.recording) return false;
    if (teleported.has(selected.id)) {
      stop('Portal jump ended the recording.');
      return false;
    }
    const row = recorder.sample(selected, getTime());
    dirty ||= Boolean(row);
    if (trial && row && projected(row, trial.axis).s >= trial.distance) {
      stop('Trial complete. Compare the measured and predicted curves.');
      return true;
    }
    if (recorder.reason) stop(recorder.reason);
    return false;
  }

  function axis() {
    const value = get('#lab-axis').value;
    return value === 'experiment' && trial ? trial.axis : value === 'y' ? {x: 0, y: 1} : {x: 1, y: 0};
  }

  function render(force = false, now = 0) {
    if (!force && (!dirty || now - lastPaint < 110)) return;
    if (!force) lastPaint = now;
    dirty = false;
    const rows = recorder.rows;
    const projectedAxis = axis();
    const last = rows.at(-1);
    const values = last && projected(last, projectedAxis);
    for (const key of ['s', 'v', 'a']) {
      const value = values?.[key];
      get('#lab-' + key).textContent = value == null ? '—' : fixed(value);
    }
    get('#lab-time').textContent = last ? fixed(last.t) + ' s' : '0.00 s';
    const compare = trial && rows.length > 1;
    const results = get('#lab-prediction');
    results.hidden = !trial;
    if (trial) {
      get('#lab-expected').textContent = fixed(trial.acceleration);
      get('#lab-average').textContent = compare ? fixed(projected(last, trial.axis).v / last.t) : '—';
      get('#lab-model').textContent = trial.model;
    }

    const key = get('#lab-series').value || 's';
    const config = series[key];
    const theoretical = trial && get('#lab-axis').value === 'experiment';
    const prediction = t => key === 's' ? .5 * trial.acceleration * t * t :
      key === 'v' ? trial.acceleration * t : trial.acceleration;
    const {width, height} = graph;
    const left = 39, right = width - 9, top = 23, bottom = height - 22;
    const duration = Math.max(.5, last?.t || 0);
    const plot = [];
    let min = 0, max = .1;
    for (const row of rows) {
      const value = projected(row, projectedAxis)[key];
      if (value !== null) { plot.push([row.t, value]); min = Math.min(min, value); max = Math.max(max, value); }
    }
    if (theoretical) max = Math.max(max, prediction(last?.t ?? 0));
    const x = time => left + time / duration * (right - left);
    const y = value => bottom - (value - min) / (max - min) * (bottom - top);
    context.clearRect(0, 0, width, height);
    context.font = '10px Segoe UI';
    context.fillStyle = '#bcd6d2';
    context.textAlign = 'left';
    context.fillText(`${config.label} · ${config.unit}`, left, 13);
    context.textAlign = 'right';
    for (let i = 0; i < 4; i++) {
      const value = min + (max - min) * i / 3;
      const py = y(value);
      context.fillText(value.toFixed(1), left - 5, py + 3);
      context.strokeStyle = '#b5f4e822';
      context.lineWidth = 1;
      context.beginPath();
      context.moveTo(left, py);
      context.lineTo(right, py);
      context.stroke();
    }
    context.fillText(duration.toFixed(2) + ' s', right, height - 6);
    context.textAlign = 'left';
    context.fillText('0', left, height - 6);
    if (theoretical && last?.t > 0) {
      context.setLineDash([4, 4]);
      context.strokeStyle = '#eff3b5a6';
      context.beginPath();
      for (let i = 0; i <= 20; i++) {
        const t = last.t * i / 20;
        if (i) context.lineTo(x(t), y(prediction(t)));
        else context.moveTo(x(t), y(prediction(t)));
      }
      context.stroke();
      context.setLineDash([]);
    }
    context.strokeStyle = config.color;
    context.lineWidth = 1.75;
    context.beginPath();
    plot.forEach(([t, value], i) => i ? context.lineTo(x(t), y(value)) : context.moveTo(x(t), y(value)));
    context.stroke();
  }

  for (const id of ['lab-axis', 'lab-series']) get('#' + id).addEventListener('change', () => render(true));

  return {
    select, start, stop, clearSelection, step, render, pathAt,
    place(point, curved) {
      const points = pathAt(point, curved);
      if (!points || !addPlatform(points)) { notify('The track does not fit, or the platform limit was reached.'); return; }
      notify(curved ? 'Curved slide placed.' : 'Straight ramp placed.');
    },
    exportCSV() {
      if (!recorder.rows.length) return;
      download(new Blob([motionCSV(recorder.rows, axis())], {type: 'text/csv;charset=utf-8'}), 'AirLab-measurements.csv');
    },
    get selected() { return selected; },
    get recording() { return recorder.recording; },
    get controlled() { return Boolean(trial && recorder.recording); },
    get rows() { return recorder.rows; },
    get trial() { return trial; }
  };
}

export function slopeTrial(points, gravity) {
  const [start, end] = points;
  const axis = axisBetween(start, end);
  return {
    axis,
    distance: (Math.hypot(end.x - start.x, end.y - start.y) - 76) / PIXELS_PER_METRE,
    acceleration: -gravity * axis.y,
    model: 'Frictionless incline · a = g sin θ'
  };
}
