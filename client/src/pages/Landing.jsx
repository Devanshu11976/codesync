import React, { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';

const LANG_OPTIONS = [
  { value: 'javascript', label: 'JavaScript' },
  { value: 'python', label: 'Python' },
  { value: 'java', label: 'Java' },
  { value: 'cpp', label: 'C++' },
  { value: 'go', label: 'Go' },
];

export default function Landing() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');
  const [language, setLanguage] = useState('javascript');
  const [error, setError] = useState('');

  const handleJoin = useCallback(
    (e) => {
      e.preventDefault();
      if (!username.trim()) { setError('Please enter a username.'); return; }
      const rid = roomId.trim() || uuidv4().slice(0, 8);
      sessionStorage.setItem('ce_username', username.trim());
      sessionStorage.setItem('ce_language', language);
      navigate(`/room/${rid}`);
    },
    [username, roomId, language, navigate]
  );

  return (
    <div className="landing-root">
      {/* Animated background orbs */}
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />

      <main className="landing-card">
        {/* Logo */}
        <div className="landing-logo">
          <span className="logo-icon">{'</>'}</span>
          <span className="logo-text">CodeSync</span>
          <span className="logo-badge">LIVE</span>
        </div>

        <h1 className="landing-headline">Collaborative Code Editor</h1>
        <p className="landing-sub">
          Real-time pair programming powered by Operational Transformation.
          Zero conflicts. Zero lag.
        </p>

        <form onSubmit={handleJoin} className="landing-form">
          {error && <div className="form-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="username">Your name</label>
            <input
              id="username"
              type="text"
              placeholder="e.g. Alice"
              value={username}
              onChange={(e) => { setUsername(e.target.value); setError(''); }}
              maxLength={32}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="roomId">Room ID <span className="label-hint">(leave blank to create new)</span></label>
            <input
              id="roomId"
              type="text"
              placeholder="e.g. abc12345"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
              maxLength={32}
            />
          </div>

          <div className="form-group">
            <label htmlFor="language">Language</label>
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              {LANG_OPTIONS.map((l) => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>
          </div>

          <button type="submit" className="btn-primary">
            <span>Enter Room</span>
            <span className="btn-arrow">→</span>
          </button>
        </form>

        <div className="landing-features">
          <div className="feature"><span>⚡</span> OT Algorithm</div>
          <div className="feature"><span>👥</span> Live Cursors</div>
          <div className="feature"><span>▶</span> Code Execution</div>
          <div className="feature"><span>↩</span> Undo History</div>
        </div>
      </main>
    </div>
  );
}
