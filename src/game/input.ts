// Pointer control. The swarm target follows the pointer's *screen* position, re-projected
// every frame (the camera keeps moving). Touch aims a little above the finger so the thumb
// doesn't cover the swarm; double tap or a second finger = flash. Mouse: hold to lead,
// double click = flash. Keyboard: space = flash, arrows/WASD nudge the target.

export type InputHooks = {
  toWorld: (px: number, py: number) => [number, number];
  getTarget: () => [number, number];
  setTarget: (x: number, y: number) => void;
  setGuiding: (on: boolean) => void;
  flash: () => void;
  firstGesture: () => void;
  enabled: () => boolean;
};

/** css px the touch target sits above the finger */
const TOUCH_LIFT = 46;

export class Input {
  isTouch = false;
  private active = new Map<number, { x: number; y: number; t: number; type: string }>();
  private lastTap = { t: 0, x: 0, y: 0 };
  private keys = new Set<string>();

  constructor(private el: HTMLElement, private h: InputHooks) {
    el.addEventListener('pointerdown', this.down, { passive: false });
    el.addEventListener('pointermove', this.move, { passive: false });
    el.addEventListener('pointerup', this.up);
    el.addEventListener('pointercancel', this.up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if (!this.h.enabled()) return;
      if (e.code === 'Space') {
        e.preventDefault();
        this.h.firstGesture();
        if (!e.repeat) this.h.flash();
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
  }

  private down = (e: PointerEvent) => {
    e.preventDefault();
    this.h.firstGesture();
    if (!this.h.enabled()) return;
    this.el.setPointerCapture?.(e.pointerId);
    const now = performance.now();
    const isTouch = e.pointerType !== 'mouse';
    this.isTouch = isTouch;
    if (isTouch && this.active.size >= 1) {
      // a second finger while steering = flash
      this.h.flash();
      this.active.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now, type: 'extra' });
      return;
    }
    const dt = now - this.lastTap.t;
    if (dt < 320 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 70) {
      this.h.flash();
      this.lastTap.t = 0;
    }
    this.active.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now, type: isTouch ? 'touch' : 'mouse' });
    this.h.setGuiding(true);
    this.aim();
  };

  private move = (e: PointerEvent) => {
    const p = this.active.get(e.pointerId);
    if (!p || !this.h.enabled()) return;
    e.preventDefault();
    p.x = e.clientX;
    p.y = e.clientY;
    this.aim();
  };

  /** Point the swarm at the steering pointer (touch: slightly above the finger). */
  private aim() {
    for (const p of this.active.values()) {
      if (p.type === 'extra') continue;
      const [wx, wy] = this.h.toWorld(p.x, p.y - (p.type === 'touch' ? TOUCH_LIFT : 0));
      this.h.setTarget(wx, wy);
      return;
    }
  }

  private up = (e: PointerEvent) => {
    const p = this.active.get(e.pointerId);
    if (!p) return;
    this.active.delete(e.pointerId);
    if (p.type !== 'extra') {
      const now = performance.now();
      if (now - p.t < 220) this.lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    let steering = false;
    for (const a of this.active.values()) if (a.type !== 'extra') steering = true;
    if (!steering) {
      // promote a remaining extra finger to the steering one
      for (const a of this.active.values()) { a.type = 'touch'; steering = true; break; }
    }
    this.h.setGuiding(steering);
  };

  /** Keyboard nudging; call every frame. */
  update(dt: number) {
    if (!this.h.enabled()) return;
    this.aim();
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) dx -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) dx += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) dy += 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) dy -= 1;
    if (dx || dy) {
      const [tx, ty] = this.h.getTarget();
      this.h.setTarget(tx + dx * 320 * dt, ty + dy * 320 * dt);
      this.h.setGuiding(true);
      this.keyGuiding = true;
    } else if (this.keyGuiding) {
      this.keyGuiding = false;
      if (this.active.size === 0) this.h.setGuiding(false);
    }
  }
  private keyGuiding = false;

  reset() {
    this.active.clear();
    this.h.setGuiding(false);
  }
}
