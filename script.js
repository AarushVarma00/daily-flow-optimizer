/**
 * Daily Flow Optimizer — script.js
 *
 * Architecture: Module pattern with strict separation of concerns.
 * Each module has ONE job and never reaches outside its boundary.
 *
 *   Time           — pure time utility functions (no DOM, no state)
 *   Validator      — all validation logic (pure, returns result objects)
 *   ScheduleEngine — schedule computation (pure, no DOM)
 *   Storage        — localStorage wrapper (isolated, safe)
 *   UI             — ALL DOM reads and writes (no logic)
 *   State          — single source of truth (no logic, no DOM)
 *   App            — orchestrator: reads form → validates → builds → commits → renders
 *
 * Why this matters for the future:
 *   - Moving to React?  Replace UI module with components. State/Engine/Validator stay as-is.
 *   - Moving to Vue?    Same story. The non-UI modules are framework-agnostic.
 *   - Adding tests?     Every module except UI can be unit-tested with zero mocking.
 */

'use strict';


/* ════════════════════════════════════════════════════════════
   TIME UTILITIES
   Pure functions. Given the same input, always return the same output.
   ════════════════════════════════════════════════════════════ */
const Time = {

  /**
   * Convert "HH:MM" string → integer minutes from midnight.
   * Returns null if input is invalid — callers must handle null.
   */
  toMinutes(t) {
    if (!t || !/^\d{2}:\d{2}$/.test(t)) return null;
    const [h, m] = t.split(':').map(Number);
    if (h > 23 || m > 59) return null;
    return h * 60 + m;
  },

  /**
   * Convert integer minutes from midnight → "HH:MM" display string.
   * Handles values >= 1440 by wrapping around midnight.
   */
  toDisplay(mins) {
    if (typeof mins !== 'number' || isNaN(mins)) return '--:--';
    const total = ((mins % 1440) + 1440) % 1440; // safe wrap
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  },

  /**
   * Convert integer minutes → human-readable duration string.
   * e.g. 90 → "1h 30m", 60 → "1h", 45 → "45m"
   */
  formatDuration(mins) {
    if (typeof mins !== 'number' || mins <= 0) return '0m';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h && m) return `${h}h ${m}m`;
    return h ? `${h}h` : `${m}m`;
  },

  /** Current clock time as minutes from midnight. */
  nowMinutes() {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  },
};


/* ════════════════════════════════════════════════════════════
   VALIDATOR
   All validation lives here. Returns { valid, error } objects.
   Never touches the DOM — the caller decides how to display errors.
   ════════════════════════════════════════════════════════════ */
const Validator = {

  wakeUp(value) {
    if (!value) return { valid: false, error: 'Wake-up time is required.' };
    if (Time.toMinutes(value) === null) return { valid: false, error: 'Please enter a valid time.' };
    return { valid: true };
  },

  /**
   * College fields are fully optional.
   * If only one is filled, that's an error. If both filled, end must be after start.
   */
  collegeTimes(start, end) {
    const hasStart = Boolean(start);
    const hasEnd   = Boolean(end);

    if (!hasStart && !hasEnd) return { valid: true }; // fully omitted — OK

    if (hasStart && !hasEnd)  return { valid: false, error: 'Please add a college end time.' };
    if (!hasStart && hasEnd)  return { valid: false, error: 'Please add a college start time.' };

    const s = Time.toMinutes(start);
    const e = Time.toMinutes(end);
    if (s === null || e === null) return { valid: false, error: 'Enter valid times for college.' };
    if (e <= s) return { valid: false, error: 'End time must be later than start time.' };

    return { valid: true };
  },

  /** Validate a single activity row's data. Returns first error found. */
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

/**
 * @typedef {{ start: number, end: number, label: string, duration: number }} ScheduleEntry
 */

const ScheduleEngine = {

  /**
   * Build sorted schedule entries from validated form data.
   * Also returns activityErrors for any activity rows that failed validation,
   * keyed by activity index so the caller can highlight the right card.
   *
   * @param {object} formData
   * @returns {{ entries: ScheduleEntry[], activityErrors: Array<{index, error}> }}
   */
  build(formData) {
    const entries        = [];
    const activityErrors = [];

    // Morning routine (always present)
    const wakeStart = Time.toMinutes(formData.wakeUp);
    const wakeDur   = Math.max(1, formData.wakeUpHours * 60 + formData.wakeUpMinutes);
    entries.push({
      start:    wakeStart,
      end:      wakeStart + wakeDur,
      label:    'Morning Routine',
      duration: wakeDur,
    });

    // College / Work (optional)
    if (formData.collegeStart && formData.collegeEnd) {
      const cs = Time.toMinutes(formData.collegeStart);
      const ce = Time.toMinutes(formData.collegeEnd);
      entries.push({
        start:    cs,
        end:      ce,
        label:    'College / Work',
        duration: ce - cs,
      });
    }

    // Custom activities
    formData.activities.forEach((act, i) => {
      const result = Validator.activity(act.name, act.time, act.hours, act.mins);
      if (!result.valid) {
        activityErrors.push({ index: i, error: result.error });
        return; // skip invalid activities
      }
      const start = Time.toMinutes(act.time);
      const dur   = act.hours * 60 + act.mins;
      entries.push({
        start,
        end:      start + dur,
        label:    act.name.trim(),
        duration: dur,
      });
    });

    // Sort by start time ascending
    entries.sort((a, b) => a.start - b.start);

    return { entries, activityErrors };
  },

  /**
   * O(n²) conflict detection — checks every pair, not just consecutive ones.
   * Two entries conflict if one starts before the other ends.
   *
   * @param {ScheduleEntry[]} entries (must be sorted)
   * @returns {Set<number>} Set of conflicting indices
   */
  findConflicts(entries) {
    const conflicts = new Set();
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (entries[j].start < entries[i].end) {
          conflicts.add(i);
          conflicts.add(j);
        }
      }
    }
    return conflicts;
  },

  /**
   * Find what the user should be doing right now.
   * Returns a display string, or null if it's free time.
   *
   * @param {ScheduleEntry[]} entries
   * @returns {string|null}
   */
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
   Uses a versioned key so future schema changes don't corrupt old data.
   ════════════════════════════════════════════════════════════ */
const Storage = {
  KEY: 'dfo_schedule_v1',

  save(schedule) {
    try {
      localStorage.setItem(this.KEY, JSON.stringify(schedule));
    } catch {
      // Storage unavailable or full — silently continue
    }
  },

  load() {
    try {
      const raw = localStorage.getItem(this.KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      // Basic shape check to guard against corrupt/old data
      if (!Array.isArray(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  },

  clear() {
    try { localStorage.removeItem(this.KEY); } catch { /* ignore */ }
  },
};


/* ════════════════════════════════════════════════════════════
   STATE
   Single mutable source of truth. Only App writes to it.
   Exposes getters to prevent external mutation.
   ════════════════════════════════════════════════════════════ */
const State = (() => {
  let _schedule = [];
  let _tickerId = null;

  return {
    get schedule()  { return [..._schedule]; }, // always return a copy
    setSchedule(s)  { _schedule = Array.isArray(s) ? [...s] : []; },
    clearSchedule() { _schedule = []; },

    get tickerId()  { return _tickerId; },
    setTicker(id)   { _tickerId = id; },
    stopTicker()    {
      if (_tickerId !== null) {
        clearInterval(_tickerId);
        _tickerId = null;
      }
    },
  };
})();


/* ════════════════════════════════════════════════════════════
   UI
   Every DOM read and write lives here. Zero logic — just bridge
   between the app's data and what the user sees.
   ════════════════════════════════════════════════════════════ */
const UI = {

  // ── Cached element references (lazy) ──────────────────────

  _el(id) {
    const el = document.getElementById(id);
    if (!el) console.warn(`UI: element #${id} not found`);
    return el;
  },

  // ── View switching ─────────────────────────────────────────

  showInput() {
    this._el('inputSection').hidden  = false;
    this._el('outputSection').hidden = true;
    // Focus the first meaningful input for keyboard users
    document.getElementById('wakeUp')?.focus();
  },

  showOutput() {
    this._el('inputSection').hidden  = true;
    this._el('outputSection').hidden = false;
  },

  // ── Schedule ───────────────────────────────────────────────

  renderSchedule(entries, conflicts) {
    const list = this._el('scheduleList');
    list.innerHTML = '';

    if (!entries.length) {
      list.innerHTML = `<li class="schedule-item">
        <span class="schedule-item__time">—</span>
        <span class="schedule-item__label">No items in schedule</span>
        <span class="schedule-item__meta"></span>
      </li>`;
      return;
    }

    entries.forEach((item, i) => {
      const isConflict = conflicts.has(i);
      const li = document.createElement('li');
      li.className = `schedule-item${isConflict ? ' is-conflict' : ''}`;

      li.innerHTML = `
        <span class="schedule-item__time">
          ${Time.toDisplay(item.start)}&nbsp;–&nbsp;${Time.toDisplay(item.end)}
        </span>
        <span class="schedule-item__label">${this._escape(item.label)}</span>
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

  // ── Activity rows ──────────────────────────────────────────

  /**
   * Create and append a new activity card to the container.
   * Returns the created element so App can wire up its remove button.
   */
  createActivityCard(index) {
    const container = this._el('activitiesContainer');
    const card = document.createElement('div');
    card.className = 'activity-card';
    card.dataset.index = String(index);

    card.innerHTML = `
      <div class="activity-card__header">
        <span class="activity-card__name">Activity</span>
        <button type="button" class="btn--icon js-remove-activity" aria-label="Remove this activity">✕</button>
      </div>

      <div class="form-group">
        <label class="form-label" for="actName-${index}">Name</label>
        <input type="text"
               id="actName-${index}"
               class="form-input act-name"
               placeholder="e.g. Gym, Study session, Reading"
               autocomplete="off">
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

  /** Read all activity data from DOM. Returns raw objects (not validated). */
  readActivities() {
    const cards = document.querySelectorAll('.activity-card');
    return Array.from(cards).map((card, i) => ({
      name:  card.querySelector('.act-name')?.value  ?? '',
      time:  card.querySelector('.act-time')?.value  ?? '',
      hours: parseInt(card.querySelector('.act-hours')?.value ?? '0', 10) || 0,
      mins:  parseInt(card.querySelector('.act-mins')?.value  ?? '0', 10) || 0,
      _card: card, // internal reference for error marking
    }));
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

  markInvalid(id) {
    document.getElementById(id)?.classList.add('is-invalid');
  },

  clearInvalid(id) {
    document.getElementById(id)?.classList.remove('is-invalid');
  },

  /** Clear all error state across the entire form. */
  clearAllErrors() {
    document.querySelectorAll('.field-error').forEach(el => { el.textContent = ''; });
    document.querySelectorAll('.is-invalid').forEach(el => { el.classList.remove('is-invalid'); });
    this.clearFormError();
  },

  // ── Utilities ──────────────────────────────────────────────

  /** Escape user-supplied strings before inserting as innerHTML. */
  _escape(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },
};


/* ════════════════════════════════════════════════════════════
   APP
   The orchestrator. Its only job is to connect the modules:
   read form data → validate → build schedule → update state → render.
   It does not contain logic that belongs in any other module.
   ════════════════════════════════════════════════════════════ */
const App = {

  /** Internal counter for unique activity IDs — never decremented. */
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
  },

  // ── Add activity ───────────────────────────────────────────

  _addActivity() {
    const index = this._activitySeq++;
    const card  = UI.createActivityCard(index);

    // Wire remove button scoped to this card only
    card.querySelector('.js-remove-activity')
      ?.addEventListener('click', () => {
        card.remove();
        UI.clearAllErrors(); // stale errors may reference removed card
      });

    // Auto-focus the name field for fast keyboard entry
    card.querySelector('.act-name')?.focus();
  },

  // ── Generate schedule ──────────────────────────────────────

  _generate() {
    UI.clearAllErrors();

    // ── 1. Read form values ──────────────────────────────
    const wakeUp        = document.getElementById('wakeUp')?.value         ?? '';
    const wakeUpHours   = parseInt(document.getElementById('wakeUpHours')?.value   ?? '0', 10) || 0;
    const wakeUpMinutes = parseInt(document.getElementById('wakeUpMinutes')?.value ?? '0', 10) || 0;
    const collegeStart  = document.getElementById('collegeStart')?.value   ?? '';
    const collegeEnd    = document.getElementById('collegeEnd')?.value     ?? '';
    const activities    = UI.readActivities();

    // ── 2. Validate ──────────────────────────────────────
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

    // ── 3. Build schedule (also collects activity errors) ──
    const formData = { wakeUp, wakeUpHours, wakeUpMinutes, collegeStart, collegeEnd, activities };
    const { entries, activityErrors } = ScheduleEngine.build(formData);

    // Mark invalid activity rows
    activityErrors.forEach(({ index, error }) => {
      const card   = activities[index]?._card;
      if (!card) return;
      const errEl  = card.querySelector('.act-error');
      if (errEl) errEl.textContent = error;
      if (!activities[index].name?.trim()) card.querySelector('.act-name')?.classList.add('is-invalid');
      if (!activities[index].time)         card.querySelector('.act-time')?.classList.add('is-invalid');
      hasErrors = true;
    });

    if (hasErrors) {
      UI.showFormError('Fix the highlighted fields before creating your plan.');
      return;
    }

    // ── 4. Conflict check (non-blocking, user confirms) ───
    const conflicts = ScheduleEngine.findConflicts(entries);
    if (conflicts.size > 0) {
      const proceed = confirm(
        `Your schedule has time overlaps between ${conflicts.size} item${conflicts.size !== 1 ? 's' : ''}.\n\nContinue anyway?`
      );
      if (!proceed) return;
    }

    // ── 5. Commit to state and persist ───────────────────
    State.setSchedule(entries);
    Storage.save(entries);

    // ── 6. Render ─────────────────────────────────────────
    UI.renderSchedule(entries, conflicts);
    UI.renderCurrentTask(ScheduleEngine.getCurrentTask(entries));
    UI.showOutput();

    this._startTicker();
  },

  // ── Edit plan ──────────────────────────────────────────────

  _editPlan() {
    State.stopTicker(); // avoid redundant interval while editing
    UI.showInput();
  },

  // ── Restore saved schedule on page load ───────────────────

  _restoreFromStorage() {
    const saved = Storage.load();
    if (!saved || !saved.length) return;

    State.setSchedule(saved);
    const conflicts = ScheduleEngine.findConflicts(saved);
    UI.renderSchedule(saved, conflicts);
    UI.renderCurrentTask(ScheduleEngine.getCurrentTask(saved));
    UI.showOutput();
    this._startTicker();
  },

  // ── Ticker ─────────────────────────────────────────────────

  _startTicker() {
    State.stopTicker(); // prevent double intervals if called more than once

    const id = setInterval(() => {
      UI.renderCurrentTask(ScheduleEngine.getCurrentTask(State.schedule));
    }, 60_000);

    State.setTicker(id);
  },
};


/* ════════════════════════════════════════════════════════════
   BOOT
   ════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => App.init());

