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
    scope: "https://www.googleapis.com/auth/calendar.events",
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
