/**
 * LocalStorage service for blog drafts
 * Provides offline-first editing with automatic backup
 */

export interface BlogDraftData {
  id?: string;
  title: string;
  subtitle?: string;
  content: string;
  coverImage?: string;
  titleColor?: string;
  showAuthorName?: boolean;
  lastSaved: number; // timestamp
  version: number; // for conflict resolution
}

const STORAGE_PREFIX = 'blog_draft_';
const STORAGE_VERSION = 1;

export class BlogStorageService {
  /**
   * Save draft to localStorage
   */
  static saveDraft(draftId: string | undefined, data: Omit<BlogDraftData, 'lastSaved' | 'version'>): void {
    try {
      const key = draftId ? `${STORAGE_PREFIX}${draftId}` : `${STORAGE_PREFIX}new`;
      
      const existing = this.getDraft(draftId);
      const version = existing ? existing.version + 1 : 1;

      const draftData: BlogDraftData = {
        ...data,
        lastSaved: Date.now(),
        version,
      };

      localStorage.setItem(key, JSON.stringify(draftData));
      
      // Also save to a list of all drafts for recovery
      this.addToRecoveryList(key);
      
      console.log(`[BlogStorage] Saved draft to localStorage: ${key}`);
    } catch (error) {
      console.error('[BlogStorage] Failed to save to localStorage:', error);
      // If localStorage is full, try to clean old drafts
      this.cleanOldDrafts();
    }
  }

  /**
   * Get draft from localStorage
   */
  static getDraft(draftId: string | undefined): BlogDraftData | null {
    try {
      const key = draftId ? `${STORAGE_PREFIX}${draftId}` : `${STORAGE_PREFIX}new`;
      const data = localStorage.getItem(key);
      
      if (!data) return null;
      
      const parsed = JSON.parse(data) as BlogDraftData;
      console.log(`[BlogStorage] Retrieved draft from localStorage: ${key}`);
      return parsed;
    } catch (error) {
      console.error('[BlogStorage] Failed to retrieve from localStorage:', error);
      return null;
    }
  }

  /**
   * Delete draft from localStorage
   */
  static deleteDraft(draftId: string | undefined): void {
    try {
      const key = draftId ? `${STORAGE_PREFIX}${draftId}` : `${STORAGE_PREFIX}new`;
      localStorage.removeItem(key);
      this.removeFromRecoveryList(key);
      console.log(`[BlogStorage] Deleted draft from localStorage: ${key}`);
    } catch (error) {
      console.error('[BlogStorage] Failed to delete from localStorage:', error);
    }
  }

  /**
   * Check if local draft is newer than server version
   */
  static isLocalNewer(localDraft: BlogDraftData, serverUpdatedAt: string): boolean {
    const serverTime = new Date(serverUpdatedAt).getTime();
    return localDraft.lastSaved > serverTime;
  }

  /**
   * Get all recovery drafts (for crash recovery)
   */
  static getAllRecoveryDrafts(): Array<{ key: string; data: BlogDraftData }> {
    try {
      const recoveryList = this.getRecoveryList();
      const drafts: Array<{ key: string; data: BlogDraftData }> = [];

      for (const key of recoveryList) {
        const data = localStorage.getItem(key);
        if (data) {
          try {
            drafts.push({ key, data: JSON.parse(data) });
          } catch (e) {
            console.error(`[BlogStorage] Failed to parse draft ${key}:`, e);
          }
        }
      }

      return drafts;
    } catch (error) {
      console.error('[BlogStorage] Failed to get recovery drafts:', error);
      return [];
    }
  }

  /**
   * Clean old drafts (older than 7 days)
   */
  private static cleanOldDrafts(): void {
    try {
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const recoveryList = this.getRecoveryList();

      for (const key of recoveryList) {
        const data = localStorage.getItem(key);
        if (data) {
          try {
            const parsed = JSON.parse(data) as BlogDraftData;
            if (parsed.lastSaved < sevenDaysAgo) {
              localStorage.removeItem(key);
              this.removeFromRecoveryList(key);
              console.log(`[BlogStorage] Cleaned old draft: ${key}`);
            }
          } catch (e) {
            // If we can't parse it, remove it
            localStorage.removeItem(key);
            this.removeFromRecoveryList(key);
          }
        }
      }
    } catch (error) {
      console.error('[BlogStorage] Failed to clean old drafts:', error);
    }
  }

  /**
   * Add draft key to recovery list
   */
  private static addToRecoveryList(key: string): void {
    try {
      const list = this.getRecoveryList();
      if (!list.includes(key)) {
        list.push(key);
        localStorage.setItem(`${STORAGE_PREFIX}recovery_list`, JSON.stringify(list));
      }
    } catch (error) {
      console.error('[BlogStorage] Failed to add to recovery list:', error);
    }
  }

  /**
   * Remove draft key from recovery list
   */
  private static removeFromRecoveryList(key: string): void {
    try {
      const list = this.getRecoveryList();
      const filtered = list.filter(k => k !== key);
      localStorage.setItem(`${STORAGE_PREFIX}recovery_list`, JSON.stringify(filtered));
    } catch (error) {
      console.error('[BlogStorage] Failed to remove from recovery list:', error);
    }
  }

  /**
   * Get recovery list
   */
  private static getRecoveryList(): string[] {
    try {
      const data = localStorage.getItem(`${STORAGE_PREFIX}recovery_list`);
      return data ? JSON.parse(data) : [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Clear all blog drafts from localStorage
   */
  static clearAll(): void {
    try {
      const recoveryList = this.getRecoveryList();
      for (const key of recoveryList) {
        localStorage.removeItem(key);
      }
      localStorage.removeItem(`${STORAGE_PREFIX}recovery_list`);
      console.log('[BlogStorage] Cleared all drafts from localStorage');
    } catch (error) {
      console.error('[BlogStorage] Failed to clear all drafts:', error);
    }
  }
}
