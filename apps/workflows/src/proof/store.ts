import { ProofRecord } from "@mira/schemas";
import { getDoc, listDocs, updateDoc, type Ports } from "@mira/runtime";
import { twinPath } from "../twin/profile";

/** Proofs live under the profile (`twins/{userId}/proofs/{proofId}`), so deleting it deletes them. */
export const proofPath = (userId: string, id: string) => `${twinPath(userId)}/proofs/${id}`;

type Store = Pick<Ports, "state">;

export const loadProof = (s: Store, userId: string, id: string) =>
  getDoc(s.state, proofPath(userId, id), ProofRecord);

export async function listProofs(s: Store, userId: string): Promise<ProofRecord[]> {
  const docs = await listDocs(s.state, `${twinPath(userId)}/proofs`, ProofRecord);
  return docs.map((d) => d.value).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function putProof(s: Store, p: ProofRecord): Promise<void> {
  await s.state.set(proofPath(p.userId, p.id), ProofRecord.parse(p));
}

/** Read-modify-write that validates both sides; a run that is delivered twice cannot double count. */
export async function changeProof(
  s: Store,
  userId: string,
  id: string,
  fn: (p: ProofRecord) => ProofRecord,
): Promise<ProofRecord | undefined> {
  const path = proofPath(userId, id);
  if ((await s.state.get(path)) === undefined) return undefined;
  return await updateDoc(s.state, path, ProofRecord, (current) => {
    if (!current) throw new Error("proof vanished");
    return fn(current);
  });
}
