import type { CalendarEvent } from './storage';

/**
 * Basic Google Calendar API logic.
 * Note: This implementation expects a valid OAuth2 flow or a Refresh Token.
 * Since the user provides Client ID / Secret manually, we would normally need an 'Authorization' code
 * to get the tokens. We'll implement a helper to generate the Auth URL.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API_URL = "https://www.googleapis.com/calendar/v3";
const REDIRECT_URI = "http://localhost";

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: number;
}

/**
 * Returns the URL to redirect the user to for Google OAuth authorization.
 */
export function getGoogleAuthUrl(clientId: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.readonly",
    access_type: "offline",
    prompt: "consent"
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

/**
 * Exchanges an authorization code for tokens.
 */
export async function getTokensFromCode(code: string, clientId: string, clientSecret: string): Promise<GoogleTokens> {
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: REDIRECT_URI,
      grant_type: "authorization_code"
    })
  });

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error_description || "Errore durante lo scambio del codice");
  }

  const data = await resp.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiryDate: Date.now() + (data.expires_in * 1000)
  };
}

/**
 * Refreshes an expired access token.
 */
export async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<GoogleTokens> {
  const resp = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token"
    })
  });

  if (!resp.ok) {
    throw new Error("Errore durante il refresh del token");
  }

  const data = await resp.json();
  return {
    accessToken: data.access_token,
    refreshToken: refreshToken, // Token rotation might happen but usually old one stays valid
    expiryDate: Date.now() + (data.expires_in * 1000)
  };
}

/**
 * Pushes a local event to Google Calendar.
 */
export async function pushEventToGoogle(event: CalendarEvent, token: string): Promise<string> {
    let start: any = { date: event.date };
    let end: any = { date: event.date };

    if (event.startTime) {
        // Timed event
        // Using local time string T HH:mm:00
        start = { dateTime: `${event.date}T${event.startTime}:00`, timeZone: 'Europe/Rome' };

        if (event.endTime) {
            end = { dateTime: `${event.date}T${event.endTime}:00`, timeZone: 'Europe/Rome' };
        } else {
            // Default +1 hour
            const [h, m] = event.startTime.split(':').map(Number);
            const endH = (h + 1) % 24;
            const endHStr = String(endH).padStart(2, '0');
            end = { dateTime: `${event.date}T${endHStr}:${String(m).padStart(2, '0')}:00`, timeZone: 'Europe/Rome' };
        }
    } else {
        // All-day event: Google requires end date to be exclusive (翌日)
        const endDate = new Date(event.date);
        endDate.setDate(endDate.getDate() + 1);
        end = { date: endDate.toISOString().split('T')[0] };
    }

    const googleEvent = {
        summary: event.activity,
        description: event.technician ? `Tecnico assegnato: ${event.technician}${event.notes ? `\nNote: ${event.notes}` : ''}` : '',
        start,
        end
    };

    const resp = await fetch(`${CALENDAR_API_URL}/calendars/primary/events`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(googleEvent)
    });

    if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error?.message || "Errore durante il push dell'evento");
    }

    const data = await resp.json();
    return data.id;
}

/**
 * Updates an existing event on Google Calendar.
 */
export async function updateEventInGoogle(event: CalendarEvent, googleEventId: string, token: string): Promise<void> {
    let start: any = { date: event.date };
    let end: any = { date: event.date };

    if (event.startTime) {
        // Timed event
        // Using local time string T HH:mm:00
        start = { dateTime: `${event.date}T${event.startTime}:00`, timeZone: 'Europe/Rome' };

        if (event.endTime) {
            end = { dateTime: `${event.date}T${event.endTime}:00`, timeZone: 'Europe/Rome' };
        } else {
            // Default +1 hour
            const [h, m] = event.startTime.split(':').map(Number);
            const endH = (h + 1) % 24;
            const endHStr = String(endH).padStart(2, '0');
            end = { dateTime: `${event.date}T${endHStr}:${String(m).padStart(2, '0')}:00`, timeZone: 'Europe/Rome' };
        }
    } else {
        // All-day event: Google requires end date to be exclusive (翌日)
        const endDate = new Date(event.date);
        endDate.setDate(endDate.getDate() + 1);
        end = { date: endDate.toISOString().split('T')[0] };
    }

    const googleEvent = {
        summary: event.activity,
        description: event.technician ? `Tecnico assegnato: ${event.technician}${event.notes ? `\nNote: ${event.notes}` : ''}` : '',
        start,
        end
    };

    const resp = await fetch(`${CALENDAR_API_URL}/calendars/primary/events/${googleEventId}`, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(googleEvent)
    });

    if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error?.message || "Errore durante l'aggiornamento dell'evento su Google Calendar");
    }
}

/**
 * Deletes an event from Google Calendar.
 */
export async function deleteEventFromGoogle(googleEventId: string, token: string): Promise<void> {
    const resp = await fetch(`${CALENDAR_API_URL}/calendars/primary/events/${googleEventId}`, {
        method: 'DELETE',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    if (!resp.ok) {
        // If status is 410 (Gone) or 404 (Not Found), it means the event is already deleted.
        // We should treat this as a success for our purposes.
        if (resp.status === 410 || resp.status === 404) {
            console.log(`[GoogleCalendar] Event ${googleEventId} already deleted (Status: ${resp.status})`);
            return;
        }

        const err = await resp.json();
        throw new Error(err.error?.message || "Errore durante l'eliminazione dell'evento da Google Calendar");
    }
}

/**
 * Fetches events from Google Calendar within a time range.
 * @param token Google access token
 * @param timeMin Start time in RFC3339 format (optional)
 * @param timeMax End time in RFC3339 format (optional)
 * @returns Array of Google Calendar events
 */
export async function fetchGoogleCalendarEvents(token: string, timeMin?: string, timeMax?: string): Promise<any[]> {
    const params = new URLSearchParams({
        singleEvents: 'true',
        orderBy: 'startTime'
    });

    if (timeMin) params.append('timeMin', timeMin);
    if (timeMax) params.append('timeMax', timeMax);

    const resp = await fetch(`${CALENDAR_API_URL}/calendars/primary/events?${params.toString()}`, {
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`
        }
    });

    if (!resp.ok) {
        const err = await resp.json();
        throw new Error(err.error?.message || "Errore durante il recupero degli eventi da Google Calendar");
    }

    const data = await resp.json();
    return data.items || [];
}

/**
 * Fetches recent emails from Gmail using the Gmail API.
 * @param token Google access token
 * @param maxResults Number of emails to fetch
 * @returns Array of FetchedEmail objects
 */
export async function fetchGmailEmails(token: string, maxResults: number = 15): Promise<any[]> {
    const listResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!listResp.ok) {
        const err = await listResp.json();
        throw new Error(err.error?.message || "Errore durante il recupero della lista email da Gmail");
    }

    const listData = await listResp.json();
    const messages = listData.messages || [];
    const results = [];

    for (const msg of messages) {
        const detailResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=full`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!detailResp.ok) continue;

        const detail = await detailResp.json();
        const headers = detail.payload.headers;
        const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(Nessun oggetto)';
        const from = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || '';
        const date = headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || '';

        let body = "";
        let attachments: any[] = [];

        const processPart = async (part: any) => {
            if (part.mimeType === "text/plain" && part.body.data) {
                // Gmail uses URL-safe base64
                const base64 = part.body.data.replace(/-/g, '+').replace(/_/g, '/');
                body += decodeURIComponent(escape(atob(base64)));
            } else if (part.mimeType === "application/pdf" && part.body.attachmentId) {
                // Fetch attachment content
                const attResp = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}/attachments/${part.body.attachmentId}`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (attResp.ok) {
                    const attData = await attResp.json();
                    // Convert URL-safe base64 to standard base64 for the UI
                    const standardBase64 = attData.data.replace(/-/g, '+').replace(/_/g, '/');
                    attachments.push({
                        filename: part.filename,
                        mimeType: part.mimeType,
                        data: standardBase64
                    });
                }
            }

            if (part.parts) {
                for (const subPart of part.parts) {
                    await processPart(subPart);
                }
            }
        };

        await processPart(detail.payload);

        results.push({
            id: msg.id,
            messageId: detail.threadId, // Use threadId as messageId for uniqueness in UI
            subject,
            from,
            date,
            body,
            attachments
        });
    }

    return results;
}
