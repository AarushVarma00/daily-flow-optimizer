let mySchedule = [];

document.addEventListener('DOMContentLoaded', () => {

    document.getElementById('addActivity').onclick = addActivity;
    document.getElementById('generateBtn').onclick = generateSchedule;

    document.getElementById('editBtn').onclick = () => {
        document.querySelector('.input-section').style.display = 'block';
        document.querySelector('.output-section').style.display = 'none';
    };

    setInterval(updateCurrentTask, 60000);
});

// ---------- ADD ACTIVITY ----------
function addActivity() {

    const container = document.getElementById('extraActivities');

    const row = document.createElement('div');
    row.className = "activity-row";

    row.innerHTML = `
        <label>What is this activity?</label>
        <input type="text" class="activity-name">

        <label>When do you begin?</label>
        <input type="time" class="activity-time">

        <label>How long does it last?</label>
        <input type="number" class="duration-h" value="1">h
        <input type="number" class="duration-m" value="0">m

        <button class="remove-btn">❌</button>
    `;

    container.appendChild(row);

    row.querySelector('.remove-btn').onclick = () => row.remove();
}

// ---------- TIME HELPERS ----------
function toMinutes(t) {
    let [h, m] = t.split(':').map(Number);
    return h * 60 + m;
}

function toTime(mins) {
    let h = Math.floor(mins / 60);
    let m = mins % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function formatDuration(mins) {
    let h = Math.floor(mins / 60);
    let m = mins % 60;
    if (h && m) return `${h}h ${m}m`;
    if (h) return `${h}h`;
    return `${m}m`;
}

// ---------- GENERATE ----------
function generateSchedule() {

    let schedule = [];

    let wake = document.getElementById('wakeUp').value;
    let wakeH = +document.getElementById('wakeUpHours').value || 0;
    let wakeM = +document.getElementById('wakeUpMinutes').value || 0;

    let wakeDur = wakeH * 60 + wakeM || 60;

    schedule.push({
        start: toMinutes(wake),
        end: toMinutes(wake) + wakeDur,
        label: "Morning Routine",
        duration: wakeDur
    });

    let cs = document.getElementById('collegeStart').value;
    let ce = document.getElementById('collegeEnd').value;

    if (cs && ce) {
        let dur = toMinutes(ce) - toMinutes(cs);
        schedule.push({
            start: toMinutes(cs),
            end: toMinutes(ce),
            label: "College",
            duration: dur
        });
    }

    document.querySelectorAll('.activity-row').forEach(row => {

        let name = row.querySelector('.activity-name').value;
        let time = row.querySelector('.activity-time').value;

        let h = +row.querySelector('.duration-h').value || 0;
        let m = +row.querySelector('.duration-m').value || 0;

        let dur = h * 60 + m || 60;

        if (name && time) {
            schedule.push({
                start: toMinutes(time),
                end: toMinutes(time) + dur,
                label: name,
                duration: dur
            });
        }
    });

    schedule.sort((a, b) => a.start - b.start);

    let conflicts = [];

    for (let i = 0; i < schedule.length - 1; i++) {
        if (schedule[i + 1].start < schedule[i].end) {
            conflicts.push(i, i + 1);
        }
    }

    if (conflicts.length > 0) {
        let allow = confirm("⚠ Overlap detected. Continue?");
        if (!allow) return;
    }

    mySchedule = schedule;

    renderSchedule(conflicts);

    document.querySelector('.input-section').style.display = 'none';
    document.querySelector('.output-section').style.display = 'block';

    updateCurrentTask();
}

// ---------- DISPLAY ----------
function renderSchedule(conflicts) {

    let list = document.getElementById('scheduleList');
    list.innerHTML = '';

    mySchedule.forEach((item, i) => {

        let li = document.createElement('li');

        let text = `${toTime(item.start)} - ${toTime(item.end)} | ${item.label} (${formatDuration(item.duration)})`;

        if (conflicts.includes(i)) {
            li.classList.add("conflict");
            text += " ⚠";
        }

        li.textContent = text;

        list.appendChild(li);
    });
}

// ---------- CURRENT TASK ----------
function updateCurrentTask() {

    let el = document.getElementById('currentTask');

    let now = new Date();
    let current = now.getHours() * 60 + now.getMinutes();

    for (let item of mySchedule) {

        if (current >= item.start && current < item.end) {

            let remaining = item.end - current;

            el.textContent = `${item.label} (${formatDuration(remaining)} left)`;
            return;
        }
    }

    el.textContent = "Free time";
}
