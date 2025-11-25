'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

type Theme = 'light' | 'dark' | 'auto';
type Language = 'en' | 'vi';

interface AppContextType {
    theme: Theme;
    language: Language;
    setTheme: (theme: Theme) => void;
    setLanguage: (language: Language) => void;
    t: (key: string) => string;
}

const translations: Record<Language, Record<string, string>> = {
    en: {
        settings: 'Settings',
        appearance: 'Appearance',
        theme: 'Theme',
        light: 'Light',
        dark: 'Dark',
        auto: 'Auto',
        language: 'Language & Region',
        languageLabel: 'Language',
        saveChanges: 'Save Changes',
        cancel: 'Cancel',
        saved: 'Settings saved successfully!',
        profile: 'Profile',
        myDrive: 'My Drive',
        recent: 'Recent',
        starred: 'Starred',
        trash: 'Trash',
        newUpload: 'New',
        searchFiles: 'Search in Drive',
        noFiles: 'No files yet',
        getStarted: 'Get started by uploading your first file',
        uploadFiles: 'Upload Files',
        myFiles: 'My Files',
        uploading: 'Uploading',
    },
    vi: {
        settings: 'Cài đặt',
        appearance: 'Giao diện',
        theme: 'Chủ đề',
        light: 'Sáng',
        dark: 'Tối',
        auto: 'Tự động',
        language: 'Ngôn ngữ & Vùng',
        languageLabel: 'Ngôn ngữ',
        saveChanges: 'Lưu thay đổi',
        cancel: 'Hủy',
        saved: 'Đã lưu cài đặt thành công!',
        profile: 'Hồ sơ',
        myDrive: 'Ổ của tôi',
        recent: 'Gần đây',
        starred: 'Đã gắn dấu sao',
        trash: 'Thùng rác',
        newUpload: 'Mới',
        searchFiles: 'Tìm kiếm trong Drive',
        noFiles: 'Chưa có tệp nào',
        getStarted: 'Bắt đầu bằng cách tải lên tệp đầu tiên của bạn',
        uploadFiles: 'Tải tệp lên',
        myFiles: 'Tệp của tôi',
        uploading: 'Đang tải lên',
    },
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Theme>('light');
    const [language, setLanguageState] = useState<Language>('en');

    // Load from localStorage on mount
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const savedTheme = localStorage.getItem('theme') as Theme | null;
            const savedLanguage = localStorage.getItem('language') as Language | null;
            
            if (savedTheme) setThemeState(savedTheme);
            if (savedLanguage) setLanguageState(savedLanguage);
        }
    }, []);

    // Apply theme
    useEffect(() => {
        if (typeof window === 'undefined') return;
        
        const root = document.documentElement;
        const applyTheme = (themeMode: 'light' | 'dark') => {
            if (themeMode === 'dark') {
                root.classList.add('dark');
            } else {
                root.classList.remove('dark');
            }
        };

        if (theme === 'auto') {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            applyTheme(mediaQuery.matches ? 'dark' : 'light');
            
            const handler = (e: MediaQueryListEvent) => {
                applyTheme(e.matches ? 'dark' : 'light');
            };
            mediaQuery.addEventListener('change', handler);
            return () => mediaQuery.removeEventListener('change', handler);
        } else {
            applyTheme(theme);
        }
    }, [theme]);

    const setTheme = (newTheme: Theme) => {
        setThemeState(newTheme);
        if (typeof window !== 'undefined') {
            localStorage.setItem('theme', newTheme);
        }
    };

    const setLanguage = (newLanguage: Language) => {
        setLanguageState(newLanguage);
        if (typeof window !== 'undefined') {
            localStorage.setItem('language', newLanguage);
        }
    };

    const t = (key: string): string => {
        return translations[language][key] || key;
    };

    return (
        <AppContext.Provider value={{ theme, language, setTheme, setLanguage, t }}>
            {children}
        </AppContext.Provider>
    );
}

export function useApp() {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error('useApp must be used within an AppProvider');
    }
    return context;
}

