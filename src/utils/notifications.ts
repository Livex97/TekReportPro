import { getAiSettings } from './storage';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

export async function sendAppNotification(title: string, body: string) {
    const settings = await getAiSettings();
    if (!settings.notificationsEnabled) return;

    try {
        let hasPermission = await isPermissionGranted();
        if (!hasPermission) {
            const permission = await requestPermission();
            hasPermission = permission === 'granted';
        }

        if (hasPermission) {
            sendNotification({ title, body });
        }
    } catch (error) {
        console.error('Failed to send notification:', error);
    }
}
