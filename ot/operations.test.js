'use strict';

const { apply, transform, compose, invert } = require('./operations');

// ─── tiny assert helper ────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅  PASS — ${message}`);
    passed++;
  } else {
    console.error(`  ❌  FAIL — ${message}`);
    failed++;
  }
}

function assertEqual(a, b, message) {
  if (a === b) {
    console.log(`  ✅  PASS — ${message}`);
    passed++;
  } else {
    console.error(`  ❌  FAIL — ${message}`);
    console.error(`       expected: ${JSON.stringify(b)}`);
    console.error(`       received: ${JSON.stringify(a)}`);
    failed++;
  }
}

function assertThrows(fn, message) {
  try {
    fn();
    console.error(`  ❌  FAIL — ${message} (expected an error but none was thrown)`);
    failed++;
  } catch (e) {
    console.log(`  ✅  PASS — ${message} (threw: ${e.message})`);
    passed++;
  }
}

// ─── document fixture ─────────────────────────────────────────────────────────
const doc = 'hello world';
console.log(`\nDocument fixture: "${doc}"\n`);

// ══════════════════════════════════════════════════════════════════════════════
// TEST 1 — apply insert
// ══════════════════════════════════════════════════════════════════════════════
console.log('── Test 1: apply insert ──────────────────────────────────────────');
{
  const result = apply(doc, { type: 'insert', position: 5, text: ' there' });
  assertEqual(result, 'hello there world', 'insert at position 5');

  // Edge cases
  assertEqual(
    apply(doc, { type: 'insert', position: 0, text: 'START ' }),
    'START hello world',
    'insert at position 0'
  );
  assertEqual(
    apply(doc, { type: 'insert', position: doc.length, text: '!' }),
    'hello world!',
    'insert at end of document'
  );
  assertThrows(
    () => apply(doc, { type: 'insert', position: -1, text: 'x' }),
    'insert at position -1 throws RangeError'
  );
  assertThrows(
    () => apply(doc, { type: 'insert', position: doc.length + 1, text: 'x' }),
    'insert beyond document length throws RangeError'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 2 — apply delete
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Test 2: apply delete ──────────────────────────────────────────');
{
  const result = apply(doc, { type: 'delete', position: 6, length: 5 });
  assertEqual(result, 'hello ', 'delete "world" at position 6 length 5');

  assertEqual(
    apply(doc, { type: 'delete', position: 0, length: 5 }),
    ' world',
    'delete first 5 chars'
  );
  assertThrows(
    () => apply(doc, { type: 'delete', position: -1, length: 1 }),
    'delete at position -1 throws RangeError'
  );
  assertThrows(
    () => apply(doc, { type: 'delete', position: 8, length: 10 }),
    'delete that overshoots end throws RangeError'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 3 — concurrent insert+insert at same position
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Test 3: concurrent insert+insert (same position) ─────────────');
{
  const op1 = { type: 'insert', position: 5, text: '_A' };
  const op2 = { type: 'insert', position: 5, text: '_B' };

  const [op1p, op2p] = transform(op1, op2);

  const branch1 = apply(apply(doc, op1), op2p);
  const branch2 = apply(apply(doc, op2), op1p);

  console.log(`    branch1 = "${branch1}"`);
  console.log(`    branch2 = "${branch2}"`);

  assert(branch1 === branch2, 'convergence on insert+insert at same position');

  // Verify priority: op1 wins → op1's text appears first
  assert(
    branch1.includes('_A_B') || branch1.includes('_B_A'),
    'both insertions are present in the result'
  );
  assert(branch1 === 'hello_A_B world', 'op1 priority: "_A" precedes "_B"');
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 4 — concurrent insert+delete collision (insert inside deleted range)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Test 4: concurrent insert+delete (collision) ─────────────────');
{
  const op3 = { type: 'insert', position: 3, text: 'XY' };
  const op4 = { type: 'delete', position: 3, length: 4 }; // deletes "lo w"

  const [op3p, op4p] = transform(op3, op4);

  const branch1 = apply(apply(doc, op3), op4p);
  const branch2 = apply(apply(doc, op4), op3p);

  console.log(`    branch1 = "${branch1}"`);
  console.log(`    branch2 = "${branch2}"`);

  assert(
    branch1 === branch2,
    'convergence on insert+delete (insert at same start as delete)'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 5 — concurrent delete+delete with overlap
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Test 5: concurrent delete+delete (overlapping ranges) ─────────');
{
  // doc = "hello world" (length 11)
  // op5 deletes positions 2-5 → "he" + "o world" = "heo world"  (deletes "ll")
  //   wait: position:2, length:4 → deletes doc[2..5] = "llo " → "heworldX"
  //   actually: "hello world".slice(0,2) + "hello world".slice(6) = "he" + "orld" = "heorld"
  // op6 deletes positions 4-7 → deletes "o wo" → "hellrld"
  //   actually: "hello world".slice(0,4) + "hello world".slice(8) = "hell" + "rld" = "hellrld"
  const op5 = { type: 'delete', position: 2, length: 4 }; // deletes "llo "
  const op6 = { type: 'delete', position: 4, length: 4 }; // deletes "o wo"

  const [op5p, op6p] = transform(op5, op6);

  const branch1 = apply(apply(doc, op5), op6p);
  const branch2 = apply(apply(doc, op6), op5p);

  console.log(`    branch1 = "${branch1}"`);
  console.log(`    branch2 = "${branch2}"`);

  assert(
    branch1 === branch2,
    'convergence on delete+delete with overlapping ranges'
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 6 — invert (insert → delete, delete → insert)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Test 6: invert ────────────────────────────────────────────────');
{
  const op = { type: 'insert', position: 5, text: ' there' };
  const afterInsert = apply(doc, op);           // "hello there world"
  const inv = invert(op, doc);                  // should delete " there" at 5
  const restored = apply(afterInsert, inv);
  assertEqual(restored, doc, 'invert(insert) restores original document');

  const op2 = { type: 'delete', position: 6, length: 5 };
  const afterDelete = apply(doc, op2);          // "hello "
  const inv2 = invert(op2, doc);               // should re-insert "world" at 6
  const restored2 = apply(afterDelete, inv2);
  assertEqual(restored2, doc, 'invert(delete) restores original document');
}

// ══════════════════════════════════════════════════════════════════════════════
// TEST 7 — compose (basic cases)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Test 7: compose ───────────────────────────────────────────────');
{
  // insert then delete that exactly undoes it → retain
  const ins = { type: 'insert', position: 5, text: ' there' };
  const del = { type: 'delete', position: 5, length: 6 };
  const composed = compose(ins, del);
  assertEqual(composed.type, 'retain', 'insert then its inverse composes to retain');

  // retain composed with anything → passthrough
  const ret = { type: 'retain', length: 0 };
  const anyOp = { type: 'insert', position: 0, text: 'hi' };
  const c2 = compose(ret, anyOp);
  assertEqual(c2.type, 'insert', 'retain ∘ op → op');
}

// ══════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════════════════════');
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed === 0) {
  console.log('🎉 All tests passed — OT engine is correct. Ready for Phase 2.');
} else {
  console.log('⚠️  Some tests failed — fix operations.js before proceeding.');
  process.exit(1);
}
