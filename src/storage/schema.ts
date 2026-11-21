// A.3's shapes (M4's design, research/m4/DESIGN.md, §1.30, §6; PLAN §10,
// §11, D-24, D-25), which the stores (src/storage/profile.ts and
// settings.ts), the screens and the specs' storage seeding share: the keys,
// the profile and the settings as stored, the settings in force, their
// defaults, and what the screens need of the stores. Nothing here touches
// storage. Three-free.

import type { RenderQuality } from '../config';

export const PROFILE_KEY = 'terriest.v1.profile';
/** The last unreadable profile, verbatim (D-24). */
export const PROFILE_BACKUP_KEY = 'terriest.v1.profile.backup';
export const SETTINGS_KEY = 'terriest.v1.settings';

export interface Profile {
  readonly v: 1;
  /** 32 lowercase hex digits, once per browser (D-25). */
  readonly playerId: string;
  readonly name: string;
  /** An index in the coat list (L44). */
  readonly coat: number;
  /** For each kind of device, a bitmask of the six controls it has used (M4-Q28). */
  readonly hints: { readonly keyboard: number; readonly touch: number; readonly gamepad: number };
}

export interface TurnServer { readonly urls: string; readonly username: string; readonly credential: string }

/** The settings as stored. calmCamera and quality are null until the player chooses (A.3). */
export interface StoredSettings {
  readonly v: 1;
  readonly relays: readonly string[];
  readonly turn: readonly TurnServer[];
  readonly names: boolean;
  readonly ballView: boolean;
  readonly calmCamera: boolean | null;
  readonly mirrorTouch: boolean;
  readonly sound: boolean;
  readonly quality: RenderQuality | null;
}

/** The settings in force: the nulls resolved by their default rules, prefers-reduced-motion for the
 *  calmer camera and the device's default for the quality (A.3). */
export interface Settings extends Omit<StoredSettings, 'calmCamera' | 'quality'> {
  readonly calmCamera: boolean;
  readonly quality: RenderQuality;
}

/** PLAN §11's: no extra relays and no TURN server, names over terriers off, start in ball view on, the
 *  calmer camera and the quality following their rules, the mirrored layout off, sound on. */
export const DEFAULT_SETTINGS: StoredSettings = Object.freeze({
  v: 1,
  relays: Object.freeze([]),
  turn: Object.freeze([]),
  names: false,
  ballView: true,
  calmCamera: null,
  mirrorTouch: false,
  sound: true,
  quality: null,
});

/** What the screens need of src/storage/profile.ts's ProfileStore, which implements it. */
export interface ProfileSource {
  /** false: a write failed, and Home says so (PLAN §10). */
  readonly persistent: boolean;
  get(): Profile;
  /** The profile as `change` makes it, stored by one write of the whole record (PLAN §10). */
  update(change: (p: Profile) => Profile | null): boolean;
}

/** What the screens need of src/storage/settings.ts's SettingsStore, which implements it. */
export interface SettingsSource {
  /** false: a write failed, and Settings says the change is in force for this visit only (PLAN §10). */
  readonly persistent: boolean;
  /** The nulls resolved now, so a change of the system's preference still applies. */
  get(): Settings;
  stored(): StoredSettings;
  /** null, or the first problem, a relay's or a TURN server's, and nothing is stored. */
  set(change: Partial<StoredSettings>): string | null;
  /** The settings in force on each change; returns its removal. */
  subscribe(fn: (s: Settings) => void): () => void;
}
