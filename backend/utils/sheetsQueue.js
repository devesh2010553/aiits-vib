/**
 * Google Sheets Write Queue
 * Solves: Sheets API limit of 60 writes/minute
 * Solution: Buffer all writes in memory, flush in batches every 10 seconds
 * 1000 simultaneous submits = all go to MongoDB instantly,
 * then Sheets gets them in batches of 50, max 6 batches/minute = safe
 */

const sheets = require('./sheets');

const FLUSH_INTERVAL_MS = 10000;  // flush every 10 seconds
const BATCH_SIZE        = 50;     // max rows per Sheets API call

let resultQueue   = [];  // pending result rows
let studentQueue  = {};  // pending student updates (keyed by userId, deduped)
let isFlusing     = false;
let flushTimer    = null;

// Start the queue processor
function startQueue() {
  if (flushTimer) return; // already running
  flushTimer = setInterval(flushAll, FLUSH_INTERVAL_MS);
  console.log('[SHEETS_QUEUE] Started, flush every', FLUSH_INTERVAL_MS/1000, 'sec');
}

// Add a result to queue (called on test submit)
function queueResult(resultData) {
  resultQueue.push(resultData);
  if (!flushTimer) startQueue();
}

// Add a student to queue (called on register, deduped by userId)
function queueStudent(studentData) {
  studentQueue[String(studentData.userId)] = studentData;
  if (!flushTimer) startQueue();
}

// Flush everything to Google Sheets
async function flushAll() {
  if (isFlusing) return;
  isFlusing = true;

  try {
    // Process results in batches
    while (resultQueue.length > 0) {
      const batch = resultQueue.splice(0, BATCH_SIZE);
      try {
        await sheets.writeResultsBatch(batch);
        console.log('[SHEETS_QUEUE] Wrote', batch.length, 'results to Sheet');
      } catch (err) {
        console.error('[SHEETS_QUEUE] Batch write failed:', err.message);
        // Put failed items back at front of queue to retry next flush
        resultQueue.unshift(...batch);
        break; // stop trying this cycle, wait for next flush
      }
    }

    // Process student updates
    const students = Object.values(studentQueue);
    studentQueue = {};
    for (const student of students) {
      try {
        await sheets.writeStudent(student);
      } catch (err) {
        console.error('[SHEETS_QUEUE] Student write failed:', err.message);
        // Re-queue failed student
        studentQueue[String(student.userId)] = student;
      }
    }
  } finally {
    isFlusing = false;
  }
}

// Get queue status (for admin dashboard)
function getQueueStatus() {
  return {
    pendingResults:  resultQueue.length,
    pendingStudents: Object.keys(studentQueue).length,
    isFlusing
  };
}

// Force flush immediately (call on server shutdown)
async function forceFlush() {
  if (flushTimer) { clearInterval(flushTimer); flushTimer = null; }
  await flushAll();
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[SHEETS_QUEUE] Flushing before shutdown...');
  await forceFlush();
});

startQueue();

module.exports = { queueResult, queueStudent, getQueueStatus, forceFlush };
