/**
 * 12 Hz Binary Wire Codec shared identically between Colyseus Bun Server and Web Client.
 *
 * Client -> Server Move Packet (11 Bytes fixed):
 *   [0]    u8   opcode = OP_CLIENT_MOVE (0x01)
 *   [1..2] u16  seq
 *   [3..4] i16  x quantized in 2cm units (-655m .. +655m)
 *   [5..6] i16  y quantized in 2cm units
 *   [7..8] i16  z quantized in 2cm units
 *   [9]    u8   yaw quantized 0..255 -> -PI..+PI
 *   [10]   u8   locomotion flags (bit0: moving, bit1: running, bit2: grounded, bit3: warmBuff, bits4..7: animState)
 *
 * Server -> Client World Snapshot:
 *   Header (6 Bytes):
 *     [0]    u8   opcode = OP_SERVER_SNAPSHOT (0x02)
 *     [1..2] u16  serverTick
 *     [3..4] u16  nearCount
 *     [5]    u8   farCount (Two-Tier AOI lantern silhouettes for 100-CCU Sunrise Festival!)
 *   Near Peer Record (12 Bytes * nearCount):
 *     [0..1] u16  peerNumericId
 *     [2..3] i16  x_2cm
 *     [4..5] i16  y_2cm
 *     [6..7] i16  z_2cm
 *     [8]    u8   yaw_u8
 *     [9]    u8   flags
 *     [10..11] i16 vx_dm_vz_dm (packed signed int8 vx, vz in 0.1 m/s units for Hermite spline!)
 *   Far Peer Silhouette Record (8 Bytes * farCount):
 *     [0..1] u16  peerNumericId
 *     [2..3] i16  x_2cm
 *     [4..5] i16  y_2cm
 *     [6..7] i16  z_2cm
 */

export const WIRE_OPCODES = {
  CLIENT_MOVE: 0x01,
  SERVER_SNAPSHOT: 0x02,
} as const;

export interface ClientMoveInput {
  seq: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  moving: boolean;
  running: boolean;
  grounded: boolean;
  warmBuff: boolean;
}

export interface NearPeerTransform {
  numericId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vz: number;
  moving: boolean;
  running: boolean;
  grounded: boolean;
  warmBuff: boolean;
}

export interface FarPeerBeacon {
  numericId: number;
  x: number;
  y: number;
  z: number;
}

export interface DecodedWorldSnapshot {
  serverTick: number;
  nearPeers: NearPeerTransform[];
  farPeers: FarPeerBeacon[];
}

const POS_SCALE = 50; // 1 unit = 2cm (0.02m), i16 covers +-655.34m

function clampI16(n: number): number {
  const r = Math.round(n);
  return r < -32767 ? -32767 : r > 32767 ? 32767 : r;
}

function clampI8(n: number): number {
  const r = Math.round(n);
  return r < -127 ? -127 : r > 127 ? 127 : r;
}

export function quantizeYaw(yawRad: number): number {
  const norm = ((((yawRad + Math.PI) / (Math.PI * 2)) % 1) + 1) % 1;
  return Math.round(norm * 255) & 0xff;
}

export function dequantizeYaw(u8: number): number {
  return (u8 / 255) * Math.PI * 2 - Math.PI;
}

export function encodeClientMove(input: ClientMoveInput): Uint8Array {
  const buf = new ArrayBuffer(11);
  const dv = new DataView(buf);
  dv.setUint8(0, WIRE_OPCODES.CLIENT_MOVE);
  dv.setUint16(1, input.seq & 0xffff, true);
  dv.setInt16(3, clampI16(input.x * POS_SCALE), true);
  dv.setInt16(5, clampI16(input.y * POS_SCALE), true);
  dv.setInt16(7, clampI16(input.z * POS_SCALE), true);
  dv.setUint8(9, quantizeYaw(input.yaw));
  const flags =
    (input.moving ? 1 : 0) |
    (input.running ? 2 : 0) |
    (input.grounded ? 4 : 0) |
    (input.warmBuff ? 8 : 0);
  dv.setUint8(10, flags);
  return new Uint8Array(buf);
}

export function decodeClientMove(bytes: Uint8Array | ArrayBuffer): Omit<ClientMoveInput, 'vx' | 'vz'> | null {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength < 11) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint8(0) !== WIRE_OPCODES.CLIENT_MOVE) return null;
  const seq = dv.getUint16(1, true);
  const x = dv.getInt16(3, true) / POS_SCALE;
  const y = dv.getInt16(5, true) / POS_SCALE;
  const z = dv.getInt16(7, true) / POS_SCALE;
  const yaw = dequantizeYaw(dv.getUint8(9));
  const flags = dv.getUint8(10);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return {
    seq,
    x,
    y,
    z,
    yaw,
    moving: (flags & 1) !== 0,
    running: (flags & 2) !== 0,
    grounded: (flags & 4) !== 0,
    warmBuff: (flags & 8) !== 0,
  };
}

export function encodeWorldSnapshot(
  serverTick: number,
  nearPeers: NearPeerTransform[],
  farPeers: FarPeerBeacon[]
): Uint8Array {
  const nearCount = Math.min(nearPeers.length, 64);
  const farCount = Math.min(farPeers.length, 128);
  const totalBytes = 6 + nearCount * 12 + farCount * 8;
  const buf = new ArrayBuffer(totalBytes);
  const dv = new DataView(buf);
  dv.setUint8(0, WIRE_OPCODES.SERVER_SNAPSHOT);
  dv.setUint16(1, serverTick & 0xffff, true);
  dv.setUint16(3, nearCount, true);
  dv.setUint8(5, farCount);

  let offset = 6;
  for (let i = 0; i < nearCount; i++) {
    const p = nearPeers[i];
    dv.setUint16(offset, p.numericId & 0xffff, true);
    dv.setInt16(offset + 2, clampI16(p.x * POS_SCALE), true);
    dv.setInt16(offset + 4, clampI16(p.y * POS_SCALE), true);
    dv.setInt16(offset + 6, clampI16(p.z * POS_SCALE), true);
    dv.setUint8(offset + 8, quantizeYaw(p.yaw));
    const flags =
      (p.moving ? 1 : 0) |
      (p.running ? 2 : 0) |
      (p.grounded ? 4 : 0) |
      (p.warmBuff ? 8 : 0);
    dv.setUint8(offset + 9, flags);
    dv.setInt8(offset + 10, clampI8(p.vx * 10));
    dv.setInt8(offset + 11, clampI8(p.vz * 10));
    offset += 12;
  }

  for (let i = 0; i < farCount; i++) {
    const f = farPeers[i];
    dv.setUint16(offset, f.numericId & 0xffff, true);
    dv.setInt16(offset + 2, clampI16(f.x * POS_SCALE), true);
    dv.setInt16(offset + 4, clampI16(f.y * POS_SCALE), true);
    dv.setInt16(offset + 6, clampI16(f.z * POS_SCALE), true);
    offset += 8;
  }

  return new Uint8Array(buf);
}

export function decodeWorldSnapshot(bytes: Uint8Array | ArrayBuffer): DecodedWorldSnapshot | null {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.byteLength < 6) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint8(0) !== WIRE_OPCODES.SERVER_SNAPSHOT) return null;
  const serverTick = dv.getUint16(1, true);
  const nearCount = dv.getUint16(3, true);
  const farCount = dv.getUint8(5);
  if (u8.byteLength < 6 + nearCount * 12 + farCount * 8) return null;

  const nearPeers: NearPeerTransform[] = [];
  const farPeers: FarPeerBeacon[] = [];

  let offset = 6;
  for (let i = 0; i < nearCount; i++) {
    const numericId = dv.getUint16(offset, true);
    const x = dv.getInt16(offset + 2, true) / POS_SCALE;
    const y = dv.getInt16(offset + 4, true) / POS_SCALE;
    const z = dv.getInt16(offset + 6, true) / POS_SCALE;
    const yaw = dequantizeYaw(dv.getUint8(offset + 8));
    const flags = dv.getUint8(offset + 9);
    const vx = dv.getInt8(offset + 10) / 10;
    const vz = dv.getInt8(offset + 11) / 10;
    nearPeers.push({
      numericId,
      x,
      y,
      z,
      yaw,
      vx,
      vz,
      moving: (flags & 1) !== 0,
      running: (flags & 2) !== 0,
      grounded: (flags & 4) !== 0,
      warmBuff: (flags & 8) !== 0,
    });
    offset += 12;
  }

  for (let i = 0; i < farCount; i++) {
    farPeers.push({
      numericId: dv.getUint16(offset, true),
      x: dv.getInt16(offset + 2, true) / POS_SCALE,
      y: dv.getInt16(offset + 4, true) / POS_SCALE,
      z: dv.getInt16(offset + 6, true) / POS_SCALE,
    });
    offset += 8;
  }

  return { serverTick, nearPeers, farPeers };
}

