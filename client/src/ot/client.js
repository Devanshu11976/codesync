// OTClient — Operational Transformation client state machine

/**
 * OT Client state machine.
 *
 * State:
 *   pendingOp   – op sent to server awaiting ack, or null
 *   buffer      – ops queued while we're waiting for an ack
 *   serverRevision – last revision the server ack'd or we synced to
 *
 * Usage:
 *   const client = new OTClient(sendFn, applyFn)
 *   client.sendOp(op)          // call on local edit
 *   client.onServerOp(op)      // call on remote op from server
 *   client.onAck(revision)     // call when server sends {type:'ack'}
 */

import { transform, apply } from './operations';

export class OTClient {
  constructor(sendFn, applyFn) {
    this._send = sendFn;   // (op, revision) => void — send to server
    this._apply = applyFn; // (op) => void — apply to local editor model
    this.serverRevision = 0;
    this.pendingOp = null;
    this.buffer = [];
  }

  /** Called when the local user makes an edit. */
  sendOp(op) {
    if (this.pendingOp === null) {
      // Nothing in-flight — send immediately
      this.pendingOp = op;
      this._send(op, this.serverRevision);
    } else {
      // Already waiting for ack — buffer it
      this.buffer.push(op);
    }
  }

  /** Called when we receive a remote op from the server. */
  onServerOp(serverOp) {
    let op = serverOp;

    // Transform against pending op
    if (this.pendingOp !== null) {
      try {
        const [newPending, newOp] = transform(this.pendingOp, op);
        this.pendingOp = newPending;
        op = newOp;
      } catch (e) {
        console.error('[OTClient] transform(pending, serverOp) failed:', e);
      }
    }

    // Transform against buffered ops
    for (let i = 0; i < this.buffer.length; i++) {
      try {
        const [newBuf, newOp] = transform(this.buffer[i], op);
        this.buffer[i] = newBuf;
        op = newOp;
      } catch (e) {
        console.error(`[OTClient] transform(buffer[${i}], serverOp) failed:`, e);
      }
    }

    // Apply the fully-transformed server op to the local document
    try {
      this._apply(op);
    } catch (e) {
      console.error('[OTClient] apply(serverOp) failed:', e);
    }
  }

  /** Called when server sends {type:'ack', revision}. */
  onAck(revision) {
    this.serverRevision = revision;
    // The head of the buffer becomes the new pending
    this.pendingOp = this.buffer.shift() || null;
    if (this.pendingOp !== null) {
      this._send(this.pendingOp, this.serverRevision);
    }
  }

  reset(revision) {
    this.serverRevision = revision;
    this.pendingOp = null;
    this.buffer = [];
  }
}

// Re-export primitives so consumers only need one import
export { apply, transform };
