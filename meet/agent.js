// Chowaniec Meet - Meeting Agent.
// A host starts the Agent, which turns on Daily's live transcription. The host's
// browser collects the speaker-labelled transcript, keeps AI meeting notes up to
// date via /.netlify/functions/meeting-agent, and listens for "Hey Agent" commands
// from the Director or Co-Director. Everyone in the call sees live captions.
// Relies on globals from meet/index.html.

const AGENT_ENDPOINT = '/.netlify/functions/meeting-agent';
const AGENT_NOTES_INTERVAL_MS = 60 * 1000;
const AGENT_MAX_LINES_PER_UPDATE = 400;
// Speech recognition may render the wake phrase a few ways ("Hey, Agent." / "Hi agents").
const AGENT_WAKE_PATTERN = /\b(?:hey|hi|okay|ok)[\s,.!?-]+agents?\b[\s,.!?:;-]*/i;
const AGENT_COMMAND_SILENCE_MS = 2500;
const AGENT_WAKE_ONLY_WAIT_MS = 5000;
const CHECKIN_TIMEOUT_MS = 90 * 1000;
const NOTES_ENDPOINT = '/.netlify/functions/notes';
const RECAP_ENDPOINT = '/.netlify/functions/meeting-recap';

let agent = freshAgentState();
let agentListeningRemotely = false;   // someone in the call has the Agent running
let agentNotesTimer = null;
let agentRenderTimer = null;
let agentTranscriptOpen = false;
let checkInTimer = null;
const agentNames = {};                 // session id -> last known name

function freshAgentState() {
  return {
    running: false,
    starting: false,
    startedAt: null,
    transcript: [],          // { time, speaker, id, text }
    notes: null,
    notesUpdatedIndex: 0,
    notesUpdatedAt: null,
    updatingNotes: false,
    notesError: null,
    pinned: [],              // notes added with "Hey Agent, note that..."
    polls: [],               // poll objects launched from this device (live tallies)
    activity: [],            // { time, text, status }
    pending: {},             // speaker id -> command being captured
    // Voice check-in: everyone says their name so notes know who is speaking.
    checkIn: { active: false, expected: {}, heard: {} },
    intros: {},              // session id -> { name, text } from the check-in
    savedNoteId: null,       // the shared note in /notes that mirrors these notes
    notesSyncError: null
  };
}

// --- Persistence (per meeting code, on this device) ---

function agentStorageKey() {
  return `chowaniec_meet_agent_${currentMeetingCode}`;
}

function saveAgentState() {
  try {
    const { transcript, notes, notesUpdatedIndex, notesUpdatedAt, pinned, activity, startedAt, intros, savedNoteId } = agent;
    const polls = agent.polls.map(pollSummary);
    localStorage.setItem(agentStorageKey(), JSON.stringify({ transcript, notes, notesUpdatedIndex, notesUpdatedAt, pinned, activity, startedAt, polls, intros, savedNoteId }));
  } catch (e) {
    // Storage full or unavailable; notes still live in memory.
  }
}

function loadAgentState() {
  agent = freshAgentState();
  try {
    const stored = JSON.parse(localStorage.getItem(agentStorageKey()));
    if (stored && Array.isArray(stored.transcript)) {
      Object.assign(agent, {
        transcript: stored.transcript,
        notes: stored.notes || null,
        notesUpdatedIndex: Math.min(stored.notesUpdatedIndex || 0, stored.transcript.length),
        notesUpdatedAt: stored.notesUpdatedAt || null,
        pinned: Array.isArray(stored.pinned) ? stored.pinned : [],
        activity: Array.isArray(stored.activity) ? stored.activity : [],
        startedAt: stored.startedAt || null,
        intros: stored.intros && typeof stored.intros === 'object' ? stored.intros : {},
        savedNoteId: stored.savedNoteId || null,
        // Earlier polls keep their final tallies as plain summaries.
        polls: (Array.isArray(stored.polls) ? stored.polls : []).map((p) => ({ ...p, archived: true }))
      });
    }
  } catch (e) {
    // Corrupt storage: start fresh.
  }
}

// --- Daily wiring (called from meet/index.html) ---

function agentAttach(frame) {
  loadAgentState();
  agentListeningRemotely = false;
  frame.on('transcription-started', () => {
    agentListeningRemotely = true;
    if (agent.starting) {
      agent.starting = false;
      agent.running = true;
      agent.startedAt = agent.startedAt || new Date().toISOString();
      logAgentActivity('Agent started listening.', 'ok');
      broadcastAgentSay('The Agent is now listening and taking notes. Say "Hey Agent" to give it a command.');
      clearInterval(agentNotesTimer);
      agentNotesTimer = setInterval(() => updateAgentNotes(false), AGENT_NOTES_INTERVAL_MS);
      startVoiceCheckIn();
    }
    updateAgentChip();
    scheduleAgentRender();
  });
  frame.on('transcription-stopped', () => {
    agentListeningRemotely = false;
    if (agent.running) stopAgentLocally('Agent stopped listening.');
    updateAgentChip();
    scheduleAgentRender();
  });
  frame.on('transcription-error', (evt) => {
    const wasStarting = agent.starting;
    agent.starting = false;
    if (wasStarting || agent.running) {
      const detail = (evt && evt.errorMsg) ? `: ${evt.errorMsg}` : '';
      toast(`The Agent could not listen${detail}`);
      logAgentActivity(`Transcription error${detail}`, 'error');
      if (agent.running) stopAgentLocally();
    }
    updateAgentChip();
    scheduleAgentRender();
  });
  frame.on('transcription-message', handleTranscriptionMessage);
  updateAgentChip();
}

function agentDetach() {
  clearInterval(agentNotesTimer);
  clearTimeout(checkInTimer);
  agent.checkIn.active = false;
  hideCheckInCard();
  agentNotesTimer = null;
  Object.values(agent.pending).forEach((p) => clearTimeout(p.timer));
  agent.pending = {};
  agent.running = false;
  agent.starting = false;
  agentListeningRemotely = false;
  saveAgentState();
  updateAgentChip();
}

function agentIsActive() {
  return agent.running;
}

// Every poll launched from this device is tracked so the notes get real tallies.
function agentTrackPoll(poll) {
  if (poll && !agent.polls.includes(poll)) agent.polls.push(poll);
}

// --- Transcript & wake phrase ---

function speakerName(sessionId) {
  const p = getParticipant(sessionId);
  if (p && p.user_name) agentNames[sessionId] = p.user_name;
  return agentNames[sessionId] || 'Unknown speaker';
}

function handleTranscriptionMessage(evt) {
  agentListeningRemotely = true;
  updateAgentChip();
  if (!evt || !evt.text || !evt.text.trim()) return;
  // Everyone in the call gets captions; only the host running the Agent keeps the transcript.
  showCaption(speakerName(evt.participantId), evt.text.trim());
  if (!agent.running) return;

  const line = {
    time: new Date(evt.timestamp || Date.now()).toISOString(),
    speaker: speakerName(evt.participantId),
    id: evt.participantId,
    text: evt.text.trim()
  };
  agent.transcript.push(line);
  recordCheckIn(line);
  detectAgentCommand(line);
  saveAgentState();
  scheduleAgentRender();
}

function detectAgentCommand(line) {
  const pending = agent.pending[line.id];
  if (pending) {
    pending.text = `${pending.text} ${line.text}`.trim();
    armCommandTimer(line.id, AGENT_COMMAND_SILENCE_MS);
    return;
  }
  const match = line.text.match(AGENT_WAKE_PATTERN);
  if (!match) return;

  const text = line.text.slice(match.index + match[0].length).trim();
  agent.pending[line.id] = { speaker: line.speaker, text, contextEnd: agent.transcript.length - 1 };
  armCommandTimer(line.id, text ? AGENT_COMMAND_SILENCE_MS : AGENT_WAKE_ONLY_WAIT_MS);
  toast('Agent is listening...');
}

function armCommandTimer(sessionId, delay) {
  const pending = agent.pending[sessionId];
  clearTimeout(pending.timer);
  pending.timer = setTimeout(() => {
    delete agent.pending[sessionId];
    if (!pending.text) {
      toast('The Agent didn\'t hear a command after "Hey Agent".');
      return;
    }
    if (!isPrivileged(sessionId)) {
      logAgentActivity(`Ignored a command from ${pending.speaker} (only the Director or Co-Director can give commands).`, 'error');
      toast('Only the Director or Co-Director can give the Agent commands.');
      return;
    }
    runAgentCommand(pending);
  }, delay);
}

// --- Talking to the Agent function ---

function participantNames() {
  if (!callFrame) return [];
  return Object.values(callFrame.participants()).map((p) => p.user_name || 'Guest');
}

function linesForAgent(lines) {
  return lines.map((l) => ({
    time: new Date(l.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    speaker: l.speaker,
    text: l.text
  }));
}

async function callAgent(payload) {
  const res = await fetch(AGENT_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Chowaniec-Key': signedInKey() },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'The Agent could not respond. Please try again.');
  return data;
}

async function runAgentCommand(pending) {
  logAgentActivity(`${pending.speaker}: "Hey Agent, ${pending.text}"`, 'working');
  scheduleAgentRender();
  try {
    const { result } = await callAgent({
      mode: 'command',
      command: pending.text,
      speaker: pending.speaker,
      participants: participantNames(),
      // Whole-meeting context so questions about earlier discussion can be answered.
      notes: agent.notes,
      pinned: agent.pinned.map((p) => p.text),
      polls: agent.polls.map(pollSummary),
      brief: currentBrief,
      context: linesForAgent(agent.transcript.slice(Math.max(0, pending.contextEnd - 80), pending.contextEnd + 1))
    });
    executeAgentAction(result);
    finishAgentActivity('ok');
  } catch (err) {
    finishAgentActivity('error', err.message);
    toast(err.message);
  }
  saveAgentState();
  scheduleAgentRender();
}

function executeAgentAction(result) {
  const canPush = !!callFrame && isPrivileged(localSessionId());
  if ((result.action === 'poll' || result.action === 'question') && !canPush) {
    toast('The Agent needs you to be Director or Co-Director to send polls and questions.');
    return;
  }

  if (result.action === 'poll') {
    myPoll = { id: Date.now().toString(36), question: result.text, options: result.options, votes: {}, fromAgent: true };
    agentTrackPoll(myPoll);
    callFrame.sendAppMessage({ type: 'PUSH_POLL', poll: { id: myPoll.id, question: myPoll.question, options: myPoll.options } }, '*');
  } else if (result.action === 'question') {
    const form = { title: 'Question from the Agent', fields: [{ label: result.text, type: result.answer_type }] };
    callFrame.sendAppMessage({ type: 'PUSH_FORM', form }, '*');
  } else if (result.action === 'note') {
    agent.pinned.push({ time: new Date().toISOString(), text: result.text });
  }
  broadcastAgentSay(result.confirmation || result.text);
}

// Shows a message from the Agent to everyone in the call (including this device).
function broadcastAgentSay(text) {
  const message = String(text || '').slice(0, 500);
  if (!message) return;
  showAgentSay(message);
  if (callFrame) callFrame.sendAppMessage({ type: 'AGENT_SAY', text: message }, '*');
}

function showAgentSay(text) {
  toast(`Agent: ${text}`);
}

function pollSummary(poll) {
  if (poll.archived) return poll;
  const counts = {};
  poll.options.forEach((opt) => { counts[opt] = 0; });
  Object.values(poll.votes || {}).forEach((i) => {
    const opt = poll.options[i];
    if (opt !== undefined) counts[opt]++;
  });
  return { question: poll.question, results: counts, fromAgent: !!poll.fromAgent };
}

async function updateAgentNotes(manual) {
  if (agent.updatingNotes) return;
  const end = Math.min(agent.transcript.length, agent.notesUpdatedIndex + AGENT_MAX_LINES_PER_UPDATE);
  const hasNewLines = end > agent.notesUpdatedIndex;
  if (!hasNewLines && !manual) return;

  agent.updatingNotes = true;
  agent.notesError = null;
  scheduleAgentRender();
  try {
    const { notes } = await callAgent({
      mode: 'notes',
      meetingDate: new Date(agent.startedAt || Date.now()).toDateString(),
      participants: participantNames(),
      brief: currentBrief,
      previousNotes: agent.notes,
      newLines: linesForAgent(agent.transcript.slice(agent.notesUpdatedIndex, end)),
      polls: agent.polls.map(pollSummary),
      formResponses,
      pinned: agent.pinned.map((p) => p.text),
      intros: Object.values(agent.intros).map((i) => ({ device: i.name, said: i.text }))
    });
    agent.notes = notes;
    agent.notesUpdatedIndex = end;
    agent.notesUpdatedAt = new Date().toISOString();
    syncNotesToNotebook();
  } catch (err) {
    agent.notesError = err.message;
  } finally {
    agent.updatingNotes = false;
    saveAgentState();
    scheduleAgentRender();
  }
}

// --- Voice check-in ---
// Daily transcribes each device separately, so lines are already labelled by device.
// The check-in confirms every microphone reaches the Agent and lets people who share a
// device introduce themselves, so the notes can tell them apart.

function startVoiceCheckIn() {
  if (!callFrame || !agent.running) return;
  const expected = {};
  Object.values(callFrame.participants()).forEach((p) => { expected[p.session_id] = p.user_name || 'Guest'; });
  agent.checkIn = { active: true, expected, heard: {} };
  callFrame.sendAppMessage({ type: 'CHECKIN' }, '*');
  showCheckInCard();
  clearTimeout(checkInTimer);
  checkInTimer = setTimeout(() => finishVoiceCheckIn(), CHECKIN_TIMEOUT_MS);
  logAgentActivity('Voice check-in started.', 'ok');
  scheduleAgentRender();
}

// Prompts someone who joins while the Agent is running to introduce themselves.
function agentOnParticipantJoined(participant) {
  if (!agent.running || !participant || !participant.session_id) return;
  agent.checkIn.expected[participant.session_id] = participant.user_name || 'Guest';
  callFrame.sendAppMessage({ type: 'CHECKIN' }, participant.session_id);
  scheduleAgentRender();
}

function recordCheckIn(line) {
  const { checkIn } = agent;
  if (!checkIn.expected[line.id]) return;
  const intro = agent.intros[line.id] || { name: line.speaker, text: '' };
  if (intro.text.length < 300) intro.text = `${intro.text} ${line.text}`.trim().slice(0, 300);
  agent.intros[line.id] = intro;
  if (checkIn.heard[line.id]) return;

  checkIn.heard[line.id] = true;
  if (line.id === localSessionId()) markCheckInHeard();
  else callFrame.sendAppMessage({ type: 'CHECKIN_HEARD' }, line.id);
  scheduleAgentRender();
  if (checkIn.active && Object.keys(checkIn.expected).every((id) => checkIn.heard[id] || !getParticipant(id))) {
    finishVoiceCheckIn();
  }
}

function finishVoiceCheckIn() {
  const { checkIn } = agent;
  if (!checkIn.active) return;
  checkIn.active = false;
  clearTimeout(checkInTimer);
  if (callFrame) callFrame.sendAppMessage({ type: 'CHECKIN_DONE' }, '*');
  hideCheckInCard();
  const missing = Object.keys(checkIn.expected)
    .filter((id) => !checkIn.heard[id] && getParticipant(id))
    .map((id) => checkIn.expected[id]);
  broadcastAgentSay(missing.length
    ? `Voice check-in done. I couldn't hear ${missing.join(', ')} yet; please check ${missing.length === 1 ? 'that microphone' : 'those microphones'}.`
    : 'Voice check-in done. The Agent can hear everyone.');
  logAgentActivity(missing.length ? `Check-in finished; not heard: ${missing.join(', ')}.` : 'Check-in finished; heard everyone.', missing.length ? 'error' : 'ok');
  scheduleAgentRender();
}

function showCheckInCard() {
  const card = document.getElementById('checkin-card');
  if (!card) return;
  document.getElementById('checkin-status').innerText = 'Listening for you...';
  card.classList.remove('hidden');
}

function markCheckInHeard() {
  const card = document.getElementById('checkin-card');
  if (!card || card.classList.contains('hidden')) return;
  document.getElementById('checkin-status').innerText = 'Got it, thanks!';
  setTimeout(hideCheckInCard, 2500);
}

function hideCheckInCard() {
  const card = document.getElementById('checkin-card');
  if (card) card.classList.add('hidden');
}

// Check-in messages from the host running the Agent. Returns true when handled.
function agentHandleAppMessage(msg, fromId) {
  if (!['CHECKIN', 'CHECKIN_HEARD', 'CHECKIN_DONE'].includes(msg.type)) return false;
  const sender = getParticipant(fromId);
  if (!(isPrivileged(fromId) || (sender && sender.owner))) return true;
  if (msg.type === 'CHECKIN') showCheckInCard();
  else if (msg.type === 'CHECKIN_HEARD') markCheckInHeard();
  else hideCheckInCard();
  return true;
}

// --- Saving to Chowaniec Notes (/notes) ---

async function notesRequest(method, body) {
  const res = await fetch(NOTES_ENDPOINT, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Chowaniec-Key': signedInKey() },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

// Mirrors the Agent's notes into a note shared with the family, so everyone can read them.
async function syncNotesToNotebook() {
  if (!agent.notes) return;
  const date = new Date(agent.startedAt || Date.now()).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const title = `${agent.notes.title || 'Meeting notes'} (${date})`;
  const markdown = agentNotesMarkdown();
  try {
    if (agent.savedNoteId) {
      const { status } = await notesRequest('PUT', { id: agent.savedNoteId, title, markdown });
      if (status === 404) agent.savedNoteId = null;
      else if (status !== 200) throw new Error();
    }
    if (!agent.savedNoteId) {
      const { status, data } = await notesRequest('POST', { title, markdown, shared: true, source: 'agent', meetingCode: currentMeetingCode });
      if (status !== 200) throw new Error();
      agent.savedNoteId = data.note.id;
    }
    agent.notesSyncError = null;
  } catch (e) {
    agent.notesSyncError = 'Could not save these notes to Chowaniec Notes. They are still saved on this device.';
  }
  saveAgentState();
  scheduleAgentRender();
}

// --- Meeting recap (posted to a group chat as Chowaniec AI) ---
// Everyone reports when they join, so the recap goes to the most private chat that includes everyone who attended.
// The host can pick a different chat, or turn the recap off, in the Agent panel.

const agentRecap = { chat: 'auto', info: null, busy: false, message: '' };

function recapStorageKey() { return `chowaniec_meet_recap_chat_${currentMeetingCode}`; }

function recapHeaders() {
  return { 'Content-Type': 'application/json', 'X-Chowaniec-Key': signedInKey() };
}

function reportMeetingJoined() {
  if (!currentMeetingCode) return;
  fetch(RECAP_ENDPOINT, { method: 'POST', headers: recapHeaders(), body: JSON.stringify({ action: 'joined', code: currentMeetingCode }), keepalive: true }).catch(() => {});
  try { agentRecap.chat = localStorage.getItem(recapStorageKey()) || 'auto'; } catch (e) { agentRecap.chat = 'auto'; }
}

async function loadRecapInfo() {
  if (!isHostUser() || !currentMeetingCode) return;
  try {
    const res = await fetch(`${RECAP_ENDPOINT}?code=${encodeURIComponent(currentMeetingCode)}`, { headers: recapHeaders(), cache: 'no-store' });
    if (res.ok) { agentRecap.info = await res.json(); scheduleAgentRender(); }
  } catch (e) { /* the card still works with its defaults */ }
}

function setRecapChat(value) {
  agentRecap.chat = value;
  try { localStorage.setItem(recapStorageKey(), value); } catch (e) { /* ignore */ }
  scheduleAgentRender();
}

// Sends the recap now. From the "Post recap now" button the person sees the result; on leaving it runs in the background.
async function postRecapNow(background) {
  if (agentRecap.chat === 'none' || !currentMeetingCode || agentRecap.busy) return;
  agentRecap.busy = true;
  agentRecap.message = '';
  scheduleAgentRender();
  if (agent.notes && background !== true) await syncNotesToNotebook();
  try {
    const res = await fetch(RECAP_ENDPOINT, {
      method: 'POST', headers: recapHeaders(), keepalive: background === true,
      body: JSON.stringify({ action: 'post', code: currentMeetingCode, chat: agentRecap.chat })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'The recap could not be posted.');
    agentRecap.message = 'Recap posted to the chat.';
    if (!background) toast('Recap posted to the chat.');
  } catch (e) {
    agentRecap.message = e.message;
    if (!background) toast(e.message);
  } finally {
    agentRecap.busy = false;
    scheduleAgentRender();
  }
}

// Called when the host who ran the Agent leaves: save the notes, then post the recap without making them wait.
async function postRecapOnLeave() {
  if (agentRecap.chat === 'none' || !agent.notes) return;
  try { await Promise.race([syncNotesToNotebook(), new Promise((r) => setTimeout(r, 4000))]); } catch (e) { /* the recap uses the saved note */ }
  postRecapNow(true);
}

function renderRecapSection() {
  if (!isHostUser()) return '';
  const info = agentRecap.info;
  const chats = (info && info.chats) || [{ id: 'everyone', name: 'Everyone' }];
  const suggested = info ? chats.find((c) => c.id === info.suggested) : null;
  const options = [
    `<option value="auto"${agentRecap.chat === 'auto' ? ' selected' : ''}>Automatic${suggested ? `: ${escapeHtml(suggested.name)}` : ''}</option>`,
    ...chats.map((c) => `<option value="${escapeHtml(c.id)}"${agentRecap.chat === c.id ? ' selected' : ''}>${escapeHtml(c.name)}</option>`),
    `<option value="none"${agentRecap.chat === 'none' ? ' selected' : ''}>Don't post a recap</option>`
  ].join('');
  return `
    <div class="p-4 rounded-xl bg-white/5 border border-white/5 space-y-3">
      <span class="text-xs font-medium text-white">Meeting Recap</span>
      <p class="text-[11px] text-zinc-500 leading-relaxed">When you leave, the AI posts a short recap in a group chat. Automatic picks the chat that matches who attended${info && info.attendees.length ? ` (${escapeHtml(info.attendees.join(', '))})` : ''}.</p>
      <label class="block text-[10px] font-mono uppercase tracking-widest text-zinc-500" for="recap-chat">Post to</label>
      <select id="recap-chat" onchange="setRecapChat(this.value)" class="w-full py-2.5 px-3 rounded-lg bg-white/10 text-xs text-white border border-white/10">${options}</select>
      <button onclick="postRecapNow()" ${agentRecap.busy || agentRecap.chat === 'none' || !agent.notes ? 'disabled' : ''} class="w-full py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white disabled:opacity-40">${agentRecap.busy ? 'Posting...' : 'Post recap now'}</button>
      ${!agent.notes ? '<p class="text-[11px] text-zinc-500">The recap needs the Agent\'s notes. Start the Agent first.</p>' : ''}
      ${info && info.posted ? `<p class="text-[11px] text-zinc-400">Last posted ${escapeHtml(formatClock(info.posted.at))}.</p>` : ''}
      ${agentRecap.message ? `<p class="text-[11px] text-zinc-300">${escapeHtml(agentRecap.message)}</p>` : ''}
    </div>`;
}

// --- Start / stop ---

function startAgent() {
  if (!callFrame) return;
  if (!isLocalOwner()) {
    toast('Only a host (Gabriel or Victoria) can start the Agent.');
    return;
  }
  agent.starting = true;
  scheduleAgentRender();
  callFrame.startTranscription();
}

function stopAgent() {
  if (!callFrame || !agent.running) return;
  callFrame.stopTranscription();
  stopAgentLocally('Agent stopped listening.');
  updateAgentNotes(false);
}

function stopAgentLocally(message) {
  agent.running = false;
  clearInterval(agentNotesTimer);
  agentNotesTimer = null;
  if (message) logAgentActivity(message, 'ok');
  saveAgentState();
}

function logAgentActivity(text, status) {
  agent.activity.push({ time: new Date().toISOString(), text, status });
  agent.activity = agent.activity.slice(-30);
}

function finishAgentActivity(status, detail) {
  const entry = [...agent.activity].reverse().find((a) => a.status === 'working');
  if (entry) {
    entry.status = status;
    if (detail) entry.detail = detail;
  }
}

// --- UI ---

function updateAgentChip() {
  const chip = document.getElementById('agent-chip');
  if (!chip) return;
  const on = agent.running || agentListeningRemotely;
  chip.classList.toggle('hidden', !on);
  chip.classList.toggle('flex', on);
}

function scheduleAgentRender() {
  if (currentDrawerTab !== 'agent' || agentRenderTimer) return;
  agentRenderTimer = setTimeout(() => {
    agentRenderTimer = null;
    if (currentDrawerTab === 'agent') renderDrawer('agent');
  }, 400);
}

function formatClock(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderAgentPanel() {
  const isHost = isLocalOwner();
  const section = (title, inner) => inner ? `
    <div class="space-y-2">
      <span class="block text-[10px] font-mono uppercase tracking-widest text-zinc-500">${title}</span>
      ${inner}
    </div>` : '';
  const list = (items, fn) => items.length ? `<ul class="space-y-1.5">${items.map((x) => `<li class="text-xs text-zinc-300 leading-relaxed">${fn(x)}</li>`).join('')}</ul>` : '';

  let controls;
  if (agent.running) {
    controls = `
      <div class="flex gap-2">
        <button onclick="stopAgent()" class="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-medium text-white">Stop Agent</button>
        <button onclick="updateAgentNotes(true)" ${agent.updatingNotes ? 'disabled' : ''} class="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/15 text-xs text-white disabled:opacity-50">${agent.updatingNotes ? 'Updating...' : 'Update Notes'}</button>
      </div>`;
  } else if (agent.starting) {
    controls = '<p class="text-xs text-zinc-400">Starting the Agent...</p>';
  } else if (agentListeningRemotely) {
    controls = '<p class="text-xs text-zinc-400 font-light">The Agent is listening. A host in this call is taking the notes.</p>';
  } else if (isHost) {
    controls = `<button onclick="startAgent()" class="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-violet-500 hover:bg-violet-400 text-xs font-medium text-white"><i data-lucide="bot" class="w-4 h-4"></i> Start Agent</button>`;
  } else {
    controls = '<p class="text-xs text-zinc-400 font-light">A host (Gabriel or Victoria) can start the Agent to take notes for this meeting.</p>';
  }

  const status = agent.running
    ? '<span class="inline-flex items-center gap-1.5 text-[11px] text-violet-300"><span class="w-2 h-2 rounded-full bg-violet-400 animate-pulse"></span>Listening</span>'
    : '<span class="text-[11px] text-zinc-500">Off</span>';

  const n = agent.notes;
  const notesHtml = n ? `
    <div class="space-y-4">
      ${n.title ? `<h4 class="text-sm font-semibold text-white">${escapeHtml(n.title)}</h4>` : ''}
      ${section('Summary', n.summary ? `<p class="text-xs text-zinc-300 leading-relaxed">${escapeHtml(n.summary)}</p>` : '')}
      ${section('Decisions', list(n.decisions, (d) => escapeHtml(d)))}
      ${section('Action Items', list(n.action_items, (a) => `<span class="text-white">${escapeHtml(a.owner || 'Unassigned')}</span>: ${escapeHtml(a.task)}${a.due ? ` <span class="text-zinc-500">(${escapeHtml(a.due)})</span>` : ''}`))}
      ${section('Important Dates', list(n.important_dates, (d) => `<span class="text-white">${escapeHtml(d.date)}</span>: ${escapeHtml(d.detail)}`))}
      ${section('Votes', list(n.votes, (v) => `${escapeHtml(v.question)}: <span class="text-white">${escapeHtml(v.outcome)}</span>`))}
      ${n.tables.map((t) => section(escapeHtml(t.title) || 'Table', `
        <div class="overflow-x-auto rounded-lg border border-white/10">
          <table class="w-full text-[11px] text-left">
            <thead class="bg-white/5 text-zinc-400"><tr>${t.columns.map((c) => `<th class="px-2 py-1.5 font-medium">${escapeHtml(c)}</th>`).join('')}</tr></thead>
            <tbody>${t.rows.map((r) => `<tr class="border-t border-white/5">${r.map((c) => `<td class="px-2 py-1.5 text-zinc-300">${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>`)).join('')}
      ${section('Who Said What', list(n.discussion, (d) => `<span class="text-white">${escapeHtml(d.speaker)}</span>: ${escapeHtml(d.point)}`))}
      ${section('Open Questions', list(n.open_questions, (q) => escapeHtml(q)))}
    </div>` : `<p class="text-xs text-zinc-500 font-light">${agent.running ? 'Notes will appear here about a minute after people start talking.' : 'No notes yet for this meeting.'}</p>`;

  const activity = agent.activity.slice(-5).reverse();
  const recentLines = agent.transcript.slice(-40);

  return `
    <div class="space-y-5">
      <div class="p-4 rounded-xl bg-white/5 border border-white/5 space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-xs font-medium text-white">Meeting Agent</span>
          ${status}
        </div>
        ${controls}
        <p class="text-[11px] text-zinc-500 leading-relaxed">Say <span class="text-zinc-300">"Hey Agent"</span> then a command, e.g. "make a poll about what I just said", "ask everyone what they would prefer", or "note that we shoot on Saturday". Commands work for the Director and Co-Director.</p>
      </div>

      ${renderCheckInSection()}

      ${renderRecapSection()}

      ${agent.savedNoteId ? `
        <a href="/notes/?id=${encodeURIComponent(agent.savedNoteId)}" target="_blank" rel="noopener" class="flex items-center justify-center gap-2 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-sky-300">
          <i data-lucide="notebook-pen" class="w-3.5 h-3.5"></i> Saved to Chowaniec Notes (shared with family)
        </a>` : ''}
      ${agent.notesSyncError ? `<p class="text-[11px] text-amber-300">${escapeHtml(agent.notesSyncError)}</p>` : ''}
      ${agent.notesError ? `<p class="text-[11px] text-red-400">${escapeHtml(agent.notesError)}</p>` : ''}
      ${agent.notesUpdatedAt ? `<p class="text-[10px] font-mono text-zinc-500">NOTES UPDATED ${escapeHtml(formatClock(agent.notesUpdatedAt))}</p>` : ''}
      ${notesHtml}

      ${(n || agent.transcript.length) ? `
        <div class="flex gap-2">
          <button onclick="copyAgentNotes()" class="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-zinc-200"><i data-lucide="copy" class="w-3.5 h-3.5"></i> Copy</button>
          <button onclick="downloadAgentNotes()" class="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-zinc-200"><i data-lucide="download" class="w-3.5 h-3.5"></i> Download</button>
        </div>` : ''}

      ${activity.length ? section('Agent Activity', list(activity, (a) => `
        <span class="${a.status === 'error' ? 'text-red-400' : a.status === 'working' ? 'text-violet-300' : 'text-zinc-400'}">${escapeHtml(formatClock(a.time))}</span>
        ${escapeHtml(a.text)}${a.status === 'working' ? ' <span class="text-violet-300">(working...)</span>' : ''}${a.detail ? ` <span class="text-red-400">${escapeHtml(a.detail)}</span>` : ''}`)) : ''}

      ${recentLines.length ? `
        <details ${agentTranscriptOpen ? 'open' : ''} ontoggle="agentTranscriptOpen = this.open" class="rounded-xl bg-white/5 border border-white/5">
          <summary class="cursor-pointer px-3 py-2.5 text-xs text-zinc-300">Live Transcript (${agent.transcript.length} lines)</summary>
          <div class="px-3 pb-3 space-y-1.5 max-h-72 overflow-y-auto">
            ${recentLines.map((l) => `<p class="text-[11px] text-zinc-400 leading-relaxed"><span class="text-zinc-500">${escapeHtml(formatClock(l.time))}</span> <span class="text-white">${escapeHtml(l.speaker)}:</span> ${escapeHtml(l.text)}</p>`).join('')}
          </div>
        </details>` : ''}
    </div>
  `;
}

function renderCheckInSection() {
  const { checkIn } = agent;
  const ids = Object.keys(checkIn.expected);
  if (!agent.running || !ids.length) return '';
  return `
    <div class="p-4 rounded-xl bg-white/5 border border-white/5 space-y-3">
      <div class="flex items-center justify-between">
        <span class="text-xs font-medium text-white">Voice Check-in</span>
        <span class="text-[11px] ${checkIn.active ? 'text-violet-300' : 'text-zinc-500'}">${checkIn.active ? 'In progress' : 'Done'}</span>
      </div>
      <ul class="space-y-1.5">
        ${ids.map((id) => {
          const heard = checkIn.heard[id];
          const present = !!getParticipant(id);
          return `<li class="flex items-center gap-2 text-xs ${present ? 'text-zinc-200' : 'text-zinc-500 line-through'}">
            <i data-lucide="${heard ? 'circle-check' : 'mic'}" class="w-3.5 h-3.5 ${heard ? 'text-emerald-400' : 'text-zinc-500'}"></i>
            ${escapeHtml(checkIn.expected[id])}${heard ? '' : ' <span class="text-zinc-500">waiting...</span>'}
          </li>`;
        }).join('')}
      </ul>
      ${checkIn.active
        ? '<button onclick="finishVoiceCheckIn()" class="w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-zinc-300">Finish Check-in</button>'
        : '<button onclick="startVoiceCheckIn()" class="w-full py-2 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-zinc-300">Run Check-in Again</button>'}
    </div>`;
}

// --- Export ---

function agentNotesMarkdown() {
  const n = agent.notes;
  const out = [];
  const date = new Date(agent.startedAt || Date.now()).toDateString();
  out.push(`# ${n && n.title ? n.title : 'Meeting Notes'}`, '', `Meeting code: ${currentMeetingCode} · ${date}`, '');
  const bullets = (title, items, fn) => {
    if (!items || !items.length) return;
    out.push(`## ${title}`, '', ...items.map((x) => `- ${fn(x)}`), '');
  };
  const cell = (v) => String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  if (n) {
    if (n.summary) out.push('## Summary', '', n.summary, '');
    bullets('Decisions', n.decisions, (d) => d);
    if (n.action_items.length) {
      out.push('## Action Items', '', '| Owner | Task | Due |', '| --- | --- | --- |',
        ...n.action_items.map((a) => `| ${cell(a.owner || 'Unassigned')} | ${cell(a.task)} | ${cell(a.due || '')} |`), '');
    }
    bullets('Important Dates', n.important_dates, (d) => `**${d.date}**: ${d.detail}`);
    bullets('Votes', n.votes, (v) => `${v.question}: **${v.outcome}**`);
    n.tables.forEach((t) => {
      if (!t.columns.length) return;
      out.push(`## ${t.title || 'Table'}`, '', `| ${t.columns.map(cell).join(' | ')} |`, `| ${t.columns.map(() => '---').join(' | ')} |`,
        ...t.rows.map((r) => `| ${r.map(cell).join(' | ')} |`), '');
    });
    bullets('Who Said What', n.discussion, (d) => `**${d.speaker}**: ${d.point}`);
    bullets('Open Questions', n.open_questions, (q) => q);
  }
  const polls = agent.polls.map(pollSummary);
  bullets('Poll Results', polls, (p) => `${p.question}: ${Object.entries(p.results).map(([k, v]) => `${k} (${v})`).join(', ')}`);
  if (formResponses.length) {
    bullets('Form Answers', formResponses, (r) => `**${r.from}** · ${r.title}: ${r.answers.map((a) => `${a.field}: ${a.value || '-'}`).join('; ')}`);
  }
  if (agent.transcript.length) {
    out.push('## Transcript', '', ...agent.transcript.map((l) => `**${formatClock(l.time)} ${l.speaker}:** ${l.text}  `), '');
  }
  return out.join('\n');
}

function copyAgentNotes() {
  const text = agentNotesMarkdown();
  if (!navigator.clipboard) {
    downloadAgentNotes();
    return;
  }
  navigator.clipboard.writeText(text).then(() => toast('Notes copied.'), () => downloadAgentNotes());
}

function downloadAgentNotes() {
  const blob = new Blob([agentNotesMarkdown()], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `meeting-notes-${currentMeetingCode || 'chowaniec'}-${new Date().toISOString().slice(0, 10)}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
