import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  query,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from './firebase'

function userPacksRef(uid) {
  return collection(db, 'users', uid, 'packs')
}

function userComponentsRef(uid) {
  return collection(db, 'users', uid, 'components')
}

// Packs

export async function getPacks(uid) {
  const snap = await getDocs(userPacksRef(uid))
  const packs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  packs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return packs
}

export async function getPack(uid, id) {
  const snap = await getDoc(doc(db, 'users', uid, 'packs', id))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() }
}

export async function createPack(uid, name, description = '') {
  const id = crypto.randomUUID()
  const data = { name, description, createdAt: Date.now() }
  await setDoc(doc(db, 'users', uid, 'packs', id), data)
  return { id, ...data }
}

export async function deletePack(uid, id) {
  const q = query(userComponentsRef(uid), where('packId', '==', id))
  const snap = await getDocs(q)
  const batch = writeBatch(db)
  snap.docs.forEach((d) => batch.delete(d.ref))
  batch.delete(doc(db, 'users', uid, 'packs', id))
  await batch.commit()
}

// Components

export async function getComponents(uid, packId) {
  const q = query(userComponentsRef(uid), where('packId', '==', packId))
  const snap = await getDocs(q)
  const comps = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  comps.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
  return comps
}

export async function getComponent(uid, id) {
  const snap = await getDoc(doc(db, 'users', uid, 'components', id))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() }
}

export async function getAllComponents(uid) {
  const snap = await getDocs(userComponentsRef(uid))
  const comps = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  comps.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
  return comps
}

export async function deleteComponent(uid, id) {
  await deleteDoc(doc(db, 'users', uid, 'components', id))
}
