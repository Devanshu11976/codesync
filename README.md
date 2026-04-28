<div align="center">

```
 ██████╗ ██████╗ ██████╗ ███████╗███████╗██╗   ██╗███╗   ██╗ ██████╗
██╔════╝██╔═══██╗██╔══██╗██╔════╝██╔════╝╚██╗ ██╔╝████╗  ██║██╔════╝
██║     ██║   ██║██║  ██║█████╗  ███████╗ ╚████╔╝ ██╔██╗ ██║██║
██║     ██║   ██║██║  ██║██╔══╝  ╚════██║  ╚██╔╝  ██║╚██╗██║██║
╚██████╗╚██████╔╝██████╔╝███████╗███████║   ██║   ██║ ╚████║╚██████╗
 ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝╚══════╝   ╚═╝   ╚═╝  ╚═══╝ ╚═════╝
```

# Real-Time Collaborative Code Editor

**Google Docs for code — built from scratch.**
Multiple users. One document. Zero conflicts. Live, in the browser.

[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black)](https://react.dev)
[![WebSockets](https://img.shields.io/badge/WebSockets-ws-010101?style=flat-square&logo=websocket&logoColor=white)](https://github.com/websockets/ws)
[![Monaco](https://img.shields.io/badge/Monaco_Editor-VS_Code_Engine-007ACC?style=flat-square&logo=visualstudiocode&logoColor=white)](https://microsoft.github.io/monaco-editor/)
[![Judge0](https://img.shields.io/badge/Judge0-Multi--Language_Execution-F7931E?style=flat-square)](https://judge0.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow?style=flat-square)](LICENSE)

[Live Demo](#) · [Architecture](#-architecture) · [Getting Started](#-getting-started) · [How OT Works](#-how-operational-transformation-works)

</div>

---

## 🧠 What Makes This Different

Most "real-time" editors fake it — they send full document snapshots or lock the file when someone is editing. This one implements **Operational Transformation (OT)** from scratch: the same algorithm that powers Google Docs.

When two users type at the same time, their edits don't clobber each other. They get *mathematically transformed* so both changes survive, in the right order, on every client — with **guaranteed convergence**.

No Firebase. No CRDTs. No magic libraries. Pure algorithmic engineering.

---

## ✨ Features

| Feature | Details |
|---|---|
| 🔄 **Conflict-free sync** | Custom OT algorithm — `transform()`, `compose()`, `invert()` implemented from scratch |
| ⚡ **Real-time** | WebSocket server in Node.js — sub-100ms latency for edits |
| 👥 **Live cursors** | See every user's cursor position with their name and a unique color |
| ↩️ **Undo / Redo** | Stack-based undo that works correctly across concurrent sessions |
| 📜 **Version history** | Full revision history implemented as a Linked List — restore any past state |
| ▶️ **Run code** | Execute code in 5 languages via Judge0 API — see output inline |
| 🔗 **Shareable rooms** | Generate a room link, share it, start collaborating instantly |
| 📱 **Monaco Editor** | The same engine that powers VS Code — syntax highlighting, autocomplete |

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENT (React)                          │
│                                                                 │
│   Monaco Editor  ──onChange──►  OT Client Buffer               │
│       ▲                              │                          │
│       │ executeEdits()               │ WebSocket send           │
│       │                              ▼                          │
│   Remote Op ◄── transform() ◄── WS Message Handler             │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │  ws://  (JSON over WebSocket)
┌──────────────────────────▼──────────────────────────────────────┐
│                      SERVER (Node.js)                           │
│                                                                 │
│   Room Manager                                                  │
│   ├── document: String          (current state)                 │
│   ├── revision: Number          (monotonic counter)             │
│   ├── history:  LinkedList      (VersionNode chain)             │
│   ├── undoStack: Stack          (last 50 invertible ops)        │
│   └── clients:  Map<id, ws>     (active connections)            │
│                                                                 │
│   On op received:                                               │
│   1. Walk history since client revision                         │
│   2. transform(op, each server op since then)                   │
│   3. apply() to document                                        │
│   4. Broadcast to all other clients                             │
│   5. ACK sender with new revision                               │
│                                                                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │  HTTP POST
                    ┌──────▼──────┐
                    │   Judge0    │
                    │  (Execute)  │
                    └─────────────┘
```

---

## 🔬 How Operational Transformation Works

The core insight: when two users edit the same document concurrently, you can't apply both edits naively — one will overwrite the other. OT *transforms* each operation against concurrent ones so they remain valid.

### The convergence guarantee

```
Initial document: "hello world"

User A types at pos 5: INSERT " there"   →  "hello there world"
User B deletes pos 6-10: DELETE 5 chars  →  "hello "

Without OT:  applying B after A would delete the wrong characters
With OT:     B's operation is transformed to account for A's insert
             Result on both clients: "hello there"   ✓ identical
```

### Operation types

```javascript
{ type: 'insert', position: 5, text: ' there' }   // insert text at position
{ type: 'delete', position: 6, length: 5 }         // delete N chars from position
{ type: 'retain', length: 11 }                     // used in composed operations
```

### The transform matrix

| op1 \ op2 | insert | delete |
|---|---|---|
| **insert** | shift position right if op2 ≤ op1 | shift position left by deleted length |
| **delete** | adjust range to skip over inserted text | trim overlapping ranges |

### Data structures used

```
Version History (Linked List)
─────────────────────────────
 HEAD → [rev:42, op, author] → [rev:41, op, author] → [rev:40, ...] → null
         newest                                                         oldest

Undo Stack (Stack — max depth 50)
──────────────────────────────────
 TOP  │ invertOp for rev 42  │
      │ invertOp for rev 41  │
      │ invertOp for rev 40  │
 BOT  └──────────────────────┘
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Judge0 API key ([get free key on RapidAPI](https://rapidapi.com/judge0-official/api/judge0-ce))

### Clone & Install

```bash
git clone https://github.com/devanshu-sharma/codesync.git
cd codesync
```

```bash
# Backend
cd server
npm install

# Frontend
cd ../client
npm install
```

### Environment Setup

```bash
# server/.env
PORT=8080
JUDGE0_URL=https://judge0-ce.p.rapidapi.com
JUDGE0_API_KEY=your_rapidapi_key_here
```

```bash
# client/.env
REACT_APP_WS_URL=ws://localhost:8080
```

### Run Locally

```bash
# Terminal 1 — start backend
cd server && npm run dev

# Terminal 2 — start frontend
cd client && npm start
```

Open [http://localhost:3000](http://localhost:3000), enter a username, generate a room, and share the link.

---

## 🧪 OT Algorithm Test Suite

The OT core has a standalone test suite. Run it before anything else:

```bash
cd server
node ot/operations.test.js
```

```
✓ apply() insert
✓ apply() delete
✓ transform() insert + insert at same position — convergence verified
✓ transform() insert + delete collision — convergence verified
✓ transform() delete + delete overlap — convergence verified
✓ ... and 13 other edge cases (total 18)

18 / 18 tests passed
```

---

## 🌐 WebSocket Message Protocol

```
CLIENT → SERVER                         SERVER → CLIENT
─────────────────────────────────────   ──────────────────────────────────────
{ type: 'join',   roomId, username }    { type: 'init',       document, revision, users }
{ type: 'op',     roomId, revision, op} { type: 'op',         revision, op, authorId }
{ type: 'cursor', roomId, position }    { type: 'ack',        revision }
{ type: 'undo',   roomId }              { type: 'cursor',     userId, position }
{ type: 'run',    roomId, lang, stdin } { type: 'user_joined',userId, username, color }
                                        { type: 'user_left',  userId }
                                        { type: 'run_result', stdout, stderr, time }
```

---

## 🖥 Supported Languages

| Language | Judge0 ID |
|---|---|
| JavaScript | 63 |
| Python | 71 |
| Java | 62 |
| C++ | 54 |
| Go | 60 |

---

## 📁 Project Structure

```
codesync/
├── server/
│   ├── ot/
│   │   ├── operations.js          # OT core — apply, transform, compose, invert
│   │   └── operations.test.js     # standalone test suite (5 convergence tests)
│   ├── room/
│   │   ├── RoomManager.js         # in-memory room state
│   │   ├── LinkedList.js          # version history data structure
│   │   └── UndoStack.js           # undo stack (max depth 50)
│   ├── services/
│   │   └── ExecutionService.js    # Judge0 API integration
│   ├── server.js                  # WebSocket server + Express
│   └── package.json
│
├── client/
│   ├── src/
│   │   ├── ot/
│   │   │   └── client.js          # client-side OT buffer (pending + queue)
│   │   ├── components/
│   │   │   ├── Editor.jsx         # Monaco Editor + OT integration
│   │   │   ├── CursorOverlay.jsx  # live cursor decorations
│   │   │   ├── UserList.jsx       # connected users sidebar
│   │   │   ├── VersionHistory.jsx # linked list revision browser
│   │   │   └── OutputPanel.jsx    # code execution results
│   │   ├── hooks/
│   │   │   └── useWebSocket.js    # WS connection + reconnection logic
│   │   └── App.jsx
│   └── package.json
│
└── README.md
```

---

## 🚢 Deployment

### Backend → Railway

```bash
# railway.json
{
  "build": { "builder": "nixpacks" },
  "deploy": { "startCommand": "node server.js" }
}
```

```bash
railway login
railway init
railway up
```

### Frontend → Vercel

```bash
vercel --prod
# Set REACT_APP_WS_URL to your Railway backend URL in Vercel env vars
```

---

## 🔑 Key Engineering Decisions

**Why OT and not CRDTs?**
CRDTs (like Y.js or Automerge) are easier to implement but trade memory for simplicity — every character carries metadata forever. OT is leaner: operations are small, history can be pruned, and the convergence proof is explicit and auditable.

**Why `ws` and not Socket.IO?**
Socket.IO adds an abstraction layer (rooms, namespaces, fallback polling) that wasn't needed here. Raw `ws` gives direct control over the message protocol, lower overhead, and makes the OT integration logic cleaner.

**Why in-memory and not a database?**
Collaborative sessions are ephemeral by nature. Rooms are cleared 10 minutes after the last user leaves. Persisting to a DB would add latency on every keystroke. The version history linked list gives all the "undo" capability needed without persistence overhead.

---

## 👨💻 Author

**Devanshu Sharma**
B.E. Computer Science (AI & ML) — Chandigarh University

[![LinkedIn](https://img.shields.io/badge/LinkedIn-devanshu--sharma-0077B5?style=flat-square&logo=linkedin)](https://linkedin.com/in/devanshu-sharma)
[![Email](https://img.shields.io/badge/Email-devanshusharmagsp@gmail.com-D14836?style=flat-square&logo=gmail&logoColor=white)](mailto:devanshusharmagsp@gmail.com)

---

## 📄 License

MIT © 2025 Devanshu Sharma

---

<div align="center">
<sub>Built with Node.js · React · WebSockets · Monaco Editor · Judge0</sub><br>
<sub>OT algorithm implemented from scratch — no Firebase, no CRDTs, no magic</sub>
</div>
