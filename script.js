/**
 * Daily Flow Optimizer — script.js
 *
 * Architecture: Module pattern with strict separation of concerns.
 *
 *   Time           — pure time utility functions (no DOM, no state)
 *   Validator      — all validation logic (pure, returns result objects)
 *   ScheduleEngine — schedule computation (pure, no DOM)
 *   Storage        — localStorage wrapper (isolated, safe, shape-validated)
 *   State          — single source of truth (no logic, no DOM)
 *   UI             — ALL DOM reads and writes (no logic)
 *   App            — orchestrator: reads form → validates → builds → commits → renders
 *
 * Framework migration path:
 *   Moving to React/Vue? Replace UI with components. Everything else stays as-is.
 *   Adding tests? Every module except UI can be unit-tested with zero mocking.
 */

'use strict';


/* ════════════════════════════════════════════════════════════
   TIME UTILITIES
   Pure functions. Same input → same output. No side effects.
   ════════════════════════════════════════════════════════════ */
const Time = {

  /** "HH:MM" → integer minutes from midnight. Returns null on invalid input. */
  toMinutes(t) {
    if (!t || !/^\d{2}:\d{2}$/.test(t)) return null;
    const [h, m] = t.split(':').map(Number);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  },

  /** Integer minutes → "HH:MM". Wraps correctly past midnight. */
  toDisplay(mins) {
    if (typeof mins !== 'number' || isNaN(mins)) return '--:--';
    const total = ((mins % 1440) + 1440) % 1440;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  },

  /** Integer minutes → human-readable duration. e.g. 90 → "1h 30m" */
  formatDuration(mins) {
    if (typeof mins !== 'number' || mins <= 0) return '0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h}h ${m}m`;
    return h ? `${h}h` : `${m}m`;
  },

  /** Current clock as minutes from midnight. */
  nowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  },
};


/* ════════════════════════════════════════════════════════════
   VALIDATOR
   Pure. Returns { valid, error } objects. Never touches the DOM.
   ════════════════════════════════════════════════════════════ */
const Validator = {

  wakeUp(value) {
    if (!value) return { valid: false, error: 'Wake-up time is required.' };
    if (Time.toMinutes(value) === null) return { valid: false, error: 'Please enter a valid time.' };
    return { valid: true };
  },

  collegeTimes(start, end) {
    const hasStart = Boolean(start);
    const hasEnd   = Boolean(end);
    if (!hasStart && !hasEnd) return { valid: true };
    if (hasStart && !hasEnd)  return { valid: false, error: 'Please add a college end time.' };
    if (!hasStart && hasEnd)  return { valid: false, error: 'Please add a college start time.' };
    const s = Time.toMinutes(start);
    const e = Time.toMinutes(end);
    if (s === null || e === null) return { valid: false, error: 'Enter valid times for college.' };
    if (e <= s) return { valid: false, error: 'End time must be later than start time.' };
    return { valid: true };
  },

  activity(name, time, hours, mins) {
    if (!name || !name.trim()) return { valid: false, error: 'Activity name is required.' };
    if (!time)                  return { valid: false, error: 'Start time is required.' };
    if (Time.toMinutes(time) === null) return { valid: false, error: 'Please enter a valid time.' };
    if ((hours * 60 + mins) <= 0)      return { valid: false, error: 'Duration must be at least 1 minute.' };
    return { valid: true };
  },
};


/* ════════════════════════════════════════════════════════════
   SCHEDULE ENGINE
   Pure computation. Receives plain data, returns plain objects.
   No DOM access, no global state reads.
   ════════════════════════════════════════════════════════════ */

/** @typedef {{ start: number, end: number, label: string, duration: number }} ScheduleEntry */

const ScheduleEngine = {

  /**
   * Build sorted schedule entries from validated form data.
   * FIX: Input values are clamped here — HTML max/min attributes
   * can be bypassed by paste, so the engine is the last line of defence.
   */
  build(formData) {
    const entries        = [];
    const activityErrors = [];

    // ── Clamp to valid ranges (defence against pasted/invalid values) ──
    const wakeHours = Math.min(23, Math.max(0, Math.floor(formData.wakeUpHours  || 0)));
    const wakeMins  = Math.min(59, Math.max(0, Math.floor(formData.wakeUpMinutes || 0)));

    const wakeStart = Time.toMinutes(formData.wakeUp);
    const wakeDur   = Math.max(1, wakeHours * 60 + wakeMins);
    entries.push({ start: wakeStart, end: wakeStart + wakeDur, label: 'Morning Routine', duration: wakeDur });

    if (formData.collegeStart && formData.collegeEnd) {
      const cs = Time.toMinutes(formData.collegeStart);
      const ce = Time.toMinutes(formData.collegeEnd);
      entries.push({ start: cs, end: ce, label: 'College / Work', duration: ce - cs });
    }

    formData.activities.forEach((act, i) => {
      const result = Validator.activity(act.name, act.time, act.hours, act.mins);
      if (!result.valid) { activityErrors.push({ index: i, error: result.error }); return; }
      const start = Time.toMinutes(act.time);
      const dur   = act.hours * 60 + act.mins;
      entries.push({ start, end: start + dur, label: act.name.trim(), duration: dur });
    });

    entries.sort((a, b) => a.start - b.start);
    return { entries, activityErrors };
  },

  /** O(n²) conflict detection. Returns Set of conflicting entry indices. */
  findConflicts(entries) {
    const conflicts = new Set();
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[j].start < entries[i].end) { conflicts.add(i); conflicts.add(j); }
      }
    }
    return conflicts;
  },

  /** What should the user be doing right now? Returns display string or null. */
  getCurrentTask(entries) {
    const now = Time.nowMinutes();
    for (const entry of entries) {
      if (now >= entry.start && now < entry.end) {
        const remaining = entry.end - now;
        return `${entry.label} · ${Time.formatDuration(remaining)} left`;
      }
    }
    return null;
  },
};


/* ════════════════════════════════════════════════════════════
   STORAGE
   LocalStorage wrapper. All reads/writes are try-catched.
   Versioned keys + shape validation guard against corrupt data.
   ════════════════════════════════════════════════════════════ */
const Storage = {
  KEY:           'dfo_schedule_v1',
  COMPLETED_KEY: 'dfo_completed_v1',

  // ── Shape guard — rejects entries missing required fields ──
  _isValidEntry(e) {
    return e !== null && typeof e === 'object'
      && typeof e.start    === 'number' && !isNaN(e.start)
      && typeof e.end      === 'number' && !isNaN(e.end)   && e.end > e.start
      && typeof e.label    === 'string' && e.label.length > 0
      && typeof e.duration === 'number' && !isNaN(e.duration);
  },

  save(schedule) {
    try { localStorage.setItem(this.KEY, JSON.stringify(schedule)); }
    catch { /* Storage full or unavailable — silently continue */ }
  },

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      // Filter out any corrupt/malformed entries rather than failing entirely
      const valid = parsed.filter(e => this._isValidEntry(e));
      return valid.length ? valid : null;
    } catch { return null; }
  },

  clear() {
    try { localStorage.removeItem(this.KEY); } catch { /* ignore */ }
  },

  saveCompleted(indices) {
    try { localStorage.setItem(this.COMPLETED_KEY, JSON.stringify([...indices])); }
    catch { /* ignore */ }
  },

  loadCompleted() {
    try {
      const raw = localStorage.getItem(this.COMPLETED_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? new Set(parsed) : new Set();
    } catch { return new Set(); }
  },

  clearCompleted() {
    try { localStorage.removeItem(this.COMPLETED_KEY); } catch { /* ignore */ }
  },
};


/* ════════════════════════════════════════════════════════════
   STATE
   Single mutable source of truth. Only App writes to it.
   Getters return copies — external mutation is impossible.
   ════════════════════════════════════════════════════════════ */
const State = (() => {
  let _schedule  = [];
  let _tickerId  = null;
  let _completed = new Set();

  return {
    get schedule()  { return [..._schedule]; },
    setSchedule(s)  { _schedule = Array.isArray(s) ? [...s] : []; },
    clearSchedule() { _schedule = []; },

    get tickerId() { return _tickerId; },
    setTicker(id)  { _tickerId = id; },
    stopTicker() {
      if (_tickerId !== null) { clearInterval(_tickerId); _tickerId = null; }
    },

    get completed()        { return new Set(_completed); },
    setCompleted(s)        { _completed = new Set(s); },
    toggleCompleted(index) {
      if (_completed.has(index)) _completed.delete(index);
      else _completed.add(index);
      return new Set(_completed);
    },
  };
})();


/* ════════════════════════════════════════════════════════════
   UI
   Every DOM read and write lives here. Zero logic.
   Bridge between the app's data and what the user sees.
   ════════════════════════════════════════════════════════════ */
const UI = {

  _el(id) {
    const el = document.getElementById(id);
    if (!el) console.warn(`UI: element #${id} not found`);
    return el;
  },

  // ── View switching ─────────────────────────────────────────

  showInput() {
    this._el('inputSection').hidden  = false;
    this._el('outputSection').hidden = true;
    document.getElementById('wakeUp')?.focus();
  },

  showOutput() {
    this._el('inputSection').hidden  = true;
    this._el('outputSection').hidden = false;
  },

  // ── Schedule ───────────────────────────────────────────────

  renderSchedule(entries, conflicts, completed) {
    const list = this._el('scheduleList');
    list.innerHTML = '';

    if (!entries.length) {
      list.innerHTML = `<li class="schedule-item schedule-item--empty">
        <span>No items in schedule</span>
      </li>`;
      return;
    }

    entries.forEach((item, i) => {
      const isConflict = conflicts.has(i);
      const isDone     = completed.has(i);
      const li = document.createElement('li');
      li.className = `schedule-item${isConflict ? ' is-conflict' : ''}${isDone ? ' is-done' : ''}`;

      li.innerHTML = `
        <label class="schedule-item__check"
               aria-label="Mark ${this._escape(item.label)} as complete">
          <input type="checkbox" class="js-task-check"
                 data-index="${i}" ${isDone ? 'checked' : ''}>
          <span class="check-box"></span>
        </label>
        <span class="schedule-item__time">
          ${Time.toDisplay(item.start)}&nbsp;–&nbsp;${Time.toDisplay(item.end)}
        </span>
        <span class="schedule-item__label"
              title="${this._escape(item.label)}">${this._escape(item.label)}</span>
        <span class="schedule-item__meta">
          <span class="schedule-item__duration">${Time.formatDuration(item.duration)}</span>
          ${isConflict ? '<span class="schedule-item__badge">Overlap</span>' : ''}
        </span>
      `;
      list.appendChild(li);
    });
  },

  // ── Current task ───────────────────────────────────────────

  renderCurrentTask(taskString) {
    this._el('currentTaskValue').textContent = taskString ?? 'Free time';
  },

  // ── Pie chart ──────────────────────────────────────────────

  renderPieChart(entries, completed) {
    const wrap = this._el('pieChart');
    if (!wrap) return;
    if (!entries.length) { wrap.innerHTML = ''; return; }

    const COLORS = [
      '#38bdf8', '#34d399', '#a78bfa', '#fb923c',
      '#f472b6', '#facc15', '#60a5fa', '#f87171',
    ];
    const DONE_FILL   = 'rgba(255,255,255,0.06)';
    const DONE_STROKE = 'rgba(255,255,255,0.10)';

    const total = entries.reduce((s, e) => s + e.duration, 0);
    if (!total) { wrap.innerHTML = ''; return; }

    const SIZE = 180, CX = 90, CY = 90, R = 72, IR = 46;
    const GAP  = entries.length > 1 ? 0.045 : 0;
    const p2c  = (r, a) => ({ x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) });
    const f    = n => n.toFixed(3);

    const slicePath = (sa, ea) => {
      const [o1, o2, i1, i2] = [p2c(R, sa), p2c(R, ea), p2c(IR, ea), p2c(IR, sa)];
      const lg = (ea - sa) > Math.PI ? 1 : 0;
      return `M${f(o1.x)},${f(o1.y)} A${R},${R},0,${lg},1,${f(o2.x)},${f(o2.y)}`
           + ` L${f(i1.x)},${f(i1.y)} A${IR},${IR},0,${lg},0,${f(i2.x)},${f(i2.y)}Z`;
    };

    const ringPath = () => {
      const [ot, ob, it, ib] = [p2c(R,-Math.PI/2), p2c(R,Math.PI/2), p2c(IR,-Math.PI/2), p2c(IR,Math.PI/2)];
      return `M${f(ot.x)},${f(ot.y)} A${R},${R},0,1,1,${f(ob.x)},${f(ob.y)}`
           + ` A${R},${R},0,1,1,${f(ot.x)},${f(ot.y)}`
           + ` M${f(it.x)},${f(it.y)} A${IR},${IR},0,1,0,${f(ib.x)},${f(ib.y)}`
           + ` A${IR},${IR},0,1,0,${f(it.x)},${f(it.y)}Z`;
    };

    let angle = -Math.PI / 2;
    const slices = entries.map((entry, i) => {
      const frac  = entry.duration / total;
      const sweep = frac * Math.PI * 2;
      const sa = angle + GAP / 2;
      const ea = angle + sweep - GAP / 2;
      angle += sweep;
      return { i, entry, sa, ea, frac, color: COLORS[i % COLORS.length] };
    });

    const doneCount = slices.filter(s => completed.has(s.i)).length;
    const pct = Math.round((doneCount / entries.length) * 100);

    const paths = slices.map(s => {
      const isDone = completed.has(s.i);
      const fill   = isDone ? DONE_FILL   : s.color;
      const stroke = isDone ? DONE_STROKE : s.color;
      const d = s.frac >= 0.999 ? ringPath() : slicePath(s.sa, Math.max(s.sa + 0.002, s.ea));
      return `<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"`
           + ` fill-rule="evenodd" class="pie-slice${isDone ? ' pie-slice--done' : ''}"/>`;
    }).join('');

    const legend = slices.map(s => {
      const isDone = completed.has(s.i);
      return `<li class="pie-legend__item${isDone ? ' is-done' : ''}">
        <span class="pie-legend__dot" style="background:${isDone ? 'rgba(255,255,255,0.18)' : s.color}"></span>
        <span class="pie-legend__label">${this._escape(s.entry.label)}</span>
        <span class="pie-legend__dur">${Time.formatDuration(s.entry.duration)}</span>
      </li>`;
    }).join('');

    wrap.innerHTML = `
      <div class="pie-wrap">
        <div class="pie-svg-wrap">
          <svg viewBox="0 0 ${SIZE} ${SIZE}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <g filter="url(#glow)">${paths}</g>
            <text x="${CX}" y="${CY - 7}" text-anchor="middle"
              font-family="Syne, sans-serif" font-size="27" font-weight="700"
              fill="#e2e8f0">${pct}%</text>
            <text x="${CX}" y="${CY + 12}" text-anchor="middle"
              font-family="DM Sans, sans-serif" font-size="9.5"
              fill="#64748b" letter-spacing="1.8">DONE</text>
          </svg>
        </div>
        <ul class="pie-legend" aria-label="Task breakdown">${legend}</ul>
      </div>`;
  },

  // ── Activity rows ──────────────────────────────────────────

  createActivityCard(index) {
    const container = this._el('activitiesContainer');
    const card = document.createElement('div');
    card.className = 'activity-card';
    card.dataset.index = String(index);

    card.innerHTML = `
      <div class="activity-card__header">
        <span class="activity-card__name">Activity</span>
        <button type="button" class="btn--icon js-remove-activity"
                aria-label="Remove this activity">✕</button>
      </div>
      <div class="form-group">
        <label class="form-label" for="actName-${index}">Name</label>
        <input type="text" id="actName-${index}" class="form-input act-name"
               placeholder="e.g. Gym, Study session, Reading" autocomplete="off">
        <span class="field-error act-error" role="alert" aria-live="polite"></span>
      </div>
      <div class="form-group">
        <label class="form-label" for="actTime-${index}">Start time</label>
        <input type="time" id="actTime-${index}" class="form-input act-time">
      </div>
      <fieldset class="form-fieldset">
        <legend class="form-legend">Duration</legend>
        <div class="duration-row">
          <div class="duration-unit">
            <input type="number" class="form-input form-input--short act-hours"
                   value="1" min="0" max="12" aria-label="Duration hours">
            <span class="form-label--inline">hr</span>
          </div>
          <div class="duration-unit">
            <input type="number" class="form-input form-input--short act-mins"
                   value="0" min="0" max="59" aria-label="Duration minutes">
            <span class="form-label--inline">min</span>
          </div>
        </div>
      </fieldset>
    `;

    container.appendChild(card);
    return card;
  },

  readActivities() {
    return Array.from(document.querySelectorAll('.activity-card')).map(card => ({
      name:  card.querySelector('.act-name')?.value  ?? '',
      time:  card.querySelector('.act-time')?.value  ?? '',
      hours: parseInt(card.querySelector('.act-hours')?.value ?? '0', 10) || 0,
      mins:  parseInt(card.querySelector('.act-mins')?.value  ?? '0', 10) || 0,
      _card: card,
    }));
  },

  // ── Conflict modal ─────────────────────────────────────────
  /**
   * FIX: Replaces browser-native confirm().
   * Native confirm() is blocked in some mobile contexts, unstyled,
   * and can't be tracked with analytics. This returns a Promise<boolean>.
   * Focus is managed properly — cancel is default for safety.
   */
  showModal(title, body) {
    return new Promise(resolve => {
      const overlay    = this._el('modalOverlay');
      const confirmBtn = this._el('modalConfirm');
      const cancelBtn  = this._el('modalCancel');

      this._el('modalTitle').textContent = title;
      this._el('modalBody').textContent  = body;
      overlay.hidden = false;

      // Default focus on Cancel — safer for a destructive-ish action
      cancelBtn.focus();

      const close = result => {
        overlay.hidden = true;
        confirmBtn.removeEventListener('click', onConfirm);
        cancelBtn.removeEventListener('click',  onCancel);
        overlay.removeEventListener('keydown',  onKey);
        resolve(result);
      };

      const onConfirm = () => close(true);
      const onCancel  = () => close(false);

      const onKey = e => {
        if (e.key === 'Escape') { e.preventDefault(); close(false); return; }
        // Simple focus trap between two buttons
        if (e.key === 'Tab') {
          if (!e.shiftKey && document.activeElement === confirmBtn) {
            e.preventDefault(); cancelBtn.focus();
          } else if (e.shiftKey && document.activeElement === cancelBtn) {
            e.preventDefault(); confirmBtn.focus();
          }
        }
      };

      confirmBtn.addEventListener('click', onConfirm);
      cancelBtn.addEventListener('click',  onCancel);
      overlay.addEventListener('keydown',  onKey);
    });
  },

  // ── Error management ───────────────────────────────────────

  showFieldError(id, message) {
    const el = document.getElementById(id);
    if (el) el.textContent = message;
  },

  clearFieldError(id) {
    const el = document.getElementById(id);
    if (el) el.textContent = '';
  },

  showFormError(message) {
    const el = this._el('formError');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
  },

  clearFormError() {
    const el = this._el('formError');
    if (!el) return;
    el.textContent = '';
    el.hidden = true;
  },

  markInvalid(id)  { document.getElementById(id)?.classList.add('is-invalid'); },
  clearInvalid(id) { document.getElementById(id)?.classList.remove('is-invalid'); },

  clearAllErrors() {
    document.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; });
    document.querySelectorAll('.is-invalid').forEach(el => { el.classList.remove('is-invalid'); });
    this.clearFormError();
  },

  // ── Utilities ──────────────────────────────────────────────

  _escape(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },
};


/* ════════════════════════════════════════════════════════════
   APP
   Orchestrator. Connects modules:
   read form → validate → build → commit → render.
   No logic that belongs in any other module.
   ════════════════════════════════════════════════════════════ */
const App = {

  _activitySeq: 0,

  init() {
    this._bindEvents();
    this._restoreFromStorage();
  },

  // ── Event wiring ───────────────────────────────────────────

  _bindEvents() {
    document.getElementById('addActivityBtn')
      ?.addEventListener('click', () => this._addActivity());

    document.getElementById('generateBtn')
      ?.addEventListener('click', () => this._generate());

    document.getElementById('editBtn')
      ?.addEventListener('click', () => this._editPlan());

    // Checkbox delegation — single listener, not one per row
    document.getElementById('scheduleList')
      ?.addEventListener('change', e => {
        const cb = e.target;
        if (!cb.classList.contains('js-task-check')) return;
        const index     = parseInt(cb.dataset.index, 10);
        const completed = State.toggleCompleted(index);
        Storage.saveCompleted(completed);
        UI.renderPieChart(State.schedule, completed);
        cb.closest('.schedule-item')?.classList.toggle('is-done', completed.has(index));
      });

    // Ctrl+Enter shortcut — generate plan from anywhere in the form
    document.addEventListener('keydown', e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        if (!document.getElementById('inputSection')?.hidden) {
          e.preventDefault();
          this._generate();
        }
      }
    });

    // FIX: Re-sync "right now" widget immediately when user returns to tab.
    // Without this, the widget can be stale for up to 10s if the tab was backgrounded.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        const schedule = State.schedule;
        if (schedule.length) {
          UI.renderCurrentTask(ScheduleEngine.getCurrentTask(schedule));
        }
      }
    });
  },

  // ── Add activity ───────────────────────────────────────────

  _addActivity() {
    const index = this._activitySeq++;
    const card  = UI.createActivityCard(index);
    card.querySelector('.js-remove-activity')
      ?.addEventListener('click', () => { card.remove(); UI.clearAllErrors(); });
    card.querySelector('.act-name')?.focus();
  },

  // ── Generate schedule ──────────────────────────────────────
  // async because UI.showModal is Promise-based (no blocking confirm())

  async _generate() {
    UI.clearAllErrors();

    // 1. Read
    const wakeUp        = document.getElementById('wakeUp')?.value         ?? '';
    const wakeUpHours   = parseInt(document.getElementById('wakeUpHours')?.value   ?? '0', 10) || 0;
    const wakeUpMinutes = parseInt(document.getElementById('wakeUpMinutes')?.value ?? '0', 10) || 0;
    const collegeStart  = document.getElementById('collegeStart')?.value   ?? '';
    const collegeEnd    = document.getElementById('collegeEnd')?.value     ?? '';
    const activities    = UI.readActivities();

    // 2. Validate
    let hasErrors = false;

    const wakeResult = Validator.wakeUp(wakeUp);
    if (!wakeResult.valid) {
      UI.showFieldError('err-wakeUp', wakeResult.error);
      UI.markInvalid('wakeUp');
      hasErrors = true;
    }

    const collegeResult = Validator.collegeTimes(collegeStart, collegeEnd);
    if (!collegeResult.valid) {
      UI.showFieldError('err-college', collegeResult.error);
      if (!collegeStart) UI.markInvalid('collegeStart');
      if (!collegeEnd)   UI.markInvalid('collegeEnd');
      hasErrors = true;
    }

    // 3. Build schedule (also surfaces per-activity errors)
    const formData = { wakeUp, wakeUpHours, wakeUpMinutes, collegeStart, collegeEnd, activities };
    const { entries, activityErrors } = ScheduleEngine.build(formData);

    activityErrors.forEach(({ index, error }) => {
      const card  = activities[index]?._card;
      if (!card) return;
      const errEl = card.querySelector('.act-error');
      if (errEl) errEl.textContent = error;
      if (!activities[index].name?.trim()) card.querySelector('.act-name')?.classList.add('is-invalid');
      if (!activities[index].time)         card.querySelector('.act-time')?.classList.add('is-invalid');
      hasErrors = true;
    });

    if (hasErrors) {
      UI.showFormError('Fix the highlighted fields before creating your plan.');
      return;
    }

    // 4. Conflict check — custom modal, not confirm()
    const conflicts = ScheduleEngine.findConflicts(entries);
    if (conflicts.size > 0) {
      const n = conflicts.size;
      const proceed = await UI.showModal(
        'Schedule Overlap',
        `You have ${n} time overlap${n !== 1 ? 's' : ''} in your schedule. You can continue and they'll be highlighted, or go back and fix them first.`
      );
      if (!proceed) return;
    }

    // 5. Commit
    State.setCompleted(new Set());
    Storage.clearCompleted();
    State.setSchedule(entries);
    Storage.save(entries);

    // 6. Render
    UI.renderSchedule(entries, conflicts, State.completed);
    UI.renderPieChart(entries, State.completed);
    UI.renderCurrentTask(ScheduleEngine.getCurrentTask(entries));
    UI.showOutput();

    this._startTicker();
  },

  // ── Edit plan ──────────────────────────────────────────────

  _editPlan() {
    State.stopTicker();
    UI.showInput();
  },

  // ── Restore on page load ───────────────────────────────────

  _restoreFromStorage() {
    const saved = Storage.load();
    if (!saved || !saved.length) return;

    State.setSchedule(saved);
    State.setCompleted(Storage.loadCompleted());
    const conflicts = ScheduleEngine.findConflicts(saved);
    UI.renderSchedule(saved, conflicts, State.completed);
    UI.renderPieChart(saved, State.completed);
    UI.renderCurrentTask(ScheduleEngine.getCurrentTask(saved));
    UI.showOutput();
    this._startTicker();
  },

  // ── Ticker ─────────────────────────────────────────────────
  /**
   * FIX: Changed from 60s to 10s interval.
   * A 60s interval fired from an arbitrary moment (e.g. 12:34:47) would
   * mean the "right now" widget could be ~59s stale. 10s keeps it sharp
   * with negligible performance cost for a task-tracking app.
   */
  _startTicker() {
    State.stopTicker();
    const id = setInterval(() => {
      UI.renderCurrentTask(ScheduleEngine.getCurrentTask(State.schedule));
    }, 10_000);
    State.setTicker(id);
  },
};


/* ════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => App.init());



/* ════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => App.init());

