const FLUSH_INTERVAL_MS = 10000;
const BATCH_SIZE = 50;
let resultQueue  = [];
let studentQueue = {};
let isFlushing   = false;
let flushTimer   = null;

function startQueue() {
  if (flushTimer) return;
  flushTimer = setInterval(flushAll, FLUSH_INTERVAL_MS);
  console.log('[SHEETS_QUEUE] Started, flushing every', FLUSH_INTERVAL_MS/1000, 'sec');
}
function queueResult(data) { resultQueue.push(data); if (!flushTimer) startQueue(); }
function queueStudent(data) { studentQueue[String(data.userId)] = data; if (!flushTimer) startQueue(); }

async function flushAll() {
  if (isFlushing) return;
  isFlushing = true;
  try {
    const sheets = require('./sheets');
    while (resultQueue.length > 0) {
      const batch = resultQueue.splice(0, BATCH_SIZE);
      try {
        await sheets.writeResultsBatch(batch);
        console.log('[SHEETS_QUEUE] Wrote', batch.length, 'results');
      } catch(err) {
        console.error('[SHEETS_QUEUE] Batch failed:', err.message);
        resultQueue.unshift(...batch);
        break;
      }
    }
    const students = Object.values(studentQueue);
    studentQueue = {};
    for (const s of students) {
      try { await require('./sheets').writeStudent(s); }
      catch(err) { studentQueue[String(s.userId)] = s; }
    }
  } finally { isFlushing = false; }
}
function getQueueStatus() { return { pendingResults: resultQueue.length, pendingStudents: Object.keys(studentQueue).length, isFlushing }; }
async function forceFlush() { if (flushTimer) { clearInterval(flushTimer); flushTimer = null; } await flushAll(); }
process.on('SIGTERM', async () => { console.log('[SHEETS_QUEUE] Flushing...'); await forceFlush(); });
startQueue();
module.exports = { queueResult, queueStudent, getQueueStatus, forceFlush };
