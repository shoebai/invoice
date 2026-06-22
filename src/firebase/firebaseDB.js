// ─────────────────────────────────────────────────────────────────────────────
// firebaseDB.js  —  Firestore data layer
//
// Replaces IndexedDB for invoices, clients, settings and users.
// All saves go to Firestore → both PCs see changes in real-time.
//
// Place this file at:  src/firebase/firebaseDB.js
// ─────────────────────────────────────────────────────────────────────────────

import {
  collection, doc,
  getDocs, getDoc, setDoc, deleteDoc, updateDoc,
  onSnapshot, query, orderBy,
  serverTimestamp, writeBatch,
} from 'firebase/firestore';

import { db } from './firebase.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
const col   = (name) => collection(db, name);
const docRef = (name, id) => doc(db, name, id);
const ts     = () => ({ updatedAt: new Date().toISOString() });

// ── INVOICES ──────────────────────────────────────────────────────────────────
export async function fsGetInvoices() {
  const snap = await getDocs(query(col('invoices'), orderBy('issueDate', 'desc')));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fsSaveInvoice(inv) {
  const ref = docRef('invoices', inv.id);
  await setDoc(ref, { ...inv, ...ts() }, { merge: true });
}

export async function fsDeleteInvoice(id) {
  await deleteDoc(docRef('invoices', id));
}

// Real-time listener — calls callback whenever invoices change on any PC
export function fsListenInvoices(callback) {
  return onSnapshot(
    query(col('invoices'), orderBy('issueDate', 'desc')),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.warn('Firestore invoices listener error:', err.message)
  );
}

// ── CLIENTS ───────────────────────────────────────────────────────────────────
export async function fsGetClients() {
  const snap = await getDocs(col('clients'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fsSaveClient(client) {
  await setDoc(docRef('clients', client.id), { ...client, ...ts() }, { merge: true });
}

export async function fsDeleteClient(id) {
  await deleteDoc(docRef('clients', id));
}

export function fsListenClients(callback) {
  return onSnapshot(
    col('clients'),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.warn('Firestore clients listener error:', err.message)
  );
}

// ── SETTINGS ──────────────────────────────────────────────────────────────────
export async function fsGetSettings() {
  const snap = await getDoc(docRef('settings', 'main'));
  return snap.exists() ? snap.data() : {};
}

export async function fsSaveSettings(settingsObj) {
  await setDoc(docRef('settings', 'main'), { ...settingsObj, ...ts() }, { merge: true });
}

export function fsListenSettings(callback) {
  return onSnapshot(
    docRef('settings', 'main'),
    snap => callback(snap.exists() ? snap.data() : {}),
    err => console.warn('Firestore settings listener error:', err.message)
  );
}

// ── USERS (with roles) ────────────────────────────────────────────────────────
export async function fsGetUsers() {
  const snap = await getDocs(col('users'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function fsSaveUser(user) {
  await setDoc(docRef('users', user.id), { ...user, ...ts() }, { merge: true });
}

export async function fsDeleteUser(id) {
  await deleteDoc(docRef('users', id));
}

// Get a single user profile by UID (used for role lookup after Firebase Auth login)
export async function fsGetUserByUid(uid) {
  const snap = await getDoc(docRef('users', uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

// Get a single user profile by email
export async function fsGetUserByEmail(email) {
  const snap = await getDocs(col('users'));
  const match = snap.docs.find(d => d.data().email === email);
  return match ? { id: match.id, ...match.data() } : null;
}

export function fsListenUsers(callback) {
  return onSnapshot(
    col('users'),
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => console.warn('Firestore users listener error:', err.message)
  );
}

// ── SEED default data (first-time setup) ─────────────────────────────────────
export async function fsSeedIfEmpty(defaultSettings) {
  const snap = await getDocs(col('invoices'));
  if (!snap.empty) return; // already has data

  // Seed settings
  await fsSaveSettings(defaultSettings);

  // Seed one sample client
  const clientId = 'client-sample-1';
  await fsSaveClient({
    id: clientId,
    nameEn: 'Arabian Grand Hospitality',
    nameAr: 'شركة الضيافة العربية الكبرى',
    vat: '310987654300003',
    phone: '+966501234567',
    email: 'info@arabgrand.sa',
    address: 'Olaya District, Riyadh',
  });
}
