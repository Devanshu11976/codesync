'use strict';

require('dotenv').config();
const http = require('http');
const express = require('express');
const { WebSocketServer, WebSocket } = require('ws');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const { apply, transform, invert } = require('./ot/operations');

// ─── Constants ────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const JUDGE0_URL = process.env.JUDGE0_URL || 'https://judge0-ce.p.rapidapi.com';
const JUDGE0_API_KEY = process.env.JUDGE0_API_KEY || '';
const CURSOR_COLORS = ['#E85D24', '#1D9E75', '#534AB7', '#BA7517', '#D4537E'];
const UNDO_STACK_MAX = 50;
const ROOM_TTL_MS = 10 * 60 * 1000; // 10 minutes
const LANG_MAP = { javascript: 63, python: 71, java: 62, cpp: 54, go: 60 };
const RUN_COOLDOWN_MS = 5000;

// ─── Data Structures ──────────────────────────────────────────────────────────

class VersionNode {
  constructor(revision, op, authorId) {
    this.revision = revision;
    this.op = op;
    this.authorId = authorId;
    this.timestamp = new Date();
    this.next = null;
  }
}

class VersionHistory {
  constructor() {
    this.head = null;
    this.size = 0;
  }

  /** Prepend a new node (most recent first). */
  prepend(revision, op, authorId) {
    const node = new VersionNode(revision, op, authorId);
    node.next = this.head;
    this.head = node;
    this.size++;
    return node;
  }

  /** Walk list from head to find all ops with revision > sinceRevision. */
  opsSince(sinceRevision) {
    const ops = [];
    let cur = this.head;
    while (cur) {
      if (cur.revision > sinceRevision) ops.push(cur);
      cur = cur.next;
    }
    // Return in ascending order (oldest first)
    return ops.reverse();
  }

  /** Serialize for client-side mirroring. */
  toArray() {
    const arr = [];
    let cur = this.head;
    while (cur) {
      arr.push({
        revision: cur.revision,
        op: cur.op,
        authorId: cur.authorId,
        timestamp: cur.timestamp,
      });
      cur = cur.next;
    }
    return arr;
  }
}

class UndoStack {
  constructor() {
    this.ops = [];
  }

  push(op) {
    if (this.ops.length >= UNDO_STACK_MAX) {
      this.ops.shift(); // drop oldest (bottom)
    }
    this.ops.push(op);
  }

  pop() {
    return this.ops.pop() || null;
  }

  peek() {
    return this.ops[this.ops.length - 1] || null;
  }
}

// ─── Room store ───────────────────────────────────────────────────────────────

/**
 * rooms: Map<roomId, {
 *   document: string,
 *   revision: number,
 *   history: VersionHistory,
 *   undoStack: UndoStack,
 *   clients: Map<ws, { id, username, color, cursorPos }>,
 *   colorIndex: number,
 *   lastRunAt: number,
 *   cleanupTimer: ReturnType<typeof setTimeout>|null,
 * }>
 */
const rooms = new Map();

function getOrCreateRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      document: '// Start coding here\n',
      revision: 0,
      history: new VersionHistory(),
      undoStack: new UndoStack(),
      clients: new Map(),
      colorIndex: 0,
      lastRunAt: 0,
      cleanupTimer: null,
    });
  }
  return rooms.get(roomId);
}

function scheduleRoomCleanup(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
  room.cleanupTimer = setTimeout(() => {
    rooms.delete(roomId);
    console.log(`[room] ${roomId} expired and removed.`);
  }, ROOM_TTL_MS);
}

function cancelRoomCleanup(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  if (room.cleanupTimer) {
    clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcast(room, payload, excludeWs = null) {
  for (const [ws] of room.clients) {
    if (ws !== excludeWs) send(ws, payload);
  }
}

function getUserList(room) {
  return Array.from(room.clients.values()).map(({ id, username, color }) => ({
    id,
    username,
    color,
  }));
}

// ─── OT server logic ─────────────────────────────────────────────────────────

function handleOp(ws, room, clientRevision, rawOp) {
  // 1. Collect all ops committed since clientRevision
  const serverOpsSince = room.history.opsSince(clientRevision);

  // 2. Transform incoming op against each server op
  let op = rawOp;
  for (const node of serverOpsSince) {
    try {
      [op] = transform(op, node.op);
    } catch (e) {
      console.error('[OT] transform error:', e.message);
      return;
    }
  }

  // 3. Apply transformed op
  let newDoc;
  try {
    newDoc = apply(room.document, op);
  } catch (e) {
    console.error(`[OT] apply error in room ${room.id || 'unknown'}:`, e.message);
    console.error(`     op: ${JSON.stringify(op)}`);
    console.error(`     doc length: ${room.document.length}`);
    console.error(`     clientRevision: ${clientRevision}, serverRevision: ${room.revision}`);
    // Notify client of desync so they can force-refresh
    send(ws, { type: 'error', message: 'Synchronization error. Please refresh.' });
    return;
  }

  // 4. Build invert op for undo BEFORE updating document
  const invertOp = invert(op, room.document);

  // 5. Commit
  room.document = newDoc;
  room.revision++;
  room.history.prepend(room.revision, op, room.clients.get(ws)?.id ?? 'unknown');
  room.undoStack.push(invertOp);

  // 6. Ack sender
  send(ws, { type: 'ack', revision: room.revision });

  // 7. Broadcast to others
  broadcast(room, { type: 'op', revision: room.revision, op, authorId: room.clients.get(ws)?.id }, ws);
}

function handleUndo(ws, room) {
  const invertOp = room.undoStack.pop();
  if (!invertOp) return;

  let newDoc;
  try {
    newDoc = apply(room.document, invertOp);
  } catch (e) {
    console.error('[undo] apply error:', e.message);
    return;
  }

  room.document = newDoc;
  room.revision++;
  room.history.prepend(room.revision, invertOp, room.clients.get(ws)?.id ?? 'unknown');

  const payload = { type: 'op', revision: room.revision, op: invertOp, authorId: room.clients.get(ws)?.id };
  send(ws, payload);
  broadcast(room, payload, ws);
}

// ─── Code Execution ───────────────────────────────────────────────────────────

async function handleRun(ws, room, language, stdin) {
  const now = Date.now();
  if (now - room.lastRunAt < RUN_COOLDOWN_MS) {
    send(ws, { type: 'run_result', stderr: 'Rate limit: wait 5s between runs.', stdout: '', status: 'Rate Limited' });
    return;
  }
  room.lastRunAt = now;

  const langKey = (language || '').toLowerCase().replace(/\+/g, 'p');
  const languageId = LANG_MAP[langKey];
  if (!languageId) {
    send(ws, { type: 'run_result', stderr: `Unknown language: ${language}`, stdout: '', status: 'Error' });
    return;
  }

  // --- Demo Mock Mode ---
  if (!JUDGE0_API_KEY || JUDGE0_API_KEY === 'your_rapidapi_key_here') {
    // Simulate network delay
    setTimeout(() => {
      send(ws, {
        type: 'run_result',
        stdout: `[MOCK OUTPUT]\n> Running ${language} code...\nHello from CodeSync!\nExecution successful.`,
        stderr: '',
        time: '0.05s',
        memory: '1240 KB',
        status: 'Accepted (Mock Mode)',
      });
    }, 1000);
    return;
  }

  try {
    const headers = { 'content-type': 'application/json' };
    if (JUDGE0_API_KEY) {
      headers['X-RapidAPI-Key'] = JUDGE0_API_KEY;
      headers['X-RapidAPI-Host'] = 'judge0-ce.p.rapidapi.com';
    }

    const response = await axios.post(
      `${JUDGE0_URL}/submissions?base64_encoded=false&wait=true`,
      { source_code: room.document, language_id: languageId, stdin: stdin || '' },
      { headers, timeout: 15000 }
    );

    const { stdout, stderr, time, memory, status } = response.data;
    send(ws, {
      type: 'run_result',
      stdout: stdout || '',
      stderr: stderr || '',
      time,
      memory,
      status: status?.description || 'Unknown',
    });
  } catch (err) {
    send(ws, {
      type: 'run_result',
      stdout: '',
      stderr: err.response?.data?.message || err.message,
      status: 'Error',
    });
  }
}

// ─── Express + WebSocket server ───────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from React build
app.use(express.static(path.join(__dirname, 'client/build')));

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

// Catch-all route to serve React app
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'client/build', 'index.html'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  let currentRoomId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      // ── join ───────────────────────────────────────────────────────────────
      case 'join': {
        const { roomId, username } = msg;
        if (!roomId || !username) return;

        currentRoomId = roomId;
        const room = getOrCreateRoom(roomId);
        cancelRoomCleanup(roomId);

        const id = uuidv4();
        const color = CURSOR_COLORS[room.colorIndex % CURSOR_COLORS.length];
        room.colorIndex++;
        room.clients.set(ws, { id, username, color, cursorPos: 0 });

        // Send init state to joining client
        send(ws, {
          type: 'init',
          document: room.document,
          revision: room.revision,
          users: getUserList(room),
          history: room.history.toArray().slice(0, 50),
        });

        // Notify others
        broadcast(room, { type: 'user_joined', userId: id, username, color }, ws);
        console.log(`[join] ${username} (${id}) → room:${roomId}`);
        break;
      }

      // ── op ────────────────────────────────────────────────────────────────
      case 'op': {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;
        handleOp(ws, room, msg.revision, msg.op);
        break;
      }

      // ── cursor ────────────────────────────────────────────────────────────
      case 'cursor': {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;
        const client = room.clients.get(ws);
        if (!client) return;
        client.cursorPos = msg.position;
        broadcast(room, { type: 'cursor', userId: client.id, position: msg.position }, ws);
        break;
      }

      // ── undo ──────────────────────────────────────────────────────────────
      case 'undo': {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;
        handleUndo(ws, room);
        break;
      }

      // ── run ───────────────────────────────────────────────────────────────
      case 'run': {
        if (!currentRoomId) return;
        const room = rooms.get(currentRoomId);
        if (!room) return;
        handleRun(ws, room, msg.language, msg.stdin);
        break;
      }

      default:
        break;
    }
  });

  ws.on('close', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room) return;

    const client = room.clients.get(ws);
    if (client) {
      broadcast(room, { type: 'user_left', userId: client.id });
      console.log(`[leave] ${client.username} (${client.id}) ← room:${currentRoomId}`);
    }
    room.clients.delete(ws);

    if (room.clients.size === 0) {
      scheduleRoomCleanup(currentRoomId);
    }
  });

  ws.on('error', (err) => {
    console.error('[ws] error:', err.message);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Collab-editor server running on ws://localhost:${PORT}`);
});
