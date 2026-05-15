/**
 * Google Sheets utility for AIITS
 * Sheet ID: 1TTMI8-v9Z7kycqTY_d9SmCxErLCKopPuv75anMlRKBc
 *
 * Setup:
 * 1. console.cloud.google.com -> New project -> Enable Sheets API + Drive API
 * 2. Credentials -> Service Account -> Download JSON key
 * 3. Share your Google Sheet with the service account email (Editor)
 * 4. In Render: set GOOGLE_CREDENTIALS_JSON = entire JSON content of key file
 */

const { google } = require('googleapis');
const path = require('path');
const fs   = require('fs');

const MAIN_SHEET_ID    = '1TTMI8-v9Z7kycqTY_d9SmCxErLCKopPuv75anMlRKBc';
const ARCHIVE_TRIGGER  = 45000;
const ARCHIVE_CHUNK    = 10000;

// Column headers
const RESULTS_HEADERS = [
  'SubmittedAt','StudentName','Email','Phone','Batch',
  'CoachingName','TestTitle','Subject','Topic',
  'ObtainedMarks','TotalMarks','Percentage',
  'Correct','Wrong','Skipped','TimeSecs',
  'OverallRank','BatchRank','TestID','UserID'
];
const STUDENTS_HEADERS = [
  'RegisteredAt','Name','Email','Phone','Batch',
  'CoachingName','FatherName','FatherOccupation','WhatsApp',
  'TotalTests','TotalMarks','HighestMarks','UserID'
];

function getAuth() {
  let credentials;
  if (process.env.GOOGLE_CREDENTIALS_JSON) {
    try { credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON); }
    catch (e) { throw new Error('GOOGLE_CREDENTIALS_JSON is invalid JSON: ' + e.message); }
  } else {
    const p = path.join(__dirname, '..', '..', 'credentials.json');
    if (!fs.existsSync(p)) throw new Error('No Google credentials. Set GOOGLE_CREDENTIALS_JSON in Render env vars.');
    credentials = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive']
  });
}

function getSheetsClient() { return google.sheets({ version: 'v4', auth: getAuth() }); }
function getDriveClient()  { return google.drive ({ version: 'v3', auth: getAuth() }); }

async function ensureTab(client, spreadsheetId, tabName) {
  const meta = await client.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some(s => s.properties.title === tabName);
  if (!exists) {
    await client.spreadsheets.batchUpdate({
      spreadsheetId,
      resource: { requests: [{ addSheet: { properties: { title: tabName } } }] }
    });
  }
}

async function getRowCount(client, spreadsheetId, tab) {
  try {
    const res = await client.spreadsheets.values.get({ spreadsheetId, range: tab + '!A:A' });
    return (res.data.values || []).length;
  } catch (e) { return 0; }
}

async function initTab(client, spreadsheetId, tabName, headers) {
  await ensureTab(client, spreadsheetId, tabName);
  const rows = await getRowCount(client, spreadsheetId, tabName);
  if (rows === 0) {
    await client.spreadsheets.values.update({
      spreadsheetId, range: tabName + '!A1',
      valueInputOption: 'RAW',
      resource: { values: [headers] }
    });
  }
}

// Archive old rows when sheet gets too big
async function archiveIfNeeded(client) {
  const rows = await getRowCount(client, MAIN_SHEET_ID, 'Results');
  if (rows < ARCHIVE_TRIGGER + 1) return;

  console.log('[SHEETS] Archiving', ARCHIVE_CHUNK, 'rows...');
  const readRes = await client.spreadsheets.values.get({
    spreadsheetId: MAIN_SHEET_ID,
    range: 'Results!A2:T' + (ARCHIVE_CHUNK + 1)
  });
  const rowsToArchive = readRes.data.values || [];
  if (!rowsToArchive.length) return;

  // Get or create archive spreadsheet
  const drive = getDriveClient();
  let archiveId;
  const search = await drive.files.list({
    q: "name='AIITS_Archive' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    fields: 'files(id)', spaces: 'drive'
  });
  if (search.data.files && search.data.files.length > 0) {
    archiveId = search.data.files[0].id;
  } else {
    const created = await drive.files.create({
      resource: { name: 'AIITS_Archive', mimeType: 'application/vnd.google-apps.spreadsheet' },
      fields: 'id'
    });
    archiveId = created.data.id;
    if (process.env.ADMIN_EMAIL) {
      await drive.permissions.create({
        fileId: archiveId,
        resource: { type: 'user', role: 'writer', emailAddress: process.env.ADMIN_EMAIL }
      });
    }
    console.log('[SHEETS] Created archive sheet:', archiveId);
  }

  // Write to archive
  const archClient = getSheetsClient();
  await initTab(archClient, archiveId, 'Results', RESULTS_HEADERS);
  await archClient.spreadsheets.values.append({
    spreadsheetId: archiveId, range: 'Results!A:T',
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    resource: { values: rowsToArchive }
  });

  // Delete archived rows from main sheet
  const sheetMeta = await client.spreadsheets.get({ spreadsheetId: MAIN_SHEET_ID });
  const resultsSheet = sheetMeta.data.sheets.find(s => s.properties.title === 'Results');
  if (resultsSheet) {
    await client.spreadsheets.batchUpdate({
      spreadsheetId: MAIN_SHEET_ID,
      resource: { requests: [{ deleteDimension: { range: {
        sheetId: resultsSheet.properties.sheetId,
        dimension: 'ROWS', startIndex: 1, endIndex: 1 + rowsToArchive.length
      }}}]}
    });
  }
  console.log('[SHEETS] Archived', rowsToArchive.length, 'rows');
}

// Write a single result (used directly for low traffic)
exports.writeResult = async function(data) {
  try {
    const client = getSheetsClient();
    await initTab(client, MAIN_SHEET_ID, 'Results', RESULTS_HEADERS);
    const row = [
      new Date(data.submittedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),
      data.userName||'', data.userEmail||'', data.userPhone||'', data.batch||'',
      data.coachingName||'', data.testTitle||'', data.subject||'', data.topic||'',
      data.obtainedMarks||0, data.totalMarks||0, data.percentage||0,
      data.correctAnswers||0, data.wrongAnswers||0, data.notAttempted||0,
      data.timeTaken||0, data.rank||'', data.batchRank||'',
      String(data.testId||''), String(data.userId||'')
    ];
    await client.spreadsheets.values.append({
      spreadsheetId: MAIN_SHEET_ID, range: 'Results!A:T',
      valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
      resource: { values: [row] }
    });
    archiveIfNeeded(client).catch(e => console.error('[SHEETS] Archive error:', e.message));
    return true;
  } catch (err) { console.error('[SHEETS] writeResult error:', err.message); return false; }
};

// Write MULTIPLE results at once (used by queue for batch inserts - EFFICIENT)
exports.writeResultsBatch = async function(dataArray) {
  if (!dataArray || !dataArray.length) return true;
  const client = getSheetsClient();
  await initTab(client, MAIN_SHEET_ID, 'Results', RESULTS_HEADERS);
  const rows = dataArray.map(data => [
    new Date(data.submittedAt).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),
    data.userName||'', data.userEmail||'', data.userPhone||'', data.batch||'',
    data.coachingName||'', data.testTitle||'', data.subject||'', data.topic||'',
    data.obtainedMarks||0, data.totalMarks||0, data.percentage||0,
    data.correctAnswers||0, data.wrongAnswers||0, data.notAttempted||0,
    data.timeTaken||0, data.rank||'', data.batchRank||'',
    String(data.testId||''), String(data.userId||'')
  ]);
  // ONE API call for up to 50 rows - massively more efficient
  await client.spreadsheets.values.append({
    spreadsheetId: MAIN_SHEET_ID, range: 'Results!A:T',
    valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    resource: { values: rows }
  });
  archiveIfNeeded(client).catch(e => console.error('[SHEETS] Archive error:', e.message));
  return true;
};

// Write/update student row
exports.writeStudent = async function(data) {
  try {
    const client = getSheetsClient();
    await initTab(client, MAIN_SHEET_ID, 'Students', STUDENTS_HEADERS);
    // Check if student exists (by UserID in column M = index 12)
    const res = await client.spreadsheets.values.get({
      spreadsheetId: MAIN_SHEET_ID, range: 'Students!A:M'
    });
    const rows = res.data.values || [];
    let existingRow = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][12] === String(data.userId)) { existingRow = i + 1; break; }
    }
    const row = [
      new Date(data.createdAt||Date.now()).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}),
      data.name||'', data.email||'', data.phone||'', data.batch||'',
      data.coachingName||'', data.fatherName||'', data.fatherOccupation||'', data.whatsappNumber||'',
      data.totalTests||0, data.totalMarks||0, data.highestMarks||0, String(data.userId||'')
    ];
    if (existingRow > 0) {
      await client.spreadsheets.values.update({
        spreadsheetId: MAIN_SHEET_ID, range: 'Students!A' + existingRow,
        valueInputOption: 'RAW', resource: { values: [row] }
      });
    } else {
      await client.spreadsheets.values.append({
        spreadsheetId: MAIN_SHEET_ID, range: 'Students!A:M',
        valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
        resource: { values: [row] }
      });
    }
    return true;
  } catch (err) { console.error('[SHEETS] writeStudent error:', err.message); return false; }
};

// Read results for a test
exports.readTestResults = async function(testId) {
  try {
    const client = getSheetsClient();
    const res = await client.spreadsheets.values.get({
      spreadsheetId: MAIN_SHEET_ID, range: 'Results!A:T'
    });
    const rows = res.data.values || [];
    return rows.slice(1).filter(r => r[18] === String(testId)).map(r => ({
      submittedAt: r[0], userName: r[1], userEmail: r[2], userPhone: r[3], batch: r[4],
      coachingName: r[5], testTitle: r[6], subject: r[7], topic: r[8],
      obtainedMarks: Number(r[9])||0, totalMarks: Number(r[10])||0, percentage: Number(r[11])||0,
      correctAnswers: Number(r[12])||0, wrongAnswers: Number(r[13])||0, notAttempted: Number(r[14])||0,
      timeTaken: Number(r[15])||0, rank: Number(r[16])||null, batchRank: Number(r[17])||null,
      testId: r[18], userId: r[19]
    }));
  } catch (err) { console.error('[SHEETS] readTestResults error:', err.message); return []; }
};

// Read all results for a user
exports.readUserResults = async function(userId) {
  try {
    const client = getSheetsClient();
    const res = await client.spreadsheets.values.get({
      spreadsheetId: MAIN_SHEET_ID, range: 'Results!A:T'
    });
    const rows = res.data.values || [];
    return rows.slice(1).filter(r => r[19] === String(userId)).map(r => ({
      submittedAt: r[0], userName: r[1], userEmail: r[2], batch: r[4],
      testTitle: r[6], subject: r[7],
      obtainedMarks: Number(r[9])||0, totalMarks: Number(r[10])||0, percentage: Number(r[11])||0,
      correctAnswers: Number(r[12])||0, wrongAnswers: Number(r[13])||0, notAttempted: Number(r[14])||0,
      timeTaken: Number(r[15])||0, rank: Number(r[16])||null, batchRank: Number(r[17])||null,
      testId: r[18], userId: r[19]
    }));
  } catch (err) { console.error('[SHEETS] readUserResults error:', err.message); return []; }
};

// Sheet stats for admin dashboard
exports.getSheetStats = async function() {
  try {
    const client = getSheetsClient();
    const [rRows, sRows] = await Promise.all([
      getRowCount(client, MAIN_SHEET_ID, 'Results'),
      getRowCount(client, MAIN_SHEET_ID, 'Students')
    ]);
    return {
      resultsRows:  Math.max(0, rRows - 1),
      studentsRows: Math.max(0, sRows - 1),
      archiveTrigger: ARCHIVE_TRIGGER,
      mainSheetUrl: 'https://docs.google.com/spreadsheets/d/' + MAIN_SHEET_ID + '/edit'
    };
  } catch (err) { console.error('[SHEETS] getSheetStats error:', err.message); return null; }
};
