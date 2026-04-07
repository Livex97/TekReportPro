import { getCalendarEvents, getGoogleSettings, setCalendarEvents, setGoogleSettings, type GoogleCalendarSettings } from './storage';
import { pushEventToGoogle, refreshAccessToken, type GoogleTokens } from './googleCalendar';

/**
 * SyncManager coordinates the background synchronization process.
 */

let isSyncRunning = false;
let syncTimeoutId: number | null = null;

/**
 * Starts the automatic synchronization cycle.
 */
export async function startAutoSync() {
  if (isSyncRunning) return;
  console.log('[SyncManager] Starting Auto Sync cycle...');
  isSyncRunning = true;
  runSyncCycle();
}

/**
 * Stops the automatic synchronization cycle.
 */
export function stopAutoSync() {
  isSyncRunning = false;
  if (syncTimeoutId) {
    clearTimeout(syncTimeoutId);
    syncTimeoutId = null;
  }
}

async function runSyncCycle() {
  if (!isSyncRunning) return;

  try {
    const settings = await getGoogleSettings();
    if (settings.enabled && settings.refreshToken) {
      await performSync(settings);
    }
  } catch (e) {
    console.error('[SyncManager] Sync cycle failed:', e);
  }

  // Schedule next run even if failed (every 5 minutes)
  syncTimeoutId = window.setTimeout(runSyncCycle, 5 * 60 * 1000);
}

/**
 * Performs a single sync operation.
 */
export async function performSync(settings: GoogleCalendarSettings) {
  if (!settings.refreshToken || !settings.clientId || !settings.clientSecret) {
    console.warn('[SyncManager] Missing credentials for sync');
    return;
  }

  console.log('[SyncManager] Performing sync...');

  // 1. Refresh token if needed
  let tokens: GoogleTokens = {
    accessToken: settings.accessToken || '',
    refreshToken: settings.refreshToken,
    expiryDate: settings.expiryDate || 0
  };

  if (!tokens.accessToken || Date.now() > tokens.expiryDate) {
    console.log('[SyncManager] Token expired, refreshing...');
    try {
      tokens = await refreshAccessToken(settings.refreshToken, settings.clientId, settings.clientSecret);
      // Update settings with new token
      await setGoogleSettings({
        ...settings,
        accessToken: tokens.accessToken,
        expiryDate: tokens.expiryDate
      });
    } catch (e) {
      console.error('[SyncManager] Refresh failed:', e);
      return;
    }
  }

  // 2. Fetch local events
  const events = await getCalendarEvents();
  let hasChanges = false;

  // 3. For each event that has no googleEventId, push it
  for (const event of events) {
    if (!event.googleEventId) {
      try {
        console.log(`[SyncManager] Pushing event: ${event.activity}`);
        const googleId = await pushEventToGoogle(event, tokens.accessToken);
        event.googleEventId = googleId;
        hasChanges = true;
      } catch (e) {
        console.error(`[SyncManager] Failed to push event ${event.id}:`, e);
      }
    }
  }

  // 4. Save updated events back to storage
  if (hasChanges) {
    await setCalendarEvents(events);
    await setGoogleSettings({
      ...settings,
      lastSync: new Date().toISOString()
    });
    console.log('[SyncManager] Sync completed successfully.');
  } else {
    console.log('[SyncManager] Nothing to sync.');
  }
}
