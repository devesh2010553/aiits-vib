/**
 * Google Sheets utility for AIITS
 * Spreadsheet: https://docs.google.com/spreadsheets/d/1TTMI8-v9Z7kycqTY_d9SmCxErLCKopPuv75anMlRKBc
 * Sheet "Results" — one row per student test submission
 * Sheet "Students" — one row per registered student
 * Sheet "Archive_YYYY-MM" — auto-created when Results hits 45000 rows
 *
 * credentials.json must be placed at project root OR
 * set GOOGLE_CREDENTIALS_JSON env var with the JSON string
 */

const { google } = require('googleapis');
const path = require('path');
const fs   = require('fs');

const MAIN_SHEET_ID = '1TTMI8-v9Z7kycqTY_d9SmCxErLCKopPuv75anMlRKBc';
const ARCHIVE_TRIGGER_ROWS = 45000;   // archive oldest 10000 rows when this is reached
const ARCHIVE_CHUNK        = 10000;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || '';

// ── Auth ─────────────────────────────────────────────────────────────────────
function getAuth() {
  let credentials;
  // Option 1: env var (recommended for Render)
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try { credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON); }
    catch (e) { throw new Error('GOOGLE_CREDENTIALS_JSON env var is invalid JSON: ' + e.message); }
  } else {
    // Option 2: credentials.json file at project root
    const credPath = path.join(__dirname, '..', '..', 'credentials.json');
    if (!fs.existsSync(credPath)) {
      throw new Error(
        'Google credentials not found. Either:\n' +
        '1. Put credentials.json in the project root, OR\n' +
        '2. Set GOOGLE_CREDENTIALS_JSON env var in Render with the JSON content'
      );
    }
    credentials = JSON.parse(fs.readFileSync(credPath, 'utf8'));
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive'
    ]
  });
  return auth;
}

function getSheets() {
  return google.sheets({ version: 'v4', auth: getAuth() });
}
function getDrive() {
  return google.drive({ version: 'v3', auth: getAuth() });
}

// ── Sheet tab helpers ─────────────────────────────────────────────────────────
async function ensureTab(sheets, spreadsheetId, tabName) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(s => s.properties.title === tabName);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: {
        requests: [{
          addSheet: { properties: { title: tabName } }
        }]
      }
    });
    console.log('[SHEETS] Created tab:', tabName, 'in', spreadsheetId);
  }
}

async function getLastRow(sheets, spreadsheetId, tab) {
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A:A`
    });
    return (res.data.values || []).length;
  } catch (e) { return 0; }
}

// ── Initialize headers if sheet is empty ────────────────────────────────────
const RESULTS_HEADERS = [
  'SubmittedAt', 'StudentName', 'Email', 'Phone', 'Batch',
  'CoachingName', 'TestTitle', 'Subject', 'Topic',
  'ObtainedMarks', 'TotalMarks', 'Percentage',
  'CorrectAnswers', 'WrongAnswers', 'Skipped',
  'TimeTaken_Seconds', 'OverallRank', 'BatchRank',
  'TestID', 'UserID'
];

const STUDENTS_HEADERS = [
  'RegisteredAt', 'Name', 'Email', 'Phone', 'Batch',
  'CoachingName', 'FatherName', 'FatherOccupation', 'WhatsApp',
  'TotalTests', 'TotalMarks', 'HighestMarks', 'UserID'
];

async function initResultsTab(sheets) {
  await ensureTab(sheets, MAIN_SHEET_ID, 'Results');
  const lastRow = await getLastRow(sheets, MAIN_SHEET_ID, 'Results');
  if (lastRow === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: MAIN_SHEET_ID,
      range: 'Results!A1',
      valueInputOption: 'RAW',
      resource: { values: [RESULTS_HEADERS] }
    });
    console.log('[SHEETS] Results headers written');
  }
}

async function initStudentsTab(sheets) {
  await ensureTab(sheets, MAIN_SHEET_ID, 'Students');
  const lastRow = await getLastRow(sheets, MAIN_SHEET_ID, 'Students');
  if (lastRow === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: MAIN_SHEET_ID,
      range: 'Students!A1',
      valueInputOption: 'RAW',
      resource: { values: [STUDENTS_HEADERS] }
    });
    console.log('[SHEETS] Students headers written');
  }
}

// ── Archive logic ─────────────────────────────────────────────────────────────
async function archiveIfNeeded(sheets) {
  const lastRow = await getLastRow(sheets, MAIN_SHEET_ID, 'Results');
  if (lastRow < ARCHIVE_TRIGGER_ROWS + 1) return; // +1 for header row

  console.log('[SHEETS] Row count', lastRow, '— starting archive of oldest', ARCHIVE_CHUNK, 'rows');

  // 1. Read oldest ARCHIVE_CHUNK data rows (rows 2 to ARCHIVE_CHUNK+1, skip header row 1)
  const readRes = await sheets.spreadsheets.values.get({
    spreadsheetId: MAIN_SHEET_ID,
    range: `Results!A2:T${ARCHIVE_CHUNK + 1}`
  });
  const rowsToArchive = readRes.data.values || [];
  if (!rowsToArchive.length) return;

  // 2. Find or create archive sheet in Drive
  const archiveSheetId = await getOrCreateArchiveSheet();

  // 3. Get archive sheets client with same auth
  const archiveSheets = getSheets();
  await ensureTab(archiveSheets, archiveSheetId, 'Results');
  const archiveLastRow = await getLastRow(archiveSheets, archiveSheetId, 'Results');
  if (archiveLastRow === 0) {
    // Write headers first time
    await archiveSheets.spreadsheets.values.update({
      spreadsheetId: archiveSheetId,
      range: 'Results!A1',
      valueInputOption: 'RAW',
      resource: { values: [RESULTS_HEADERS] }
    });
  }

  // 4. Append to archive
  await archiveSheets.spreadsheets.values.append({
    spreadsheetId: archiveSheetId,
    range: 'Results!A:T',
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: rowsToArchive }
  });
  console.log('[SHEETS] Archived', rowsToArchive.length, 'rows to', archiveSheetId);

  // 5. Delete those rows from main sheet (delete rows 2 to ARCHIVE_CHUNK+1)
  const sheetMeta = await sheets.spreadsheets.get({ spreadsheetId: MAIN_SHEET_ID });
  const resultsSheet = sheetMeta.data.sheets.find(s => s.properties.title === 'Results');
  if (resultsSheet) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: MAIN_SHEET_ID,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId: resultsSheet.properties.sheetId,
              dimension: 'ROWS',
              startIndex: 1,           // row index 1 = row 2 (0-indexed, after header)
              endIndex: 1 + rowsToArchive.length
            }
          }
        }]
      }
    });
    console.log('[SHEETS] Deleted', rowsToArchive.length, 'rows from main sheet');
  }
}

async function getOrCreateArchiveSheet() {
  const drive = getDrive();
  const archiveName = 'AIITS_Archive';

  // Search for existing archive file
  const searchRes = await drive.files.list({
    q: `name='${archiveName}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id,name)',
    spaces: 'drive'
  });

  if (searchRes.data.files && searchRes.data.files.length > 0) {
    return searchRes.data.files[0].id;
  }

  // Create new archive file
  const createRes = await drive.files.create({
    resource: {
      name: archiveName,
      mimeType: 'application/vnd.google-apps.spreadsheet'
    },
    fields: 'id'
  });
  const archiveId = createRes.data.id;
  console.log('[SHEETS] Created archive sheet:', archiveId);

  // Share with admin email so they can view it
  if (ADMIN_EMAIL) {
    await drive.permissions.create({
      fileId: archiveId,
      resource: {
        type: 'user',
        role: 'writer',
        emailAddress: ADMIN_EMAIL
      }
    });
    console.log('[SHEETS] Shared archive with', ADMIN_EMAIL);
  }

  return archiveId;
}

// ── PUBLIC API ────────────────────────────────────────────────────────────────

/**
 * Write a result row to the Results tab
 */
exports.writeResult = async (resultData) => {
  try {
    const sheets = getSheets();
    await initResultsTab(sheets);

    const row = [
      new Date(resultData.submittedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      resultData.userName      || '',
      resultData.userEmail     || '',
      resultData.userPhone     || '',
      resultData.batch         || '',
      resultData.coachingName  || '',
      resultData.testTitle     || '',
      resultData.subject       || '',
      resultData.topic         || '',
      resultData.obtainedMarks || 0,
      resultData.totalMarks    || 0,
      resultData.percentage    || 0,
      resultData.correctAnswers || 0,
      resultData.wrongAnswers   || 0,
      resultData.notAttempted   || 0,
      resultData.timeTaken      || 0,
      resultData.rank           || '',
      resultData.batchRank      || '',
      String(resultData.testId  || ''),
      String(resultData.userId  || '')
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId: MAIN_SHEET_ID,
      range: 'Results!A:T',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: { values: [row] }
    });

    // Check and archive if needed (async, don't block response)
    archiveIfNeeded(sheets).catch(e => console.error('[SHEETS] Archive error:', e.message));

    return true;
  } catch (err) {
    console.error('[SHEETS] writeResult error:', err.message);
    return false; // Non-fatal — test still submits even if Sheets fails
  }
};

/**
 * Write/update a student row in the Students tab
 */
exports.writeStudent = async (studentData) => {
  try {
    const sheets = getSheets();
    await initStudentsTab(sheets);

    // Check if student already exists (by UserID in column M)
    const readRes = await sheets.spreadsheets.values.get({
      spreadsheetId: MAIN_SHEET_ID,
      range: 'Students!A:M'
    });
    const rows = readRes.data.values || [];
    let existingRowIndex = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][12] === String(studentData.userId)) {
        existingRowIndex = i + 1; // 1-indexed sheet row
        break;
      }
    }

    const row = [
      new Date(studentData.createdAt || Date.now()).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
      studentData.name            || '',
      studentData.email           || '',
      studentData.phone           || '',
      studentData.batch           || '',
      studentData.coachingName    || '',
      studentData.fatherName      || '',
      studentData.fatherOccupation|| '',
      studentData.whatsappNumber  || '',
      studentData.totalTests      || 0,
      studentData.totalMarks      || 0,
      studentData.highestMarks    || 0,
      String(studentData.userId   || '')
    ];

    if (existingRowIndex > 0) {
      // Update existing row
      await sheets.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID,
        range: `Students!A${existingRowIndex}`,
        valueInputOption: 'RAW',
        resource: { values: [row] }
      });
    } else {
      // Append new row
      await sheets.spreadsheets.values.append({
        spreadsheetId: MAIN_SHEET_ID,
        range: 'Students!A:M',
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [row] }
      });
    }
    return true;
  } catch (err) {
    console.error('[SHEETS] writeStudent error:', err.message);
    return false;
  }
};

/**
 * Read all results for a test from Google Sheet
 * Returns array of result objects
 */
exports.readTestResults = async (testId) => {
  try {
    const sheets = getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: MAIN_SHEET_ID,
      range: 'Results!A:T'
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return [];
    // Filter by testId (column S, index 18)
    return rows.slice(1).filter(r => r[18] === String(testId)).map(r => ({
      submittedAt:    r[0],
      userName:       r[1],
      userEmail:      r[2],
      userPhone:      r[3],
      batch:          r[4],
      coachingName:   r[5],
      testTitle:      r[6],
      subject:        r[7],
      topic:          r[8],
      obtainedMarks:  Number(r[9])  || 0,
      totalMarks:     Number(r[10]) || 0,
      percentage:     Number(r[11]) || 0,
      correctAnswers: Number(r[12]) || 0,
      wrongAnswers:   Number(r[13]) || 0,
      notAttempted:   Number(r[14]) || 0,
      timeTaken:      Number(r[15]) || 0,
      rank:           Number(r[16]) || null,
      batchRank:      Number(r[17]) || null,
      testId:         r[18],
      userId:         r[19]
    }));
  } catch (err) {
    console.error('[SHEETS] readTestResults error:', err.message);
    return [];
  }
};

/**
 * Get all results for a specific user from Google Sheet
 */
exports.readUserResults = async (userId) => {
  try {
    const sheets = getSheets();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: MAIN_SHEET_ID,
      range: 'Results!A:T'
    });
    const rows = res.data.values || [];
    if (rows.length <= 1) return [];
    // Filter by userId (column T, index 19)
    return rows.slice(1).filter(r => r[19] === String(userId)).map(r => ({
      submittedAt:    r[0],
      userName:       r[1],
      userEmail:      r[2],
      batch:          r[4],
      testTitle:      r[6],
      subject:        r[7],
      obtainedMarks:  Number(r[9])  || 0,
      totalMarks:     Number(r[10]) || 0,
      percentage:     Number(r[11]) || 0,
      correctAnswers: Number(r[12]) || 0,
      wrongAnswers:   Number(r[13]) || 0,
      notAttempted:   Number(r[14]) || 0,
      timeTaken:      Number(r[15]) || 0,
      rank:           Number(r[16]) || null,
      batchRank:      Number(r[17]) || null,
      testId:         r[18],
      userId:         r[19]
    }));
  } catch (err) {
    console.error('[SHEETS] readUserResults error:', err.message);
    return [];
  }
};

/**
 * Get sheet stats (row counts)
 */
exports.getSheetStats = async () => {
  try {
    const sheets = getSheets();
    const [resultsRows, studentsRows] = await Promise.all([
      getLastRow(sheets, MAIN_SHEET_ID, 'Results'),
      getLastRow(sheets, MAIN_SHEET_ID, 'Students')
    ]);
    return {
      resultsRows: Math.max(0, resultsRows - 1), // minus header
      studentsRows: Math.max(0, studentsRows - 1),
      archiveTrigger: ARCHIVE_TRIGGER_ROWS,
      mainSheetUrl: `https://docs.google.com/spreadsheets/d/${MAIN_SHEET_ID}/edit`
    };
  } catch (err) {
    console.error('[SHEETS] getSheetStats error:', err.message);
    return null;
  }
};
