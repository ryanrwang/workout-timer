// --- STATE MANAGEMENT ---
const STATE = {
    groups: [],
    archived: [],
    history: [],
    editingGroupId: null,
    activeWorkout: null,
};

const SYNC = {
    token: null,
    name: null,
    enabled: false,
    _saveTimeout: null,
};

// --- DOM ELEMENTS ---
const views = {
    home: document.getElementById('view-home'),
    edit: document.getElementById('view-edit'),
    workout: document.getElementById('view-workout')
};

// Home View
const groupsList = document.getElementById('groups-list');
const createGroupBtn = document.getElementById('create-group-btn');
const backupBtn = document.getElementById('backup-btn');

// Edit View
const editViewTitle = document.getElementById('edit-view-title');
const groupNameInput = document.getElementById('group-name-input');
const editExerciseList = document.getElementById('edit-exercise-list');
const addExerciseBtn = document.getElementById('add-exercise-btn');
const cancelEditBtn = document.getElementById('cancel-edit-btn');

// Exercise Modal
const exerciseModal = document.getElementById('exercise-modal');
const modalTitle = document.getElementById('modal-title');
const saveExModalBtn = document.getElementById('save-ex-modal');
const cancelExModalBtn = document.getElementById('cancel-ex-modal');
const deleteExModalBtn = document.getElementById('delete-ex-modal');
const exInputs = {
    name: document.getElementById('ex-name'),
    link: document.getElementById('ex-link'),
    tool: document.getElementById('ex-tool'),
    weight: document.getElementById('ex-weight'),
    unit: document.getElementById('ex-unit'),
    sets: document.getElementById('ex-sets'),
    reps: document.getElementById('ex-reps'),
    rest: document.getElementById('ex-rest'),
    betweenRest: document.getElementById('ex-between-rest')
};

// Backup Modal
const backupModal = document.getElementById('backup-modal');
const closeBackupBtn = document.getElementById('close-backup');
const exportBtn = document.getElementById('export-btn');
const importFile = document.getElementById('import-file');

// History Modal
const historyModal = document.getElementById('history-modal');
const historyList = document.getElementById('history-list');
const closeHistoryBtn = document.getElementById('close-history');
const clearHistoryBtn = document.getElementById('clear-history');
const viewHistoryBtn = document.getElementById('view-history-btn');

// Workout View
const activeTimerDisplay = document.getElementById('active-timer');
const actionBtn = document.getElementById('action-btn');
const currentExName = document.getElementById('wh-exercise-name');
const currentExMeta = document.getElementById('wh-exercise-meta');
const currentExThumb = document.getElementById('current-exercise-thumb');
const currentExLink = document.getElementById('current-exercise-link');
const whThumb = document.getElementById('wh-thumb');
const targetRepsDisplay = document.getElementById('target-reps-display');
const setsContainer = document.getElementById('sets-container');
const prevExerciseNav = document.getElementById('prev-exercise-nav');
const nextExerciseNav = document.getElementById('next-exercise-nav');
const exercisePills = document.getElementById('exercise-pills');
const workoutHeaderEl = document.getElementById('workout-header');

// Sync DOM
const syncIndicator = document.getElementById('sync-indicator');
const syncModal = document.getElementById('sync-modal');
const syncGuestSection = document.getElementById('sync-guest');
const syncLoggedInSection = document.getElementById('sync-logged-in');
const syncDisplayName = document.getElementById('sync-display-name');
const syncError = document.getElementById('sync-error');

// --- INIT & PERSISTENCE ---

function init() {
    loadData();
    renderHome();
    checkSyncAuth().then(() => restoreFromHash());
}

// Flush any pending sync before the tab closes
window.addEventListener('beforeunload', () => {
    if (SYNC.enabled && SYNC._saveTimeout) {
        clearTimeout(SYNC._saveTimeout);
        const payload = JSON.stringify(buildSyncPayload());
        // sendBeacon can't set headers, so pass token as query param
        const url = SYNC.token
            ? 'api.php?action=save&token=' + encodeURIComponent(SYNC.token)
            : 'api.php?action=save';
        navigator.sendBeacon(url, payload);
    }
});

// --- HASH-BASED STATE MANAGEMENT ---

let _programmaticHashChanges = 0;

function updateHash(hash) {
    // Track programmatic hash changes by count to avoid race conditions
    _programmaticHashChanges++;
    window.location.hash = hash;
}

function restoreFromHash() {
    const hash = window.location.hash.replace('#', '');
    if (!hash) return;

    const parts = hash.split('/');

    if (parts[0] === 'edit' && parts[1]) {
        const groupId = parts[1];
        const group = STATE.groups.find(g => g.id === groupId);
        if (group) {
            STATE.editingGroupId = groupId;
            startEditing(true); // true = skip hash update (already set)

            // Also restore exercise modal if specified
            if (parts[2] === 'ex' && parts[3] !== undefined) {
                const exIdx = parseInt(parts[3]);
                if (exIdx >= 0 && exIdx < tempExercises.length) {
                    openExerciseModal(exIdx, true);
                }
            }
        }
    } else if (parts[0] === 'workout' && parts[1]) {
        const groupId = parts[1];
        const group = STATE.groups.find(g => g.id === groupId);
        if (group && group.exercises.length > 0) {
            window.startWorkout(groupId, true);
        }
    }
}

window.addEventListener('hashchange', () => {
    if (_programmaticHashChanges > 0) {
        _programmaticHashChanges--;
        return;
    }

    const hash = window.location.hash.replace('#', '');
    if (!hash || hash === 'home') {
        exerciseModal.classList.add('hidden');
        switchView('home', true);
        renderHome();
    } else {
        restoreFromHash();
    }
});

function loadData() {
    const data = localStorage.getItem('workoutTimerData');
    if (data) {
        const parsed = JSON.parse(data);
        STATE.groups = parsed.groups || [];
        STATE.archived = parsed.archived || [];
        STATE.history = parsed.history || [];
    }
}

function saveData() {
    localStorage.setItem('workoutTimerData', JSON.stringify({
        groups: STATE.groups,
        archived: STATE.archived,
        history: STATE.history
    }));
    debouncedSyncSave();
}

function saveWorkoutProgress() {
    if (!STATE.activeWorkout) return;
    const { group, exIndex, setIndex, completedSets, completedRests } = STATE.activeWorkout;
    localStorage.setItem('workoutProgress_' + group.id, JSON.stringify({
        exIndex, setIndex, completedSets, completedRests,
        timestamp: Date.now()
    }));
    debouncedSyncSave();
}

function loadWorkoutProgress(groupId) {
    const data = localStorage.getItem('workoutProgress_' + groupId);
    if (data) return JSON.parse(data);
    return null;
}

function clearWorkoutProgress(groupId) {
    localStorage.removeItem('workoutProgress_' + groupId);
    debouncedSyncSave();
}

// --- HELPER: THUMBNAIL LOGIC ---

function getThumbnailUrl(link, customImg) {
    if (customImg && customImg.trim() !== '') return customImg;

    // Auto-detect YouTube only
    if (link) {
        const ytId = extractYoutubeId(link);
        if (ytId) return `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
    }

    // Fallback placeholder
    return 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiM1NTUiIHN0cm9rZS13aWR0aD0iMSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSIyIiByeT0iMiIvPjxjaXJjbGUgY3g9IjguNSIgY3k9IjguNSIgcj0iMS41Ii8+PHBvbHlsaW5lIHBvaW50cz0iMjEgMTUgMTYgMTAgNSAyMSIvPjwvc3ZnPg==';
}

function extractYoutubeId(url) {
    if (!url) return null;
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
}

function fetchLinkMetadata(url, index) {
    if (index < 0 || index >= tempExercises.length) return;

    const apiUrl = `https://api.microlink.io?url=${encodeURIComponent(url)}&palette=true&audio=false&video=false&iframe=false`;

    fetch(apiUrl)
        .then(response => {
            if (!response.ok) return;
            return response.json();
        })
        .then(data => {
            if (data && data.status === 'success' && data.data && data.data.image && data.data.image.url) {
                if (tempExercises[index] && tempExercises[index].link === url) {
                    tempExercises[index].img = data.data.image.url;
                    renderEditExercises();
                }
            }
        })
        .catch(() => {});
}

// --- SHARED: PROGRESS PILLS ---

function buildProgressPillsHtml(group, activeExIndex, completedSetsData) {
    // completedSetsData: array of arrays (per-exercise completed set indices), or null
    return group.exercises.map((ex, idx) => {
        const totalSets = parseInt(ex.sets) || 3;
        let dots = '';
        for (let s = 1; s <= totalSets; s++) {
            const done = completedSetsData && completedSetsData[idx] && completedSetsData[idx].includes(s);
            dots += `<span class="progress-dot${done ? ' done' : ''}"></span>`;
        }
        const isActive = idx === activeExIndex;
        return `<span class="progress-pill${isActive ? ' active' : ''}">${ex.name}<span class="progress-dots">${dots}</span></span>`;
    }).join('');
}

// --- NAVIGATION ---

function switchView(viewName, skipHash) {
    Object.values(views).forEach(el => el.classList.add('hidden'));
    views[viewName].classList.remove('hidden');

    if (!skipHash && viewName === 'home') {
        updateHash('');
    }
}

// --- HOME VIEW LOGIC ---

function renderHome() {
    groupsList.innerHTML = '';

    if (STATE.groups.length === 0) {
        groupsList.innerHTML = '<div class="empty-state">No routines yet. Create one to get started!</div>';
        return;
    }

    STATE.groups.forEach((group, idx) => {
        const card = document.createElement('div');
        card.className = 'group-card';
        card.draggable = true;
        card.dataset.index = idx;
        // Click on main area (not buttons/handle) starts workout
        card.addEventListener('click', (e) => {
            if (e.target.classList.contains('drag-handle')) return;
            startWorkout(group.id);
        });

        // Group drag events
        card.addEventListener('dragstart', handleGroupDragStart);
        card.addEventListener('dragover', handleGroupDragOver);
        card.addEventListener('drop', handleGroupDrop);
        card.addEventListener('dragend', handleGroupDragEnd);

        const saved = loadWorkoutProgress(group.id);
        const completedSetsData = saved ? saved.completedSets : null;
        const pillsHtml = buildProgressPillsHtml(group, -1, completedSetsData);
        const hasProgress = saved && saved.completedSets && saved.completedSets.some(arr => arr && arr.length > 0);

        // Completion date from saved progress
        const completedDate = saved && saved.timestamp ? new Date(saved.timestamp) : null;
        const allExercisesComplete = saved && saved.completedSets && group.exercises.length > 0 && saved.completedSets.every((sets, ei) => {
            const totalSets = parseInt(group.exercises[ei]?.sets) || 3;
            return sets && sets.length >= totalSets;
        });
        let completedDateHtml = '';
        if (allExercisesComplete && completedDate) {
            const diffMin = Math.floor((Date.now() - completedDate.getTime()) / 60000);
            let ago;
            if (diffMin < 1) ago = 'just now';
            else if (diffMin < 60) ago = `${diffMin}m ago`;
            else if (diffMin < 1440) ago = `${Math.floor(diffMin / 60)}h ${diffMin % 60}m ago`;
            else ago = `${Math.floor(diffMin / 1440)}d ${Math.floor((diffMin % 1440) / 60)}h ago`;
            // Color from yellow → orange → red over 1–7 days
            const diffDays = diffMin / 1440;
            let agoStyle = '';
            if (diffDays >= 1) {
                const t = Math.min((diffDays - 1) / 6, 1); // 0 at 1d, 1 at 7d
                const hue = 50 - t * 50; // 50 (yellow) → 0 (red)
                const sat = 90 + t * 10; // 90% → 100%
                const lit = 55 - t * 10; // 55% → 45%
                agoStyle = ` style="color: hsl(${hue}, ${sat}%, ${lit}%); font-weight: 500"`;
            }
            completedDateHtml = `<span class="card-completed-icon"><span class="material-icons-outlined">check_circle</span></span><span class="card-completed">${completedDate.getFullYear()}/${String(completedDate.getMonth() + 1).padStart(2, '0')}/${String(completedDate.getDate()).padStart(2, '0')} @ ${completedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }).toLowerCase()} &middot; <span${agoStyle}>${ago}</span></span>`;
        }

        card.innerHTML = `
            <div class="card-top-row">
                <div class="drag-handle"><span class="material-icons-outlined">drag_indicator</span></div>
                <div class="card-title${completedDateHtml ? ' is-completed' : ''}"><span class="card-name">${group.name} <span class="card-count">&bull; ${group.exercises.length}</span></span>${completedDateHtml}</div>
                <div class="card-menu-wrapper">
                    <button class="btn-icon card-menu-btn" onclick="event.stopPropagation(); toggleCardMenu(this)"><span class="material-icons-outlined">more_vert</span></button>
                    <div class="card-dropdown-menu hidden">
                        <button class="dropdown-item" onclick="event.stopPropagation(); editGroup('${group.id}'); closeAllCardMenus()"><span class="material-icons-outlined">edit</span> Edit</button>
                        <button class="dropdown-item${hasProgress ? '' : ' disabled'}" onclick="event.stopPropagation(); ${hasProgress ? `resetRoutineProgress('${group.id}'); closeAllCardMenus()` : ''}" ${hasProgress ? '' : 'disabled'}><span class="material-icons-outlined">restart_alt</span> Reset</button>
                        <button class="dropdown-item" onclick="event.stopPropagation(); completeRoutineProgress('${group.id}'); closeAllCardMenus()"><span class="material-icons-outlined">check_circle</span> Complete</button>
                        <div class="dropdown-divider"></div>
                        <button class="dropdown-item danger-text" onclick="event.stopPropagation(); archiveRoutine('${group.id}'); closeAllCardMenus()"><span class="material-icons-outlined">archive</span> Archive</button>
                    </div>
                </div>
            </div>
            ${pillsHtml ? `<div class="ex-tags">${pillsHtml}</div>` : ''}
        `;
        groupsList.appendChild(card);
    });
}

// --- GROUP CARD DRAG & DROP ---
let groupDragSrcIndex = null;

function handleGroupDragStart(e) {
    this.classList.add('dragging');
    groupDragSrcIndex = Number(this.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', this.dataset.index);
}

function handleGroupDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    return false;
}

function handleGroupDrop(e) {
    e.stopPropagation();
    const dropTarget = e.target.closest('.group-card');
    if (!dropTarget) return;
    const dropIndex = Number(dropTarget.dataset.index);
    if (groupDragSrcIndex !== dropIndex) {
        const draggedItem = STATE.groups[groupDragSrcIndex];
        STATE.groups.splice(groupDragSrcIndex, 1);
        STATE.groups.splice(dropIndex, 0, draggedItem);
        saveData();
        renderHome();
    }
    return false;
}

function handleGroupDragEnd(e) {
    this.classList.remove('dragging');
}

createGroupBtn.addEventListener('click', () => {
    STATE.editingGroupId = null;
    startEditing();
});

// Mobile "+" add button
document.getElementById('create-group-btn-mobile').addEventListener('click', () => {
    STATE.editingGroupId = null;
    startEditing();
});

// Clickable title goes home
document.getElementById('app-title').addEventListener('click', () => {
    if (STATE.activeWorkout) {
        clearInterval(workoutTimerInterval);
        STATE.activeWorkout = null;
    }
    exerciseModal.classList.add('hidden');
    switchView('home');
    renderHome();
});

// --- EDIT VIEW LOGIC ---

let tempExercises = [];
let editingExerciseIndex = -1;

function startEditing(skipHash) {
    switchView('edit', true); // we handle hash ourselves
    if (STATE.editingGroupId) {
        const group = STATE.groups.find(g => g.id === STATE.editingGroupId);
        groupNameInput.value = group.name;
        tempExercises = JSON.parse(JSON.stringify(group.exercises)).map(ex => ({
            ...ex,
            betweenRest: ex.betweenRest ?? 120
        }));
        editViewTitle.textContent = 'Edit Routine';
    } else {
        // AUTO-SAVE: Create a new group immediately
        const newId = Date.now().toString();
        const newGroup = {
            id: newId,
            name: 'New Routine',
            exercises: []
        };
        STATE.groups.push(newGroup);
        STATE.editingGroupId = newId;
        STATE.isNewRoutine = true; // Track that this is a brand new routine

        groupNameInput.value = ''; // Let user type name
        tempExercises = [];
        editViewTitle.textContent = 'New Routine';
        // Don't save yet — wait until name or exercise added
    }
    if (!skipHash) {
        updateHash('edit/' + STATE.editingGroupId);
    }
    renderEditExercises();
}

function persistCurrentGroup() {
    if (!STATE.editingGroupId) return;

    const groupIndex = STATE.groups.findIndex(g => g.id === STATE.editingGroupId);
    if (groupIndex > -1) {
        // Update name if typed, fallback to 'New Routine' if empty
        const name = groupNameInput.value.trim() || 'New Routine';

        STATE.groups[groupIndex] = {
            ...STATE.groups[groupIndex],
            name: name,
            exercises: tempExercises
        };

        renderHome(); // Update home list in background
        saveData();   // Save to local storage
    }
}

// Auto-save name on change
groupNameInput.addEventListener('input', persistCurrentGroup);

function renderEditExercises() {
    editExerciseList.innerHTML = '';
    tempExercises.forEach((ex, index) => {
        const thumbUrl = getThumbnailUrl(ex.link, ex.img);

        const div = document.createElement('div');
        div.className = 'exercise-card';
        div.draggable = true; // Enable drag
        div.dataset.index = index;

        // Drag Events
        div.addEventListener('dragstart', handleDragStart);
        div.addEventListener('dragover', handleDragOver);
        div.addEventListener('drop', handleDrop);
        div.addEventListener('dragend', handleDragEnd);

        // Click to edit (ignore if clicking handle)
        div.onclick = (e) => {
            if (!e.target.classList.contains('drag-handle')) {
                openExerciseModal(index);
            }
        };

        div.innerHTML = `
            <div class="thumb-wrapper">
                <img src="${thumbUrl}" class="ex-thumb" alt="thumb">
                <img src="${thumbUrl}" class="thumb-preview" alt="preview">
            </div>
            <div class="ex-info">
                <div class="card-title">${index + 1}. ${ex.name}</div>
                <div class="card-meta">${ex.tool} • ${ex.weight} ${ex.unit || 'lbs'} • ${ex.sets}x${ex.reps}</div>
            </div>
            <!-- Drag Handle -->
            <div class="drag-handle"><span class="material-icons-outlined">drag_indicator</span></div>
        `;
        editExerciseList.appendChild(div);
    });
}

// --- DRAG & DROP HANDLERS ---
let dragSrcIndex = null;
let dropIndicator = null;

function getOrCreateIndicator() {
    if (!dropIndicator) {
        dropIndicator = document.createElement('div');
        dropIndicator.className = 'drag-drop-indicator';
    }
    return dropIndicator;
}

function removeIndicator() {
    if (dropIndicator && dropIndicator.parentNode) {
        dropIndicator.parentNode.removeChild(dropIndicator);
    }
}

function handleDragStart(e) {
    this.classList.add('dragging');
    dragSrcIndex = Number(this.dataset.index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/html', this.innerHTML);
}

function handleDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const card = e.target.closest('.exercise-card');
    if (!card || card.classList.contains('dragging')) return;

    const indicator = getOrCreateIndicator();
    const rect = card.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;

    if (e.clientY < midY) {
        // Insert indicator before this card
        card.parentNode.insertBefore(indicator, card);
    } else {
        // Insert indicator after this card
        card.parentNode.insertBefore(indicator, card.nextSibling);
    }

    return false;
}

function handleDrop(e) {
    e.stopPropagation();
    removeIndicator();

    const dropTarget = e.target.closest('.exercise-card');
    if (!dropTarget) return;

    let dropIndex = Number(dropTarget.dataset.index);

    const rect = dropTarget.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const insertAfter = e.clientY >= midY;

    if (dragSrcIndex !== dropIndex) {
        const draggedItem = tempExercises[dragSrcIndex];
        tempExercises.splice(dragSrcIndex, 1);

        if (dragSrcIndex < dropIndex) dropIndex--;
        const insertAt = insertAfter ? dropIndex + 1 : dropIndex;

        tempExercises.splice(insertAt, 0, draggedItem);

        renderEditExercises();
        persistCurrentGroup();
    }
    return false;
}

function handleDragEnd(e) {
    this.classList.remove('dragging');
    removeIndicator();
}

window.editGroup = (id) => {
    STATE.editingGroupId = id;
    startEditing();
};

window.resetRoutineProgress = (groupId) => {
    clearWorkoutProgress(groupId);
    renderHome();
};

window.completeRoutineProgress = (groupId) => {
    const group = STATE.groups.find(g => g.id === groupId);
    if (!group || group.exercises.length === 0) return;
    // Build completed sets for all exercises
    const completedSets = group.exercises.map(ex => {
        const totalSets = parseInt(ex.sets) || 3;
        return Array.from({ length: totalSets }, (_, i) => i + 1);
    });
    const completedRests = group.exercises.map((ex, i) => {
        const rests = [];
        const totalSets = parseInt(ex.sets) || 3;
        if (ex.rest > 0) {
            for (let r = 1; r < totalSets; r++) rests.push(r);
        }
        // Add rest-after-exercise if applicable (not for last exercise)
        const exBetweenRest = parseInt(ex.betweenRest) || 120;
        if (exBetweenRest > 0 && i < group.exercises.length - 1) {
            rests.push(-1);
        }
        return rests;
    });
    localStorage.setItem('workoutProgress_' + groupId, JSON.stringify({
        exIndex: group.exercises.length - 1,
        setIndex: parseInt(group.exercises[group.exercises.length - 1].sets) || 3,
        completedSets,
        completedRests,
        timestamp: Date.now()
    }));
    debouncedSyncSave();
    renderHome();
};

window.openExerciseModal = (index = -1, skipHash) => {
    editingExerciseIndex = index;

    if (index > -1) {
        // Edit Mode
        const ex = tempExercises[index];
        modalTitle.textContent = 'Edit Exercise';
        saveExModalBtn.textContent = 'Update';
        deleteExModalBtn.classList.remove('hidden');

        exInputs.name.value = ex.name;
        exInputs.link.value = ex.link || '';
        exInputs.tool.value = ex.tool;
        exInputs.weight.value = ex.weight;
        exInputs.unit.value = ex.unit || 'lbs';
        exInputs.sets.value = ex.sets;
        exInputs.reps.value = ex.reps;
        exInputs.rest.value = ex.rest;
        exInputs.betweenRest.value = ex.betweenRest ?? 120;

        if (!skipHash) {
            updateHash('edit/' + STATE.editingGroupId + '/ex/' + index);
        }
    } else {
        // Add Mode
        modalTitle.textContent = 'Add Exercise';
        saveExModalBtn.textContent = 'Add';
        deleteExModalBtn.classList.add('hidden');

        exInputs.name.value = '';
        exInputs.link.value = '';
        exInputs.tool.value = 'Dumbbell';
        exInputs.weight.value = 30;
        exInputs.unit.value = 'lbs';
        exInputs.sets.value = 3;
        exInputs.reps.value = 8;
        exInputs.rest.value = 60;
        exInputs.betweenRest.value = 120;
    }

    exerciseModal.classList.remove('hidden');
};

addExerciseBtn.addEventListener('click', () => openExerciseModal(-1));

saveExModalBtn.addEventListener('click', () => {
    const name = exInputs.name.value.trim();
    if (!name) return alert('Name is required');

    const link = exInputs.link.value.trim();

    // Create exercise object
    const exerciseData = {
        name: name,
        link: link,
        img: (editingExerciseIndex > -1 && tempExercises[editingExerciseIndex].img) ? tempExercises[editingExerciseIndex].img : null,
        tool: exInputs.tool.value,
        weight: parseInt(exInputs.weight.value) || 0,
        unit: exInputs.unit.value || 'lbs',
        sets: parseInt(exInputs.sets.value) || 3,
        reps: parseInt(exInputs.reps.value) || 0,
        rest: parseInt(exInputs.rest.value) || 60,
        betweenRest: parseInt(exInputs.betweenRest.value) || 120
    };

    let targetIndex = editingExerciseIndex;

    if (editingExerciseIndex > -1) {
        // Update existing
        exerciseData.id = tempExercises[editingExerciseIndex].id;
        tempExercises[editingExerciseIndex] = exerciseData;
    } else {
        // Create new
        exerciseData.id = Date.now().toString();
        tempExercises.push(exerciseData);
        targetIndex = tempExercises.length - 1;
    }

    // Trigger metadata fetch 
    if (link && !extractYoutubeId(link)) {
        fetchLinkMetadata(link, targetIndex);
    }

    exerciseModal.classList.add('hidden');
    renderEditExercises();
    persistCurrentGroup(); // AUTO-SAVE on add/update
    if (STATE.editingGroupId) updateHash('edit/' + STATE.editingGroupId);
});

deleteExModalBtn.addEventListener('click', () => {
    if (editingExerciseIndex > -1) {
        tempExercises.splice(editingExerciseIndex, 1);
        exerciseModal.classList.add('hidden');
        renderEditExercises();
        persistCurrentGroup(); // AUTO-SAVE on delete
        if (STATE.editingGroupId) updateHash('edit/' + STATE.editingGroupId);
    }
});

cancelExModalBtn.addEventListener('click', () => {
    exerciseModal.classList.add('hidden');
    // Restore hash to edit view
    if (STATE.editingGroupId) updateHash('edit/' + STATE.editingGroupId);
});

// Click outside modal content to close (without saving)
exerciseModal.addEventListener('click', (e) => {
    if (e.target === exerciseModal) {
        exerciseModal.classList.add('hidden');
        if (STATE.editingGroupId) updateHash('edit/' + STATE.editingGroupId);
    }
});

// 'Done' button - Return to home, discard if empty new routine
cancelEditBtn.addEventListener('click', () => {
    // If new routine with no name and no exercises, discard it
    if (STATE.isNewRoutine && STATE.editingGroupId) {
        const name = groupNameInput.value.trim();
        const hasExercises = tempExercises.length > 0;

        if (!name && !hasExercises) {
            const idx = STATE.groups.findIndex(g => g.id === STATE.editingGroupId);
            if (idx > -1) {
                STATE.groups.splice(idx, 1);
                saveData(); // Commit removal
            }
        }
    }

    STATE.isNewRoutine = false;
    STATE.editingGroupId = null;
    switchView('home');
    renderHome();
});

// Archive routine (Global)
window.archiveRoutine = (id) => {
    if (!id) return;

    // Check if we are editing this group currently
    if (STATE.editingGroupId === id) {
        STATE.editingGroupId = null; // exit edit mode if active
    }

    const idx = STATE.groups.findIndex(g => g.id === id);
    if (idx > -1) {
        const archived = STATE.groups.splice(idx, 1)[0];
        archived.archivedAt = new Date().toISOString();
        STATE.archived.push(archived);
        saveData();

        // If we were in edit view for this group, go home
        const hashId = window.location.hash.split('/')[1];
        if (hashId === id) {
            switchView('home');
        }
        renderHome();
    }
};

// Archive button in edit view
const archiveBtn = document.getElementById('archive-btn');
archiveBtn.addEventListener('click', () => {
    if (STATE.editingGroupId) {
        window.archiveRoutine(STATE.editingGroupId);
    }
});

// --- AUDIO SYSTEM ---

let audioCtx = null;
let audioVolume = 1.0;
let audioMuted = localStorage.getItem('workoutAudioMuted') === 'true';

function getAudioContext() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
}

function playChime() {
    if (audioMuted) return;
    try {
        const ctx = getAudioContext();
        const gainNode = ctx.createGain();
        gainNode.gain.value = audioVolume;
        gainNode.connect(ctx.destination);

        // 4-note Westminster-style chime
        const frequencies = [659.25, 523.25, 587.33, 392.00]; // E5, C5, D5, G4
        const durations = [0.6, 0.6, 0.6, 1.2]; // note length in seconds
        const spacing = 0.5; // gap between note starts in seconds
        frequencies.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = freq;

            const noteGain = ctx.createGain();
            const startTime = ctx.currentTime + i * spacing;
            noteGain.gain.setValueAtTime(0, startTime);
            noteGain.gain.linearRampToValueAtTime(audioVolume * 0.7, startTime + 0.06);
            noteGain.gain.exponentialRampToValueAtTime(0.001, startTime + durations[i]);

            osc.connect(noteGain);
            noteGain.connect(gainNode);
            osc.start(startTime);
            osc.stop(startTime + durations[i] + 0.1);
        });
    } catch (e) {
        // Audio playback failed silently — non-critical
    }
}

// Settings dropdown toggle
const settingsBtn = document.getElementById('settings-btn');
const settingsMenu = document.getElementById('settings-menu');

settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.classList.toggle('hidden');
});

document.addEventListener('click', () => {
    settingsMenu.classList.add('hidden');
    closeAllCardMenus();
});

// Mute toggle (in settings dropdown)
const muteToggle = document.getElementById('mute-toggle');
muteToggle.innerHTML = audioMuted ? '<span class="material-icons-outlined">volume_off</span> Sound Off' : '<span class="material-icons-outlined">volume_up</span> Sound On';

muteToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    audioMuted = !audioMuted;
    muteToggle.innerHTML = audioMuted ? '<span class="material-icons-outlined">volume_off</span> Sound Off' : '<span class="material-icons-outlined">volume_up</span> Sound On';
    localStorage.setItem('workoutAudioMuted', audioMuted);
});

// Card menu helpers
window.toggleCardMenu = (btn) => {
    const menu = btn.nextElementSibling;
    const wasHidden = menu.classList.contains('hidden');
    closeAllCardMenus();
    if (wasHidden) menu.classList.remove('hidden');
};

window.closeAllCardMenus = () => {
    document.querySelectorAll('.card-dropdown-menu').forEach(m => m.classList.add('hidden'));
};

// --- WORKOUT MODE LOGIC ---

let workoutTimerInterval;
let workoutStartTime;

window.startWorkout = (groupId, skipHash) => {
    const group = STATE.groups.find(g => g.id === groupId);
    if (!group || group.exercises.length === 0) return;

    STATE.activeWorkout = {
        group: group,
        exIndex: 0,
        setIndex: 1,
        state: 'IDLE',
        setStartTime: null,
        restEndTime: null,
        completedSets: [],
        completedRests: []
    };

    // Initialize completed sets/rests tracking
    group.exercises.forEach(() => {
        STATE.activeWorkout.completedSets.push([]);
        STATE.activeWorkout.completedRests.push([]);
    });

    // Load saved progress if any
    const saved = loadWorkoutProgress(groupId);
    if (saved) {
        STATE.activeWorkout.exIndex = saved.exIndex || 0;
        STATE.activeWorkout.setIndex = saved.setIndex || 1;
        if (saved.completedSets) STATE.activeWorkout.completedSets = saved.completedSets;
        if (saved.completedRests) STATE.activeWorkout.completedRests = saved.completedRests;
    }

    workoutStartTime = Date.now();
    startWorkoutTimer();
    updateWorkoutUI();
    switchView('workout', true);
    if (!skipHash) {
        updateHash('workout/' + groupId);
    }
};

function startWorkoutTimer() {
    clearInterval(workoutTimerInterval);
    workoutTimerInterval = setInterval(() => {
        if (!STATE.activeWorkout) return;
        const { state, restEndTime, setStartTime } = STATE.activeWorkout;
        if (state === 'REST') {
            const remaining = Math.ceil((restEndTime - Date.now()) / 1000);
            if (remaining <= 0) {
                activeTimerDisplay.textContent = '00:00';
                finishRest(true);
            } else {
                activeTimerDisplay.textContent = formatTimeSeconds(remaining);
            }
        } else if (state === 'WORK' && setStartTime) {
            const elapsed = Math.floor((Date.now() - setStartTime) / 1000);
            activeTimerDisplay.textContent = formatTimeSeconds(elapsed);
        }
        // IDLE: timer stays at 00:00, no counting
    }, 100);
}

function formatTimeSeconds(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
}

function updateWorkoutUI() {
    const { group, exIndex, setIndex, state, completedSets } = STATE.activeWorkout;
    const exercise = group.exercises[exIndex];



    // Collapse header on exercise change (mobile)
    workoutHeaderEl.classList.remove('expanded');

    // Exercise header
    currentExName.textContent = exercise.name;
    currentExMeta.textContent = `${exercise.tool} • ${exercise.weight} ${exercise.unit || 'lbs'}`;

    // Media Logic
    const thumbUrl = getThumbnailUrl(exercise.link, exercise.img);
    if (thumbUrl && !thumbUrl.includes('svg')) {
        currentExThumb.src = thumbUrl;
        currentExThumb.classList.remove('hidden');
        whThumb.src = thumbUrl;
        whThumb.classList.remove('no-thumb');
    } else {
        currentExThumb.classList.add('hidden');
        whThumb.src = '';
        whThumb.classList.add('no-thumb');
    }

    if (exercise.link) {
        currentExLink.href = exercise.link;
        currentExLink.classList.remove('hidden');
    } else {
        currentExLink.classList.add('hidden');
    }

    // Exercise pills navigation — reuse shared progress pills
    exercisePills.innerHTML = buildProgressPillsHtml(group, exIndex, completedSets);
    // Attach click handlers to each pill
    exercisePills.querySelectorAll('.progress-pill').forEach((pill, idx) => {
        pill.style.cursor = 'pointer';
        pill.addEventListener('click', () => {
            STATE.activeWorkout.exIndex = idx;
            STATE.activeWorkout.setIndex = findNextIncompleteSet(idx);
            STATE.activeWorkout.state = 'IDLE';
            STATE.activeWorkout.setStartTime = null;
            activeTimerDisplay.textContent = '00:00';
            updateWorkoutUI();
        });
    });

    // Reps badge — show "Resting" during rest, otherwise reps
    if (state === 'REST') {
        targetRepsDisplay.textContent = 'Resting';
        targetRepsDisplay.classList.add('resting');
    } else {
        targetRepsDisplay.textContent = `${exercise.reps} reps`;
        targetRepsDisplay.classList.remove('resting');
    }

    // Render sets grid with rest cards
    const totalSets = parseInt(exercise.sets) || 3;
    const completed = completedSets[exIndex] || [];
    const completedR = STATE.activeWorkout.completedRests[exIndex] || [];
    setsContainer.innerHTML = '';

    for (let i = 1; i <= totalSets; i++) {
        const card = document.createElement('div');
        card.className = 'set-card';
        card.style.cursor = 'pointer'; // Make it clickable

        // Click handler for set
        card.addEventListener('click', () => {
            jumpToStep(exIndex, 'SET', i);
        });

        if (completed.includes(i)) {
            card.classList.add('completed');
            card.innerHTML = `<span class="set-label">Set</span><span class="set-number">✓</span>`;
        } else if (i === setIndex && state === 'WORK') {
            card.classList.add('active');
            card.innerHTML = `<span class="set-label">Set</span><span class="set-number">●</span>`;
        } else if (i === setIndex && state !== 'REST') {
            card.classList.add('active');
            card.innerHTML = `<span class="set-label">Set</span><span class="set-number">${i}</span>`;
        } else {
            card.classList.add('pending');
            card.innerHTML = `<span class="set-label">Set</span><span class="set-number">${i}</span>`;
        }
        setsContainer.appendChild(card);

        // Rest card between sets (not after last)
        if (i < totalSets && exercise.rest > 0) {
            const restCard = document.createElement('div');
            restCard.className = 'set-card rest-card';
            restCard.style.cursor = 'pointer'; // Make it clickable

            // Click handler for rest
            restCard.addEventListener('click', () => {
                jumpToStep(exIndex, 'REST', i);
            });

            if (completedR.includes(i)) {
                restCard.classList.add('rest-done');
                restCard.innerHTML = `<span class="set-label">Rest</span><span class="set-number">✓</span>`;
            } else if (state === 'REST' && completed.includes(i) && !completed.includes(i + 1)) {
                restCard.classList.add('rest-active');
                restCard.innerHTML = `<span class="set-label">Rest</span><span class="set-number">●</span>`;
            } else {
                restCard.innerHTML = `<span class="set-label">Rest</span><span class="set-number">${exercise.rest}s</span>`;
            }
            setsContainer.appendChild(restCard);
        }
    }

    // Rest-after-exercise card at end (before next exercise)
    const afterExRest = parseInt(exercise.betweenRest) || 120;
    if (afterExRest > 0 && exIndex < group.exercises.length - 1) {
        const allSetsComplete = completed.length >= totalSets;
        const globalRestCard = document.createElement('div');
        globalRestCard.className = 'set-card rest-card';
        globalRestCard.style.cursor = 'pointer';

        globalRestCard.addEventListener('click', () => {
            jumpToStep(exIndex, 'REST', -1);
        });

        if (completedR.includes(-1)) {
            globalRestCard.classList.add('rest-done');
            globalRestCard.innerHTML = `<span class="set-label">Rest</span><span class="set-number">✓</span>`;
        } else if (state === 'REST' && allSetsComplete) {
            globalRestCard.classList.add('rest-active');
            globalRestCard.innerHTML = `<span class="set-label">Rest</span><span class="set-number">●</span>`;
        } else {
            globalRestCard.innerHTML = `<span class="set-label">Rest</span><span class="set-number">${afterExRest}s</span>`;
        }
        setsContainer.appendChild(globalRestCard);
    }



    // Prev/Next exercise nav
    prevExerciseNav.innerHTML = '';
    if (exIndex > 0) {
        const prevBtn = document.createElement('div');
        prevBtn.className = 'set-card nav-card';
        prevBtn.innerHTML = `<span class="set-label">Prev</span><span class="set-number"><span class="material-icons-outlined">arrow_back</span></span>`;
        prevBtn.addEventListener('click', () => {
            STATE.activeWorkout.exIndex--;
            STATE.activeWorkout.setIndex = 1;
            STATE.activeWorkout.state = 'IDLE';
            STATE.activeWorkout.setStartTime = null;
            activeTimerDisplay.textContent = '00:00';
            updateWorkoutUI();
        });
        prevExerciseNav.appendChild(prevBtn);
    }

    nextExerciseNav.innerHTML = '';
    if (exIndex < group.exercises.length - 1) {
        const nextBtn = document.createElement('div');
        nextBtn.className = 'set-card nav-card';
        nextBtn.innerHTML = `<span class="set-label">Next</span><span class="set-number"><span class="material-icons-outlined">arrow_forward</span></span>`;
        nextBtn.addEventListener('click', () => {
            STATE.activeWorkout.exIndex++;
            STATE.activeWorkout.setIndex = 1;
            STATE.activeWorkout.state = 'IDLE';
            STATE.activeWorkout.setStartTime = null;
            activeTimerDisplay.textContent = '00:00';
            updateWorkoutUI();
        });
        nextExerciseNav.appendChild(nextBtn);
    }

    // Button state — unified action button for all states
    const allSetsComplete = completed.length >= totalSets;
    const isLastExercise = exIndex === group.exercises.length - 1;

    if (state === 'IDLE') {
        if (allSetsComplete && isLastExercise) {
            actionBtn.textContent = 'FINISH WORKOUT';
        } else if (allSetsComplete) {
            actionBtn.textContent = 'NEXT EXERCISE';
        } else {
            actionBtn.textContent = `START SET ${setIndex}`;
        }
        actionBtn.classList.remove('secondary');
        actionBtn.classList.add('primary');
        activeTimerDisplay.classList.remove('rest-mode');
        // Flash the timer and button when a set is ready to start
        const shouldFlash = !allSetsComplete;
        activeTimerDisplay.classList.toggle('idle-flash', shouldFlash);
        actionBtn.classList.toggle('idle-flash', shouldFlash);
    } else if (state === 'WORK') {
        actionBtn.textContent = 'END SET';
        actionBtn.classList.remove('primary');
        actionBtn.classList.add('secondary');
        activeTimerDisplay.classList.remove('rest-mode');
        activeTimerDisplay.classList.remove('idle-flash');
        actionBtn.classList.remove('idle-flash');
    } else {
        // REST — show END REST
        actionBtn.textContent = 'END REST';
        actionBtn.classList.remove('primary');
        actionBtn.classList.add('secondary');
        activeTimerDisplay.classList.add('rest-mode');
        activeTimerDisplay.classList.remove('idle-flash');
        actionBtn.classList.remove('idle-flash');
    }
}


function jumpToStep(targetExIndex, type, targetIndex) {
    // 1. Reset timer/state
    STATE.activeWorkout.state = 'IDLE';
    STATE.activeWorkout.setStartTime = null;
    activeTimerDisplay.textContent = '00:00';

    // 2. Update Exercise Index
    STATE.activeWorkout.exIndex = targetExIndex;

    const group = STATE.activeWorkout.group;
    const exercise = group.exercises[targetExIndex];
    const totalSets = parseInt(exercise.sets) || 3;

    // 3. Mark sets/rests as completed or not based on target
    const newCompletedSets = [];
    const newCompletedRests = [];

    // Determine the "cutoff" point
    // If targeting Set 3, Set 1&2 are done. Set 3 is not.
    // If targeting Rest 2, Set 1,2 and Rest 1 are done. Rest 2 is current (active).

    if (type === 'SET') {
        // Before target set
        for (let i = 1; i < targetIndex; i++) {
            newCompletedSets.push(i);
        }

        // Rests before target set
        // Rest 1 comes after Set 1. So if we are at Set 3, Rest 1 and Rest 2 are done.
        for (let i = 1; i < targetIndex; i++) {
            // Check if rest exists for this step
            if (exercise.rest > 0) newCompletedRests.push(i);
        }

        // Set state for the target
        STATE.activeWorkout.setIndex = targetIndex;
        STATE.activeWorkout.state = 'IDLE';

    } else if (type === 'REST') {
        // Target is a rest period
        // If target is Rest 2: Set 1, Set 2 are done. Rest 1 is done.

        // Global rest (-1) implies all sets done
        if (targetIndex === -1) {
            for (let i = 1; i <= totalSets; i++) newCompletedSets.push(i);
            // All normal rests done
            for (let i = 1; i < totalSets; i++) if (exercise.rest > 0) newCompletedRests.push(i);

            STATE.activeWorkout.setIndex = totalSets; // or technically "after" last set

            // Enter Rest
            STATE.activeWorkout.state = 'REST';
            STATE.activeWorkout.restAfterSet = -1;
            const afterExRestVal = parseInt(exercise.betweenRest) || 120;
            STATE.activeWorkout.restEndTime = Date.now() + (afterExRestVal * 1000);

        } else {
            // Normal rest (e.g. Rest 2)
            // Sets up to and including targetIndex are done
            for (let i = 1; i <= targetIndex; i++) newCompletedSets.push(i);

            // Rests before targetIndex are done
            for (let i = 1; i < targetIndex; i++) if (exercise.rest > 0) newCompletedRests.push(i);

            STATE.activeWorkout.setIndex = targetIndex; // associated set

            // Enter Rest
            STATE.activeWorkout.state = 'REST';
            STATE.activeWorkout.restAfterSet = targetIndex;
            STATE.activeWorkout.restEndTime = Date.now() + (exercise.rest * 1000);
        }
    }

    STATE.activeWorkout.completedSets[targetExIndex] = newCompletedSets;
    STATE.activeWorkout.completedRests[targetExIndex] = newCompletedRests;

    saveWorkoutProgress();
    updateWorkoutUI();
}

function findNextIncompleteSet(exIndex) {
    const exercise = STATE.activeWorkout.group.exercises[exIndex];
    const totalSets = parseInt(exercise.sets) || 3;
    const completed = STATE.activeWorkout.completedSets[exIndex] || [];
    for (let i = 1; i <= totalSets; i++) {
        if (!completed.includes(i)) return i;
    }
    return totalSets; // all done
}

actionBtn.addEventListener('click', () => {
    if (!STATE.activeWorkout) return;
    const { group, exIndex, setIndex, state, completedSets } = STATE.activeWorkout;
    const exercise = group.exercises[exIndex];
    const totalSets = parseInt(exercise.sets) || 3;
    const allComplete = completedSets[exIndex].length >= totalSets;

    if (state === 'IDLE') {
        if (allComplete) {
            // All sets done — check for rest-after-exercise before next exercise
            const afterExRestVal1 = parseInt(exercise.betweenRest) || 120;
            const completedR = completedSets[exIndex] ? (STATE.activeWorkout.completedRests[exIndex] || []) : [];
            if (exIndex < group.exercises.length - 1 && afterExRestVal1 > 0 && !completedR.includes(-1)) {
                // Start rest after exercise
                STATE.activeWorkout.state = 'REST';
                STATE.activeWorkout.restAfterSet = -1; // marker for after-exercise rest
                STATE.activeWorkout.restEndTime = Date.now() + (afterExRestVal1 * 1000);
                saveWorkoutProgress();
                updateWorkoutUI();
            } else if (exIndex < group.exercises.length - 1) {
                STATE.activeWorkout.exIndex++;
                STATE.activeWorkout.setIndex = findNextIncompleteSet(exIndex + 1);
                STATE.activeWorkout.state = 'IDLE';
                saveWorkoutProgress();
                updateWorkoutUI();
            } else {
                finishWorkout();
            }
        } else {
            // START SET — transition to WORK
            STATE.activeWorkout.state = 'WORK';
            STATE.activeWorkout.setStartTime = Date.now();
            activeTimerDisplay.textContent = '00:00';
            updateWorkoutUI();
        }
    } else if (state === 'REST') {
        // Skip rest — same as finishRest
        finishRest();
    } else if (state === 'WORK') {
        // END SET — mark complete
        if (!completedSets[exIndex].includes(setIndex)) {
            completedSets[exIndex].push(setIndex);
        }
        const nextIncomplete = findNextIncompleteSet(exIndex);
        STATE.activeWorkout.setIndex = nextIncomplete;
        STATE.activeWorkout.setStartTime = null;

        const stillRemaining = completedSets[exIndex].length < totalSets;
        if (stillRemaining && exercise.rest > 0) {
            // Rest between sets
            startRest(setIndex);
        } else if (!stillRemaining) {
            // All sets done — check for rest-after-exercise before next exercise
            const afterExRestVal2 = parseInt(exercise.betweenRest) || 120;
            const completedR = STATE.activeWorkout.completedRests[exIndex] || [];
            if (exIndex < group.exercises.length - 1 && afterExRestVal2 > 0 && !completedR.includes(-1)) {
                // Start rest after exercise
                STATE.activeWorkout.state = 'REST';
                STATE.activeWorkout.restAfterSet = -1;
                STATE.activeWorkout.restEndTime = Date.now() + (afterExRestVal2 * 1000);
                saveWorkoutProgress();
                updateWorkoutUI();
            } else {
                STATE.activeWorkout.state = 'IDLE';
                activeTimerDisplay.textContent = '00:00';
                saveWorkoutProgress();
                updateWorkoutUI();
            }
        } else {
            STATE.activeWorkout.state = 'IDLE';
            activeTimerDisplay.textContent = '00:00';
            saveWorkoutProgress();
            updateWorkoutUI();
        }
    }
});

// SPACE key triggers the action button during active workouts
document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space') return;
    // Don't intercept when typing in inputs, textareas, or selects
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    // Only trigger during an active workout on the workout view
    if (!STATE.activeWorkout || views.workout.classList.contains('hidden')) return;
    e.preventDefault();
    actionBtn.click();
});

function startRest(afterSetIndex) {
    const { group, exIndex } = STATE.activeWorkout;
    const exercise = group.exercises[exIndex];

    STATE.activeWorkout.state = 'REST';
    STATE.activeWorkout.restAfterSet = afterSetIndex;
    STATE.activeWorkout.restEndTime = Date.now() + (exercise.rest * 1000);
    saveWorkoutProgress();
    updateWorkoutUI();
}

function finishRest(natural = false) {
    if (!STATE.activeWorkout) return;
    const { exIndex, restAfterSet, group } = STATE.activeWorkout;

    // Mark this rest as completed
    if (restAfterSet != null && !STATE.activeWorkout.completedRests[exIndex].includes(restAfterSet)) {
        STATE.activeWorkout.completedRests[exIndex].push(restAfterSet);
    }

    // Play chime only on natural timer expiry
    if (natural) playChime();

    // If global rest (-1), advance to next exercise
    if (restAfterSet === -1 && exIndex < group.exercises.length - 1) {
        STATE.activeWorkout.exIndex++;
        STATE.activeWorkout.setIndex = findNextIncompleteSet(STATE.activeWorkout.exIndex);
    }

    STATE.activeWorkout.state = 'IDLE';
    STATE.activeWorkout.setStartTime = null;
    STATE.activeWorkout.restAfterSet = null;
    activeTimerDisplay.textContent = '00:00';
    saveWorkoutProgress();
    updateWorkoutUI();
}

// Back button — go back exactly one step (set or rest), including between exercises
document.getElementById('back-btn').addEventListener('click', () => {
    if (!STATE.activeWorkout) return;
    const { group, exIndex, completedSets, completedRests, state } = STATE.activeWorkout;
    const exercise = group.exercises[exIndex];
    const totalSets = parseInt(exercise.sets) || 3;

    if (state === 'REST') {
        const restAfterSet = STATE.activeWorkout.restAfterSet;

        // Determine which set to un-complete
        let setToUncomplete = restAfterSet;
        if (setToUncomplete === -1) {
            // If global rest, it was the last set
            setToUncomplete = parseInt(exercise.sets) || 3;
        }

        // Remove from completed sets
        if (setToUncomplete != null) {
            const sIdx = completedSets[exIndex].indexOf(setToUncomplete);
            if (sIdx >= 0) completedSets[exIndex].splice(sIdx, 1);

            // Also revert set index to this set
            STATE.activeWorkout.setIndex = setToUncomplete;
        }

        // Cancel rest marker if it exists in completedRests (rare but possible if logic changes)
        // actually restAfterSet isn't added to completedRests until finishRest(), so we don't need to remove it from there
        // unless we are in a state where it was pre-added? No, finishRest adds it.
        // But wait, the original code tried to remove it from completedRests?
        // "const rIdx = completedRests[exIndex].indexOf(restAfterSet);"
        // It seems the previous logic assumed it might be there? 
        // Actually, if we are *in* REST, we haven't finished it, so it shouldn't be in completedRests yet.
        // However, let's keep the safety check just in case.
        if (restAfterSet != null) {
            const rIdx = completedRests[exIndex].indexOf(restAfterSet);
            if (rIdx >= 0) completedRests[exIndex].splice(rIdx, 1);
        }

        STATE.activeWorkout.state = 'IDLE';
        STATE.activeWorkout.restAfterSet = null;
        activeTimerDisplay.textContent = '00:00';
    } else if (state === 'WORK') {
        // Cancel current set timer
        STATE.activeWorkout.state = 'IDLE';
        STATE.activeWorkout.setStartTime = null;
        activeTimerDisplay.textContent = '00:00';

        // If there was a rest immediately before this set (i.e. set > 1), go back to it
        if (STATE.activeWorkout.setIndex > 1) {
            const prevSet = STATE.activeWorkout.setIndex - 1;
            // Check if that previous rest was completed
            if (completedRests[exIndex].includes(prevSet)) {
                // Remove it from completed
                const rIdx = completedRests[exIndex].indexOf(prevSet);
                if (rIdx >= 0) completedRests[exIndex].splice(rIdx, 1);

                // Enter REST state
                STATE.activeWorkout.state = 'REST';
                STATE.activeWorkout.restAfterSet = prevSet;
                STATE.activeWorkout.restEndTime = Date.now() + (exercise.rest * 1000);
                // Note: setIndex stays at current (upcoming) set
            }
        }
    } else {
        // IDLE — undo the last completed step
        // Check if there are completed rests for this exercise that should be undone
        const lastCompletedSet = completedSets[exIndex].length > 0 ? Math.max(...completedSets[exIndex]) : 0;

        // Find the absolute last completed rest
        // Note: global rest is -1. 
        // We need to handle: 
        // 1. Normal rest (e.g. Set 1 -> Rest 1 -> IDLE Set 2)
        // 2. Global rest (e.g. Ex 1 Done -> Global Rest -> IDLE Ex 2)

        const completedRestsForEx = completedRests[exIndex].filter(r => r > 0);
        const hasGlobalRest = completedRests[exIndex].includes(-1);

        const lastNormalRest = completedRestsForEx.length > 0 ? Math.max(...completedRestsForEx) : 0;

        // Scenario 1: Just finished a normal rest (Set X -> Rest X -> We are at Set X+1 IDLE)
        // We want to go back to Rest X
        if (lastNormalRest > 0 && lastNormalRest >= lastCompletedSet) {
            const rIdx = completedRests[exIndex].indexOf(lastNormalRest);
            if (rIdx >= 0) completedRests[exIndex].splice(rIdx, 1);

            // Go to REST state
            STATE.activeWorkout.state = 'REST';
            STATE.activeWorkout.restAfterSet = lastNormalRest;
            STATE.activeWorkout.restEndTime = Date.now() + (exercise.rest * 1000);
            STATE.activeWorkout.setIndex = lastNormalRest + 1; // Ensure we are targeting the next set

        } else if (completedSets[exIndex].length > 0) {
            // Scenario 2: Just finished a set (Set X -> IDLE, no rest yet or rest skipped)
            // Undo that set
            const lastSet = completedSets[exIndex].pop();
            STATE.activeWorkout.setIndex = lastSet;
        } else if (exIndex > 0) {
            // Scenario 3: At start of new exercise (Ex 2 IDLE)
            // Check if we came from a global rest
            // We need to look at PREVIOUS exercise's completed rests to see if -1 is there
            const prevIdx = exIndex - 1;
            const prevGroupRest = completedRests[prevIdx].includes(-1);

            if (prevGroupRest) {
                // Back into Global Rest
                const rIdx = completedRests[prevIdx].indexOf(-1);
                if (rIdx >= 0) completedRests[prevIdx].splice(rIdx, 1);

                STATE.activeWorkout.exIndex = prevIdx; // Go back to prev ex context (conceptually)
                // actually wait, global rest happens "between" exercises but visually we might want to stay on current?
                // No, global rest card is at end of Prev Ex.

                const prevExercise = group.exercises[prevIdx];
                const prevTotalSets = parseInt(prevExercise.sets) || 3;

                STATE.activeWorkout.state = 'REST';
                STATE.activeWorkout.restAfterSet = -1;
                const afterExRestVal3 = parseInt(prevExercise.betweenRest) || 120;
                STATE.activeWorkout.restEndTime = Date.now() + (afterExRestVal3 * 1000);

                STATE.activeWorkout.setIndex = prevTotalSets; // technically done
            } else {
                // Just go back to previous exercise end state (IDLE at end)
                STATE.activeWorkout.exIndex = prevIdx;
                const prevExercise = group.exercises[prevIdx];
                const prevTotalSets = parseInt(prevExercise.sets) || 3;
                STATE.activeWorkout.setIndex = prevTotalSets;

                // If the previous exercise was fully complete, we might want to un-complete its last set? 
                // That depends on user intent. Standard "Back" usually just undoes navigation.
                // Let's just go to the end of that exercise.
            }
        }
    }
    saveWorkoutProgress();
    updateWorkoutUI();
});

// Complete Set — mark all sets for current exercise as done
document.getElementById('complete-exercise-btn').addEventListener('click', () => {
    if (!STATE.activeWorkout) return;
    const { group, exIndex, completedSets } = STATE.activeWorkout;
    const exercise = group.exercises[exIndex];
    const totalSets = parseInt(exercise.sets) || 3;

    // Mark all sets as completed
    completedSets[exIndex] = Array.from({ length: totalSets }, (_, i) => i + 1);

    // Mark all rests as completed
    const rests = [];
    if (exercise.rest > 0) {
        for (let i = 1; i < totalSets; i++) rests.push(i);
    }
    const exAfterRest = parseInt(exercise.betweenRest) || 120;
    if (exAfterRest > 0 && exIndex < group.exercises.length - 1) {
        rests.push(-1);
    }
    STATE.activeWorkout.completedRests[exIndex] = rests;
    STATE.activeWorkout.setIndex = totalSets;
    STATE.activeWorkout.state = 'IDLE';
    STATE.activeWorkout.setStartTime = null;
    activeTimerDisplay.textContent = '00:00';
    saveWorkoutProgress();
    updateWorkoutUI();
});

// Reset Set — clear all progress for current exercise
document.getElementById('reset-exercise-btn').addEventListener('click', () => {
    if (!STATE.activeWorkout) return;
    const { exIndex } = STATE.activeWorkout;
    STATE.activeWorkout.completedSets[exIndex] = [];
    STATE.activeWorkout.completedRests[exIndex] = [];
    STATE.activeWorkout.setIndex = 1;
    STATE.activeWorkout.state = 'IDLE';
    STATE.activeWorkout.setStartTime = null;
    activeTimerDisplay.textContent = '00:00';
    saveWorkoutProgress();
    updateWorkoutUI();
});

// Edit current exercise from workout view
let _workoutEditObserver = null;

document.getElementById('edit-current-exercise').addEventListener('click', () => {
    if (!STATE.activeWorkout) return;
    const { group, exIndex } = STATE.activeWorkout;

    // Disconnect any previous observer to prevent leaks
    if (_workoutEditObserver) {
        _workoutEditObserver.disconnect();
        _workoutEditObserver = null;
    }

    // Switch to edit context so the modal works
    STATE.editingGroupId = group.id;
    tempExercises = [...group.exercises];

    openExerciseModal(exIndex, true); // skipHash = true

    // Watch for modal close via MutationObserver
    _workoutEditObserver = new MutationObserver(() => {
        if (exerciseModal.classList.contains('hidden')) {
            group.exercises = [...tempExercises];
            saveData();
            updateWorkoutUI();
            _workoutEditObserver.disconnect();
            _workoutEditObserver = null;
        }
    });
    _workoutEditObserver.observe(exerciseModal, { attributes: true, attributeFilter: ['class'] });
});

function finishWorkout() {
    clearInterval(workoutTimerInterval);

    const elapsedSeconds = Math.floor((Date.now() - workoutStartTime) / 1000);
    const duration = formatTimeSeconds(elapsedSeconds);

    // Record in history but keep progress visible on home page
    STATE.history.unshift({
        date: new Date().toISOString(),
        groupName: STATE.activeWorkout.group.name,
        duration: duration
    });
    saveData();
    saveWorkoutProgress(); // preserve completed sets so home shows them
    switchView('home');
    renderHome();
}

// Reset All button — clears progress for all routines
function resetAllProgress() {
    STATE.groups.forEach(group => {
        clearWorkoutProgress(group.id);
    });
    renderHome();
}
document.getElementById('reset-all-btn-desktop').addEventListener('click', resetAllProgress);
document.getElementById('reset-all-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.classList.add('hidden');
    resetAllProgress();
});

// --- BACKUP LOGIC ---

backupBtn.addEventListener('click', () => backupModal.classList.remove('hidden'));
closeBackupBtn.addEventListener('click', () => backupModal.classList.add('hidden'));
backupModal.addEventListener('click', (e) => {
    if (e.target === backupModal) backupModal.classList.add('hidden');
});

exportBtn.addEventListener('click', () => {
    const now = new Date();
    const ts = now.getFullYear() + '_'
        + String(now.getMonth() + 1).padStart(2, '0') + '_'
        + String(now.getDate()).padStart(2, '0') + '_'
        + String(now.getHours()).padStart(2, '0')
        + String(now.getMinutes()).padStart(2, '0');
    const filename = `workout_backup_${ts}.json`;
    const progress = {};
    STATE.groups.forEach(g => {
        const key = 'workoutProgress_' + g.id;
        const data = localStorage.getItem(key);
        if (data) progress[g.id] = JSON.parse(data);
    });

    // Write globalRest on each group for backward compatibility with older versions
    const exportGroups = STATE.groups.map(g => ({
        ...g,
        globalRest: g.exercises.length > 0
            ? (parseInt(g.exercises[0].betweenRest) || 120)
            : 120
    }));

    const exportData = {
        groups: exportGroups,
        archived: STATE.archived,
        history: STATE.history,
        progress: progress
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportData));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", filename);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
});

importFile.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const parsed = JSON.parse(event.target.result);
            if (parsed.groups && Array.isArray(parsed.groups)) {
                if (!confirm('This will replace all your current routines, history, and progress. Continue?')) {
                    importFile.value = '';
                    return;
                }
                // Migrate: seed betweenRest on exercises that don't have it
                STATE.groups = parsed.groups.map(g => ({
                    ...g,
                    exercises: (g.exercises || []).map(ex => ({
                        ...ex,
                        betweenRest: ex.betweenRest ?? (parseInt(g.globalRest) || 120)
                    }))
                }));
                STATE.archived = parsed.archived || [];
                STATE.history = parsed.history || [];

                // Clear existing progress
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith('workoutProgress_')) localStorage.removeItem(key);
                });

                // Restore progress if present
                if (parsed.progress) {
                    Object.keys(parsed.progress).forEach(groupId => {
                        localStorage.setItem('workoutProgress_' + groupId, JSON.stringify(parsed.progress[groupId]));
                    });
                }

                saveData();
                renderHome();
                backupModal.classList.add('hidden');
                alert('Data loaded successfully!');
            } else {
                alert('Invalid file format');
            }
        } catch (err) {
            alert('Error parsing file');
            importFile.value = '';
        }
    };
    reader.readAsText(file);
});

// --- HISTORY MODAL LOGIC ---

function renderHistory() {
    historyList.innerHTML = '';
    if (STATE.history.length === 0) {
        historyList.innerHTML = '<div class="empty-state">No workout history yet.</div>';
        clearHistoryBtn.classList.add('hidden');
        return;
    }
    clearHistoryBtn.classList.remove('hidden');
    STATE.history.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'history-entry';
        const d = new Date(entry.date);
        const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        div.innerHTML = `
            <div class="history-entry-header">
                <span class="card-title">${entry.groupName}</span>
                <span class="card-meta">${entry.duration}</span>
            </div>
            <div class="card-meta">${dateStr} at ${timeStr}</div>
        `;
        historyList.appendChild(div);
    });
}

viewHistoryBtn.addEventListener('click', () => {
    renderHistory();
    historyModal.classList.remove('hidden');
});

closeHistoryBtn.addEventListener('click', () => historyModal.classList.add('hidden'));

historyModal.addEventListener('click', (e) => {
    if (e.target === historyModal) historyModal.classList.add('hidden');
});

clearHistoryBtn.addEventListener('click', () => {
    if (!confirm('Clear all workout history? This cannot be undone.')) return;
    STATE.history = [];
    saveData();
    renderHistory();
});

// Delete All Data button logic
const deleteAllDataBtn = document.getElementById('delete-all-data-btn');
if (deleteAllDataBtn) {
    deleteAllDataBtn.addEventListener('click', () => {
        if (!confirm('WARNING: This will permanently delete ALL routines, history, and settings. This cannot be undone. Are you sure?')) return;
        localStorage.clear();
        STATE.groups = [];
        STATE.archived = [];
        STATE.history = [];
        STATE.activeWorkout = null;
        STATE.editingGroupId = null;

        // Re-init with defaults if needed, or just reload to flush everything
        alert('All data has been deleted.');
        location.reload();
    });
}

// --- ARCHIVE MODAL LOGIC ---

const archiveModal = document.getElementById('archive-modal');
const archiveList = document.getElementById('archive-list');
const closeArchiveBtn = document.getElementById('close-archive');
const viewArchiveBtn = document.getElementById('view-archive-btn');

function renderArchive() {
    archiveList.innerHTML = '';
    // Reset select-all checkbox on each render
    const selectAllCb = document.getElementById('archive-select-all');
    if (selectAllCb) selectAllCb.checked = false;

    if (STATE.archived.length === 0) {
        archiveList.innerHTML = '<div class="empty-state">No archived routines.</div>';
        document.getElementById('archive-bulk-actions').classList.add('hidden');
        return;
    }
    document.getElementById('archive-bulk-actions').classList.remove('hidden');
    STATE.archived.forEach((group, idx) => {
        const div = document.createElement('div');
        div.className = 'history-entry archive-entry';
        const d = group.archivedAt ? new Date(group.archivedAt) : null;
        const dateStr = d ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '';
        div.innerHTML = `
            <div class="archive-entry-row">
                <input type="checkbox" class="archive-checkbox" data-idx="${idx}">
                <div class="archive-entry-info">
                    <span class="card-title">${group.name}</span>
                    ${dateStr ? `<span class="card-meta">Archived ${dateStr}</span>` : ''}
                </div>
                <div class="archive-entry-actions">
                    <button class="btn secondary small" onclick="restoreFromArchive(${idx})">Restore</button>
                    <button class="btn danger-outline small" onclick="deleteFromArchive(${idx})">Delete</button>
                </div>
            </div>
        `;
        archiveList.appendChild(div);
    });
}

window.restoreFromArchive = (idx) => {
    if (idx < 0 || idx >= STATE.archived.length) return;
    const group = STATE.archived.splice(idx, 1)[0];
    delete group.archivedAt;
    STATE.groups.push(group);
    saveData();
    renderArchive();
    renderHome();
};

window.deleteFromArchive = (idx) => {
    if (idx < 0 || idx >= STATE.archived.length) return;
    if (!confirm(`Permanently delete "${STATE.archived[idx].name}"? This cannot be undone.`)) return;
    STATE.archived.splice(idx, 1);
    saveData();
    renderArchive();
};

// Bulk actions
document.getElementById('bulk-restore-btn').addEventListener('click', () => {
    const checked = getCheckedArchiveIndexes();
    if (checked.length === 0) return;
    // Process in reverse to preserve indexes
    checked.sort((a, b) => b - a).forEach(idx => {
        const group = STATE.archived.splice(idx, 1)[0];
        delete group.archivedAt;
        STATE.groups.push(group);
    });
    saveData();
    renderArchive();
    renderHome();
});

document.getElementById('bulk-delete-btn').addEventListener('click', () => {
    const checked = getCheckedArchiveIndexes();
    if (checked.length === 0) return;
    if (!confirm(`Permanently delete ${checked.length} routine(s)? This cannot be undone.`)) return;
    checked.sort((a, b) => b - a).forEach(idx => STATE.archived.splice(idx, 1));
    saveData();
    renderArchive();
});

function getCheckedArchiveIndexes() {
    return Array.from(archiveList.querySelectorAll('.archive-checkbox:checked')).map(cb => Number(cb.dataset.idx));
}

// Select / Deselect All toggle
document.getElementById('archive-select-all').addEventListener('change', (e) => {
    const checked = e.target.checked;
    archiveList.querySelectorAll('.archive-checkbox').forEach(cb => cb.checked = checked);
});

viewArchiveBtn.addEventListener('click', () => {
    renderArchive();
    archiveModal.classList.remove('hidden');
});

closeArchiveBtn.addEventListener('click', () => archiveModal.classList.add('hidden'));

archiveModal.addEventListener('click', (e) => {
    if (e.target === archiveModal) archiveModal.classList.add('hidden');
});

// --- CLOUD SYNC LOGIC ---

function showSyncError(msg) {
    syncError.textContent = msg;
    syncError.classList.remove('hidden');
    setTimeout(() => syncError.classList.add('hidden'), 4000);
}

// Helper: persist sync token to localStorage + JS cookie (cookie fallback)
function saveSyncToken(token, name) {
    if (token) {
        localStorage.setItem('syncToken', token);
        if (name) localStorage.setItem('syncName', name);
        // Also set a JS-accessible cookie as fallback if localStorage is lost (e.g. origin change)
        document.cookie = 'wt_sync_token=' + token + ';path=/;max-age=' + (365 * 86400) + ';samesite=Lax';
        if (name) document.cookie = 'wt_sync_name=' + encodeURIComponent(name) + ';path=/;max-age=' + (365 * 86400) + ';samesite=Lax';
    }
}
function clearSyncToken() {
    localStorage.removeItem('syncToken');
    localStorage.removeItem('syncName');
    document.cookie = 'wt_sync_token=;path=/;max-age=0';
    document.cookie = 'wt_sync_name=;path=/;max-age=0';
}
function getStoredSyncToken() {
    // Try localStorage first, fall back to JS cookie
    let token = localStorage.getItem('syncToken');
    let name = localStorage.getItem('syncName');
    if (token) return { token, name };
    // Fallback: read from JS cookie
    const cookies = document.cookie.split(';').reduce((acc, c) => {
        const [k, ...v] = c.trim().split('=');
        acc[k] = v.join('=');
        return acc;
    }, {});
    token = cookies['wt_sync_token'] || null;
    name = cookies['wt_sync_name'] ? decodeURIComponent(cookies['wt_sync_name']) : null;
    if (token) {
        // Restore to localStorage for next time
        localStorage.setItem('syncToken', token);
        if (name) localStorage.setItem('syncName', name);
    }
    return { token, name };
}
function getSyncHeaders() {
    const headers = { 'Content-Type': 'application/json' };
    if (SYNC.token) headers['Authorization'] = 'Bearer ' + SYNC.token;
    return headers;
}

function updateSyncUI() {
    if (SYNC.enabled) {
        syncIndicator.classList.remove('hidden');
        syncGuestSection.classList.add('hidden');
        syncLoggedInSection.classList.remove('hidden');
        syncDisplayName.textContent = SYNC.name;
    } else {
        syncIndicator.classList.add('hidden');
        syncGuestSection.classList.remove('hidden');
        syncLoggedInSection.classList.add('hidden');
    }
}

function setSyncingState(syncing) {
    if (syncing) {
        syncIndicator.classList.add('syncing');
        syncIndicator.querySelector('.material-icons-outlined').textContent = 'sync';
    } else {
        syncIndicator.classList.remove('syncing');
        syncIndicator.querySelector('.material-icons-outlined').textContent = 'cloud_done';
    }
}

function buildSyncPayload() {
    const progress = {};
    STATE.groups.forEach(g => {
        const data = localStorage.getItem('workoutProgress_' + g.id);
        if (data) progress[g.id] = JSON.parse(data);
    });
    return {
        groups: STATE.groups,
        archived: STATE.archived,
        history: STATE.history,
        progress: progress
    };
}

function applySyncData(data) {
    if (!data) return;

    // Only overwrite if server actually has data; don't nuke local data with empty server state
    const hasServerData = (data.groups && data.groups.length > 0) ||
                          (data.archived && data.archived.length > 0) ||
                          (data.history && data.history.length > 0);
    const hasLocalData = STATE.groups.length > 0 || STATE.archived.length > 0 || STATE.history.length > 0;

    if (!hasServerData && hasLocalData) {
        // Server is empty but we have local data — push local to server instead of wiping
        debouncedSyncSave();
        return;
    }

    STATE.groups = data.groups || [];
    STATE.archived = data.archived || [];
    STATE.history = data.history || [];

    // Clear old progress and restore from server
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('workoutProgress_')) localStorage.removeItem(key);
    });
    if (data.progress) {
        Object.keys(data.progress).forEach(groupId => {
            localStorage.setItem('workoutProgress_' + groupId, JSON.stringify(data.progress[groupId]));
        });
    }

    // Update localStorage main data
    localStorage.setItem('workoutTimerData', JSON.stringify({
        groups: STATE.groups,
        archived: STATE.archived,
        history: STATE.history
    }));
    renderHome();
}

async function syncSave() {
    if (!SYNC.enabled) return;
    setSyncingState(true);
    try {
        const resp = await fetch('api.php?action=save', {
            method: 'POST',
            headers: getSyncHeaders(),
            body: JSON.stringify(buildSyncPayload()),
            credentials: 'same-origin'
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            console.warn('Sync save failed:', err.error || resp.status);
        }
    } catch (e) {
        // Network error — silent, localStorage is the fallback
        console.warn('Sync save network error:', e.message);
    } finally {
        setSyncingState(false);
    }
}

function debouncedSyncSave() {
    if (!SYNC.enabled) return;
    clearTimeout(SYNC._saveTimeout);
    SYNC._saveTimeout = setTimeout(syncSave, 500);
}

async function syncLoad() {
    if (!SYNC.enabled) return;
    setSyncingState(true);
    try {
        const resp = await fetch('api.php?action=load', {
            headers: getSyncHeaders(),
            credentials: 'same-origin'
        });
        if (!resp.ok) return;
        const result = await resp.json();
        if (result.data) {
            applySyncData(result.data);
        }
    } catch (e) {
        console.warn('Sync load network error:', e.message);
    } finally {
        setSyncingState(false);
    }
}

function extractTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('u');
}

async function checkSyncAuth() {
    // 1. Check for URL token (new device link)
    const urlToken = extractTokenFromUrl();
    if (urlToken) {
        // Clean the URL
        const cleanUrl = window.location.origin + window.location.pathname + window.location.hash;
        window.history.replaceState({}, '', cleanUrl);

        // Show modal with token pre-filled for PIN entry
        syncModal.classList.remove('hidden');
        document.getElementById('sync-token-input').value = urlToken;
        updateSyncUI();
        return;
    }

    // 2. Try cookie-based auth first, then localStorage/cookie token fallback
    const stored = getStoredSyncToken();
    const storedToken = stored.token;
    const storedName = stored.name;
    const headers = {};
    if (storedToken) headers['Authorization'] = 'Bearer ' + storedToken;

    try {
        const resp = await fetch('api.php?action=check', {
            headers,
            credentials: 'same-origin'
        });
        if (resp.ok) {
            const result = await resp.json();
            SYNC.token = result.token;
            SYNC.name = result.name;
            SYNC.enabled = true;
            saveSyncToken(result.token, result.name);
            updateSyncUI();
            // Load data from server on startup
            await syncLoad();
        } else if (storedToken) {
            // Cookie failed but we have a localStorage token — clear stale token
            clearSyncToken();
        }
    } catch (e) {
        // Server unreachable — if we have cached data, stay with localStorage
        if (storedToken && storedName) {
            SYNC.token = storedToken;
            SYNC.name = storedName;
            // Don't enable sync (server is down), but at least show the indicator
        }
    }
}

// --- SYNC MODAL EVENTS ---

document.getElementById('sync-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    settingsMenu.classList.add('hidden');
    updateSyncUI();
    syncError.classList.add('hidden');
    syncModal.classList.remove('hidden');
});

document.getElementById('close-sync').addEventListener('click', () => syncModal.classList.add('hidden'));
syncModal.addEventListener('click', (e) => {
    if (e.target === syncModal) syncModal.classList.add('hidden');
});

// Register
document.getElementById('sync-register-btn').addEventListener('click', async () => {
    const name = document.getElementById('sync-name').value.trim();
    const pin = document.getElementById('sync-pin').value;

    if (!name) return showSyncError('Name is required');
    if (pin.length < 4) return showSyncError('PIN must be at least 4 characters');

    try {
        const resp = await fetch('api.php?action=register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, pin }),
            credentials: 'same-origin'
        });
        const result = await resp.json();
        if (!resp.ok) return showSyncError(result.error || 'Registration failed');

        SYNC.token = result.token;
        SYNC.name = result.name;
        SYNC.enabled = true;
        saveSyncToken(result.token, result.name);
        updateSyncUI();

        // Upload current local data to server
        await syncSave();
    } catch (e) {
        showSyncError('Network error — check your connection');
    }
});

// Login (link device)
document.getElementById('sync-login-btn').addEventListener('click', async () => {
    let tokenInput = document.getElementById('sync-token-input').value.trim();
    const pin = document.getElementById('sync-login-pin').value;

    // Extract token from URL if user pasted a full link
    try {
        const url = new URL(tokenInput);
        const params = new URLSearchParams(url.search);
        if (params.get('u')) tokenInput = params.get('u');
    } catch (e) {
        // Not a URL, treat as raw token
    }

    if (!tokenInput) return showSyncError('Token or link is required');
    if (!pin) return showSyncError('PIN is required');

    try {
        const resp = await fetch('api.php?action=login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: tokenInput, pin }),
            credentials: 'same-origin'
        });
        const result = await resp.json();
        if (!resp.ok) return showSyncError(result.error || 'Login failed');

        SYNC.token = tokenInput;
        SYNC.name = result.name;
        SYNC.enabled = true;
        saveSyncToken(tokenInput, result.name);
        updateSyncUI();

        // Load data from server (replaces local)
        await syncLoad();
    } catch (e) {
        showSyncError('Network error — check your connection');
    }
});

// Copy device link
document.getElementById('sync-copy-link').addEventListener('click', () => {
    if (!SYNC.token) return;
    const link = window.location.origin + window.location.pathname + '?u=' + SYNC.token;
    navigator.clipboard.writeText(link).then(() => {
        const btn = document.getElementById('sync-copy-link');
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        setTimeout(() => btn.textContent = orig, 2000);
    });
});

// Sync now
document.getElementById('sync-now-btn').addEventListener('click', async () => {
    await syncSave();
    await syncLoad();
    const btn = document.getElementById('sync-now-btn');
    const orig = btn.textContent;
    btn.textContent = 'Synced!';
    setTimeout(() => btn.textContent = orig, 2000);
});

// Logout
document.getElementById('sync-logout-btn').addEventListener('click', async () => {
    try {
        await fetch('api.php?action=logout', {
            headers: getSyncHeaders(),
            credentials: 'same-origin'
        });
    } catch (e) {}
    SYNC.token = null;
    SYNC.name = null;
    SYNC.enabled = false;
    clearSyncToken();
    updateSyncUI();
});

// Sync indicator click opens sync modal
syncIndicator.addEventListener('click', () => {
    updateSyncUI();
    syncError.classList.add('hidden');
    syncModal.classList.remove('hidden');
});

// --- COLLAPSIBLE WORKOUT HEADER (mobile) with text FLIP ---
const workoutHeaderHero = document.getElementById('workout-header-hero');

workoutHeaderHero.addEventListener('click', (e) => {
    // Don't toggle if clicking the edit button
    if (e.target.closest('.wh-edit-btn')) return;
    // Only toggle on mobile
    if (window.innerWidth > 600) return;

    const textEl = currentExName;
    const metaEl = currentExMeta;

    // FIRST – capture positions before toggle
    const nameFirst = textEl.getBoundingClientRect();
    const metaFirst = metaEl.getBoundingClientRect();

    // Toggle state
    workoutHeaderEl.classList.toggle('expanded');

    // LAST – read new positions
    const nameLast = textEl.getBoundingClientRect();
    const metaLast = metaEl.getBoundingClientRect();

    // INVERT + PLAY for name
    const ndx = nameFirst.left - nameLast.left;
    const ndy = nameFirst.top - nameLast.top;
    if (Math.abs(ndx) > 1 || Math.abs(ndy) > 1) {
        textEl.animate([
            { transform: `translate(${ndx}px, ${ndy}px)` },
            { transform: 'translate(0, 0)' }
        ], { duration: 280, easing: 'cubic-bezier(.4,0,.2,1)' });
    }

    // INVERT + PLAY for meta
    const mdx = metaFirst.left - metaLast.left;
    const mdy = metaFirst.top - metaLast.top;
    if (Math.abs(mdx) > 1 || Math.abs(mdy) > 1) {
        metaEl.animate([
            { transform: `translate(${mdx}px, ${mdy}px)` },
            { transform: 'translate(0, 0)' }
        ], { duration: 280, easing: 'cubic-bezier(.4,0,.2,1)' });
    }
});

// Start
init();
