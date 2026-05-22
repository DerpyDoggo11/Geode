import { getItem, type AnimKeyframe, type WeaponAnimDef } from './gui/items';

function lerpFrames(frames: AnimKeyframe[], t: number): [number, number, number] {
  if (frames.length === 0) return [0, 0, 0];
  if (t <= frames[0].time) return [...frames[0].armRot] as [number, number, number];
  const last = frames[frames.length - 1];
  if (t >= last.time) return [...last.armRot] as [number, number, number];

  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (t >= a.time && t <= b.time) {
      const u = (t - a.time) / (b.time - a.time);
      const s = u * u * (3 - 2 * u);
      return [
        a.armRot[0] + (b.armRot[0] - a.armRot[0]) * s,
        a.armRot[1] + (b.armRot[1] - a.armRot[1]) * s,
        a.armRot[2] + (b.armRot[2] - a.armRot[2]) * s,
      ];
    }
  }
  return [...last.armRot] as [number, number, number];
}

export interface ArmPose {
  active: boolean;
  rotX: number;
  rotY: number;
  rotZ: number;
}

type State = 'idle' | 'melee' | 'axe' | 'bow_charge' | 'bow_release';

export class WeaponAnimator {
  private def: WeaponAnimDef | null = null;

  private state: State = 'idle';
  private t = 0;
  private activeSwing: AnimKeyframe[] = [];

  private chargeT = 0;

  setWeapon(itemId: string | null): void {
    const item = itemId ? getItem(itemId) : null;
    this.def = item?.animation ?? null;
    this.state = 'idle';
    this.t = 0;
    this.chargeT = 0;
    this.activeSwing = [];
  }

  onMouseDown(button: number): void {
    if (!this.def) return;

    if (this.def.type === 'melee' && button === 0) {
      if (this.state === 'idle') this.startSwing('melee');
    }

    if (this.def.type === 'axe' && button === 2) {
      if (this.state === 'idle') this.startSwing('axe');
    }

    if (this.def.type === 'bow' && button === 0) {
      this.state = 'bow_charge';
      this.chargeT = 0;
    }
  }

  onMouseUp(button: number): void {
    if (!this.def) return;

    if (this.def.type === 'bow' && button === 0 && this.state === 'bow_charge') {
      this.state = 'bow_release';
      this.t = 0;
    }
  }

  isAttacking(): boolean {
    return this.state !== 'idle';
  }

  update(dt: number): ArmPose {
    if (!this.def || this.state === 'idle') {
      return { active: false, rotX: 0, rotY: 0, rotZ: 0 };
    }

    if (this.state === 'melee' || this.state === 'axe') {
      const dur = this.def.duration ?? 0.45;
      this.t = Math.min(this.t + dt / dur, 1);
      const [rx, ry, rz] = lerpFrames(this.activeSwing, this.t);
      if (this.t >= 1) this.state = 'idle';
      return { active: true, rotX: rx, rotY: ry, rotZ: rz };
    }

    if (this.state === 'bow_charge') {
      const chargeMax = this.def.chargeMax ?? 2;
      this.chargeT = Math.min(this.chargeT + dt, chargeMax);
      const normalized = this.chargeT / chargeMax;
      const [rx, ry, rz] = lerpFrames(this.def.bowCharge ?? [], normalized);
      return { active: true, rotX: rx, rotY: ry, rotZ: rz };
    }

    if (this.state === 'bow_release') {
      const dur = this.def.bowReleaseDuration ?? 0.35;
      this.t = Math.min(this.t + dt / dur, 1);
      const [rx, ry, rz] = lerpFrames(this.def.bowRelease ?? [], this.t);
      if (this.t >= 1) this.state = 'idle';
      return { active: true, rotX: rx, rotY: ry, rotZ: rz };
    }

    return { active: false, rotX: 0, rotY: 0, rotZ: 0 };
  }

  private startSwing(stateTarget: 'melee' | 'axe'): void {
    const pool = this.def?.swings ?? [];
    if (pool.length === 0) return;
    const pick = Math.floor(Math.random() * pool.length);
    this.activeSwing = pool[pick];
    this.state = stateTarget;
    this.t = 0;
  }
}
