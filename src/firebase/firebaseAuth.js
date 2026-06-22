import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from 'firebase/auth';

import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase.js';

// ── Sign in ───────────────────────────────────────────────────────────────────
export async function loginWithEmail(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  const user = credential.user;
  const profile = await getUserProfile(user.uid);
  return { uid: user.uid, email: user.email, ...profile };
}

// ── Sign out ──────────────────────────────────────────────────────────────────
export async function logout() {
  await signOut(auth);
}

// ── Password reset email ──────────────────────────────────────────────────────
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

// ── Change password ───────────────────────────────────────────────────────────
export async function changePassword(currentPassword, newPassword) {
  const user = auth.currentUser;
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
}

// ── Observe auth state ────────────────────────────────────────────────────────
export function observeAuthState(callback) {
  return onAuthStateChanged(auth, async (firebaseUser) => {
    if (!firebaseUser) {
      callback(null);
      return;
    }
    try {
      const profile = await getUserProfile(firebaseUser.uid);
      callback({ uid: firebaseUser.uid, email: firebaseUser.email, ...profile });
    } catch (err) {
      console.warn('Firestore unavailable, using default profile:', err.message);
      // FIX: default role is 'staff' not 'admin'
      // Only users with a Firestore document that has role:'admin' get admin access
      callback({
        uid:         firebaseUser.uid,
        email:       firebaseUser.email,
        name:        firebaseUser.displayName || firebaseUser.email.split('@')[0],
        role:        'staff',
        permissions: {},
        branch:      '',
      });
    }
  });
}

// ── Fetch user profile from Firestore ─────────────────────────────────────────
// Looks up by UID first, then falls back to email search across users collection
export async function getUserProfile(uid) {
  try {
    // Primary lookup: document ID = Firebase Auth UID
    const snap = await getDoc(doc(db, 'users', uid));
    if (snap.exists()) return snap.data();

    // Secondary lookup: search by uid field (handles app-created user records)
    const { getDocs, collection, query, where } = await import('firebase/firestore');
    const q = query(collection(db, 'users'), where('uid', '==', uid));
    const results = await getDocs(q);
    if (!results.empty) return results.docs[0].data();

    // No profile found — default to staff (NOT admin)
    // Admin must be explicitly set in Firestore
    return { name: 'User', role: 'staff', permissions: {}, branch: '' };

  } catch {
    // Firestore offline — default to staff
    return { name: 'User', role: 'staff', permissions: {}, branch: '' };
  }
}

// ── Save user profile ─────────────────────────────────────────────────────────
export async function saveUserProfile(uid, data) {
  try {
    await setDoc(doc(db, 'users', uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });
  } catch (err) {
    console.warn('Could not save profile to Firestore:', err.message);
  }
}

// ── Update last login timestamp ───────────────────────────────────────────────
export async function touchLastLogin(uid) {
  try {
    await updateDoc(doc(db, 'users', uid), { lastLogin: serverTimestamp() });
  } catch {
    // Firestore offline — silently ignore
  }
}
