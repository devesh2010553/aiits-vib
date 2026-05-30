const admin = require('firebase-admin');

let initialized = false;

function getFirebaseAdmin() {
  if (initialized) return admin;

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error(
      'FIREBASE_SERVICE_ACCOUNT_JSON not set in Render env vars.\n' +
      'Steps:\n' +
      '1. Firebase Console > Project Settings > Service Accounts\n' +
      '2. Click "Generate New Private Key" > Download JSON\n' +
      '3. In Render > Environment > Add FIREBASE_SERVICE_ACCOUNT_JSON = paste entire JSON content'
    );
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson);
  } catch (e) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ' + e.message);
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });

  initialized = true;
  console.log('[FIREBASE] Admin initialized for project:', serviceAccount.project_id);
  return admin;
}

// Verify Firebase ID token sent from frontend
// Returns decoded token with uid, email etc.
exports.verifyIdToken = async (idToken) => {
  const fb = getFirebaseAdmin();
  const decoded = await fb.auth().verifyIdToken(idToken);
  return decoded;
};

// Create a Firebase user (used during registration)
exports.createFirebaseUser = async (email, password, displayName) => {
  const fb = getFirebaseAdmin();
  const user = await fb.auth().createUser({
    email,
    password,
    displayName,
    emailVerified: false
  });
  return user;
};

// Delete Firebase user (used when student deletes account)
exports.deleteFirebaseUser = async (uid) => {
  const fb = getFirebaseAdmin();
  await fb.auth().deleteUser(uid);
};

// Get Firebase user by email
exports.getFirebaseUserByEmail = async (email) => {
  const fb = getFirebaseAdmin();
  return await fb.auth().getUserByEmail(email);
};

// Update Firebase user password (admin action)
exports.updateFirebasePassword = async (uid, newPassword) => {
  const fb = getFirebaseAdmin();
  await fb.auth().updateUser(uid, { password: newPassword });
};

module.exports.getAdmin = getFirebaseAdmin;
