/**
 * IB Revision Focus App
 * Handles UI routing, spaced repetition algorithm, parsing, and localStorage DB.
 */

// --- 1. Database & State Management ---
const STORAGE_KEY = 'ib_focus_data';

function toLocalString(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getTodayString() {
    return toLocalString(new Date());
}

const getEmptyDB = () => ({
    version: 1,
    questions: [],
    recentSession: null,
    arcade_total_xp: 0,
    streak_count: 0,
    streak_last_date: null,
    streak_questions_today: 0,
    streak_questions_date: getTodayString(),
    mastered_topics: [],
    heatmap_data: {}
});

let db = getEmptyDB();
let currentSession = null;

function loadDB() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
        try {
            db = JSON.parse(raw);
            if(!db.questions) db.questions = [];
            if(db.arcade_total_xp === undefined) {
                db.arcade_total_xp = 0;
                db.streak_count = 0;
                db.streak_last_date = null;
                db.streak_questions_today = 0;
                db.streak_questions_date = getTodayString();
                db.mastered_topics = [];
                db.heatmap_data = {};
            }
        } catch (e) {
            console.error("Failed to parse DB", e);
            db = getEmptyDB();
        }
    }
}

function saveDB() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));

    if (window.currentUser && window.supabaseClient) {
        // Create a lightweight copy of the DB containing only essential stats and IDs
        // to avoid storing huge repetitive blocks of text in the database.
        const dbCopy = JSON.parse(JSON.stringify(db));
        dbCopy.questions = dbCopy.questions.map(q => ({ id: q.id, stats: q.stats }));
        
        window.supabaseClient.from('user_profiles').upsert({
            user_id: window.currentUser.id,
            db_data: dbCopy,
            updated_at: new Date().toISOString()
        }).then(({ error }) => {
            if (error) console.error("Supabase sync failed:", error);
        });
    }
}

window.syncFromSupabase = async function(userId) {
    if (!window.supabaseClient) return;

    const { data, error } = await window.supabaseClient
        .from('user_profiles')
        .select('db_data')
        .eq('user_id', userId)
        .single();
        
    if (data && data.db_data) {
        const remoteDB = data.db_data;
        
        // Merge remote scalars
        if (remoteDB.arcade_total_xp !== undefined) db.arcade_total_xp = remoteDB.arcade_total_xp;
        if (remoteDB.mastered_topics) db.mastered_topics = remoteDB.mastered_topics;
        if (remoteDB.streak_count !== undefined) db.streak_count = remoteDB.streak_count;
        if (remoteDB.streak_last_date) db.streak_last_date = remoteDB.streak_last_date;
        if (remoteDB.heatmap_data) db.heatmap_data = remoteDB.heatmap_data;

        // Merge stats for questions
        if (remoteDB.questions && Array.isArray(remoteDB.questions)) {
            remoteDB.questions.forEach(rq => {
                const localQ = db.questions.find(x => x.id === rq.id);
                if (localQ && rq.stats) {
                    localQ.stats = rq.stats;
                }
            });
        }

        localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
        
        // Refresh the current view to reflect loaded data
        if (!document.getElementById('view-home').classList.contains('hidden')) {
            initHome();
        } else if (!document.getElementById('view-arcade').classList.contains('hidden')) {
            initArcade();
        }
    } else if (error && error.code !== 'PGRST116') { 
        console.error("Fetch profile error:", error);
    } else if (!data) {
        // New user! Push current local storage up.
        saveDB(); 
    }
};

// Ensure each question has stats initialized

function initQuestionStats(q) {
    if (!q.stats) {
        q.stats = {
            seen: 0,
            correct: 0,
            incorrect: 0,
            streak: 0,
            last_reviewed: null,
            interval: 0,
            ease_factor: 2.5,
            next_review: new Date().toISOString() // Fallback to ISO, will be coerced
        };
    }
}

// --- 2. Spaced Repetition Algorithm ---
// Simplified SM-2 inspired
function recordAnswer(qId, isCorrect, multiplier = 1.5) {
    const q = db.questions.find(x => x.id === qId);
    if (!q) return;

    if (isCorrect) {
        // Interval calculation
        if (q.stats.interval === 0) {
            q.stats.interval = 1;
        } else if (q.stats.interval === 1) {
            q.stats.interval = 3; // First successful review jump
        } else {
            q.stats.interval = Math.round(q.stats.interval * multiplier);
        }
    } else {
        // Reset interval to tomorrow
        q.stats.interval = 1;
    }

    // Set next review date
    const d = new Date();
    d.setDate(d.getDate() + q.stats.interval);
    q.stats.next_review = toLocalString(d);
}


// --- 3. UI Router ---
const views = ['view-load', 'view-home', 'view-setup', 'view-test', 'view-session', 'view-summary', 'view-arcade', 'view-browse'];

function switchView(viewId) {
    views.forEach(v => {
        const el = document.getElementById(v);
        if(el) el.classList.add('hidden');
    });
    
    const targetEl = document.getElementById(viewId);
    if(targetEl) targetEl.classList.remove('hidden');
    
    // Manage nav visibility
    const isSessionActive = (viewId === 'view-session');
    const isLoadScreen = (viewId === 'view-load');
    
    document.getElementById('top-nav').classList.toggle('hidden', isSessionActive || isLoadScreen);
    document.getElementById('bottom-nav').classList.toggle('hidden', isSessionActive || isLoadScreen);

    // Update active nav link
    document.querySelectorAll('.nav-link').forEach(link => {
        if (link.dataset.target === viewId) link.classList.add('active');
        else link.classList.remove('active');
    });

    // View specific init hooks
    if (viewId === 'view-home') initHome();
    if (viewId === 'view-setup') initSetup();
    if (viewId === 'view-arcade') initArcade();
    if (viewId === 'view-browse') initBrowse();
    if (viewId === 'view-test') initTest();

    // Re-render lucide icons if new ones appear
    lucide.createIcons();
}


// --- KaTeX Renderer ---
function renderLatex(element) {
    if (element && window.renderMathInElement) {
        renderMathInElement(element, {
            delimiters: [
                { left: '$$', right: '$$', display: true },
                { left: '$', right: '$', display: false }
            ],
            throwOnError: false
        });
    }
}


// --- 4. Manifest Bootstrapper ---
async function fetchAndLoadManifest() {
    const statusEl = document.getElementById('upload-status');
    statusEl.innerHTML = 'Connecting to Question Bank manifest...';
    try {
        const res = await fetch(`/public/questions/manifest.json?t=${new Date().getTime()}`);
        if (!res.ok) throw new Error("Manifest not found.");
        const manifest = await res.json();
        
        let newQuestionsCount = 0;
        
        // Fetch files in parallel
        const fetchPromises = manifest.banks.map(async (fileUrl) => {
            const fRes = await fetch(`${fileUrl}?t=${new Date().getTime()}`);
            if (!fRes.ok) throw new Error(`Failed to load ${fileUrl}`);
            return fRes.json();
        });
        
        const allParsed = await Promise.all(fetchPromises);

        allParsed.forEach(parsed => {
            if (Array.isArray(parsed)) {
                parsed.forEach(q => {
                    if (q.id && q.question && q.answer) {
                        const existingIdx = db.questions.findIndex(x => x.id === q.id);
                        initQuestionStats(q);
                        if (existingIdx >= 0) {
                            // Keep stats
                            const stats = db.questions[existingIdx].stats;
                            db.questions[existingIdx] = { ...q, stats };
                        } else {
                            db.questions.push(q);
                            newQuestionsCount++;
                        }
                    } else {
                        console.warn('Skipping malformed question context.');
                    }
                });
            }
        });
        
        saveDB();
        statusEl.innerHTML = `<span class="text-success">System operational. ${db.questions.length} questions loaded.</span>`;
        
        // Auto forward to home if done
        setTimeout(() => {
            switchView('view-home');
        }, 1000);
        
    } catch (err) {
        console.error(err);
        statusEl.innerHTML = `<span class="text-danger">Failed to load manifest. Error: ${err.message}</span>
        <div class="mt-16"><button id="btn-try-again" class="btn btn-secondary">Try Again</button></div>`;
        document.getElementById('btn-try-again').addEventListener('click', fetchAndLoadManifest);
        
        // if db has questions, allow them to resume anyway
        const btnResume = document.getElementById('btn-resume');
        if (btnResume && db.questions.length > 0) {
            btnResume.style.display = 'inline-block';
            btnResume.innerText = `Resume Offline Mode (${db.questions.length})`;
        }
    }
}

document.getElementById('btn-resume').addEventListener('click', () => {
    switchView('view-home');
});


// --- 5. Home View ---
function initHome() {
    // Calculate Due Today
    const today = getTodayString();
    
    // Guard against missing stats inside filter
    const dueCards = db.questions.filter(q => q.stats && (q.stats.next_review || "").slice(0, 10) <= today);
    const dueCountEl = document.getElementById('home-due-count');
    if(dueCountEl) dueCountEl.innerText = dueCards.length;

    // Subject Pills
    const subjects = {};
    db.questions.forEach(q => {
        subjects[q.subject] = (subjects[q.subject] || 0) + 1;
    });
    
    const pillsContainer = document.getElementById('subject-pills');
    if(pillsContainer) {
        pillsContainer.innerHTML = '';
        Object.keys(subjects).forEach(sub => {
            pillsContainer.innerHTML += `<div class="pill"><span>${sub}</span><span>${subjects[sub]}</span></div>`;
        });
    }
    
    const totalCountEl = document.getElementById('home-total-count');
    if(totalCountEl) totalCountEl.innerText = db.questions.length;

    // Recent session
    const recentDiv = document.getElementById('recent-session-stats');
    if (recentDiv && db.recentSession) {
        const { date, correct, total } = db.recentSession;
        const acc = Math.round((correct / total) * 100) || 0;
        const dt = new Date(date).toLocaleDateString();
        recentDiv.innerHTML = `
            <p class="font-medium">On ${dt}</p>
            <p class="text-sm mt-8">${total} cards reviewed</p>
            <p class="text-sm">Accuracy: <strong>${acc}%</strong></p>
        `;
    }
}

document.getElementById('btn-start-due').addEventListener('click', () => {
    const today = getTodayString();
    let dueCards = db.questions.filter(q => q.stats && (q.stats.next_review || "").slice(0, 10) <= today);
    if (dueCards.length > 0) {
        dueCards = dueCards.sort(() => Math.random() - 0.5);
        startSession(dueCards, 'spaced');
    } else {
        alert("You are all caught up! Browse or do Topic Focus.");
    }
});


// --- 6. Setup View ---
let setupMode = 'spaced';

function initSetup() {
    const today = getTodayString();
    const dueCount = db.questions.filter(q => q.stats && (q.stats.next_review || "").slice(0, 10) <= today).length;
    document.getElementById('setup-due-count').innerText = dueCount;
    
    const btnLaunchSpaced = document.getElementById('btn-launch-spaced');
    btnLaunchSpaced.disabled = (dueCount === 0);
    btnLaunchSpaced.innerText = dueCount === 0 ? "You're caught up!" : "Start Review \u2192";

    // Populate Subjects
    const subSelect = document.getElementById('setup-subject');
    const subjects = [...new Set(db.questions.map(q => q.subject))];
    subSelect.innerHTML = subjects.map(s => `<option value="${s}">${s}</option>`).join('');
    
    if (subjects.length > 0) updateTopicCheckboxes(subjects[0]);
}

function updateTopicCheckboxes(subject) {
    const topics = [...new Set(db.questions.filter(q => q.subject === subject).map(q => q.topic))];
    const tContainer = document.getElementById('setup-topics');
    tContainer.innerHTML = topics.map(t => `
        <label class="checkbox-item">
            <input type="checkbox" value="${t}" class="topic-cb" checked>
            <span>${t}</span>
        </label>
    `).join('');
    updateFocusCount();
    
    // Add event listeners to new checkboxes
    document.querySelectorAll('.topic-cb').forEach(cb => {
        cb.addEventListener('change', updateFocusCount);
    });
}

function updateFocusCount() {
    const selSub = document.getElementById('setup-subject').value;
    const selDiff = document.getElementById('setup-difficulty').value;
    const selTopics = Array.from(document.querySelectorAll('.topic-cb:checked')).map(cb => cb.value);
    
    let count = db.questions.filter(q => {
        if (q.subject !== selSub) return false;
        if (!selTopics.includes(q.topic)) return false;
        if (selDiff !== 'all' && q.difficulty.toString() !== selDiff) return false;
        return true;
    }).length;
    
    document.getElementById('setup-focus-count').innerText = count;
    document.getElementById('btn-launch-topic').disabled = (count === 0);
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        setupMode = e.target.dataset.mode;
        
        document.getElementById('setup-mode-spaced').classList.toggle('hidden', setupMode !== 'spaced');
        document.getElementById('setup-mode-topic').classList.toggle('hidden', setupMode !== 'topic');
    });
});

document.getElementById('setup-subject').addEventListener('change', (e) => updateTopicCheckboxes(e.target.value));
document.getElementById('setup-difficulty').addEventListener('change', updateFocusCount);

document.getElementById('btn-launch-spaced').addEventListener('click', () => {
    const today = getTodayString();
    let queue = db.questions.filter(q => q.stats && (q.stats.next_review || "").slice(0, 10) <= today);
    if (queue && queue.length > 0) {
        queue = queue.sort(() => Math.random() - 0.5);
    }
    startSession(queue, 'spaced');
});

document.getElementById('btn-reset-queue')?.addEventListener('click', () => {
    if (confirm("This will force ALL questions in the bank to be 'Due Today'. Are you sure?")) {
        const today = getTodayString();
        db.questions.forEach(q => {
            if (q.stats) q.stats.next_review = today;
        });
        saveDB();
        initSetup(); // Refresh the count
        alert("Queue reset successfully! You can now start the daily review.");
    }
});

document.getElementById('btn-launch-topic').addEventListener('click', () => {
    const selSub = document.getElementById('setup-subject').value;
    const selDiff = document.getElementById('setup-difficulty').value;
    const selTopics = Array.from(document.querySelectorAll('.topic-cb:checked')).map(cb => cb.value);
    
    let queue = db.questions.filter(q => {
        if (q.subject !== selSub) return false;
        if (!selTopics.includes(q.topic)) return false;
        if (selDiff !== 'all' && q.difficulty.toString() !== selDiff) return false;
        return true;
    });
    
    // Shuffle queue defensively
    if (queue && queue.length > 0) {
        queue = queue.sort(() => Math.random() - 0.5);
    }
    startSession(queue, 'topic');
});


// --- 6.5. Unit Test View ---
let unitTestQuestions = [];

async function initTest() {
    const statusEl = document.getElementById('unit-test-status');
    const btnLaunch = document.getElementById('btn-launch-unit-test');
    
    if (unitTestQuestions.length > 0) {
        statusEl.innerText = `${unitTestQuestions.length} questions loaded and ready.`;
        btnLaunch.disabled = false;
        return;
    }
    
    statusEl.innerText = "Loading unit test questions...";
    btnLaunch.disabled = true;
    
    try {
        const res = await fetch(`/public/questions/chemistry-unit-test.json?t=${new Date().getTime()}`);
        if (!res.ok) throw new Error("Could not load unit test");
        const parsed = await res.json();
        
        // initialize stats but don't add to main db
        parsed.forEach(q => initQuestionStats(q));
        unitTestQuestions = parsed;
        
        statusEl.innerText = `${unitTestQuestions.length} questions loaded and ready.`;
        btnLaunch.disabled = false;
    } catch (err) {
        console.error(err);
        statusEl.innerText = "Failed to load unit test questions.";
    }
}

document.getElementById('btn-launch-unit-test')?.addEventListener('click', () => {
    if (unitTestQuestions.length > 0) {
        // shuffle the queue optionally, or keep order. We will keep order for a set test
        const queue = [...unitTestQuestions];
        startSession(queue, 'unit-test');
    }
});


// --- 7. Session Loop ---
function startSession(queue, mode) {
    if (!queue || queue.length === 0) return;
    currentSession = {
        mode: mode,
        queue: queue,
        currentIndex: 0,
        results: { correct: 0, incorrect: 0, missedQuestions: [] }
    };
    switchView('view-session');
    renderQuestion();
}

let speedTimerInterval = null;
let speedTimerRemaining = 10;

// --- Daily Gamification Hooks ---
function processDailyActivity() {
    const today = getTodayString();
    
    // Streak logic
    if (db.streak_last_date !== today) {
        db.streak_questions_today = 0;
        
        if (db.streak_last_date) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            if (db.streak_last_date === toLocalString(yesterday)) {
                db.streak_count += 1;
            } else {
                db.streak_count = 1;
            }
        } else {
            db.streak_count = 1;
        }
        db.streak_last_date = today;
    }
    
    db.streak_questions_today += 1;
    
    // Heatmap Logic
    if (!db.heatmap_data[today]) db.heatmap_data[today] = 0;
    db.heatmap_data[today] += 1;
}

function renderQuestion() {
    if (!currentSession) return;
    const q = currentSession.queue[currentSession.currentIndex];
    
    if (!q) {
        endSession();
        return;
    }
    
    // Reset UI state
    mcqLocked = false;
    flipState = false;
    
    // Dynamic Tints
    document.body.className = '';
    const subL = q.subject.toLowerCase();
    if (subL.includes('chemistry')) document.body.classList.add('subject-tint-chemistry');
    else if (subL.includes('physics')) document.body.classList.add('subject-tint-physics');
    else if (subL.includes('math')) document.body.classList.add('subject-tint-math');

    // Speed Timer Initialization
    speedTimerRemaining = 10;
    if (speedTimerInterval) clearInterval(speedTimerInterval);
    const speedBar = document.getElementById('speed-timer-bar');
    if (speedBar) {
        speedBar.style.transition = 'none';
        speedBar.style.width = '100%';
        void speedBar.offsetWidth; // Force Reflow
        speedBar.style.transition = 'width 10s linear';
        speedBar.style.width = '0%';
    }
    
    speedTimerInterval = setInterval(() => {
        speedTimerRemaining--;
        if (speedTimerRemaining <= 0) clearInterval(speedTimerInterval);
    }, 1000);
    
    // Progress UI
    const progressPct = (currentSession.currentIndex / currentSession.queue.length) * 100;
    document.getElementById('session-progress-fill').style.width = `${progressPct}%`;
    document.getElementById('session-subject').innerText = `${q.subject}`;
    document.getElementById('session-counter').innerText = `${currentSession.currentIndex + 1} / ${currentSession.queue.length}`;
    
    const fcContainer = document.getElementById('card-flashcard');
    const mcqContainer = document.getElementById('card-mcq');
    
    // Store question and answers into DOM Elements and Render LaTeX
    if (q.type === 'flashcard') {
        fcContainer.classList.remove('hidden');
        mcqContainer.classList.add('hidden');
        
        // Reset card flip
        const inner = fcContainer.querySelector('.flashcard-inner');
        inner.classList.remove('flipped');
        
        const qText = fcContainer.querySelector('.question-text');
        const aText = fcContainer.querySelector('.answer-text');
        
        qText.innerText = q.question;
        aText.innerText = q.answer;
        
        renderLatex(qText);
        renderLatex(aText);
        
        // Explanation
        const expEl = document.getElementById('flashcard-explanation');
        if (q.explanation) {
            expEl.innerHTML = `<strong>Note:</strong> ${q.explanation}`;
            renderLatex(expEl);
            expEl.classList.remove('hidden');
        } else {
            expEl.classList.add('hidden');
        }
        
        document.querySelector('.flashcard-controls').classList.add('hidden');
        document.querySelector('.hint-text').classList.remove('hidden');
        
    } else if (q.type === 'mcq') {
        fcContainer.classList.add('hidden');
        mcqContainer.classList.remove('hidden');
        
        const mqText = mcqContainer.querySelector('.question-text');
        mqText.innerText = q.question;
        renderLatex(mqText);
        
        const optsDiv = document.getElementById('mcq-options');
        optsDiv.innerHTML = '';
        
        // Render options (A, B, C, D)
        const labels = ['A', 'B', 'C', 'D'];
        q.options.forEach((optText, idx) => {
            const div = document.createElement('div');
            div.className = 'mcq-option';
            
            // Set the raw answer text safely into a data attribute
            div.dataset.rawAnswer = optText;
            
            div.innerHTML = `<span class="option-label">${labels[idx]}</span><span class="option-text">${optText}</span>`;
            
            renderLatex(div.querySelector('.option-text'));
            
            div.addEventListener('click', () => handleMCQClick(div, div.dataset.rawAnswer, q.answer, q));
            optsDiv.appendChild(div);
        });

        document.getElementById('mcq-explanation').classList.add('hidden');
        document.querySelector('.mcq-controls').classList.add('hidden');
    }
}

function handleFlashcardFlip() {
    if (!currentSession) return;
    const q = currentSession.queue[currentSession.currentIndex];
    if (!q || q.type !== 'flashcard') return;
    if (flipState) return; // Already flipped
    
    flipState = true;
    document.querySelector('.flashcard-inner').classList.add('flipped');
    document.querySelector('.flashcard-controls').classList.remove('hidden');
    document.querySelector('.hint-text').classList.add('hidden');
    
    // Stop speed timer visual
    const speedBar = document.getElementById('speed-timer-bar');
    if (speedBar) {
        const computedWidth = window.getComputedStyle(speedBar).width;
        speedBar.style.transition = 'none';
        speedBar.style.width = computedWidth;
    }
    if (speedTimerInterval) clearInterval(speedTimerInterval);
}

// Attach flip click bind (once on load)
document.querySelector('.flashcard-inner').addEventListener('click', handleFlashcardFlip);

// Confidence Buttons mappings
document.getElementById('btn-fc-missed').addEventListener('click', () => handleResponse(false, {xp: 0, mult: 1.0}));
document.getElementById('btn-fc-hard').addEventListener('click', () => handleResponse(true, {xp: 10, mult: 1.2}));
document.getElementById('btn-fc-good').addEventListener('click', () => handleResponse(true, {xp: 20, mult: 1.5}));
document.getElementById('btn-fc-easy').addEventListener('click', () => handleResponse(true, {xp: 25, mult: 2.0}));

function handleMCQClick(optionEl, selectedRawText, correctRawText, q) {
    if (mcqLocked) return;
    mcqLocked = true;
    
    const isCorrect = (selectedRawText === correctRawText);
    
    // Highlight UI
    const allOptions = document.querySelectorAll('.mcq-option');
    allOptions.forEach(opt => opt.classList.add('locked'));
    
    if (isCorrect) {
        optionEl.classList.add('correct');
    } else {
        optionEl.classList.add('wrong');
        // Find and highlight correct answer
        allOptions.forEach(opt => {
            if (opt.dataset.rawAnswer === correctRawText) {
                opt.classList.add('correct');
            }
        });
    }
    
    // Show explanation if exists
    if (q.explanation) {
        const expEl = document.getElementById('mcq-explanation');
        expEl.innerHTML = `<strong>Explanation:</strong> ${q.explanation}`;
        renderLatex(expEl);
        expEl.classList.remove('hidden');
    }
    
    document.querySelector('.mcq-controls').classList.remove('hidden');
    
    // Stop speed timer visual
    const speedBar = document.getElementById('speed-timer-bar');
    if (speedBar) {
        const computedWidth = window.getComputedStyle(speedBar).width;
        speedBar.style.transition = 'none';
        speedBar.style.width = computedWidth;
    }
    if (speedTimerInterval) clearInterval(speedTimerInterval);
    
    // Store result to process on NEXT click
    if (currentSession) currentSession.pendingMCQResult = isCorrect;
}

document.getElementById('btn-mcq-next').addEventListener('click', () => {
    if (currentSession && mcqLocked) {
        handleResponse(currentSession.pendingMCQResult, {xp: currentSession.pendingMCQResult ? 15 : 0, mult: 1.5});
    }
});

function handleResponse(isCorrect, params) {
    if (!currentSession) return;
    const q = currentSession.queue[currentSession.currentIndex];
    if (!q) return;

    // Apply XP and Multipliers
    let xpEarned = params.xp || 0;
    let multiplier = params.mult || 1.0;

    // Apply Speed Bonus if they were fast!
    if (isCorrect && speedTimerRemaining > 0) {
        xpEarned += 5;
    }
    
    if (xpEarned > 0) {
        db.arcade_total_xp += xpEarned;
    }

    if (isCorrect) {
        processDailyActivity();
        currentSession.results.correct++;
    } else {
        currentSession.results.incorrect++;
        currentSession.results.missedQuestions.push(q);
    }
    
    // Ensure standard generic stats increment regardless of session type
    const targetQ = db.questions.find(x => x.id === q.id);
    if (targetQ && targetQ.stats) {
        targetQ.stats.seen += 1;
        targetQ.stats.last_reviewed = new Date().toISOString();
        if (isCorrect) {
            targetQ.stats.correct += 1;
            targetQ.stats.streak += 1;
        } else {
            targetQ.stats.incorrect += 1;
            targetQ.stats.streak = 0;
        }
    }
    
    if (currentSession.mode === 'spaced') {
        recordAnswer(q.id, isCorrect, multiplier);
    } // Topic focus does not update SR intervals
    
    saveDB();
    
    currentSession.currentIndex++;
    renderQuestion(); // Load next gracefully terminates if finished
}

function endSession() {
    if (!currentSession) return;
    
    // Cleanup active bindings
    document.body.className = '';
    if(speedTimerInterval) clearInterval(speedTimerInterval);
    
    // Topic Mastery Evaluation Hook
    const topicsEncountered = [...new Set(currentSession.queue.map(q => q.topic))];
    let newlyMastered = [];
    topicsEncountered.forEach(topic => {
        if (!db.mastered_topics.includes(topic)) {
            const tQs = db.questions.filter(q => q.topic === topic);
            if (tQs.length > 0) {
                let mCount = 0;
                tQs.forEach(q => {
                    if (q.stats && q.stats.seen >= 1 && (q.stats.correct / q.stats.seen) >= 0.75) {
                        mCount++;
                    }
                });
                if (mCount === tQs.length) {
                    db.mastered_topics.push(topic);
                    newlyMastered.push(topic);
                }
            }
        }
    });

    if (newlyMastered.length > 0) {
        if (window.confetti) {
            confetti({
                particleCount: 120,
                spread: 80,
                origin: {y: 0.6},
                colors: ['#2563eb', '#16a34a', '#f59e0b', '#ec4899']
            });
        }
        
        const toast = document.getElementById('toast-mastery');
        const tmMsg = document.getElementById('toast-message');
        if (toast && tmMsg) {
            tmMsg.innerText = `🎉 Topic mastered: ${newlyMastered[0]}`;
            toast.classList.remove('hidden');
            toast.classList.add('toast-enter');
            setTimeout(() => {
                toast.classList.add('toast-exit');
                setTimeout(() => {
                    toast.classList.add('hidden');
                    toast.classList.remove('toast-enter', 'toast-exit');
                }, 300);
            }, 3000);
        }
    }

    // Save session stats locally
    const stats = {
        date: new Date().toISOString(),
        total: currentSession.queue.length,
        correct: currentSession.results.correct,
        mode: currentSession.mode
    };
    db.recentSession = stats;
    saveDB();
    
    // Fill Summary View
    document.getElementById('sum-total').innerText = stats.total;
    document.getElementById('sum-correct').innerText = stats.correct;
    document.getElementById('sum-incorrect').innerText = currentSession.results.incorrect;
    
    const listEl = document.getElementById('summary-missed-list');
    listEl.innerHTML = '';
    
    currentSession.results.missedQuestions.forEach(q => {
        const div = document.createElement('div');
        div.className = "card p-16 mb-8 bg-white border";
        div.innerHTML = `
            <p class="font-medium text-sm mb-4 summary-q">${q.question}</p>
            <p class="text-sm text-success summary-a">Answer: ${q.answer}</p>
        `;
        listEl.appendChild(div);
        renderLatex(div); // Render LaTeX exclusively on the appended element
    });
    
    const reviewBtn = document.getElementById('btn-sum-review');
    if(currentSession.results.missedQuestions.length === 0) {
        listEl.innerHTML = '<p class="text-muted text-sm" >No questions missed. Great job!</p>';
        if (reviewBtn) reviewBtn.style.display = 'none';
    } else {
        if (reviewBtn) reviewBtn.style.display = 'inline-flex';
    }

    switchView('view-summary');
}

document.getElementById('btn-exit-session').addEventListener('click', () => {
    if (confirm("End session? Progress on answered questions is already saved.")) {
        switchView('view-home');
        currentSession = null;
    }
});
document.getElementById('btn-sum-home').addEventListener('click', () => {
    switchView('view-home');
    currentSession = null;
});

document.getElementById('btn-sum-review').addEventListener('click', () => {
    if (currentSession && currentSession.results.missedQuestions.length > 0) {
        // Build mini session
        startSession([...currentSession.results.missedQuestions], currentSession.mode);
    }
});


// --- 8. Arcade View ---
function initArcade() {
    // 1. Player Card
    const xp = db.arcade_total_xp || 0;
    const level = Math.floor(xp / 50) + 1;
    const currentLevelXP = xp % 50;
    
    document.getElementById('arcade-level').innerText = level;
    document.getElementById('arcade-xp').innerText = currentLevelXP;
    document.getElementById('arcade-xp-fill').style.width = `${(currentLevelXP / 50) * 100}%`;
    
    const streakEl = document.getElementById('arcade-streak');
    streakEl.innerText = `🔥 ${db.streak_count || 0}`;
    if ((db.streak_count || 0) >= 3) streakEl.classList.add('streak-glow');
    else streakEl.classList.remove('streak-glow');

    // 2. Topic Mastery (SVG Rings)
    const ringsContainer = document.getElementById('arcade-rings-container');
    ringsContainer.innerHTML = '';
    
    const hierarchy = {};
    db.questions.forEach(q => {
        if (!hierarchy[q.subject]) hierarchy[q.subject] = {};
        if (!hierarchy[q.subject][q.topic]) hierarchy[q.subject][q.topic] = [];
        hierarchy[q.subject][q.topic].push(q);
    });

    Object.keys(hierarchy).forEach(sub => {
        const topHeader = document.createElement('h4');
        topHeader.className = "text-left text-muted mt-24 mb-16 w-full border-b border-subtle pb-8";
        topHeader.style.gridColumn = "1 / -1"; // Span all columns
        topHeader.innerText = sub;
        ringsContainer.appendChild(topHeader);
        
        Object.keys(hierarchy[sub]).forEach(topic => {
            const arr = hierarchy[sub][topic];
            let masteredCount = 0;
            arr.forEach(q => {
                if (q.stats && q.stats.seen >= 1 && (q.stats.correct / q.stats.seen) >= 0.75) masteredCount++;
            });
            
            const pct = arr.length > 0 ? Math.round((masteredCount / arr.length) * 100) : 0;
            const r = 36;
            const c = 2 * Math.PI * r;
            const dashoffset = c - (pct / 100) * c;
            
            let ringClass = 'ring-bg';
            if (pct > 0 && pct < 75) ringClass = 'ring-amber';
            else if (pct >= 75 && pct < 100) ringClass = 'ring-blue';
            else if (pct === 100) ringClass = 'ring-green';
            
            const div = document.createElement('div');
            div.innerHTML = `
                <svg width="80" height="80" viewBox="0 0 80 80" class="ring-svg mx-auto">
                    <circle cx="40" cy="40" r="${r}" class="ring-bg"></circle>
                    <circle cx="40" cy="40" r="${r}" class="ring-fg ${ringClass}" stroke-dasharray="${c}" stroke-dashoffset="${pct === 0 ? c : dashoffset}" transform="rotate(-90 40 40)"></circle>
                    <text x="40" y="40" class="ring-text" dy="2">${pct}%</text>
                </svg>
                <div class="mt-8">
                    <div class="text-sm font-medium truncate w-full" title="${topic}">${topic}</div>
                    <div class="text-xs text-muted">${masteredCount} / ${arr.length}</div>
                </div>
            `;
            ringsContainer.appendChild(div);
        });
    });

    // 3. Heatmap
    const heatContainer = document.getElementById('arcade-heatmap-container');
    heatContainer.innerHTML = '';
    heatContainer.style.gridAutoFlow = 'column'; // Force column-major top-to-bottom filling
    
    // Generate past 84 days (12 weeks)
    const today = new Date();
    for (let i = 0; i < 84; i++) {
        const d = new Date(today);
        d.setDate(today.getDate() - (83 - i));
        const dateStr = toLocalString(d);
        const count = (db.heatmap_data && db.heatmap_data[dateStr]) ? db.heatmap_data[dateStr] : 0;
        
        let level = 0;
        if (count > 0 && count <= 5) level = 1;
        else if (count >= 6 && count <= 14) level = 2;
        else if (count >= 15 && count <= 29) level = 3;
        else if (count >= 30) level = 4;
        
        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        cell.dataset.level = level;
        cell.title = `${dateStr} — ${count} questions`;
        heatContainer.appendChild(cell);
    }
}


// --- 9. Browse View ---
function initBrowse() {
    populateBrowseFilters();
    renderBrowseTable();
}

function populateBrowseFilters() {
    const fSub = document.getElementById('filter-subject');
    const subjects = [...new Set(db.questions.map(q => q.subject))];
    fSub.innerHTML = '<option value="">All Subjects</option>' + subjects.map(s => `<option value="${s}">${s}</option>`).join('');
}

function renderBrowseTable() {
    const tbody = document.getElementById('browse-tbody');
    const search = document.getElementById('browse-search').value.toLowerCase();
    const fSub = document.getElementById('filter-subject').value;
    const fType = document.getElementById('filter-type').value;
    const fDiff = document.getElementById('filter-difficulty').value;
    
    // Filter by raw text since it is more reliable
    let items = db.questions.filter(q => {
        if (fSub && q.subject !== fSub) return false;
        if (fType && q.type !== fType) return false;
        if (fDiff && q.difficulty.toString() !== fDiff) return false;
        if (search && !q.question.toLowerCase().includes(search) && !q.topic.toLowerCase().includes(search)) return false;
        return true;
    });
    
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="p-16 text-center text-muted">No questions found.</td></tr>';
        return;
    }

    // Limit to 100 to prevent DOM lag
    items = items.slice(0, 100);

    tbody.innerHTML = '';
    items.forEach(q => {
        const tr = document.createElement('tr');
        const icon = q.type === 'mcq' ? 'list' : 'layers';
        
        let diffDots = '';
        for(let i=1; i<=3; i++) {
            diffDots += `<span class="diff-dot ${i <= q.difficulty ? 'active' : ''}"></span>`;
        }

        tr.innerHTML = `
            <td class="p-16 text-sm"><span class="badge">${q.subject}</span></td>
            <td class="p-16 text-sm text-muted">${q.topic}</td>
            <td class="p-16"><div class="diff-dots">${diffDots}</div></td>
            <td class="p-16 dflex items-center gap-8">
                <i data-lucide="${icon}" class="w-16 h-16 text-muted border border-subtle p-2 rounded"></i>
                <div class="truncate block max-w-sm" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${q.question}</div>
            </td>
        `;
        
        // Do NOT render LaTeX inside .truncate to avoid breaking malformed tags
        
        // Expansion logic
        let expanded = false;
        tr.addEventListener('click', () => {
            if (expanded) {
                tr.nextElementSibling.remove();
                tr.classList.remove('bg-gray-50');
            } else {
                const detTr = document.createElement('tr');
                detTr.className = 'expanded-detail';
                detTr.innerHTML = `
                    <td colspan="4">
                        <p class="font-medium mb-8">Q: ${q.question}</p>
                        <p class="text-success mb-8">A: ${q.answer}</p>
                        ${q.explanation ? `<div class="explanation-box">${q.explanation}</div>` : ''}
                        <div class="mt-8 text-xs text-muted">Seen: ${q.stats.seen} | Accuracy: ${q.stats.seen ? Math.round((q.stats.correct/q.stats.seen)*100) : 0}% | Next review: ${new Date(q.stats.next_review).toLocaleDateString()}</div>
                    </td>
                `;
                tr.after(detTr);
                renderLatex(detTr);  // Render LaTeX in expanded view
                tr.classList.add('bg-gray-50');
            }
            expanded = !expanded;
        });

        tbody.appendChild(tr);
    });
    lucide.createIcons();
}

document.getElementById('browse-search').addEventListener('input', renderBrowseTable);
document.getElementById('filter-subject').addEventListener('change', renderBrowseTable);
document.getElementById('filter-type').addEventListener('change', renderBrowseTable);
document.getElementById('filter-difficulty').addEventListener('change', renderBrowseTable);


// --- 10. Nav & Shortcuts ---
document.querySelectorAll('.nav-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const target = e.currentTarget.dataset.target;
        if (target) switchView(target);
    });
});

// Global Keyboard bindings
window.addEventListener('keydown', (e) => {
    const isInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
    if (isInput) return;

    const vId = document.querySelector('.view:not(.hidden)').id;

    if (e.key === '?') {
        document.getElementById('shortcuts-modal').classList.remove('hidden');
        return;
    }
    if (e.key === 'Escape') {
        const modal = document.getElementById('shortcuts-modal');
        if (!modal.classList.contains('hidden')) {
            modal.classList.add('hidden');
        } else if (vId === 'view-session') {
           if(confirm("End session? Progress on answered questions is already saved.")) switchView('view-home');
        }
    }

    if (vId === 'view-session' && currentSession) {
        const q = currentSession.queue[currentSession.currentIndex];
        if (!q) return;

        if (q.type === 'flashcard') {
            if (e.key === ' ' && !flipState) {
                e.preventDefault();
                handleFlashcardFlip();
            } else if (flipState) {
                if (e.key === '1') handleResponse(false); // Missed it
                if (e.key === '2') handleResponse(true);  // Got it
            }
        } else if (q.type === 'mcq') {
            if (!mcqLocked) {
                const keys = ['1', '2', '3', '4'];
                if (keys.includes(e.key)) {
                    const idx = parseInt(e.key) - 1;
                    const opts = document.querySelectorAll('.mcq-option');
                    if (opts[idx]) {
                        opts[idx].click();
                    }
                }
            } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
                handleResponse(currentSession.pendingMCQResult);
            }
        }
    }
});

document.getElementById('btn-close-shortcuts').addEventListener('click', () => {
    document.getElementById('shortcuts-modal').classList.add('hidden');
});

// --- INIT & THEME ---
const savedTheme = localStorage.getItem('theme');
if (savedTheme === 'dark') document.body.setAttribute('data-theme', 'dark');

function toggleTheme() {
    const isDark = document.body.getAttribute('data-theme') === 'dark';
    if (isDark) {
        document.body.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
    } else {
        document.body.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
    }
    lucide.createIcons();
}

document.getElementById('dark-toggle-desktop').addEventListener('click', toggleTheme);
document.getElementById('dark-toggle-mobile').addEventListener('click', toggleTheme);

// --- 11. iOS PWA Install Prompt ---
function checkPwaPrompt() {
    const isIos = () => {
        const userAgent = window.navigator.userAgent.toLowerCase();
        return /iphone|ipad|ipod/.test(userAgent);
    };

    const isInStandaloneMode = () => ('standalone' in window.navigator) && (window.navigator.standalone);

    if (isIos() && !isInStandaloneMode() && !localStorage.getItem('ios_a2hs_prompted')) {
        const promptEl = document.getElementById('ios-pwa-prompt');
        if (promptEl) {
            setTimeout(() => {
                promptEl.classList.remove('hidden');
            }, 3000); // 3-second delay to not disrupt initial UX
            
            document.getElementById('btn-close-pwa').addEventListener('click', () => {
                promptEl.classList.add('hidden');
                localStorage.setItem('ios_a2hs_prompted', 'true');
            });
        }
    }
}

function initBackgrounds() {
    if (window.particlesJS) {
        particlesJS("tsparticles", {
            "particles": {
                "number": { "value": 50, "density": { "enable": true, "value_area": 800 } },
                "color": { "value": "#2563eb" },
                "shape": { "type": "circle" },
                "opacity": { "value": 0.3, "random": false },
                "size": { "value": 3, "random": true },
                "line_linked": {
                    "enable": true,
                    "distance": 150,
                    "color": "#93c5fd",
                    "opacity": 0.4,
                    "width": 1
                },
                "move": {
                    "enable": true,
                    "speed": 2,
                    "direction": "none",
                    "random": false,
                    "straight": false,
                    "out_mode": "bounce",
                    "bounce": true
                }
            },
            "interactivity": {
                "detect_on": "canvas",
                "events": {
                    "onhover": { "enable": true, "mode": "repulse" },
                    "onclick": { "enable": true, "mode": "push" },
                    "resize": true
                },
                "modes": {
                    "repulse": { "distance": 100, "duration": 0.4 },
                    "push": { "particles_nb": 4 }
                }
            },
            "retina_detect": true
        });
    }
}

function initApp() {
    loadDB();
    switchView('view-load');
    lucide.createIcons();
    initBackgrounds();
    
    // Instead of waiting for file upload, fetch manifest automatically.
    fetchAndLoadManifest();
}

initApp();
