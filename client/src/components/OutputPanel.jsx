import React from 'react';

export default function OutputPanel({ output, onClose }) {
  const isError = output?.status && !['Accepted', 'Running'].includes(output.status);

  return (
    <div className="output-panel">
      <div className="output-header">
        <div className="output-meta">
          <span className={`output-status ${isError ? 'output-error' : 'output-success'}`}>
            {output.status || 'Done'}
          </span>
          {output.time && <span className="output-stat">⏱ {output.time}s</span>}
          {output.memory && <span className="output-stat">💾 {output.memory} KB</span>}
        </div>
        <button className="output-close" onClick={onClose}>✕</button>
      </div>
      <div className="output-body">
        {output.stdout && (
          <div className="output-section">
            <div className="output-section-label">stdout</div>
            <pre className="output-pre output-stdout">{output.stdout}</pre>
          </div>
        )}
        {output.stderr && (
          <div className="output-section">
            <div className="output-section-label output-err-label">stderr</div>
            <pre className="output-pre output-stderr">{output.stderr}</pre>
          </div>
        )}
        {!output.stdout && !output.stderr && (
          <div className="output-empty">No output.</div>
        )}
      </div>
    </div>
  );
}
