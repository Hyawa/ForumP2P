/**
 * Network membership: hello bindings, the signed roster log, its authority
 * fold, and invite codes.
 *
 * This module is pure and transport-agnostic: it never touches the network or
 * the database. The core package persists the ops it produces; the node package
 * moves them between peers.
 */
import { canonicalBytes } from './canonical';
import { base64urlDecode, base64urlEncode } from './encoding';
import { contentId } from './hash';
import { sign, verify } from './crypto';
import { NETWORK_ROLE, INVITE, type NetworkRole, type RosterOpType } from './constants';
import { InviteCodeSchema, type InviteCode, type RosterOp } from './schemas';

const HELLO_DOMAIN = 'pforum-hello@2';
const ROSTER_DOMAIN = 'pforum-roster-op@2';
const INVITE_DOMAIN = 'pforum-invite@2';

// --- hello binding ----------------------------------------------------------

export interface HelloBindingInput {
  user: string;
  peerId: string;
  addrs?: string[];
}

export function helloPayload(input: HelloBindingInput): Uint8Array {
  return canonicalBytes({
    t: HELLO_DOMAIN,
    user: input.user,
    peerId: input.peerId,
    addrs: input.addrs ?? [],
  });
}

export async function signHello(input: HelloBindingInput, privateKey: string): Promise<string> {
  return sign(helloPayload(input), privateKey);
}

export async function verifyHello(
  input: Required<Pick<HelloBindingInput, 'user' | 'peerId'>> & { addrs?: string[] },
  signature: string,
): Promise<boolean> {
  return verify(signature, helloPayload(input), input.user);
}

// --- roster ops -------------------------------------------------------------

export interface RosterOpInput {
  networkId: string;
  opType: RosterOpType;
  subject: string;
  role: NetworkRole | null;
  epoch: number;
  author: string;
  prevHash: string | null;
  createdAt: number;
}

function rosterOpCanonical(input: RosterOpInput): Record<string, unknown> {
  return {
    t: ROSTER_DOMAIN,
    networkId: input.networkId,
    opType: input.opType,
    subject: input.subject,
    role: input.role,
    epoch: input.epoch,
    author: input.author,
    prevHash: input.prevHash,
    createdAt: input.createdAt,
  };
}

export function rosterOpId(input: RosterOpInput): string {
  return contentId(rosterOpCanonical(input));
}

export async function signRosterOp(input: RosterOpInput, privateKey: string): Promise<RosterOp> {
  const opId = rosterOpId(input);
  const signature = await sign(canonicalBytes(rosterOpCanonical(input)), privateKey);
  return { ...input, opId, signature };
}

export async function verifyRosterOp(op: RosterOp): Promise<boolean> {
  const { opId, signature, ...input } = op;
  if (rosterOpId(input) !== opId) return false;
  return verify(signature, canonicalBytes(rosterOpCanonical(input)), op.author);
}

// --- roster fold (authority) ------------------------------------------------

export interface MemberState {
  user: string;
  role: NetworkRole;
  active: boolean;
  epoch: number;
}

export interface RosterState {
  owner: string | null;
  members: Map<string, MemberState>;
  rejected: number;
}

/** Deterministic ordering of the append-only log. */
export function sortRosterOps(ops: RosterOp[]): RosterOp[] {
  return [...ops].sort(
    (a, b) =>
      a.epoch - b.epoch ||
      a.createdAt - b.createdAt ||
      (a.opId < b.opId ? -1 : a.opId > b.opId ? 1 : 0),
  );
}

/**
 * Folds the roster log into the current membership, enforcing the
 * owner-centric authority rules:
 *  - `create` is valid only once, by the subject themselves.
 *  - `add`/`remove` require an active owner or admin.
 *  - `remove` can never remove the owner.
 *  - `setRole` requires the owner.
 * Invalid ops are counted and skipped, so a single bad op cannot corrupt state.
 */
export function foldRoster(ops: RosterOp[]): RosterState {
  const members = new Map<string, MemberState>();
  let owner: string | null = null;
  let rejected = 0;

  for (const op of sortRosterOps(ops)) {
    const signer = members.get(op.author);
    const isOwner = signer?.active === true && signer.role === NETWORK_ROLE.OWNER;
    const canAdminister =
      signer?.active === true &&
      (signer.role === NETWORK_ROLE.OWNER || signer.role === NETWORK_ROLE.ADMIN);

    switch (op.opType) {
      case 'create':
        if (owner === null && op.author === op.subject) {
          owner = op.author;
          members.set(op.author, {
            user: op.author,
            role: NETWORK_ROLE.OWNER,
            active: true,
            epoch: op.epoch,
          });
        } else {
          rejected += 1;
        }
        break;
      case 'add':
        if (canAdminister) {
          members.set(op.subject, {
            user: op.subject,
            role: op.role ?? NETWORK_ROLE.MEMBER,
            active: true,
            epoch: op.epoch,
          });
        } else {
          rejected += 1;
        }
        break;
      case 'remove': {
        const target = members.get(op.subject);
        if (canAdminister && op.subject !== owner && target) {
          members.set(op.subject, { ...target, active: false, epoch: op.epoch });
        } else {
          rejected += 1;
        }
        break;
      }
      case 'setRole':
        if (isOwner && op.subject !== owner) {
          const target = members.get(op.subject);
          if (target) {
            members.set(op.subject, {
              ...target,
              role: op.role ?? NETWORK_ROLE.MEMBER,
              active: true,
              epoch: op.epoch,
            });
          } else {
            rejected += 1;
          }
        } else {
          rejected += 1;
        }
        break;
      default:
        rejected += 1;
    }
  }

  return { owner, members, rejected };
}

export function isActiveMember(state: RosterState, user: string): boolean {
  return state.members.get(user)?.active === true;
}

export function roleOf(state: RosterState, user: string): NetworkRole | null {
  const member = state.members.get(user);
  return member && member.active ? member.role : null;
}

// --- invite codes -----------------------------------------------------------

export interface InviteInput {
  networkId: string;
  secret: string;
  inviter: string;
  addrs: string[];
  expiresAt: number;
  maxUses: number;
}

function inviteCanonical(input: InviteInput): Record<string, unknown> {
  return {
    t: INVITE_DOMAIN,
    v: 2,
    networkId: input.networkId,
    secret: input.secret,
    inviter: input.inviter,
    addrs: input.addrs,
    expiresAt: input.expiresAt,
    maxUses: input.maxUses,
  };
}

export async function signInvite(input: InviteInput, privateKey: string): Promise<InviteCode> {
  const signature = await sign(canonicalBytes(inviteCanonical(input)), privateKey);
  return {
    v: 2,
    networkId: input.networkId,
    secret: input.secret,
    inviter: input.inviter,
    addrs: input.addrs,
    expiresAt: input.expiresAt,
    maxUses: input.maxUses,
    signature,
  };
}

export async function verifyInvite(invite: InviteCode): Promise<boolean> {
  const { signature, v: _v, ...rest } = invite;
  return verify(signature, canonicalBytes(inviteCanonical(rest)), invite.inviter);
}

/** Encodes an invite into a copy/paste, QR-friendly text code. */
export function encodeInviteCode(invite: InviteCode): string {
  return `${INVITE.PREFIX}${base64urlEncode(canonicalBytes(invite))}`;
}

export function decodeInviteCode(code: string): InviteCode {
  const trimmed = code.trim();
  const payload = trimmed.startsWith(INVITE.PREFIX)
    ? trimmed.slice(INVITE.PREFIX.length)
    : trimmed;
  const bytes = base64urlDecode(payload);
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  return InviteCodeSchema.parse(parsed);
}

/** Human-readable hint shown next to a generated code. */
export const INVITE_CODE_HELP = `Invite codes start with "${INVITE.PREFIX}" and can be shared as text or a QR image.`;
