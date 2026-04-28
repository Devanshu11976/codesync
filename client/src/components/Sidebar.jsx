import React from 'react';

function timeAgo(ts) {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(ts).getTime()) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function opSummary(op) {
  if (!op) return '—';
  if (op.type === 'insert') return `+  "${(op.text || '').slice(0, 24).replace(/\n/g, '↵')}"`;
  if (op.type === 'delete') return `−  ${op.length} char${op.length !== 1 ? 's' : ''}`;
  return op.type;
}

// ── Users panel ───────────────────────────────────────────────────────────────
function UsersPanel({ users }) {
  return (
    <div className="sidebar-panel">
      <div className="sidebar-section-title">Active Users ({users.length})</div>
      {users.length === 0 && <div className="sidebar-empty">No other users yet.</div>}
      <ul className="user-list">
        {users.map((u) => (
          <li key={u.id} className="user-item">
            <span className="user-dot" style={{ background: u.color }} />
            <span className="user-name">{u.username}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── History panel ─────────────────────────────────────────────────────────────
function HistoryPanel({ history, users }) {
  return (
    <div className="sidebar-panel">
      <div className="sidebar-section-title">Version History ({history.length})</div>
      {history.length === 0 && <div className="sidebar-empty">No history yet.</div>}
      <ul className="history-list">
        {history.map((h, i) => {
          const user = users.find((u) => u.id === h.authorId);
          const color = user?.color || '#888';
          return (
            <li key={i} className="history-item">
              <span className="history-dot" style={{ background: color }} />
              <div className="history-info">
                <span className="history-author">{user?.username || 'Unknown'}</span>
                <span className="history-time">{timeAgo(h.timestamp)}</span>
                <span className="history-op">{opSummary(h.op)}</span>
              </div>
              <span className="history-rev">r{h.revision}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
export default function Sidebar({ tab, users, history }) {
  return (
    <aside className="sidebar">
      {tab === 'users' && <UsersPanel users={users} />}
      {tab === 'history' && <HistoryPanel history={history} users={users} />}
    </aside>
  );
}
