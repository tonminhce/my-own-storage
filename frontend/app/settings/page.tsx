'use client';

import { motion } from 'framer-motion';
import { ArrowLeft, Palette, Globe } from 'lucide-react';
import Link from 'next/link';
import { useApp } from '../contexts/AppContext';

export default function SettingsPage() {
    const { theme, language, setTheme, setLanguage, t } = useApp();

    return (
        <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
            {/* Header */}
            <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-4 sm:px-6 lg:px-8 py-4">
                <div className="flex items-center gap-4">
                    <Link href="/" className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
                        <ArrowLeft className="w-5 h-5 text-gray-600 dark:text-gray-300" />
                    </Link>
                    <h1 className="text-2xl font-normal text-gray-900 dark:text-white">{t('settings')}</h1>
                </div>
            </header>

            <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                {/* Appearance Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6"
                >
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-purple-50 dark:bg-purple-900/20 rounded-lg flex items-center justify-center">
                            <Palette className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                        </div>
                        <h2 className="text-xl font-medium text-gray-900 dark:text-white">{t('appearance')}</h2>
                    </div>

                    <div className="space-y-4">
                        <div>
                            <p className="font-medium text-gray-900 dark:text-white mb-3">{t('theme')}</p>
                            <div className="flex gap-3">
                                    {(['light', 'dark', 'auto'] as const).map((themeOption) => (
                                        <button
                                            key={themeOption}
                                            onClick={() => setTheme(themeOption)}
                                            className={`px-4 py-2 rounded-lg border transition-colors ${
                                                theme === themeOption
                                                    ? 'border-blue-600 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400'
                                                    : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                                            }`}
                                        >
                                            {t(themeOption)}
                                        </button>
                                    ))}
                            </div>
                        </div>
                    </div>
                </motion.div>

                {/* Language Section */}
                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.1 }}
                    className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6 mb-6"
                >
                    <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 bg-orange-50 dark:bg-orange-900/20 rounded-lg flex items-center justify-center">
                            <Globe className="w-5 h-5 text-orange-600 dark:text-orange-400" />
                        </div>
                        <h2 className="text-xl font-medium text-gray-900 dark:text-white">{t('language')}</h2>
                    </div>

                    <div>
                        <p className="font-medium text-gray-900 dark:text-white mb-3">{t('languageLabel')}</p>
                        <select
                            value={language}
                            onChange={(e) => setLanguage(e.target.value as 'en' | 'vi')}
                            className="w-full px-4 py-2 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                        >
                            <option value="en">English</option>
                            <option value="vi">Tiếng Việt</option>
                        </select>
                    </div>
                </motion.div>
            </main>
        </div>
    );
}
