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

    return { start, end, label, duration };
}

// ---------- LOAD SAVED ----------
document.addEventListener('DOMContentLoaded', () => {

    loadData();

    document.getElementById('addActivity').onclick = addActivity;
    document.getElementById('generateBtn').onclick = generateSchedule;

    document.getElementById('clearBtn').onclick = () => {
        localStorage.removeItem("schedule");
        mySchedule = [];
        renderSchedule();
        updateCurrentTask();
    };

    setInterval(updateCurrentTask, 60000);
});

// ---------- ADD ACTIVITY ----------
function addActivity() {
    const container = document.getElementById('extraActivities');

    const row = document.createElement('div');
    row.innerHTML = `
        <input type="text" class="activity-name" placeholder="Activity">
        <input type="time" class="activity-time" value="18:00">
        <input type="number" class="duration-h" value="1">h
        <input type="number" class="duration-m" value="0">m
    `;

    container.appendChild(row);
}

// ---------- GENERATE ----------
function generateSchedule() {

    let schedule = [];

    // WAKE
    let wake = document.getElementById('wakeUp').value;
    let wakeH = parseInt(document.getElementById('wakeUpHours').value) || 0;
    let wakeM = parseInt(document.getElementById('wakeUpMinutes').value) || 0;

    schedule.push(createItem(wake, "Morning Routine", getDuration(wakeH, wakeM)));

    // COLLEGE
    let start = document.getElementById('collegeStart').value;
    let end = document.getElementById('collegeEnd').value;

    if (start && end) {
        let duration = toMinutes(end) - toMinutes(start);
        schedule.push(createItem(start, "College", duration));
    }

    // ACTIVITIES
    document.querySelectorAll('#extraActivities div').forEach(row => {
        let name = row.querySelector('.activity-name').value;
        let time = row.querySelector('.activity-time').value;
        let h = parseInt(row.querySelector('.duration-h').value) || 0;
        let m = parseInt(row.querySelector('.duration-m').value) || 0;

        if (name && time) {
            schedule.push(createItem(time, name, getDuration(h, m)));
        }
    });

    schedule.sort((a, b) => a.start - b.start);

    mySchedule = schedule;

    saveData();
    renderSchedule();
    updateCurrentTask();
}

// ---------- DISPLAY ----------
function renderSchedule() {
    const list = document.getElementById('scheduleList');
    list.innerHTML = '';

    mySchedule.forEach(item => {
        let li = document.createElement('li');

        li.textContent =
            `${toTime(item.start)} - ${toTime(item.end)} | ${item.label} (${formatDuration(item.duration)})`;

        list.appendChild(li);
    });
}

// ---------- CURRENT TASK ----------
function updateCurrentTask() {
    const el = document.getElementById('currentTask');

    if (mySchedule.length === 0) {
        el.textContent = "No schedule";
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

// ---------- SAVE ----------
function saveData() {
    localStorage.setItem("schedule", JSON.stringify(mySchedule));
}

// ---------- LOAD ----------
function loadData() {
    let saved = localStorage.getItem("schedule");

    if (saved) {
        mySchedule = JSON.parse(saved);
        renderSchedule();
        updateCurrentTask();
    }
}
