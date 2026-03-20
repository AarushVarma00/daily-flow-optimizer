// ===============================
// CLEAN DAILY FLOW OPTIMIZER
// ===============================

let mySchedule = [];

// ---------- TIME HELPERS ----------
function toMinutes(t) {
    let [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function toTime(mins) {
    let h = Math.floor(mins / 60) % 24;
    let m = mins % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function getDuration(h, m) {
    return (h * 60 + m) || 60;
}

function formatDuration(mins) {
    let h = Math.floor(mins / 60);
    let m = mins % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
}

// ---------- CREATE ITEM ----------
function createItem(time, label, duration) {
    let start = toMinutes(time);
    let end = start + duration;

    return {
        start,
        end,
        label,
        duration
    };
}

// ---------- DOM READY ----------
document.addEventListener('DOMContentLoaded', () => {

    document.getElementById('addActivity').onclick = addActivity;
    document.getElementById('generateBtn').onclick = generateSchedule;

    document.getElementById('extraActivities').addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-activity')) {
            e.target.closest('.activity-row').remove();
        }
    });

    setInterval(updateCurrentTask, 60000);
});

// ---------- ADD ACTIVITY ----------
function addActivity() {
    const container = document.getElementById('extraActivities');

    const row = document.createElement('div');
    row.className = 'activity-row';

    row.innerHTML = `
        <input type="text" class="activity-name" placeholder="Activity">
        <input type="time" class="activity-time" value="18:00">
        <input type="number" class="duration-h" value="1" min="0" placeholder="h">
        <input type="number" class="duration-m" value="0" min="0" max="59" placeholder="m">
        <button type="button" class="remove-activity">−</button>
    `;

    container.appendChild(row);
}

// ---------- GENERATE SCHEDULE ----------
function generateSchedule() {

    let schedule = [];

    // --- WAKE UP ---
    let wake = document.getElementById('wakeUp').value;
    let wakeH = parseInt(document.getElementById('wakeUpHours').value) || 0;
    let wakeM = parseInt(document.getElementById('wakeUpMinutes').value) || 0;

    if (wake) {
        schedule.push(createItem(wake, "Morning Routine", getDuration(wakeH, wakeM)));
    }

    // --- COLLEGE ---
    let start = document.getElementById('collegeStart').value;
    let end = document.getElementById('collegeEnd').value;

    if (start && end) {
        let duration = toMinutes(end) - toMinutes(start);
        schedule.push(createItem(start, "College", duration));
    }

    // --- EXTRA ACTIVITIES ---
    document.querySelectorAll('.activity-row').forEach(row => {
        let name = row.querySelector('.activity-name').value.trim();
        let time = row.querySelector('.activity-time').value;

        let h = parseInt(row.querySelector('.duration-h').value) || 0;
        let m = parseInt(row.querySelector('.duration-m').value) || 0;

        if (name && time) {
            schedule.push(createItem(time, name, getDuration(h, m)));
        }
    });

    // --- SORT ---
    schedule.sort((a, b) => a.start - b.start);

    mySchedule = schedule;

    renderSchedule();
    updateCurrentTask();
}

// ---------- DISPLAY ----------
function renderSchedule() {
    const list = document.getElementById('scheduleList');
    list.innerHTML = '';

    if (mySchedule.length === 0) {
        list.innerHTML = '<li class="empty-state">No schedule</li>';
        return;
    }

    mySchedule.forEach(item => {
        let li = document.createElement('li');

        let start = toTime(item.start);
        let end = toTime(item.end);
        let dur = formatDuration(item.duration);

        li.textContent = `${start} - ${end} | ${item.label} (${dur})`;

        list.appendChild(li);
    });
}

// ---------- CURRENT TASK ----------
function updateCurrentTask() {
    const el = document.getElementById('currentTask');

    if (mySchedule.length === 0) {
        el.textContent = "Generate schedule first";
        return;
    }

    let now = new Date();
    let current = now.getHours() * 60 + now.getMinutes();

    for (let item of mySchedule) {

        if (current < item.start) {
            el.textContent = `Next: ${item.label} at ${toTime(item.start)}`;
            return;
        }

        if (current >= item.start && current < item.end) {
            let remaining = item.end - current;
            el.textContent = `${item.label} (${formatDuration(remaining)} left)`;
            return;
        }
    }

    el.textContent = "Free time";
}
