import { getCalendarEvents, getGoogleSettings, setCalendarEvents, setGoogleSettings, type GoogleCalendarSettings, type CalendarEvent, getGoogleEventMap, setGoogleEventMap } from './storage';
import { pushEventToGoogle, refreshAccessToken, fetchGoogleCalendarEvents, type GoogleTokens } from './googleCalendar';

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
 * Performs a single sync operation - bi-directional sync (Google -> App)
 */
export async function performSync(settings: GoogleCalendarSettings) {
  if (!settings.refreshToken || !settings.clientId || !settings.clientSecret) {
    console.warn('[SyncManager] Missing credentials for sync');
    return;
  }

  console.log('[SyncManager] Performing periodic sync (Google -> App)...');

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

  // 2. Fetch local events and map
  const localEvents = await getCalendarEvents();
  const googleEventMap = await getGoogleEventMap();
  
  // 3. Determine time range for fetching Google events (last 30 days to next 30 days)
  const now = new Date();
  const timeMinDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const timeMaxDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days future
  const timeMin = timeMinDate.toISOString();
  const timeMax = timeMaxDate.toISOString();
  
  // 4. Fetch events from Google Calendar
  let googleEvents;
  try {
    googleEvents = await fetchGoogleCalendarEvents(tokens.accessToken, timeMin, timeMax);
    console.log(`[SyncManager] Fetched ${googleEvents.length} events from Google Calendar`);
  } catch (e) {
    console.error('[SyncManager] Failed to fetch Google Calendar events:', e);
    return;
  }
  
  // 5. Build lookup maps
  const googleEventsById = new Map();
  googleEvents.forEach(ge => googleEventsById.set(ge.id, ge));

  const updatedEvents = [...localEvents];
  const updatedEventMap = { ...googleEventMap };
  let hasChanges = false;

  // 6. Process Google events -> Add or Update local events
  for (const gEvent of googleEvents) {
    const localId = Object.keys(updatedEventMap).find(id => updatedEventMap[id] === gEvent.id);
    const convertedGEvent = convertGoogleEventToCalendarEvent(gEvent);
    if (!convertedGEvent) continue;

    if (localId) {
      // Existing event - check for updates
      const localIdx = updatedEvents.findIndex(e => e.id === localId);
      if (localIdx !== -1) {
        const localEvent = updatedEvents[localIdx];
        
        // Simple comparison of fields to see if we need to update
        const needsUpdate = 
          localEvent.activity !== convertedGEvent.activity ||
          localEvent.date !== convertedGEvent.date ||
          localEvent.technician !== convertedGEvent.technician ||
          localEvent.startTime !== convertedGEvent.startTime ||
          localEvent.endTime !== convertedGEvent.endTime ||
          localEvent.notes !== convertedGEvent.notes;

        if (needsUpdate) {
          console.log(`[SyncManager] Updating local event ${localId} from Google update`);
          updatedEvents[localIdx] = {
            ...localEvent,
            ...convertedGEvent,
            id: localId, // Keep local ID
            googleEventId: gEvent.id
          };
          hasChanges = true;
        }
      }
    } else {
      // New event from Google - check if duplicate by content before adding
      const isDuplicate = localEvents.some(le => 
        le.activity === convertedGEvent.activity &&
        le.date === convertedGEvent.date &&
        le.startTime === convertedGEvent.startTime &&
        le.endTime === convertedGEvent.endTime &&
        le.technician === convertedGEvent.technician
      );

      if (!isDuplicate) {
        console.log(`[SyncManager] Importing new event from Google: ${convertedGEvent.activity}`);
        const newLocalEvent = { ...convertedGEvent, googleEventId: gEvent.id };
        updatedEvents.push(newLocalEvent);
        updatedEventMap[newLocalEvent.id] = gEvent.id;
        hasChanges = true;
      } else {
        // It's a duplicate but not in map - let's map it to avoid future reprocessing
        const existingEvent = localEvents.find(le => 
          le.activity === convertedGEvent.activity &&
          le.date === convertedGEvent.date &&
          le.startTime === convertedGEvent.startTime &&
          le.endTime === convertedGEvent.endTime &&
          le.technician === convertedGEvent.technician
        );
        if (existingEvent) {
          console.log(`[SyncManager] Mapping existing local event ${existingEvent.id} to Google event ${gEvent.id}`);
          updatedEventMap[existingEvent.id] = gEvent.id;
          // Also update the event itself to have the googleEventId
          const idx = updatedEvents.findIndex(e => e.id === existingEvent.id);
          if (idx !== -1) {
            updatedEvents[idx] = { ...updatedEvents[idx], googleEventId: gEvent.id };
          }
          hasChanges = true;
        }
      }
    }
  }

  // 7. Check for events deleted on Google
  // Iterate through local events that have a googleEventId
  for (let i = updatedEvents.length - 1; i >= 0; i--) {
    const localEvent = updatedEvents[i];
    const googleId = updatedEventMap[localEvent.id] || localEvent.googleEventId;

    if (googleId) {
      // Only check events within the fetched time range
      const eventDate = new Date(localEvent.date);
      if (eventDate >= timeMinDate && eventDate <= timeMaxDate) {
        if (!googleEventsById.has(googleId)) {
          console.log(`[SyncManager] Event ${localEvent.activity} was deleted from Google, removing locally...`);
          updatedEvents.splice(i, 1);
          delete updatedEventMap[localEvent.id];
          hasChanges = true;
        }
      }
    }
  }

  // 8. Finalize changes
  if (hasChanges) {
    await setCalendarEvents(updatedEvents);
    await setGoogleEventMap(updatedEventMap);
    
    await setGoogleSettings({
      ...settings,
      lastSync: new Date().toISOString()
    });
    console.log('[SyncManager] Sync completed with changes.');
    
    // Dispatch custom event so UI can refresh
    window.dispatchEvent(new CustomEvent('sync-completed'));
  } else {
    console.log('[SyncManager] Sync completed - no changes found.');
  }
}

/**
 * Converts a Google Calendar event to our CalendarEvent format
 * @param googleEvent The Google Calendar event object
 * @returns CalendarEvent or null if conversion fails
 */
function convertGoogleEventToCalendarEvent(googleEvent: any): CalendarEvent | null {
  try {
    // Extract date and time from Google event
    let date: string = '';
    let startTime: string | undefined;
    let endTime: string | undefined;
    
    // Handle all-day events
    if (googleEvent.start.date) {
      date = googleEvent.start.date;
      // All-day events don't have times
    } else if (googleEvent.start.dateTime) {
      const startDateTime = new Date(googleEvent.start.dateTime);
      date = startDateTime.toISOString().split('T')[0]; // YYYY-MM-DD
      startTime = startDateTime.toISOString().split('T')[1].substring(0, 5); // HH:mm
      
      if (googleEvent.end.dateTime) {
        const endDateTime = new Date(googleEvent.end.dateTime);
        endTime = endDateTime.toISOString().split('T')[1].substring(0, 5); // HH:mm
      }
    }
    
    if (!date) {
      console.warn('[SyncManager] Could not extract date from Google event:', googleEvent);
      return null;
    }
    
    // Extract description to get technician and notes
    const description = googleEvent.description || '';
    let technician = '';
    let notes = '';
    
    if (description) {
      const lines = description.split('\n');
      for (const line of lines) {
        if (line.startsWith('Tecnico assegnato:')) {
          technician = line.substring('Tecnico assegnato:'.length).trim();
        } else if (line.startsWith('Note:')) {
          notes = line.substring('Note:'.length).trim();
        }
      }
    }
    
    // Create the CalendarEvent
    const calendarEvent: CalendarEvent = {
      id: crypto.randomUUID(), // Generate new ID for local storage
      date,
      activity: googleEvent.summary || '(Senza titolo)',
      technician,
      startTime,
      endTime,
      notes: notes || undefined,
      googleEventId: googleEvent.id // Store the Google event ID for future reference
    };
    
    return calendarEvent;
  } catch (error) {
    console.error('[SyncManager] Error converting Google event:', error);
    return null;
  }
}
