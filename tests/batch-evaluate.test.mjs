// outdate bot comment
import assert from 'assert';
import { processPipelineBatch } from '../batch-evaluate-gemini.mjs';

async function runTests() {
  console.log('Testing processPipelineBatch concurrency and array bounds...');

  // Setup a mock pipeline of 10 items
  const pendingIndices = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const concurrency = 3;
  let activeCount = 0;
  let maxActiveCount = 0;
  let processedCount = 0;
  const processedIndices = [];

  const mockProcessorFn = async (lineIdx, runIdx) => {
    activeCount++;
    if (activeCount > maxActiveCount) {
      maxActiveCount = activeCount;
    }
    
    // Simulate some async work with random delay to trigger race conditions
    const delay = Math.floor(Math.random() * 50) + 10;
    await new Promise(resolve => setTimeout(resolve, delay));
    
    processedCount++;
    processedIndices.push(lineIdx);
    activeCount--;
    
    return { line: `Processed ${lineIdx}`, processed: true };
  };

  const results = await processPipelineBatch(pendingIndices, concurrency, mockProcessorFn);

  // Assertions
  assert.strictEqual(results.size, 10, 'Expected exactly 10 results');
  assert.strictEqual(processedCount, 10, 'Expected exactly 10 processed items');
  assert.ok(maxActiveCount <= concurrency, `Expected max active count to be <= ${concurrency}, got ${maxActiveCount}`);
  
  // Verify all input indices were processed exactly once
  const sortedProcessed = [...processedIndices].sort((a, b) => a - b);
  assert.deepStrictEqual(sortedProcessed, pendingIndices, 'Processed indices do not match input indices');

  for (const idx of pendingIndices) {
    const res = results.get(idx);
    assert.ok(res, `Missing result for index ${idx}`);
    assert.strictEqual(res.processed, true);
    assert.strictEqual(res.line, `Processed ${idx}`);
  }

  console.log('✅ All tests passed!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
