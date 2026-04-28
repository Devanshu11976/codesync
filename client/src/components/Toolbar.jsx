import React from 'react';

export default function Toolbar({ roomId, language, users, connected, onRun, isRunning, sidebarTab, setSidebarTab }) {
  function copyRoomId() {
    navigator.clipboard.writeText(roomId).catch(() => {});
  }

  return (
    <header className="toolbar">
      {/* Left: Brand */}
      <div className="toolbar-brand">
        <span className="logo-icon-sm">{'</>'}</span>
        <span className="toolbar-title">CodeSync</span>
      </div>

      {/* Center: Room ID */}
      <div className="toolbar-center">
        <span className="toolbar-room-label">Room</span>
        <button className="room-id-btn" onClick={copyRoomId} title="Click to copy">
          {roomId}
          <span className="copy-icon">⧉</span>
        </button>
        <span className={`conn-dot ${connected ? 'conn-online' : 'conn-offline'}`} title={connected ? 'Connected' : 'Reconnecting…'} />
      </div>

      {/* Right: Sidebar tabs + Run */}
      <div className="toolbar-right">
        <div className="tab-group">
          <button
            className={`tab-btn ${sidebarTab === 'users' ? 'tab-active' : ''}`}
            onClick={() => setSidebarTab('users')}
          >
            👥 Users <span className="badge">{users.length}</span>
          </button>
          <button
            className={`tab-btn ${sidebarTab === 'history' ? 'tab-active' : ''}`}
            onClick={() => setSidebarTab('history')}
          >
            🕒 History
          </button>
        </div>

        <button
          className={`run-btn ${isRunning ? 'run-btn-loading' : ''}`}
          onClick={() => onRun('')}
          disabled={isRunning || !connected}
          title={`Run ${language}`}
        >
          {isRunning ? (
            <><span className="spinner" /> Running…</>
          ) : (
            <>▶ Run</>
          )}
        </button>
      </div>
    </header>
  );
}
