export type DisplayDensity = 'comfortable' | 'compact';

export interface Identity {
  id: string;
  name: string;
}

export interface Preferences {
  displayDensity: DisplayDensity;
  timezone: 'America/Denver';
  weekStartsOn: 1;
}

export interface Gateway {
  getIdentity(): Promise<Identity | null>;
  isOwner(): Promise<boolean>;
  loadPreferences(userId: string): Promise<Preferences>;
  savePreferences(userId: string, density: DisplayDensity): Promise<Preferences>;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  onIdentityChange(listener: () => void): () => void;
}

export const defaultPreferences: Preferences = {
  displayDensity: 'comfortable',
  timezone: 'America/Denver',
  weekStartsOn: 1,
};
