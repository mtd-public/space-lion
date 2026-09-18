import { clamp } from './utils.js';

// Handles the virtual thumbstick (bottom-left) and tap-to-shoot (everywhere else),
// unified across touch/mouse via Pointer Events, plus a keyboard fallback for desktop.
export class InputManager {
  constructor(canvas) {
    this.canvas = canvas;

    this.hasDirection = false;
    this.dirX = 0;
    this.dirY = 0;

    this.isFiring = false;
    this.fireJustPressed = false;

    // Joystick visual state (for rendering the stick UI).
    this.stickActive = false;
    this.stickBaseX = 0;
    this.stickBaseY = 0;
    this.stickThumbX = 0;
    this.stickThumbY = 0;
    this.stickRadius = 58;

    this._joystickPointerId = null;
    this._firePointerIds = new Set();

    this._keys = new Set();

    this._bind();
  }

  _zoneIsJoystick(x, y) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    return x < w * 0.5 && y > h * 0.52;
  }

  _bind() {
    const el = this.canvas;

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const x = e.clientX;
      const y = e.clientY;

      if (this._joystickPointerId === null && this._zoneIsJoystick(x, y)) {
        this._joystickPointerId = e.pointerId;
        this.stickActive = true;
        this.stickBaseX = x;
        this.stickBaseY = y;
        this.stickThumbX = x;
        this.stickThumbY = y;
      } else {
        this._firePointerIds.add(e.pointerId);
        this.isFiring = true;
        this.fireJustPressed = true;
      }
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }, { passive: false });

    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this._joystickPointerId) return;
      e.preventDefault();
      this._updateStick(e.clientX, e.clientY);
    }, { passive: false });

    const endPointer = (e) => {
      if (e.pointerId === this._joystickPointerId) {
        this._joystickPointerId = null;
        this.stickActive = false;
        // Keep last direction — ship keeps flying the way it was last steered.
      }
      if (this._firePointerIds.has(e.pointerId)) {
        this._firePointerIds.delete(e.pointerId);
        if (this._firePointerIds.size === 0) this.isFiring = false;
      }
    };
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', endPointer);
    el.addEventListener('pointerleave', endPointer);

    window.addEventListener('keydown', (e) => this._keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this._keys.delete(e.key.toLowerCase()));
  }

  _updateStick(x, y) {
    let dx = x - this.stickBaseX;
    let dy = y - this.stickBaseY;
    const d = Math.hypot(dx, dy);
    if (d > this.stickRadius) {
      dx = (dx / d) * this.stickRadius;
      dy = (dy / d) * this.stickRadius;
    }
    this.stickThumbX = this.stickBaseX + dx;
    this.stickThumbY = this.stickBaseY + dy;

    const deadzone = 6;
    if (d > deadzone) {
      this.hasDirection = true;
      this.dirX = dx / (d > this.stickRadius ? this.stickRadius : d || 1);
      this.dirY = dy / (d > this.stickRadius ? this.stickRadius : d || 1);
      // Normalize direction vector.
      const n = Math.hypot(this.dirX, this.dirY) || 1;
      this.dirX /= n;
      this.dirY /= n;
    }
  }

  // Call once per frame after game logic has consumed fireJustPressed.
  clearFrameFlags() {
    this.fireJustPressed = false;
  }

  // Keyboard fallback direction (WASD / arrows), used only if no touch stick engaged.
  keyboardDirection() {
    let x = 0, y = 0;
    const k = this._keys;
    if (k.has('arrowleft') || k.has('a')) x -= 1;
    if (k.has('arrowright') || k.has('d')) x += 1;
    if (k.has('arrowup') || k.has('w')) y -= 1;
    if (k.has('arrowdown') || k.has('s')) y += 1;
    if (x === 0 && y === 0) return null;
    const n = Math.hypot(x, y) || 1;
    return { x: x / n, y: y / n };
  }

  keyboardFiring() {
    return this._keys.has(' ');
  }
}
