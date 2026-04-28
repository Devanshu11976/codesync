// OT primitives — ES module for frontend bundle

// ─── apply ────────────────────────────────────────────────────────────────────
export function apply(doc, op) {
  if (typeof doc !== 'string') throw new TypeError('apply: doc must be a string');

  switch (op.type) {
    case 'insert': {
      const pos = op.position;
      if (pos < 0 || pos > doc.length)
        throw new RangeError(`apply(insert): position ${pos} out of bounds for length ${doc.length}`);
      return doc.slice(0, pos) + op.text + doc.slice(pos);
    }
    case 'delete': {
      const pos = op.position;
      const len = op.length;
      if (pos < 0 || pos > doc.length)
        throw new RangeError(`apply(delete): position ${pos} out of bounds`);
      if (pos + len > doc.length)
        throw new RangeError(`apply(delete): delete exceeds document end`);
      return doc.slice(0, pos) + doc.slice(pos + len);
    }
    case 'retain':
      return doc;
    default:
      throw new TypeError(`apply: unknown op type "${op.type}"`);
  }
}

// ─── transform ────────────────────────────────────────────────────────────────
export function transform(op1, op2) {
  if (op1.type === 'insert' && op2.type === 'insert') {
    let op1p = { ...op1 }, op2p = { ...op2 };
    if (op2.position < op1.position) {
      op1p = { ...op1, position: op1.position + op2.text.length };
    } else if (op1.position < op2.position) {
      op2p = { ...op2, position: op2.position + op1.text.length };
    } else {
      op2p = { ...op2, position: op2.position + op1.text.length };
    }
    return [op1p, op2p];
  }

  if (op1.type === 'insert' && op2.type === 'delete') {
    let op1p = { ...op1 }, op2p = { ...op2 };
    const ins = op1.position, delStart = op2.position, delEnd = op2.position + op2.length;
    if (ins <= delStart) {
      op2p = { ...op2, position: op2.position + op1.text.length };
    } else if (ins >= delEnd) {
      op1p = { ...op1, position: op1.position - op2.length };
    } else {
      op1p = { ...op1, position: delStart };
      op2p = { ...op2, length: Math.max(op2.length, (ins - delStart) + op1.text.length) };
    }
    return [op1p, op2p];
  }

  if (op1.type === 'delete' && op2.type === 'insert') {
    const [op2pSwap, op1pSwap] = transform(op2, op1);
    return [op1pSwap, op2pSwap];
  }

  if (op1.type === 'delete' && op2.type === 'delete') {
    const s1 = op1.position, e1 = op1.position + op1.length;
    const s2 = op2.position, e2 = op2.position + op2.length;
    let op1p, op2p;
    if (e1 <= s2) {
      op1p = { ...op1 }; op2p = { ...op2, position: op2.position - op1.length };
    } else if (e2 <= s1) {
      op1p = { ...op1, position: op1.position - op2.length }; op2p = { ...op2 };
    } else {
      const overlapStart = Math.max(s1, s2), overlapEnd = Math.min(e1, e2);
      const overlapLen = overlapEnd - overlapStart;
      const newLen1 = op1.length - overlapLen, newLen2 = op2.length - overlapLen;
      const charsRemovedByOp2BeforeS1 = Math.max(0, Math.min(e2, s1) - s2);
      const charsRemovedByOp1BeforeS2 = Math.max(0, Math.min(e1, s2) - s1);
      op1p = newLen1 > 0 ? { ...op1, position: op1.position - charsRemovedByOp2BeforeS1, length: newLen1 } : { type: 'retain', length: 0 };
      op2p = newLen2 > 0 ? { ...op2, position: op2.position - charsRemovedByOp1BeforeS2, length: newLen2 } : { type: 'retain', length: 0 };
    }
    return [op1p, op2p];
  }

  if (op1.type === 'retain') return [op1, op2];
  if (op2.type === 'retain') return [op1, op2];
  throw new TypeError(`transform: unsupported types "${op1.type}" and "${op2.type}"`);
}

// ─── invert ───────────────────────────────────────────────────────────────────
export function invert(op, document) {
  switch (op.type) {
    case 'insert':
      return { type: 'delete', position: op.position, length: op.text.length };
    case 'delete':
      return { type: 'insert', position: op.position, text: document.slice(op.position, op.position + op.length) };
    case 'retain':
      return { type: 'retain', length: op.length };
    default:
      throw new TypeError(`invert: unknown op type "${op.type}"`);
  }
}
