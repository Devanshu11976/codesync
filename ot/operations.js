'use strict';

/**
 * Operational Transformation — core pure functions.
 *
 * Operation shapes:
 *   { type: 'insert', position: Number, text: String }
 *   { type: 'delete', position: Number, length: Number }
 *   { type: 'retain', length: Number }   ← produced by compose
 *
 * All positions are 0-indexed character offsets into the document string.
 */

// ─── apply ────────────────────────────────────────────────────────────────────

/**
 * Apply a single operation to a document string.
 * @param {string} doc
 * @param {object} op
 * @returns {string} new document
 */
function apply(doc, op) {
  if (typeof doc !== 'string') {
    throw new TypeError(`apply: doc must be a string, got ${typeof doc}`);
  }

  switch (op.type) {
    case 'insert': {
      const pos = op.position;
      if (pos < 0 || pos > doc.length) {
        throw new RangeError(
          `apply(insert): position ${pos} out of bounds for doc of length ${doc.length}`
        );
      }
      return doc.slice(0, pos) + op.text + doc.slice(pos);
    }

    case 'delete': {
      const pos = op.position;
      const len = op.length;
      if (pos < 0 || pos > doc.length) {
        throw new RangeError(
          `apply(delete): position ${pos} out of bounds for doc of length ${doc.length}`
        );
      }
      if (pos + len > doc.length) {
        throw new RangeError(
          `apply(delete): delete would exceed document end (pos=${pos}, length=${len}, docLen=${doc.length})`
        );
      }
      return doc.slice(0, pos) + doc.slice(pos + len);
    }

    case 'retain': {
      // 'retain' is a no-op on the document itself (used in composed ops).
      return doc;
    }

    default:
      throw new TypeError(`apply: unknown operation type "${op.type}"`);
  }
}

// ─── transform ────────────────────────────────────────────────────────────────

/**
 * Transform two concurrent operations so they can be applied in either order
 * and yield the same result (convergence).
 *
 *   apply(apply(doc, op1), op2') === apply(apply(doc, op2), op1')
 *
 * Priority rule for insert/insert at the same position: op1 wins (op2 shifts right).
 *
 * @param {object} op1
 * @param {object} op2
 * @returns {[object, object]} [op1Prime, op2Prime]
 */
function transform(op1, op2) {
  // ── insert vs insert ──────────────────────────────────────────────────────
  if (op1.type === 'insert' && op2.type === 'insert') {
    let op1p = { ...op1 };
    let op2p = { ...op2 };

    if (op2.position < op1.position) {
      // op2 inserts before op1 → shift op1 right
      op1p = { ...op1, position: op1.position + op2.text.length };
    } else if (op1.position < op2.position) {
      // op1 inserts before op2 → shift op2 right
      op2p = { ...op2, position: op2.position + op1.text.length };
    } else {
      // same position: op1 wins (op1 stays, op2 shifts right by op1's length)
      op2p = { ...op2, position: op2.position + op1.text.length };
    }

    return [op1p, op2p];
  }

  // ── insert vs delete ──────────────────────────────────────────────────────
  if (op1.type === 'insert' && op2.type === 'delete') {
    let op1p = { ...op1 };
    let op2p = { ...op2 };

    const ins = op1.position;
    const delStart = op2.position;
    const delEnd = op2.position + op2.length;

    if (ins <= delStart) {
      // insert is at or before the delete range → shift delete right
      op2p = { ...op2, position: op2.position + op1.text.length };
    } else if (ins >= delEnd) {
      // insert is after the delete range → shift insert left
      op1p = { ...op1, position: op1.position - op2.length };
    } else {
      // insert lands inside the deleted range → move insert to the start of the deletion
      op1p = { ...op1, position: delStart };
      op2p = { ...op2, length: Math.max(op2.length, (ins - delStart) + op1.text.length) };
    }

    return [op1p, op2p];
  }

  // ── delete vs insert ──────────────────────────────────────────────────────
  if (op1.type === 'delete' && op2.type === 'insert') {
    // Swap roles relative to the insert/delete case above.
    const [op2pSwap, op1pSwap] = transform(op2, op1);
    return [op1pSwap, op2pSwap];
  }

  // ── delete vs delete ──────────────────────────────────────────────────────
  if (op1.type === 'delete' && op2.type === 'delete') {
    const s1 = op1.position;
    const e1 = op1.position + op1.length; // exclusive
    const s2 = op2.position;
    const e2 = op2.position + op2.length; // exclusive

    let op1p, op2p;

    if (e1 <= s2) {
      // op1 is entirely before op2 → op2 shifts left by op1.length
      op1p = { ...op1 };
      op2p = { ...op2, position: op2.position - op1.length };
    } else if (e2 <= s1) {
      // op2 is entirely before op1 → op1 shifts left by op2.length
      op1p = { ...op1, position: op1.position - op2.length };
      op2p = { ...op2 };
    } else {
      // Overlapping deletions — each should only delete chars the other didn't.
      // Intersection: [max(s1,s2), min(e1,e2))
      const overlapStart = Math.max(s1, s2);
      const overlapEnd = Math.min(e1, e2);
      const overlapLen = overlapEnd - overlapStart;

      // op1' deletes op1's range minus the overlap (chars op2 already removed)
      const newLen1 = op1.length - overlapLen;
      // op2' deletes op2's range minus the overlap
      const newLen2 = op2.length - overlapLen;

      // New positions: each range is shifted left by whatever the other op
      // deleted before our own start.
      const charsRemovedByOp2BeforeS1 = Math.max(0, Math.min(e2, s1) - s2);
      const charsRemovedByOp1BeforeS2 = Math.max(0, Math.min(e1, s2) - s1);

      op1p = newLen1 > 0
        ? { ...op1, position: op1.position - charsRemovedByOp2BeforeS1, length: newLen1 }
        : { type: 'retain', length: 0 }; // no-op

      op2p = newLen2 > 0
        ? { ...op2, position: op2.position - charsRemovedByOp1BeforeS2, length: newLen2 }
        : { type: 'retain', length: 0 }; // no-op
    }

    return [op1p, op2p];
  }

  // ── retain (identity) cases ───────────────────────────────────────────────
  if (op1.type === 'retain') return [op1, op2];
  if (op2.type === 'retain') return [op1, op2];

  throw new TypeError(
    `transform: unsupported operation types "${op1.type}" and "${op2.type}"`
  );
}

// ─── compose ─────────────────────────────────────────────────────────────────

/**
 * Compose two operations into one that is equivalent to applying op1 then op2.
 * This simplified version handles the common single-op shapes; a production
 * implementation would use cursor-based sequence decomposition.
 *
 * @param {object} op1 — applied first
 * @param {object} op2 — applied second (positions relative to doc after op1)
 * @returns {object} composed operation
 */
function compose(op1, op2) {
  // retain is identity
  if (op1.type === 'retain') return op2;
  if (op2.type === 'retain') return op1;

  // insert then insert at same position → merge texts
  if (op1.type === 'insert' && op2.type === 'insert') {
    if (op2.position === op1.position) {
      return { type: 'insert', position: op1.position, text: op2.text + op1.text };
    }
    // insert op1 text, then insert op2 text at its position (after op1 applied)
    // Convert op2 position back to pre-op1 space if needed
    // If op2 is after op1's insert, adjust
    if (op2.position >= op1.position + op1.text.length) {
      return {
        type: 'insert',
        position: op1.position,
        text: op1.text,
        _then: op2, // chained — represent as a multi-op wrapper
      };
    }
  }

  // insert then delete: if delete exactly undoes the insert → retain
  if (op1.type === 'insert' && op2.type === 'delete') {
    if (op2.position === op1.position && op2.length === op1.text.length) {
      return { type: 'retain', length: 0 };
    }
  }

  // delete then delete at same position → merge lengths
  if (op1.type === 'delete' && op2.type === 'delete') {
    if (op2.position === op1.position) {
      return { type: 'delete', position: op1.position, length: op1.length + op2.length };
    }
  }

  // Fallback: return a composite wrapper understood by apply
  return { type: '_composed', ops: [op1, op2] };
}

// ─── invert ───────────────────────────────────────────────────────────────────

/**
 * Return the inverse of an operation given the document BEFORE the operation
 * was applied.
 *
 * @param {object} op
 * @param {string} document — the document state BEFORE op was applied
 * @returns {object} inverse operation
 */
function invert(op, document) {
  switch (op.type) {
    case 'insert':
      // Undo an insert → delete the inserted text
      return { type: 'delete', position: op.position, length: op.text.length };

    case 'delete': {
      // Undo a delete → re-insert the deleted text (captured from the document)
      const deletedText = document.slice(op.position, op.position + op.length);
      return { type: 'insert', position: op.position, text: deletedText };
    }

    case 'retain':
      return { type: 'retain', length: op.length };

    default:
      throw new TypeError(`invert: unknown operation type "${op.type}"`);
  }
}

// ─── exports ──────────────────────────────────────────────────────────────────

module.exports = { apply, transform, compose, invert };
