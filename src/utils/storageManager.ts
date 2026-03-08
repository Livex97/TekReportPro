// storageManager.ts

// Cross-platform storage management code

// Import necessary modules for different operating systems
import { Platform } from 'react-native';

const StorageManager = {
    setItem: async (key, value) => {
        try {
            if (Platform.OS === 'ios') {
                // iOS specific storage logic
                await AsyncStorage.setItem(key, value);
            } else if (Platform.OS === 'android') {
                // Android specific storage logic
                await AsyncStorage.setItem(key, value);
            } else {
                // Fallback for other platforms
                console.warn('Platform not supported for storage!');
            }
        } catch (error) {
            console.error('Error saving data', error);
        }
    },
    getItem: async (key) => {
        try {
            if (Platform.OS === 'ios') {
                return await AsyncStorage.getItem(key);
            } else if (Platform.OS === 'android') {
                return await AsyncStorage.getItem(key);
            } else {
                console.warn('Platform not supported for retrieval!');
                return null;
            }
        } catch (error) {
            console.error('Error retrieving data', error);
            return null;
        }
    }
};

export default StorageManager;
