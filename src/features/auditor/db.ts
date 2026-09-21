/**
 * ThreadMax — IndexedDB Vault (Relationship Intelligence)
 * Local-first storage for follower snapshots & diff history.
 */

import { RelationshipDiff, Snapshot, computeRelationshipDiff, validateSnapshotContract } from '../utils';
import { INDEXED_DB } from '../constants';

let dbPromise: Promise<IDBDatabase> | null = null;

export function initDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(INDEXED_DB.NAME, INDEXED_DB.VERSION);
    
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(INDEXED_DB.STORE_SNAPSHOTS)) {
        db.createObjectStore(INDEXED_DB.STORE_SNAPSHOTS, { keyPath: 'id', autoIncrement: true });
      }
    };
    
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  
  return dbPromise;
}

export async function saveSnapshot(data: {
  username: string;
  followers: string[];
  following: string[];
  diff?: RelationshipDiff;
}): Promise<{ id: number; timestamp: number; username: string; followers: string[]; following: string[]; diff: RelationshipDiff }> {
  const db = await initDB();
  const prev = await getLatestSnapshot();
  const followers = data.followers || [];
  const following = data.following || [];
  const diff = data.diff || computeRelationshipDiff(followers, following, prev);
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXED_DB.STORE_SNAPSHOTS, 'readwrite');
    const store = tx.objectStore(INDEXED_DB.STORE_SNAPSHOTS);
    const record = {
      timestamp: Date.now(),
      username: data.username || 'me',
      followers,
      following,
      diff,
    };
    const req = store.add(record);
    req.onsuccess = () => resolve({ id: req.result, ...record });
    req.onerror = () => reject(req.error);
  });
}

export async function getLatestSnapshot(): Promise<Snapshot | null> {
  const db = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXED_DB.STORE_SNAPSHOTS, 'readonly');
    const store = tx.objectStore(INDEXED_DB.STORE_SNAPSHOTS);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      resolve(all.length > 0 ? all[all.length - 1] : null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getAllSnapshots(): Promise<Snapshot[]> {
  const db = await initDB();
  
  return new Promise((resolve, reject) => {
    const tx = db.transaction(INDEXED_DB.STORE_SNAPSHOTS, 'readonly');
    const store = tx.objectStore(INDEXED_DB.STORE_SNAPSHOTS);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

export { computeRelationshipDiff, validateSnapshotContract, type RelationshipDiff, type Snapshot };