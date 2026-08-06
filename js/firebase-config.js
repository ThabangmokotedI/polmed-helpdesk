// ============================================================
// POLMED HELPDESK — FIREBASE CONFIGURATION
// ============================================================
// STATUS: web app config filled in below (project: polmed-helpdesk).
//
// REMAINING SETUP STEPS in Firebase Console:
//    - Authentication → Sign-in method → Enable "Email/Password"
//    - Firestore Database → Create database → Start in production mode
//    - Firestore → Rules → paste the rules from docs/firestore.rules
//    - Authentication → Users → Add user (email + password for each agent)
//
// NOTE: this apiKey is safe to commit — it only identifies this project to
// the browser and does not by itself grant read/write access. The value
// that must stay secret is the service account key, which lives only in
// Netlify's environment variables (see README.md).
// ============================================================

export const firebaseConfig = {
  apiKey: "AIzaSyDVH8TQ7jRWF7EbFzJxUJERULmITcxQwHc",
  authDomain: "polmed-helpdesk.firebaseapp.com",
  projectId: "polmed-helpdesk",
  storageBucket: "polmed-helpdesk.firebasestorage.app",
  messagingSenderId: "467429881077",
  appId: "1:467429881077:web:dbaf1c3d94bdd684c401bc"
};
