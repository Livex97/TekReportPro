#!/usr/bin/env python3
import sys
import json
import imaplib
import email
from email.header import decode_header
import base64
import socket
import traceback

def clean_text(text):
    if not text:
        return ""
    # Strip non-unicode characters if needed, or just standard strip
    return text.strip()

def decode_mime_words(s):
    if not s:
        return ""
    decoded_words = decode_header(s)
    result = []
    for word, charset in decoded_words:
        if isinstance(word, bytes):
            if charset:
                try:
                    result.append(word.decode(charset))
                except (LookupError, UnicodeDecodeError):
                    result.append(word.decode('utf-8', errors='replace'))
            else:
                result.append(word.decode('utf-8', errors='replace'))
        else:
            result.append(str(word))
    return "".join(result)

def fetch_emails(host, port, username, password, max_emails=15):
    import io
    import sys
    from contextlib import redirect_stderr

    debug_output = io.StringIO()
    mail = None
    try:
        # Attiviamo il debug di imaplib e catturiamo l'output
        # Impostiamo un timeout per la connessione (es. 30 secondi)
        mail = imaplib.IMAP4_SSL(host, port, timeout=30)
        mail.debug = 4
        
        with redirect_stderr(debug_output):
            try:
                # Forza la codifica utf-8 per username e password
                u = username.strip()
                p = password.strip()
                mail.login(u, p)
            except Exception as login_err:
                # Se il login fallisce, recuperiamo il log di debug
                details = debug_output.getvalue()
                # Puliamo i dettagli per non mostrare la password in chiaro (solitamente è offuscata ma meglio essere certi)
                safe_details = details.replace(password, "********")
                error_msg = str(login_err)
                if isinstance(login_err, bytes):
                    error_msg = login_err.decode('utf-8', errors='ignore')
                return {
                    "success": False, 
                    "error": f"Autenticazione fallita: {error_msg}\n\nDETTAGLI TECNICI:\n{safe_details}"
                }

        mail.select("INBOX", readonly=True) # Readonly per non modificare flag accidentalmente

        # Cerca tutte le email per prendere le più recenti
        status, messages = mail.search(None, "ALL")
        if status != "OK":
            return {"error": "Impossibile recuperare i messaggi."}

        email_ids = messages[0].split()
        
        # Prendi solo le ultime N email
        recent_ids = email_ids[-max_emails:] if len(email_ids) > max_emails else email_ids
        
        # Le ordiniamo dalla più recente alla più vecchia
        recent_ids.reverse()

        results = []

        for e_id in recent_ids:
            status, msg_data = mail.fetch(e_id, "(RFC822)")
            if status != "OK":
                continue

            for response_part in msg_data:
                if isinstance(response_part, tuple):
                    msg = email.message_from_bytes(response_part[1])

                    subject = decode_mime_words(msg.get("Subject", ""))
                    sender = decode_mime_words(msg.get("From", ""))
                    date_str = str(msg.get("Date", ""))
                    msg_id = str(msg.get("Message-ID", ""))

                    body_text = ""
                    attachments = []

                    if msg.is_multipart():
                        for part in msg.walk():
                            content_type = part.get_content_type()
                            content_disposition = str(part.get("Content-Disposition"))

                            # Extract plain text body
                            if content_type == "text/plain" and "attachment" not in content_disposition:
                                try:
                                    charset = part.get_content_charset()
                                    if charset:
                                        body_text += part.get_payload(decode=True).decode(charset, errors='replace') + "\n"
                                    else:
                                        body_text += part.get_payload(decode=True).decode('utf-8', errors='replace') + "\n"
                                except Exception:
                                    pass
                            
                            # Extract PDF attachments
                            if "attachment" in content_disposition or part.get_filename():
                                filename = part.get_filename()
                                if filename:
                                    filename = decode_mime_words(filename)
                                    if filename.lower().endswith('.pdf') or content_type == 'application/pdf':
                                        payload = part.get_payload(decode=True)
                                        if payload:
                                            b64_data = base64.b64encode(payload).decode('utf-8')
                                            attachments.append({
                                                "filename": filename,
                                                "mimeType": "application/pdf",
                                                "data": b64_data
                                            })
                    else:
                        # Non multipart
                        content_type = msg.get_content_type()
                        if content_type == "text/plain":
                            try:
                                charset = msg.get_content_charset()
                                if charset:
                                    body_text = msg.get_payload(decode=True).decode(charset, errors='replace')
                                else:
                                    body_text = msg.get_payload(decode=True).decode('utf-8', errors='replace')
                            except Exception:
                                pass

                    results.append({
                        "id": e_id.decode('utf-8') if isinstance(e_id, bytes) else str(e_id),
                        "messageId": msg_id,
                        "subject": subject,
                        "from": sender,
                        "date": date_str,
                        "body": clean_text(body_text),
                        "attachments": attachments
                    })

        mail.close()
        mail.logout()

        return {"success": True, "emails": results}

    except imaplib.IMAP4.error as e:
        return {"success": False, "error": f"Errore IMAP: {str(e)}"}
    except (socket.timeout, TimeoutError):
        return {"success": False, "error": f"La connessione al server {host} è andata in timeout. Verifica l'indirizzo host, la porta e la tua connessione internet."}
    except Exception as e:
        error_str = str(e)
        if "timeout" in error_str.lower() or "[Errno 60]" in error_str:
            return {"success": False, "error": f"Timeout della connessione: Il server {host} non ha risposto in tempo. Assicurati che l'host e la porta ({port}) siano corretti."}
        return {"success": False, "error": f"Errore inatteso: {error_str}", "traceback": traceback.format_exc()}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Parametri mancanti."}))
        sys.exit(1)

    try:
        config = json.loads(sys.argv[1])
        host = config.get("host", "imap.aruba.it").strip()
        port = int(config.get("port", 993))
        username = config.get("username", "").strip()
        password = config.get("password", "").strip()
        max_emails = int(config.get("max_emails", 15))

        if not username or not password:
            print(json.dumps({"success": False, "error": f"Username o password mancanti (ricevuto username: '{username}')"}))
            sys.exit(1)

        result = fetch_emails(host, port, username, password, max_emails)
        
        # Se fallisce l'autenticazione, aggiungiamo info di debug (senza password)
        if not result.get("success") and "Authentication failed" in str(result.get("error")):
            result["error"] += f" [Debug: Host={host}, Port={port}, User={username}]"
            
        print(json.dumps(result))

    except json.JSONDecodeError:
        print(json.dumps({"success": False, "error": "JSON non valido fornito come argomento."}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({"success": False, "error": f"Errore main: {str(e)}"}))
        sys.exit(1)

if __name__ == "__main__":
    main()
