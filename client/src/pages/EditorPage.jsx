import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import MonacoEditor from '@monaco-editor/react';
import { OTClient } from '../ot/client';
import Sidebar from '../components/Sidebar';
import Toolbar from '../components/Toolbar';
import OutputPanel from '../components/OutputPanel';

const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:8080';
const FLASH_DURATION = 800;

const LANG_MONACO_MAP = {
  javascript: 'javascript',
  python: 'python',
  java: 'java',
  cpp: 'cpp',
  go: 'go',
};

// ── helpers ───────────────────────────────────────────────────────────────────

function monacoOffsetToPosition(model, offset) {
  return model.getPositionAt(Math.max(0, Math.min(offset, model.getValue().length)));
}

function changeToOp(change) {
  // Monaco change: { rangeOffset, rangeLength, text }
  if (change.rangeLength === 0) {
    return { type: 'insert', position: change.rangeOffset, text: change.text };
  }
  if (change.text === '') {
    return { type: 'delete', position: change.rangeOffset, length: change.rangeLength };
  }
  // Replace — model as insert after delete
  return { type: 'insert', position: change.rangeOffset, text: change.text, _replaceLen: change.rangeLength };
}

// ─── EditorPage ───────────────────────────────────────────────────────────────

export default function EditorPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const username = sessionStorage.getItem('ce_username') || 'Anonymous';
  const language = sessionStorage.getItem('ce_language') || 'javascript';

  const wsRef = useRef(null);
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const clientRef = useRef(null);
  const suppressRef = useRef(false);       // suppress local change events on remote edits
  const decorationsRef = useRef({});       // userId → decorationCollection
  const flashTimersRef = useRef({});
  const cursorTimerRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectDelay = useRef(2000);

  const [users, setUsers] = useState([]);
  const usersRef = useRef([]); // Maintain ref to avoid stale closures in WS handlers
  const [history, setHistory] = useState([]);
  const [output, setOutput] = useState(null);
  const [isRunning, setIsRunning] = useState(false);
  const [connected, setConnected] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('users'); // 'users' | 'history'

  // ── WebSocket connection ────────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      reconnectDelay.current = 2000;
      ws.send(JSON.stringify({ type: 'join', roomId, username }));
    };

    ws.onmessage = (event) => {
      let msg;
      try { msg = JSON.parse(event.data); } catch { return; }
      handleServerMessage(msg);
    };

    ws.onclose = () => {
      setConnected(false);
      scheduleReconnect();
    };

    ws.onerror = () => ws.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, username]);

  function scheduleReconnect() {
    if (reconnectTimerRef.current) return;
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      reconnectDelay.current = Math.min(reconnectDelay.current * 2, 30000);
      connect();
    }, reconnectDelay.current);
  }

  useEffect(() => {
    if (!username || username === 'Anonymous') {
      navigate('/');
      return;
    }
    connect();
    return () => {
      wsRef.current?.close();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
    };
  }, [connect, navigate, username]);

  // ── OT Client bootstrap ────────────────────────────────────────────────────

  const sendOp = useCallback((op, revision) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'op', roomId, revision, op }));
    }
  }, [roomId]);

  const applyRemoteOp = useCallback((op) => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;

    suppressRef.current = true;
    try {
      if (op.type === 'retain') return;

      if (op.type === 'insert') {
        const pos = monacoOffsetToPosition(model, op.position);
        editor.executeEdits('remote', [{
          range: new monacoRef.current.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
          text: op.text,
          forceMoveMarkers: true,
        }]);
      } else if (op.type === 'delete') {
        const startPos = monacoOffsetToPosition(model, op.position);
        const endPos = monacoOffsetToPosition(model, op.position + op.length);
        editor.executeEdits('remote', [{
          range: new monacoRef.current.Range(startPos.lineNumber, startPos.column, endPos.lineNumber, endPos.column),
          text: '',
          forceMoveMarkers: true,
        }]);
      }
    } finally {
      suppressRef.current = false;
    }
  }, []);

  // ── Server message handler ─────────────────────────────────────────────────

  function handleServerMessage(msg) {
    switch (msg.type) {
      case 'init': {
        const editor = editorRef.current;
        if (editor) {
          const currentVal = editor.getValue();
          // Only overwrite if significant divergence or if it's the first load
          if (!clientRef.current || Math.abs(currentVal.length - msg.document.length) > 50) {
            suppressRef.current = true;
            editor.getModel()?.setValue(msg.document);
            suppressRef.current = false;
          }
        }
        // Boot OT client
        if (!clientRef.current) {
          clientRef.current = new OTClient(sendOp, applyRemoteOp);
        }
        clientRef.current.reset(msg.revision);
        setUsers(msg.users || []);
        usersRef.current = msg.users || [];
        setHistory(msg.history || []);
        break;
      }

      case 'op': {
        const client = clientRef.current;
        if (!client) return;
        client.onServerOp(msg.op);
        
        // Update remote cursor position immediately on op to prevent lag/glitch
        if (msg.authorId) {
          const newPos = msg.op.type === 'insert' 
            ? msg.op.position + msg.op.text.length 
            : msg.op.position;
          renderRemoteCursor(msg.authorId, newPos);
        }

        // Flash
        flashRemoteEdit(msg.op, msg.authorId);
        // Update history list
        setHistory((prev) => [
          { revision: msg.revision, op: msg.op, authorId: msg.authorId, timestamp: new Date() },
          ...prev.slice(0, 49),
        ]);
        break;
      }

      case 'ack': {
        clientRef.current?.onAck(msg.revision);
        break;
      }

      case 'cursor': {
        renderRemoteCursor(msg.userId, msg.position);
        break;
      }

      case 'user_joined': {
        setUsers((prev) => {
          const next = [...prev.filter((u) => u.id !== msg.userId), { id: msg.userId, username: msg.username, color: msg.color }];
          usersRef.current = next;
          return next;
        });
        break;
      }

      case 'user_left': {
        setUsers((prev) => {
          const next = prev.filter((u) => u.id !== msg.userId);
          usersRef.current = next;
          return next;
        });
        clearDecoration(msg.userId);
        break;
      }

      case 'run_result': {
        setOutput(msg);
        setIsRunning(false);
        break;
      }

      case 'error': {
        console.error('[server error]', msg.message);
        // Optional: Show a toast or alert
        break;
      }

      default:
        break;
    }
  }

  // ── Flash effect ───────────────────────────────────────────────────────────

  function flashRemoteEdit(op, authorId) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || op.type === 'retain') return;

    const model = editor.getModel();
    if (!model) return;

    const currentUsers = usersRef.current;
    const user = currentUsers.find((u) => u.id === authorId);
    const color = user?.color || '#6c63ff';

    const pos = op.type === 'insert'
      ? monacoOffsetToPosition(model, op.position)
      : monacoOffsetToPosition(model, op.position);

    const endOff = op.type === 'insert' ? op.position + op.text.length : op.position + op.length;
    const endPos = monacoOffsetToPosition(model, endOff);

    const cssColor = color + '33'; // 20% opacity
    const key = `flash-${authorId}`;

    // Inject ephemeral CSS class
    const className = `flash-${authorId.slice(0, 8)}`;
    let styleEl = document.getElementById(key);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = key;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `.${className} { background: ${cssColor} !important; transition: background 0.8s; }`;

    const col = editor.createDecorationsCollection([{
      range: new monaco.Range(pos.lineNumber, pos.column, endPos.lineNumber, endPos.column),
      options: { inlineClassName: className },
    }]);

    if (flashTimersRef.current[authorId]) clearTimeout(flashTimersRef.current[authorId]);
    flashTimersRef.current[authorId] = setTimeout(() => {
      col.clear();
    }, FLASH_DURATION);
  }

  // ── Remote cursors ─────────────────────────────────────────────────────────

  function renderRemoteCursor(userId, offset) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco) return;

    const model = editor.getModel();
    if (!model) return;

    const currentUsers = usersRef.current;
    const user = currentUsers.find((u) => u.id === userId);
    const color = user?.color || '#6c63ff'; // Default to primary accent if not found
    const name = user?.username || 'User';

    const pos = monacoOffsetToPosition(model, offset);

    const cssClass = `cursor-${userId.replace(/[^a-z0-9]/g, '')}`; // Safer class name
    let styleEl = document.getElementById(`cursor-style-${userId}`);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = `cursor-style-${userId}`;
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      .${cssClass} {
        border-left: 2px solid ${color} !important;
        height: 1.2em;
        position: relative;
        transition: all 0.1s ease-out; /* Smooth movement */
      }
      .${cssClass}::before {
        content: '${name}';
        position: absolute;
        top: -18px;
        left: -2px;
        background: ${color};
        color: #ffffff !important;
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 3px;
        white-space: nowrap;
        pointer-events: none;
        font-family: 'Inter', sans-serif;
        font-weight: 600;
        z-index: 110;
        box-shadow: 0 2px 4px rgba(0,0,0,0.3);
        transition: opacity 0.2s;
      }
    `;

    if (!decorationsRef.current[userId]) {
      decorationsRef.current[userId] = editor.createDecorationsCollection([]);
    }

    decorationsRef.current[userId].set([{
      range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
      options: { beforeContentClassName: cssClass },
    }]);
  }

  function clearDecoration(userId) {
    if (decorationsRef.current[userId]) {
      decorationsRef.current[userId].clear();
      delete decorationsRef.current[userId];
    }
  }

  // ── Monaco setup ───────────────────────────────────────────────────────────

  function handleEditorDidMount(editor, monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Disable Monaco's built-in undo so Ctrl+Z routes through our server
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => {
      wsRef.current?.send(JSON.stringify({ type: 'undo', roomId }));
    });

    editor.onDidChangeModelContent((event) => {
      if (suppressRef.current) return;
      const client = clientRef.current;
      if (!client) return;

      for (const change of event.changes) {
        if (change._replaceLen !== undefined) {
          // Replace: send delete then insert
          const delOp = { type: 'delete', position: change.rangeOffset, length: change._replaceLen };
          client.sendOp(delOp);
          const insOp = { type: 'insert', position: change.rangeOffset, text: change.text };
          client.sendOp(insOp);
        } else {
          const op = changeToOp(change);
          client.sendOp(op);
        }
      }
    });

    // Cursor position broadcasts (debounced 50ms)
    editor.onDidChangeCursorPosition((e) => {
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current);
      cursorTimerRef.current = setTimeout(() => {
        const model = editor.getModel();
        if (!model) return;
        const offset = model.getOffsetAt(e.position);
        wsRef.current?.send(JSON.stringify({ type: 'cursor', roomId, position: offset }));
      }, 50);
    });
  }

  // ── Code run ───────────────────────────────────────────────────────────────

  function handleRun(stdin = '') {
    if (isRunning) return;
    setIsRunning(true);
    setOutput(null);
    wsRef.current?.send(JSON.stringify({ type: 'run', roomId, language, stdin }));
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="editor-root">
      <Toolbar
        roomId={roomId}
        language={language}
        users={users}
        connected={connected}
        onRun={handleRun}
        isRunning={isRunning}
        sidebarTab={sidebarTab}
        setSidebarTab={setSidebarTab}
      />

      <div className="editor-body">
        <Sidebar
          tab={sidebarTab}
          users={users}
          history={history}
        />

        <div className="editor-area">
          <MonacoEditor
            height="100%"
            language={LANG_MONACO_MAP[language] || 'plaintext'}
            theme="vs-dark"
            onMount={handleEditorDidMount}
            options={{
              fontSize: 14,
              fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
              fontLigatures: true,
              minimap: { enabled: true },
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              tabSize: 2,
              automaticLayout: true,
              lineNumbers: 'on',
              renderWhitespace: 'selection',
              bracketPairColorization: { enabled: true },
              padding: { top: 16 },
            }}
          />

          {output && (
            <OutputPanel output={output} onClose={() => setOutput(null)} />
          )}
        </div>
      </div>
    </div>
  );
}
